import { createHash } from "node:crypto";
import { createDb } from "@viberimenya/db";

type SqlClient = ReturnType<typeof createDb>["client"];

export type AdminAuditSeverity = "info" | "warning" | "critical";

export type AdminAuditInput = {
  shopId: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  severity?: AdminAuditSeverity;
  ip?: string | null;
  userAgent?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 5;
const MAX_ACTIVE_SESSIONS = 3;

export function createLoginFingerprint(login: string) {
  return createHash("sha256")
    .update(login.trim().toLowerCase())
    .digest("hex")
    .slice(0, 40);
}

export function maskLogin(login: string) {
  const value = login.trim();

  if (!value) return "пустой логин";

  if (value.includes("@")) {
    const [name = "", domain = ""] = value.split("@");
    const safeName = name.length <= 2
      ? `${name.slice(0, 1)}*`
      : `${name.slice(0, 2)}***`;

    return `${safeName}@${domain}`;
  }

  const digits = value.replace(/\D/g, "");

  if (digits.length >= 4) {
    return `***${digits.slice(-4)}`;
  }

  return `${value.slice(0, 1)}***`;
}

export async function writeAdminAudit(
  client: SqlClient,
  input: AdminAuditInput
) {
  const metadata = JSON.stringify(input.metadata ?? {});

  await client`
    INSERT INTO admin_audit_log (
      shop_id,
      actor_user_id,
      actor_role,
      event_type,
      entity_type,
      entity_id,
      severity,
      ip,
      user_agent,
      summary,
      metadata,
      created_at
    )
    VALUES (
      ${input.shopId},
      ${input.actorUserId ?? null},
      ${input.actorRole ?? null},
      ${input.eventType.slice(0, 100)},
      ${input.entityType ?? null},
      ${input.entityId ?? null},
      ${(input.severity ?? "info").slice(0, 20)},
      ${input.ip ?? null},
      ${input.userAgent ?? null},
      ${input.summary.slice(0, 500)},
      CAST(${metadata} AS jsonb),
      NOW()
    )
  `;
}

export async function persistentLoginBlockSeconds(
  client: SqlClient,
  params: {
    shopId: string;
    ip: string;
    loginFingerprint: string;
  }
) {
  const rows = await client<{
    failures: number;
    retry_after_seconds: number;
  }[]>`
    SELECT
      COUNT(*)::int AS failures,
      CASE
        WHEN COUNT(*) >= ${LOGIN_MAX_FAILURES}
        THEN GREATEST(
          0,
          CEIL(
            EXTRACT(
              EPOCH FROM (
                MAX(created_at)
                + (${LOGIN_WINDOW_MINUTES}::text || ' minutes')::interval
                - NOW()
              )
            )
          )
        )::int
        ELSE 0
      END AS retry_after_seconds
    FROM admin_audit_log
    WHERE shop_id = ${params.shopId}
      AND event_type = 'auth.login_failed'
      AND created_at >= NOW() - (${LOGIN_WINDOW_MINUTES}::text || ' minutes')::interval
      AND COALESCE(ip, '') = ${params.ip}
      AND COALESCE(metadata ->> 'loginFingerprint', '') = ${params.loginFingerprint}
  `;

  return Math.max(0, Number(rows[0]?.retry_after_seconds ?? 0));
}

export async function enforceActiveSessionLimit(
  client: SqlClient,
  params: {
    shopId: string;
    userId: string;
    keepToken: string;
  }
) {
  const rows = await client<{ token: string }[]>`
    WITH ranked AS (
      SELECT
        token,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN token = ${params.keepToken} THEN 0 ELSE 1 END,
            created_at DESC
        ) AS row_number
      FROM admin_sessions
      WHERE shop_id = ${params.shopId}
        AND user_id = ${params.userId}
        AND revoked_at IS NULL
        AND expires_at > NOW()
    )
    UPDATE admin_sessions session
    SET revoked_at = NOW(),
        updated_at = NOW()
    WHERE session.token IN (
      SELECT token
      FROM ranked
      WHERE row_number > ${MAX_ACTIVE_SESSIONS}
    )
    RETURNING session.token
  `;

  return rows.length;
}

export function auditEventForMutation(path: string, method: string) {
  const normalizedMethod = method.toUpperCase();

  if (
    normalizedMethod === "GET"
    || normalizedMethod === "HEAD"
    || normalizedMethod === "OPTIONS"
    || path.startsWith("/api/admin/auth/")
    || path.startsWith("/api/admin/security")
    || path.startsWith("/api/admin/presence")
    || path.includes("/internal-chat")
  ) {
    return null;
  }

  let eventType = "admin.mutation";
  let entityType = "admin";
  let label = "Изменение в CRM";

  if (path.startsWith("/api/admin/employees")) {
    eventType = "employee.changed";
    entityType = "employee";
    label = "Изменение сотрудника";
  } else if (path.startsWith("/api/admin/orders")) {
    eventType = path.endsWith("/refund")
      ? "finance.refund"
      : "order.changed";
    entityType = "order";
    label = path.endsWith("/refund")
      ? "Возврат по заказу"
      : "Изменение заказа";
  } else if (path.startsWith("/api/admin/finance")) {
    eventType = "finance.changed";
    entityType = "finance";
    label = "Финансовое действие";
  } else if (path.startsWith("/api/admin/launch")) {
    eventType = "launch.changed";
    entityType = "launch";
    label = "Изменение настроек запуска";
  } else if (path.startsWith("/api/admin/settings")) {
    eventType = "settings.changed";
    entityType = "settings";
    label = "Изменение настроек";
  } else if (
    path.startsWith("/api/admin/catalog")
    || path.startsWith("/api/admin/categories")
    || path.startsWith("/api/admin/products")
    || path.startsWith("/api/admin/product-images")
  ) {
    eventType = "catalog.changed";
    entityType = "catalog";
    label = "Изменение каталога";
  } else if (path.startsWith("/api/admin/delivery")) {
    eventType = "delivery.changed";
    entityType = "delivery";
    label = "Изменение доставки";
  } else if (path.startsWith("/api/admin/promocodes")) {
    eventType = "promocode.changed";
    entityType = "promocode";
    label = "Изменение промокода";
  } else if (path.startsWith("/api/admin/customers")) {
    eventType = "customer.changed";
    entityType = "customer";
    label = "Изменение клиента или бонусов";
  } else if (path.startsWith("/api/admin/notifications")) {
    eventType = "notification.changed";
    entityType = "notification";
    label = "Действие с уведомлением";
  }

  const severity: AdminAuditSeverity = (
    normalizedMethod === "DELETE"
    || path.includes("refund")
    || path.includes("revoke")
  ) ? "warning" : "info";

  const entityId = path.match(
    /\/([0-9a-f]{8}-[0-9a-f-]{27,})/i
  )?.[1] ?? null;

  return {
    eventType,
    entityType,
    entityId,
    severity,
    summary: `${label}: ${normalizedMethod} ${path}`
  };
}
