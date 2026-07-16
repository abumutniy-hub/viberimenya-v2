import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { createDb } from "@viberimenya/db";
import { env } from "../lib/env";
import { writeAdminAudit } from "../modules/admin/admin-security.service";

type AdminRole = "owner" | "admin" | "manager" | "florist" | "courier";

type SecurityRequest = FastifyRequest & {
  adminContext?: {
    userId: string;
    shopId: string;
    role: AdminRole;
  };
};

const ADMIN_SESSION_COOKIE = "vm_admin_session";

function getCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return "";

  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");

    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return "";
}

const securityQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  severity: z.enum(["all", "info", "warning", "critical"]).optional().default("all"),
  event: z.string().trim().max(100).optional().default("all"),
  employeeId: z.string().uuid().optional().or(z.literal("")).default(""),
  days: z.coerce.number().int().min(1).max(90).optional().default(14),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  pageSize: z.coerce.number().int().min(20).max(100).optional().default(50)
});

function userAgentLabel(value: string | null) {
  const text = String(value ?? "").trim();

  if (!text) return "Неизвестное устройство";

  if (/iphone|ipad/i.test(text)) return "iPhone / iPad";
  if (/android/i.test(text)) return "Android";
  if (/windows/i.test(text)) return "Windows";
  if (/macintosh|mac os/i.test(text)) return "Mac";
  if (/linux/i.test(text)) return "Linux";

  return text.slice(0, 120);
}

export function registerAdminSecurityRoutes(app: FastifyInstance) {
  app.get("/api/admin/security", async (request, reply) => {
    const adminContext = (request as SecurityRequest).adminContext;

    if (!adminContext) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const query = securityQuerySchema.parse(request.query ?? {});
    const currentToken = getCookieValue(
      request.headers.cookie,
      ADMIN_SESSION_COOKIE
    );
    const offset = (query.page - 1) * query.pageSize;
    const { client } = createDb();

    try {
      const shopRows = await client<{ id: string; name: string }[]>`
        SELECT id, name
        FROM shops
        WHERE slug = ${env.DEFAULT_SHOP_SLUG}
        LIMIT 1
      `;
      const shop = shopRows[0];

      if (!shop || shop.id !== adminContext.shopId) {
        return reply.status(404).send({
          ok: false,
          message: "Магазин не найден"
        });
      }

      const [summaryRows, sessionRows, eventRows, eventCountRows, employeeRows, eventTypeRows] = await Promise.all([
        client<{
          active_employees: number;
          active_owners: number;
          active_sessions: number;
          failed_logins_24h: number;
          blocked_logins_24h: number;
          warnings_7d: number;
          stale_sessions: number;
        }[]>`
          SELECT
            (
              SELECT COUNT(*)::int
              FROM shop_users su
              JOIN users u ON u.id = su.user_id
              WHERE su.shop_id = ${shop.id}
                AND su.is_active = true
                AND u.status = 'active'
            ) AS active_employees,
            (
              SELECT COUNT(*)::int
              FROM shop_users su
              JOIN users u ON u.id = su.user_id
              WHERE su.shop_id = ${shop.id}
                AND su.role = 'owner'
                AND su.is_active = true
                AND u.status = 'active'
            ) AS active_owners,
            (
              SELECT COUNT(*)::int
              FROM admin_sessions s
              WHERE s.shop_id = ${shop.id}
                AND s.revoked_at IS NULL
                AND s.expires_at > NOW()
            ) AS active_sessions,
            (
              SELECT COUNT(*)::int
              FROM admin_audit_log a
              WHERE a.shop_id = ${shop.id}
                AND a.event_type = 'auth.login_failed'
                AND a.created_at >= NOW() - INTERVAL '24 hours'
            ) AS failed_logins_24h,
            (
              SELECT COUNT(*)::int
              FROM admin_audit_log a
              WHERE a.shop_id = ${shop.id}
                AND a.event_type = 'auth.login_blocked'
                AND a.created_at >= NOW() - INTERVAL '24 hours'
            ) AS blocked_logins_24h,
            (
              SELECT COUNT(*)::int
              FROM admin_audit_log a
              WHERE a.shop_id = ${shop.id}
                AND a.severity IN ('warning', 'critical')
                AND a.created_at >= NOW() - INTERVAL '7 days'
            ) AS warnings_7d,
            (
              SELECT COUNT(*)::int
              FROM admin_sessions s
              WHERE s.shop_id = ${shop.id}
                AND s.revoked_at IS NULL
                AND s.expires_at > NOW()
                AND s.updated_at < NOW() - INTERVAL '7 days'
            ) AS stale_sessions
        `,
        client<{
          session_key: string;
          user_id: string;
          name: string | null;
          phone: string | null;
          email: string | null;
          role: string;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
          last_activity_at: string;
          expires_at: string;
          is_current: boolean;
        }[]>`
          SELECT
            md5(s.token) AS session_key,
            s.user_id,
            u.name,
            u.phone,
            u.email,
            su.role::text AS role,
            s.ip,
            s.user_agent,
            s.created_at,
            s.updated_at AS last_activity_at,
            s.expires_at,
            (s.token = ${currentToken}) AS is_current
          FROM admin_sessions s
          JOIN users u ON u.id = s.user_id
          JOIN shop_users su
            ON su.shop_id = s.shop_id
           AND su.user_id = s.user_id
          WHERE s.shop_id = ${shop.id}
            AND s.revoked_at IS NULL
            AND s.expires_at > NOW()
          ORDER BY
            (s.token = ${currentToken}) DESC,
            s.updated_at DESC,
            s.created_at DESC
          LIMIT 100
        `,
        client<{
          id: string;
          actor_user_id: string | null;
          actor_name: string | null;
          actor_role: string | null;
          event_type: string;
          entity_type: string | null;
          entity_id: string | null;
          severity: string;
          ip: string | null;
          user_agent: string | null;
          summary: string;
          metadata: Record<string, unknown>;
          created_at: string;
        }[]>`
          SELECT
            a.id,
            a.actor_user_id,
            u.name AS actor_name,
            a.actor_role,
            a.event_type,
            a.entity_type,
            a.entity_id,
            a.severity,
            a.ip,
            a.user_agent,
            a.summary,
            a.metadata,
            a.created_at
          FROM admin_audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.shop_id = ${shop.id}
            AND a.created_at >= NOW() - (${query.days}::text || ' days')::interval
            AND (${query.severity} = 'all' OR a.severity = ${query.severity})
            AND (${query.event} = 'all' OR a.event_type = ${query.event})
            AND (${query.employeeId} = '' OR a.actor_user_id = NULLIF(${query.employeeId}, '')::uuid)
            AND (
              ${query.q} = ''
              OR a.summary ILIKE ${`%${query.q}%`}
              OR COALESCE(u.name, '') ILIKE ${`%${query.q}%`}
              OR COALESCE(a.ip, '') ILIKE ${`%${query.q}%`}
              OR COALESCE(a.entity_id, '') ILIKE ${`%${query.q}%`}
            )
          ORDER BY a.created_at DESC
          LIMIT ${query.pageSize}
          OFFSET ${offset}
        `,
        client<{ total: number }[]>`
          SELECT COUNT(*)::int AS total
          FROM admin_audit_log a
          LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.shop_id = ${shop.id}
            AND a.created_at >= NOW() - (${query.days}::text || ' days')::interval
            AND (${query.severity} = 'all' OR a.severity = ${query.severity})
            AND (${query.event} = 'all' OR a.event_type = ${query.event})
            AND (${query.employeeId} = '' OR a.actor_user_id = NULLIF(${query.employeeId}, '')::uuid)
            AND (
              ${query.q} = ''
              OR a.summary ILIKE ${`%${query.q}%`}
              OR COALESCE(u.name, '') ILIKE ${`%${query.q}%`}
              OR COALESCE(a.ip, '') ILIKE ${`%${query.q}%`}
              OR COALESCE(a.entity_id, '') ILIKE ${`%${query.q}%`}
            )
        `,
        client<{
          user_id: string;
          name: string | null;
          role: string;
        }[]>`
          SELECT
            su.user_id,
            u.name,
            su.role::text AS role
          FROM shop_users su
          JOIN users u ON u.id = su.user_id
          WHERE su.shop_id = ${shop.id}
          ORDER BY u.name NULLS LAST, su.created_at
        `,
        client<{ event_type: string; total: number }[]>`
          SELECT event_type, COUNT(*)::int AS total
          FROM admin_audit_log
          WHERE shop_id = ${shop.id}
            AND created_at >= NOW() - INTERVAL '90 days'
          GROUP BY event_type
          ORDER BY COUNT(*) DESC, event_type
          LIMIT 40
        `
      ]);

      const total = Number(eventCountRows[0]?.total ?? 0);

      return {
        ok: true,
        shop,
        currentUser: {
          id: adminContext.userId,
          role: adminContext.role
        },
        policy: {
          sessionDays: 14,
          maxActiveSessions: 3,
          failedAttempts: 5,
          blockMinutes: 15,
          telegramCodeMinutes: 10,
          passwordMinimumLength: 10
        },
        summary: summaryRows[0] ?? null,
        sessions: sessionRows.map((session) => ({
          ...session,
          device: userAgentLabel(session.user_agent)
        })),
        events: eventRows.map((event) => ({
          ...event,
          device: userAgentLabel(event.user_agent)
        })),
        employees: employeeRows,
        eventTypes: eventTypeRows,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize))
        },
        filters: query
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/security/sessions/:sessionKey/revoke", async (request, reply) => {
    const adminContext = (request as SecurityRequest).adminContext;

    if (!adminContext) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const params = z.object({
      sessionKey: z.string().regex(/^[a-f0-9]{32}$/)
    }).parse(request.params ?? {});
    const currentToken = getCookieValue(
      request.headers.cookie,
      ADMIN_SESSION_COOKIE
    );
    const { client } = createDb();

    try {
      const targetRows = await client<{
        token: string;
        user_id: string;
        name: string | null;
        role: string;
        is_current: boolean;
      }[]>`
        SELECT
          s.token,
          s.user_id,
          u.name,
          su.role::text AS role,
          (s.token = ${currentToken}) AS is_current
        FROM admin_sessions s
        JOIN users u ON u.id = s.user_id
        JOIN shop_users su
          ON su.shop_id = s.shop_id
         AND su.user_id = s.user_id
        WHERE s.shop_id = ${adminContext.shopId}
          AND md5(s.token) = ${params.sessionKey}
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
        LIMIT 1
      `;
      const target = targetRows[0];

      if (!target) {
        return reply.status(404).send({
          ok: false,
          message: "Активный сеанс не найден"
        });
      }

      if (target.is_current) {
        return reply.status(400).send({
          ok: false,
          message: "Текущий сеанс завершайте кнопкой «Выйти»"
        });
      }

      if (adminContext.role !== "owner" && target.role === "owner") {
        return reply.status(403).send({
          ok: false,
          message: "Только владелец может завершить сеанс владельца"
        });
      }

      await client`
        UPDATE admin_sessions
        SET revoked_at = NOW(),
            updated_at = NOW()
        WHERE shop_id = ${adminContext.shopId}
          AND token = ${target.token}
          AND revoked_at IS NULL
      `;

      await writeAdminAudit(client, {
        shopId: adminContext.shopId,
        actorUserId: adminContext.userId,
        actorRole: adminContext.role,
        eventType: "security.session_revoked",
        entityType: "user",
        entityId: target.user_id,
        severity: "warning",
        ip: request.ip || null,
        userAgent: request.headers["user-agent"] || null,
        summary: `Завершён сеанс сотрудника: ${target.name || target.user_id}`,
        metadata: {
          targetRole: target.role,
          sessionKey: params.sessionKey
        }
      });

      return { ok: true };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/security/sessions/revoke-others", async (request, reply) => {
    const adminContext = (request as SecurityRequest).adminContext;

    if (!adminContext) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    const currentToken = getCookieValue(
      request.headers.cookie,
      ADMIN_SESSION_COOKIE
    );
    const { client } = createDb();

    try {
      const rows = await client<{ token: string }[]>`
        UPDATE admin_sessions
        SET revoked_at = NOW(),
            updated_at = NOW()
        WHERE shop_id = ${adminContext.shopId}
          AND user_id = ${adminContext.userId}
          AND token <> ${currentToken}
          AND revoked_at IS NULL
        RETURNING token
      `;

      await writeAdminAudit(client, {
        shopId: adminContext.shopId,
        actorUserId: adminContext.userId,
        actorRole: adminContext.role,
        eventType: "security.other_sessions_revoked",
        entityType: "user",
        entityId: adminContext.userId,
        severity: "warning",
        ip: request.ip || null,
        userAgent: request.headers["user-agent"] || null,
        summary: `Завершены другие сеансы текущего сотрудника: ${rows.length}`,
        metadata: {
          revokedSessions: rows.length
        }
      });

      return {
        ok: true,
        revokedSessions: rows.length
      };
    } finally {
      await client.end();
    }
  });

  app.post("/api/admin/security/cleanup", async (request, reply) => {
    const adminContext = (request as SecurityRequest).adminContext;

    if (!adminContext) {
      return reply.status(401).send({
        ok: false,
        message: "Требуется вход в CRM"
      });
    }

    if (adminContext.role !== "owner") {
      return reply.status(403).send({
        ok: false,
        message: "Очистка доступна только владельцу"
      });
    }

    const { client } = createDb();

    try {
      const expiredRows = await client<{ token: string }[]>`
        UPDATE admin_sessions
        SET revoked_at = COALESCE(revoked_at, NOW()),
            updated_at = NOW()
        WHERE shop_id = ${adminContext.shopId}
          AND revoked_at IS NULL
          AND expires_at <= NOW()
        RETURNING token
      `;

      const auditRows = await client<{ id: string }[]>`
        DELETE FROM admin_audit_log
        WHERE shop_id = ${adminContext.shopId}
          AND created_at < NOW() - INTERVAL '365 days'
        RETURNING id
      `;

      await writeAdminAudit(client, {
        shopId: adminContext.shopId,
        actorUserId: adminContext.userId,
        actorRole: adminContext.role,
        eventType: "security.cleanup",
        entityType: "security",
        severity: "info",
        ip: request.ip || null,
        userAgent: request.headers["user-agent"] || null,
        summary: "Выполнена очистка устаревших данных безопасности",
        metadata: {
          expiredSessions: expiredRows.length,
          deletedAuditEvents: auditRows.length
        }
      });

      return {
        ok: true,
        expiredSessions: expiredRows.length,
        deletedAuditEvents: auditRows.length
      };
    } finally {
      await client.end();
    }
  });
}
