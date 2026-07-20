import { createHash, randomUUID } from "node:crypto";

export type CustomerSqlExecutor = {
  <
    T extends readonly (object | undefined)[] =
      Record<string, unknown>[],
  >(
    strings: TemplateStringsArray,
    ...parameters: any[]
  ): PromiseLike<T>;
};

const SESSION_CONTEXT = "viberimenya:customer-session:v1";
const MAGIC_CONTEXT = "viberimenya:customer-magic-login:v1";
export const MAX_ACTIVE_CUSTOMER_SESSIONS = 5;

export type CustomerSessionContext = {
  id: string;
  shop_id: string;
  customer_id: string;
  token: string;
  user_agent: string | null;
  expires_at: string;
  last_seen_at: string | null;
  created_at: string;
};

function hashSecret(context: string, rawToken: string) {
  return `sha256:${createHash("sha256")
    .update(`${context}:${rawToken}`)
    .digest("hex")}`;
}

export function createCustomerOpaqueToken() {
  return (
    randomUUID().replace(/-/g, "") +
    randomUUID().replace(/-/g, "")
  );
}

export function hashCustomerSessionToken(rawToken: string) {
  return hashSecret(SESSION_CONTEXT, rawToken);
}

export function hashCustomerMagicToken(rawToken: string) {
  return hashSecret(MAGIC_CONTEXT, rawToken);
}

export function customerSessionTokenCandidates(rawToken: string) {
  return [hashCustomerSessionToken(rawToken), rawToken];
}

export function customerMagicTokenCandidates(rawToken: string) {
  return [hashCustomerMagicToken(rawToken), rawToken];
}

export function safeCustomerRedirectPath(value: unknown) {
  if (typeof value !== "string") return "/account";

  const path = value.trim();

  if (!path.startsWith("/") || path.startsWith("//")) {
    return "/account";
  }

  const allowed = [
    /^\/account(?:\?(?:section|auth)=[a-z0-9_-]+)?$/i,
    /^\/orders$/,
    /^\/cart$/,
    /^\/catalog(?:\?[a-z0-9_=&%-]+)?$/i,
    /^\/order\/track\/[a-zA-Z0-9_-]{12,180}$/,
  ];

  return allowed.some((pattern) => pattern.test(path))
    ? path
    : "/account";
}

export function describeCustomerDevice(userAgent: string | null) {
  const ua = String(userAgent || "");
  const platform = /iPhone/i.test(ua)
    ? "iPhone"
    : /iPad/i.test(ua)
      ? "iPad"
      : /Android/i.test(ua)
        ? "Android"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux"
              : "Устройство";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "браузер";

  return `${browser} · ${platform}`;
}

export async function resolveActiveCustomerSession(
  sql: CustomerSqlExecutor,
  rawToken: string,
): Promise<CustomerSessionContext | null> {
  if (!rawToken) return null;

  const candidates = customerSessionTokenCandidates(rawToken);
  const rows = await sql<CustomerSessionContext[]>`
    SELECT
      id,
      shop_id,
      customer_id,
      token,
      user_agent,
      expires_at::text,
      last_seen_at::text,
      created_at::text
    FROM customer_sessions
    WHERE token = ANY(${candidates}::text[])
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;
  const session = rows[0];

  if (!session) return null;

  const secureToken = candidates[0];
  if (session.token === rawToken && secureToken) {
    await sql`
      UPDATE customer_sessions
      SET token = ${secureToken}
      WHERE id = ${session.id}
        AND token = ${rawToken}
    `;
    session.token = secureToken;
  }

  return session;
}

export async function createSecureCustomerSession(
  sql: CustomerSqlExecutor,
  params: {
    shopId: string;
    customerId: string;
    userAgent: string | null;
    ip: string | null;
    source: string;
  },
) {
  const rawToken = createCustomerOpaqueToken();
  const storedToken = hashCustomerSessionToken(rawToken);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO customer_sessions (
      shop_id,
      customer_id,
      token,
      user_agent,
      expires_at,
      last_seen_at,
      created_at
    )
    VALUES (
      ${params.shopId},
      ${params.customerId},
      ${storedToken},
      ${params.userAgent},
      NOW() + INTERVAL '30 days',
      NOW(),
      NOW()
    )
    RETURNING id
  `;
  const sessionId = rows[0]?.id;

  if (!sessionId) {
    throw new Error("Customer session was not created");
  }

  const revoked = await sql<{ id: string }[]>`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          ORDER BY created_at DESC, id DESC
        ) AS position
      FROM customer_sessions
      WHERE shop_id = ${params.shopId}
        AND customer_id = ${params.customerId}
        AND revoked_at IS NULL
        AND expires_at > NOW()
    )
    UPDATE customer_sessions sessions
    SET revoked_at = NOW()
    WHERE sessions.id IN (
      SELECT id
      FROM ranked
      WHERE position > ${MAX_ACTIVE_CUSTOMER_SESSIONS}
    )
    RETURNING sessions.id
  `;

  await sql`
    INSERT INTO admin_audit_log (
      shop_id,
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
      ${params.shopId},
      'customer',
      'customer.session_created',
      'customer_session',
      ${sessionId},
      'info',
      ${params.ip},
      ${params.userAgent},
      'Создана сессия личного кабинета',
      ${JSON.stringify({
        customerId: params.customerId,
        source: params.source,
        revokedByLimit: revoked.length,
        tokenStorage: "sha256-v1",
      })}::jsonb,
      NOW()
    )
  `;

  return {
    rawToken,
    sessionId,
    revokedSessionIds: revoked.map((row) => row.id),
  };
}

export async function writeCustomerSecurityAudit(
  sql: CustomerSqlExecutor,
  params: {
    shopId: string;
    customerId: string;
    eventType: string;
    entityId?: string | null;
    severity?: "info" | "warning" | "critical";
    summary: string;
    ip?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await sql`
    INSERT INTO admin_audit_log (
      shop_id,
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
      ${params.shopId},
      'customer',
      ${params.eventType},
      'customer_session',
      ${params.entityId ?? params.customerId},
      ${params.severity ?? "info"},
      ${params.ip ?? null},
      ${params.userAgent ?? null},
      ${params.summary},
      ${JSON.stringify({
        customerId: params.customerId,
        ...(params.metadata ?? {}),
      })}::jsonb,
      NOW()
    )
  `;
}
