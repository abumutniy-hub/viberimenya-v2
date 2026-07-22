import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { readPlatformFeatureFlags } from "@viberimenya/config";
import { createDb } from "@viberimenya/db";
import { z } from "zod";
import { env } from "../lib/env";
import {
  createMaxMiniAppLink,
  MaxWebAppValidationError,
  validateMaxWebAppData,
} from "../modules/customers/customer-max-auth.service";
import {
  authenticateCustomerWithMax,
  createMaxIdentityLinkIntent,
  disableCustomerMaxIdentity,
  MaxIdentityAuthError,
} from "../modules/customers/customer-max-identity.service";
import {
  resolveActiveCustomerSession,
  safeCustomerRedirectPath,
} from "../modules/customers/customer-session-security.service";

const CUSTOMER_SESSION_COOKIE = "vm_customer_session";

function getCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return "";

  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");

    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return "";
      }
    }
  }

  return "";
}

function customerCookieSecuritySuffix() {
  return env.NODE_ENV === "production" ? "; Secure" : "";
}

function buildCustomerSessionCookie(token: string) {
  return [
    `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=2592000",
  ].join("; ") + customerCookieSecuritySuffix();
}

async function getMaxShopRuntime() {
  const { client } = createDb();

  try {
    const rows = await client<{
      id: string;
      settings: Record<string, unknown>;
    }[]>`
      SELECT
        shops.id,
        COALESCE(shop_settings.settings, '{}'::jsonb) AS settings
      FROM shops
      LEFT JOIN shop_settings
        ON shop_settings.shop_id = shops.id
      WHERE shops.slug = ${env.DEFAULT_SHOP_SLUG}
      LIMIT 1
    `;
    const shop = rows[0];

    if (!shop) {
      throw new Error("Shop not found");
    }

    const flags = readPlatformFeatureFlags(shop.settings);
    const configured = Boolean(
      env.MAX_BOT_TOKEN.trim()
      && env.MAX_BOT_USERNAME.trim(),
    );

    return {
      shopId: shop.id,
      flags,
      configured,
      enabled: configured && flags.maxEnabled && flags.maxAuthEnabled,
    };
  } finally {
    await client.end();
  }
}

function maxUnavailable(reply: FastifyReply) {
  return reply.status(503).send({
    ok: false,
    code: "max_auth_unavailable",
    message: "Вход через MAX пока не включён",
  });
}

function maxValidationFailure(
  reply: FastifyReply,
  error: MaxWebAppValidationError,
) {
  const statusCode = [
    "max_init_data_signature_invalid",
    "max_init_data_expired",
    "max_init_data_from_future",
  ].includes(error.code)
    ? 401
    : 400;

  return reply.status(statusCode).send({
    ok: false,
    code: error.code,
    message: error.message,
  });
}

function maxIdentityFailure(
  reply: FastifyReply,
  error: MaxIdentityAuthError,
) {
  const statusCode = error.code === "max_link_token_invalid"
    ? 410
    : 409;

  return reply.status(statusCode).send({
    ok: false,
    code: error.code,
    message: error.message,
  });
}

async function activeCustomerSession(request: FastifyRequest) {
  const rawToken = getCookieValue(
    request.headers.cookie,
    CUSTOMER_SESSION_COOKIE,
  );

  if (!rawToken) return null;

  const { client } = createDb();

  try {
    return await resolveActiveCustomerSession(client, rawToken);
  } finally {
    await client.end();
  }
}

export async function maxAuthRoutes(app: FastifyInstance) {
  app.post(
    "/api/public/account/auth/max/link-intent",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = z
        .object({
          redirectPath: z.string().trim().max(240).optional(),
        })
        .parse(request.body ?? {});
      const runtime = await getMaxShopRuntime();

      if (!runtime.enabled) {
        return maxUnavailable(reply);
      }

      const session = await activeCustomerSession(request);

      if (!session || session.shop_id !== runtime.shopId) {
        return reply.status(401).send({
          ok: false,
          code: "customer_auth_required",
          message: "Сначала войдите в личный кабинет",
        });
      }

      const redirectPath = safeCustomerRedirectPath(
        body.redirectPath || "/account",
      );
      const { client } = createDb();

      try {
        const intent = await client.begin(async (transaction) => {
          return createMaxIdentityLinkIntent(transaction, {
            shopId: runtime.shopId,
            customerId: session.customer_id,
            redirectPath,
            ip: request.ip || null,
            userAgent:
              String(request.headers["user-agent"] ?? "")
              || null,
          });
        });
        const launchUrl = createMaxMiniAppLink(
          env.MAX_BOT_USERNAME,
          intent.rawToken,
        );

        if (!launchUrl) {
          throw new Error("MAX bot username is not configured");
        }

        reply.header("Cache-Control", "no-store, max-age=0");
        reply.header("Pragma", "no-cache");
        reply.header("Referrer-Policy", "no-referrer");

        return {
          ok: true,
          provider: "max",
          requestId: intent.id,
          startParam: intent.startParam,
          launchUrl,
          expiresAt: intent.expiresAt,
        };
      } finally {
        await client.end();
      }
    },
  );

  app.post(
    "/api/public/account/auth/max/session",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = z
        .object({
          initData: z.string().trim().min(1).max(16_384),
          redirectPath: z.string().trim().max(240).optional(),
        })
        .parse(request.body ?? {});
      const runtime = await getMaxShopRuntime();

      if (!runtime.enabled) {
        return maxUnavailable(reply);
      }

      let validatedData;

      try {
        validatedData = validateMaxWebAppData(
          body.initData,
          env.MAX_BOT_TOKEN,
          {
            maximumAgeSeconds:
              env.MAX_WEBAPP_AUTH_MAX_AGE_SECONDS,
          },
        );
      } catch (error) {
        if (error instanceof MaxWebAppValidationError) {
          return maxValidationFailure(reply, error);
        }

        throw error;
      }

      const redirectPath = safeCustomerRedirectPath(
        body.redirectPath || "/account",
      );
      const { client } = createDb();

      try {
        const result = await client.begin(async (transaction) => {
          return authenticateCustomerWithMax(transaction, {
            shopId: runtime.shopId,
            validatedData,
            redirectPath,
            requestIp: request.ip || null,
            userAgent:
              String(request.headers["user-agent"] ?? "")
              || null,
          });
        });

        reply.header(
          "Set-Cookie",
          buildCustomerSessionCookie(result.rawSessionToken),
        );
        reply.header("Cache-Control", "no-store, max-age=0");
        reply.header("Pragma", "no-cache");
        reply.header("Referrer-Policy", "no-referrer");

        return {
          ok: true,
          provider: "max",
          authenticated: true,
          linkedNow: result.linkedNow,
          redirectPath,
          customerId: result.customerId,
        };
      } catch (error) {
        if (error instanceof MaxIdentityAuthError) {
          return maxIdentityFailure(reply, error);
        }

        throw error;
      } finally {
        await client.end();
      }
    },
  );

  app.delete(
    "/api/public/account/auth/max/link",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const runtime = await getMaxShopRuntime();
      const session = await activeCustomerSession(request);

      if (!session || session.shop_id !== runtime.shopId) {
        return reply.status(401).send({
          ok: false,
          code: "customer_auth_required",
          message: "Войдите в личный кабинет",
        });
      }

      const { client } = createDb();

      try {
        const result = await client.begin(async (transaction) => {
          return disableCustomerMaxIdentity(transaction, {
            shopId: runtime.shopId,
            customerId: session.customer_id,
            ip: request.ip || null,
            userAgent:
              String(request.headers["user-agent"] ?? "")
              || null,
          });
        });

        return {
          ok: true,
          provider: "max",
          ...result,
        };
      } finally {
        await client.end();
      }
    },
  );
}
