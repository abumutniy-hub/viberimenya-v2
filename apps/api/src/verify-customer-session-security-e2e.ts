import { randomUUID } from "node:crypto";
import { createDb } from "@viberimenya/db";
import {
  type CustomerSqlExecutor,
  createCustomerOpaqueToken,
  createSecureCustomerSession,
  customerMagicTokenCandidates,
  describeCustomerDevice,
  hashCustomerMagicToken,
  hashCustomerSessionToken,
  resolveActiveCustomerSession,
  safeCustomerRedirectPath,
} from "./modules/customers/customer-session-security.service";
import { unlinkCustomerTelegramIdentity } from "./modules/customers/customer-telegram-identity.service";

class VerificationRollback extends Error {}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const marker = `session-security-e2e-${randomUUID()}`;
const phone = `+7998${String(Date.now()).slice(-7)}`;
const telegramId = `8${Date.now()}${Math.floor(Math.random() * 1000)}`;
let customerId = "";
const { client } = createDb();

try {
  try {
    await client.begin(async (transaction: CustomerSqlExecutor) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtext('viberimenya:customer-session-security-e2e')
        )
      `;

      const shops = await transaction<{ id: string }[]>`
        SELECT id
        FROM shops
        WHERE status = 'active'
        ORDER BY created_at ASC
        LIMIT 1
      `;
      const shop = shops[0];
      assertCondition(shop, "Активный магазин не найден");
      pass("активный магазин найден");

      const customers = await transaction<{ id: string }[]>`
        INSERT INTO customers (
          shop_id, phone, name, email, created_at, updated_at
        )
        VALUES (
          ${shop.id}, ${phone}, 'Session Security E2E',
          ${`${marker}@example.invalid`}, NOW(), NOW()
        )
        RETURNING id
      `;
      const customer = customers[0];
      assertCondition(customer, "Синтетический клиент не создан");
      customerId = customer.id;

      await transaction`
        INSERT INTO telegram_accounts (
          shop_id, customer_id, telegram_id, username,
          notifications_enabled, is_active,
          linked_at, created_at, updated_at
        )
        VALUES (
          ${shop.id}, ${customer.id}, ${telegramId}, ${marker},
          true, true, NOW(), NOW(), NOW()
        )
      `;
      pass("синтетический Telegram-профиль создан");

      const rawMagicToken = createCustomerOpaqueToken();
      const storedMagicToken = hashCustomerMagicToken(rawMagicToken);

      await transaction`
        INSERT INTO customer_link_tokens (
          shop_id, customer_id, provider, purpose,
          token, status, expires_at, metadata,
          created_at, updated_at
        )
        VALUES (
          ${shop.id}, ${customer.id}, 'site', 'magic_login',
          ${storedMagicToken}, 'pending', NOW() + INTERVAL '10 minutes',
          ${JSON.stringify({
            marker,
            redirectPath: "/account?section=security",
            tokenStorage: "sha256-v1",
          })}::jsonb,
          NOW(), NOW()
        )
      `;

      const storageRows = await transaction<{
        stored_count: number;
        raw_count: number;
      }[]>`
        SELECT
          COUNT(*) FILTER (WHERE token = ${storedMagicToken})::int
            AS stored_count,
          COUNT(*) FILTER (WHERE token = ${rawMagicToken})::int
            AS raw_count
        FROM customer_link_tokens
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
          AND purpose = 'magic_login'
      `;
      assertCondition(storageRows[0]?.stored_count === 1, "Хеш magic token не сохранён");
      assertCondition(storageRows[0]?.raw_count === 0, "Magic token сохранён открыто");
      pass("одноразовый токен хранится только как SHA-256");

      const candidates = customerMagicTokenCandidates(rawMagicToken);
      const claimed = await transaction<{ id: string }[]>`
        WITH candidate AS (
          SELECT tokens.id
          FROM customer_link_tokens tokens
          WHERE tokens.shop_id = ${shop.id}
            AND tokens.customer_id = ${customer.id}
            AND tokens.provider = 'site'
            AND tokens.purpose = 'magic_login'
            AND tokens.token = ANY(${candidates}::text[])
            AND tokens.status = 'pending'
            AND tokens.consumed_at IS NULL
            AND tokens.expires_at > NOW()
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE customer_link_tokens tokens
        SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
        FROM candidate
        WHERE tokens.id = candidate.id
          AND tokens.status = 'pending'
          AND tokens.consumed_at IS NULL
        RETURNING tokens.id
      `;
      assertCondition(claimed.length === 1, "Первое погашение magic token не выполнено");

      const repeated = await transaction<{ id: string }[]>`
        WITH candidate AS (
          SELECT tokens.id
          FROM customer_link_tokens tokens
          WHERE tokens.shop_id = ${shop.id}
            AND tokens.customer_id = ${customer.id}
            AND tokens.provider = 'site'
            AND tokens.purpose = 'magic_login'
            AND tokens.token = ANY(${candidates}::text[])
            AND tokens.status = 'pending'
            AND tokens.consumed_at IS NULL
            AND tokens.expires_at > NOW()
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE customer_link_tokens tokens
        SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
        FROM candidate
        WHERE tokens.id = candidate.id
        RETURNING tokens.id
      `;
      assertCondition(repeated.length === 0, "Magic token использован повторно");
      pass("одноразовый токен атомарно погашается только один раз");

      const createdRawTokens: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        const session = await createSecureCustomerSession(transaction, {
          shopId: shop.id,
          customerId: customer.id,
          userAgent: index % 2 === 0
            ? "Mozilla/5.0 (iPhone) AppleWebKit Safari/605.1"
            : "Mozilla/5.0 (Windows NT 10.0) Chrome/142.0",
          ip: "127.0.0.1",
          source: `e2e-${index}`,
        });
        createdRawTokens.push(session.rawToken);
      }

      const sessionState = await transaction<{
        active_count: number;
        hashed_count: number;
        raw_count: number;
      }[]>`
        SELECT
          COUNT(*) FILTER (
            WHERE revoked_at IS NULL AND expires_at > NOW()
          )::int AS active_count,
          COUNT(*) FILTER (
            WHERE token LIKE 'sha256:%'
          )::int AS hashed_count,
          COUNT(*) FILTER (
            WHERE token = ANY(${createdRawTokens}::text[])
          )::int AS raw_count
        FROM customer_sessions
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
      `;
      assertCondition(sessionState[0]?.active_count === 5, "Лимит 5 сессий не соблюдён");
      assertCondition(sessionState[0]?.hashed_count === 6, "Не все сессии хешированы");
      assertCondition(sessionState[0]?.raw_count === 0, "Raw session token попал в БД");
      pass("сессии хешируются и ограничиваются пятью устройствами");

      const legacyRaw = createCustomerOpaqueToken();
      const legacyRows = await transaction<{ id: string }[]>`
        INSERT INTO customer_sessions (
          shop_id, customer_id, token, user_agent,
          expires_at, last_seen_at, created_at
        )
        VALUES (
          ${shop.id}, ${customer.id}, ${legacyRaw}, 'Legacy Browser',
          NOW() + INTERVAL '30 days', NOW(), NOW()
        )
        RETURNING id
      `;
      const legacy = legacyRows[0];
      assertCondition(legacy, "Legacy session не создана");

      const resolvedLegacy = await resolveActiveCustomerSession(
        transaction,
        legacyRaw,
      );
      assertCondition(resolvedLegacy?.id === legacy.id, "Legacy session не прочитана");

      const migratedRows = await transaction<{ token: string }[]>`
        SELECT token
        FROM customer_sessions
        WHERE id = ${legacy.id}
      `;
      assertCondition(
        migratedRows[0]?.token === hashCustomerSessionToken(legacyRaw),
        "Legacy session не мигрировала на SHA-256",
      );
      pass("старые активные сессии мигрируют без принудительного выхода");

      assertCondition(
        safeCustomerRedirectPath("https://evil.example") === "/account",
        "Внешний redirect не заблокирован",
      );
      assertCondition(
        safeCustomerRedirectPath("//evil.example") === "/account",
        "Protocol-relative redirect не заблокирован",
      );
      assertCondition(
        safeCustomerRedirectPath("/account?section=security") ===
          "/account?section=security",
        "Разрешённый redirect отклонён",
      );
      assertCondition(
        describeCustomerDevice("Mozilla/5.0 (iPhone) Safari/605.1") ===
          "Safari · iPhone",
        "Название устройства определено неверно",
      );
      pass("open redirect заблокирован, устройство определяется безопасно");

      const pendingSiteToken = hashCustomerMagicToken(createCustomerOpaqueToken());
      const pendingTelegramToken = `tg-${randomUUID()}`;
      await transaction`
        INSERT INTO customer_link_tokens (
          shop_id, customer_id, provider, purpose,
          token, status, expires_at, metadata,
          created_at, updated_at
        )
        VALUES
          (
            ${shop.id}, ${customer.id}, 'site', 'magic_login',
            ${pendingSiteToken}, 'pending', NOW() + INTERVAL '10 minutes',
            ${JSON.stringify({ marker, kind: "site" })}::jsonb,
            NOW(), NOW()
          ),
          (
            ${shop.id}, ${customer.id}, 'telegram', 'connect_channel',
            ${pendingTelegramToken}, 'pending', NOW() + INTERVAL '30 minutes',
            ${JSON.stringify({ marker, kind: "telegram" })}::jsonb,
            NOW(), NOW()
          )
      `;

      const unlink = await unlinkCustomerTelegramIdentity(transaction, {
        shopId: shop.id,
        customerId: customer.id,
        source: "customer_account",
        actorRole: "customer",
        ip: "127.0.0.1",
        userAgent: "session-security-e2e",
      });
      assertCondition(unlink.unlinked, "Telegram не отвязан");
      assertCondition(
        unlink.cancelledTokens >= 2,
        "Не все ожидающие login/link token отменены",
      );

      const pendingRows = await transaction<{ pending_count: number }[]>`
        SELECT COUNT(*)::int AS pending_count
        FROM customer_link_tokens
        WHERE shop_id = ${shop.id}
          AND customer_id = ${customer.id}
          AND status = 'pending'
          AND consumed_at IS NULL
          AND purpose IN ('magic_login', 'connect_channel')
      `;
      assertCondition(pendingRows[0]?.pending_count === 0, "После отвязки остались токены");
      pass("отвязка Telegram аннулирует неиспользованные login-ссылки");

      throw new VerificationRollback("rollback synthetic security data");
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) throw error;
  }

  const residue = await client<{ total: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM customers WHERE id = ${customerId || null})
      + (SELECT COUNT(*) FROM telegram_accounts WHERE telegram_id = ${telegramId})
      + (SELECT COUNT(*) FROM customer_link_tokens WHERE metadata::text LIKE ${`%${marker}%`})
      + (SELECT COUNT(*) FROM admin_audit_log WHERE metadata::text LIKE ${`%${marker}%`})
    )::int AS total
  `;
  assertCondition(Number(residue[0]?.total ?? -1) === 0, "После rollback остались данные");
  pass("транзакционный rollback удалил все синтетические данные");

  console.log("");
  console.log("CUSTOMER SESSION SECURITY E2E: OK");
  console.log("Проверены одноразовые ссылки, хеши, лимит сессий, legacy migration и отзыв.");
  console.log("Реальные Telegram-сообщения не отправлялись.");
} finally {
  await client.end();
}
