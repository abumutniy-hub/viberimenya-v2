import {
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto";
import { createDb } from "@viberimenya/db";
import {
  createMaxIdentityLinkIntent,
  authenticateCustomerWithMax,
  MaxIdentityAuthError,
} from "./modules/customers/customer-max-identity.service";
import {
  MaxWebAppValidationError,
  validateMaxWebAppData,
} from "./modules/customers/customer-max-auth.service";

class RollbackProbe extends Error {}

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function signMaxInitData(
  params: Record<string, string>,
  botToken: string,
) {
  const launchParams = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(launchParams)
    .digest("hex");

  return [
    ...Object.entries(params).map(
      ([key, value]) => `${key}=${encodeURIComponent(value)}`,
    ),
    `hash=${hash}`,
  ].join("&");
}

type E2eResult = {
  customerId: string;
  linkedNow: boolean;
  replayProtected: boolean;
  conflictProtected: boolean;
  tamperProtected: boolean;
  staleProtected: boolean;
  sessionStoredAsHash: boolean;
  linkTokenConsumed: boolean;
  channelUpdateProcessed: boolean;
};

const { client } = createDb();
const suffix = randomBytes(8).toString("hex");
const phoneSuffix = randomInt(10_000_000, 99_999_999).toString();
const botToken = `max-test-token-${randomBytes(24).toString("hex")}`;
const nowMs = Date.now();
const nowSeconds = Math.floor(nowMs / 1000);
const maxUserId = String(randomInt(100_000_000, 999_999_999));
const maxChatId = String(randomInt(100_000_000, 999_999_999));
const resultRef: { current: E2eResult | null } = { current: null };

try {
  try {
    await client.begin(async (sql) => {
      const shopRows = await sql<{ id: string }[]>`
        INSERT INTO shops (
          slug,
          name,
          status,
          timezone,
          currency
        )
        VALUES (
          ${`verify-max-auth-${suffix}`}::text,
          'MAX identity auth verification',
          'active',
          'Europe/Moscow',
          'RUB'
        )
        RETURNING id
      `;
      const shopId = shopRows[0]?.id;

      assertCondition(shopId, "Не удалось создать тестовый магазин");

      const customerRows = await sql<{ id: string }[]>`
        INSERT INTO customers (
          shop_id,
          phone,
          name
        )
        VALUES
          (${shopId}::uuid, ${`79${phoneSuffix}`}::text, 'MAX Client One'),
          (${shopId}::uuid, ${`78${phoneSuffix}`}::text, 'MAX Client Two')
        RETURNING id
      `;
      const firstCustomerId = customerRows[0]?.id;
      const secondCustomerId = customerRows[1]?.id;

      assertCondition(
        firstCustomerId && secondCustomerId,
        "Не удалось создать тестовых клиентов",
      );

      const firstIntent = await createMaxIdentityLinkIntent(sql, {
        shopId,
        customerId: firstCustomerId,
        redirectPath: "/account",
        ip: "127.0.0.1",
        userAgent: "max-auth-e2e",
      });
      const signedInitData = signMaxInitData(
        {
          auth_date: String(nowSeconds),
          chat: JSON.stringify({
            id: Number(maxChatId),
            type: "DIALOG",
          }),
          query_id: `query-${suffix}-one`,
          start_param: firstIntent.startParam,
          user: JSON.stringify({
            id: Number(maxUserId),
            first_name: "MAX",
            last_name: "Client",
            username: `max_${suffix}`,
            language_code: "ru",
            photo_url: null,
          }),
        },
        botToken,
      );
      const validated = validateMaxWebAppData(
        signedInitData,
        botToken,
        {
          nowMs,
          maximumAgeSeconds: 3600,
        },
      );
      const authenticated = await authenticateCustomerWithMax(sql, {
        shopId,
        validatedData: validated,
        redirectPath: "/account",
        requestIp: "127.0.0.1",
        userAgent: "max-auth-e2e",
      });

      assertCondition(
        authenticated.customerId === firstCustomerId,
        "MAX identity привязана не к тому клиенту",
      );
      assertCondition(
        authenticated.linkedNow,
        "Первая MAX identity не отмечена новой привязкой",
      );

      let replayProtected = false;

      try {
        await authenticateCustomerWithMax(sql, {
          shopId,
          validatedData: validated,
          redirectPath: "/account",
          requestIp: "127.0.0.1",
          userAgent: "max-auth-e2e-replay",
        });
      } catch (error) {
        replayProtected = error instanceof MaxIdentityAuthError
          && error.code === "max_auth_replayed";
      }

      assertCondition(
        replayProtected,
        "Повторное использование query_id не заблокировано",
      );

      const secondIntent = await createMaxIdentityLinkIntent(sql, {
        shopId,
        customerId: secondCustomerId,
        redirectPath: "/account",
        ip: "127.0.0.1",
        userAgent: "max-auth-e2e-conflict",
      });
      const conflictingData = validateMaxWebAppData(
        signMaxInitData(
          {
            auth_date: String(nowSeconds),
            query_id: `query-${suffix}-conflict`,
            start_param: secondIntent.startParam,
            user: JSON.stringify({
              id: Number(maxUserId),
              first_name: "MAX",
              last_name: "Conflict",
              username: `max_${suffix}`,
              language_code: "ru",
              photo_url: null,
            }),
          },
          botToken,
        ),
        botToken,
        { nowMs },
      );
      let conflictProtected = false;

      try {
        await authenticateCustomerWithMax(sql, {
          shopId,
          validatedData: conflictingData,
          redirectPath: "/account",
          requestIp: "127.0.0.1",
          userAgent: "max-auth-e2e-conflict",
        });
      } catch (error) {
        conflictProtected = error instanceof MaxIdentityAuthError
          && error.code === "max_identity_conflict";
      }

      assertCondition(
        conflictProtected,
        "MAX identity удалось перепривязать другому клиенту",
      );

      let tamperProtected = false;
      const tamperedInitData = signedInitData.replace(
        encodeURIComponent("MAX"),
        encodeURIComponent("HACKED"),
      );

      try {
        validateMaxWebAppData(tamperedInitData, botToken, { nowMs });
      } catch (error) {
        tamperProtected = error instanceof MaxWebAppValidationError
          && error.code === "max_init_data_signature_invalid";
      }

      assertCondition(
        tamperProtected,
        "Изменённая подпись MAX initData не заблокирована",
      );

      let staleProtected = false;
      const staleInitData = signMaxInitData(
        {
          auth_date: String(nowSeconds - 7200),
          query_id: `query-${suffix}-stale`,
          user: JSON.stringify({
            id: Number(maxUserId),
            first_name: "MAX",
            last_name: "Stale",
            username: null,
            language_code: "ru",
            photo_url: null,
          }),
        },
        botToken,
      );

      try {
        validateMaxWebAppData(staleInitData, botToken, {
          nowMs,
          maximumAgeSeconds: 3600,
        });
      } catch (error) {
        staleProtected = error instanceof MaxWebAppValidationError
          && error.code === "max_init_data_expired";
      }

      assertCondition(
        staleProtected,
        "Устаревшее MAX initData не заблокировано",
      );

      const sessionRows = await sql<{
        token: string;
      }[]>`
        SELECT token
        FROM customer_sessions
        WHERE id = ${authenticated.sessionId}::uuid
      `;
      const tokenRows = await sql<{
        status: string;
        consumed_at: Date | null;
      }[]>`
        SELECT status, consumed_at
        FROM customer_link_tokens
        WHERE id = ${firstIntent.id}::uuid
      `;
      const updateRows = await sql<{
        status: string;
        processed_at: Date | null;
      }[]>`
        SELECT status, processed_at
        FROM channel_updates
        WHERE shop_id = ${shopId}::uuid
          AND provider = 'max'
          AND external_update_id = ${`webapp-auth:${validated.queryId}`}::text
      `;
      const sessionStoredAsHash = Boolean(
        sessionRows[0]?.token.startsWith("sha256:")
        && sessionRows[0]?.token !== authenticated.rawSessionToken,
      );
      const linkTokenConsumed = Boolean(
        tokenRows[0]?.status === "consumed"
        && tokenRows[0]?.consumed_at,
      );
      const channelUpdateProcessed = Boolean(
        updateRows[0]?.status === "processed"
        && updateRows[0]?.processed_at,
      );

      assertCondition(
        sessionStoredAsHash,
        "Customer session сохранена не в виде хеша",
      );
      assertCondition(
        linkTokenConsumed,
        "MAX link token не погашен",
      );
      assertCondition(
        channelUpdateProcessed,
        "MAX auth update не переведён в processed",
      );

      resultRef.current = {
        customerId: authenticated.customerId,
        linkedNow: authenticated.linkedNow,
        replayProtected,
        conflictProtected,
        tamperProtected,
        staleProtected,
        sessionStoredAsHash,
        linkTokenConsumed,
        channelUpdateProcessed,
      };

      throw new RollbackProbe("rollback max identity auth e2e");
    });
  } catch (error) {
    if (!(error instanceof RollbackProbe)) {
      throw error;
    }
  }

  const result = resultRef.current;
  assertCondition(result, "E2E не сформировал результат");

  const leftovers = await client<{ count: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM shops WHERE slug = ${`verify-max-auth-${suffix}`}::text)
      + (SELECT COUNT(*) FROM customer_channel_links WHERE provider_user_id = ${maxUserId}::text)
      + (SELECT COUNT(*) FROM channel_updates WHERE external_update_id LIKE ${`%${suffix}%`}::text)
    )::int AS count
  `;

  assertCondition(
    leftovers[0]?.count === 0,
    "Rollback E2E оставил тестовые данные",
  );

  console.log(JSON.stringify({
    ok: true,
    ...result,
    rollbackClean: true,
  }));
  console.log("MAX_IDENTITY_AUTH_E2E: OK");
} finally {
  await client.end();
}
