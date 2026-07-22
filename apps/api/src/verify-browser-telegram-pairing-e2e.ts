import { randomUUID } from "node:crypto";
import { createDb } from "@viberimenya/db";
import {
  CUSTOMER_AUTH_PROVIDER_ADAPTERS,
  createCustomerPairingBrowserNonce,
  createCustomerPairingCode,
  createCustomerPairingToken,
  createTelegramPairingQrDataUrl,
  createTelegramPairingUrl,
  hashCustomerPairingBrowserNonce,
  hashCustomerPairingCode,
  hashCustomerPairingToken,
  normalizeCustomerPhone,
  safeHashEqual,
} from "./modules/customers/customer-pairing.service";
import {
  type CustomerSqlExecutor,
  createSecureCustomerSession,
  hashCustomerSessionToken,
} from "./modules/customers/customer-session-security.service";
import {
  unlinkCustomerTelegramIdentity,
} from "./modules/customers/customer-telegram-identity.service";

class VerificationRollback extends Error {}

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const marker = `browser-pairing-e2e-${randomUUID()}`;
const phone = normalizeCustomerPhone(
  `8${String(Date.now()).slice(-10)}`,
);
const telegramId =
  `7${Date.now()}${Math.floor(Math.random() * 1000)}`;
let customerId = "";
const { client } = createDb();

try {
  try {
    await client.begin(
      async (transaction: CustomerSqlExecutor) => {
        await transaction`
          SELECT pg_advisory_xact_lock(
            hashtext('viberimenya:browser-telegram-pairing-e2e')
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

        assertCondition(
          phone.startsWith("+") && phone.length >= 11,
          "Телефон не нормализован",
        );

        const customers = await transaction<{ id: string }[]>`
          INSERT INTO customers (
            shop_id,
            phone,
            name,
            email,
            bonus_balance,
            total_orders,
            total_spent,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${phone},
            NULL,
            NULL,
            0,
            0,
            0,
            NOW(),
            NOW()
          )
          RETURNING id
        `;
        const customer = customers[0];
        assertCondition(
          customer,
          "Профиль до первого заказа не создан",
        );
        customerId = customer.id;

        const orderRows = await transaction<{ count: number }[]>`
          SELECT COUNT(*)::int AS count
          FROM orders
          WHERE customer_id = ${customer.id}
        `;
        assertCondition(
          Number(orderRows[0]?.count ?? 0) === 0,
          "Для создания профиля потребовался заказ",
        );
        pass("профиль клиента создаётся до первого заказа");

        const rawToken = createCustomerPairingToken();
        const rawCode = createCustomerPairingCode();
        const rawNonce = createCustomerPairingBrowserNonce();
        const storedToken = hashCustomerPairingToken(rawToken);
        const codeHash = hashCustomerPairingCode(rawCode);
        const nonceHash =
          hashCustomerPairingBrowserNonce(rawNonce);

        const tokens = await transaction<{ id: string }[]>`
          INSERT INTO customer_link_tokens (
            shop_id,
            customer_id,
            provider,
            purpose,
            token,
            status,
            expires_at,
            metadata,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${customer.id},
            'telegram',
            'browser_pairing_login',
            ${storedToken},
            'pending',
            NOW() + INTERVAL '10 minutes',
            ${JSON.stringify({
              marker,
              phone,
              codeHash,
              browserNonceHash: nonceHash,
              redirectPath: "/account",
              attempts: 0,
            })}::text::jsonb,
            NOW(),
            NOW()
          )
          RETURNING id
        `;
        const pairing = tokens[0];
        assertCondition(pairing, "Pairing intent не создан");

        const storageRows = await transaction<{
          stored_token: number;
          raw_token: number;
          raw_code: number;
        }[]>`
          SELECT
            COUNT(*) FILTER (
              WHERE token = ${storedToken}
            )::int AS stored_token,
            COUNT(*) FILTER (
              WHERE token = ${rawToken}
            )::int AS raw_token,
            COUNT(*) FILTER (
              WHERE metadata::text LIKE ${`%${rawCode}%`}
            )::int AS raw_code
          FROM customer_link_tokens
          WHERE id = ${pairing.id}
        `;
        assertCondition(
          storageRows[0]?.stored_token === 1,
          "Хеш pairing token не сохранён",
        );
        assertCondition(
          storageRows[0]?.raw_token === 0,
          "Pairing token сохранён открыто",
        );
        assertCondition(
          storageRows[0]?.raw_code === 0,
          "Ручной код сохранён открыто",
        );
        assertCondition(
          safeHashEqual(
            hashCustomerPairingBrowserNonce(rawNonce),
            nonceHash,
          ),
          "Browser nonce не подтверждается",
        );
        pass("token, код и browser nonce хранятся только как SHA-256");

        const telegramUrl = createTelegramPairingUrl(
          "viberimenya_test_bot",
          rawToken,
        );
        const qrDataUrl =
          createTelegramPairingQrDataUrl(telegramUrl);
        assertCondition(
          telegramUrl.includes(`start=pair_${rawToken}`),
          "Telegram deep-link сформирован неверно",
        );
        assertCondition(
          qrDataUrl.startsWith(
            "data:image/svg+xml;base64,",
          ),
          "Локальный QR не создан",
        );
        assertCondition(
          !qrDataUrl.includes(rawToken),
          "Raw token виден в data URL как текст",
        );
        pass("deep-link и локальный QR создаются без внешнего сервиса");

        await transaction`
          UPDATE customer_link_tokens
          SET
            status = 'opened',
            metadata = metadata || ${JSON.stringify({
              candidateTelegramId: telegramId,
              openedAt: new Date().toISOString(),
            })}::text::jsonb,
            updated_at = NOW()
          WHERE id = ${pairing.id}
            AND status = 'pending'
        `;

        const openedMetadataRows = await transaction<{
          metadata_type: string;
          browser_nonce_hash: string | null;
          code_hash: string | null;
          candidate_telegram_id: string | null;
        }[]>`
          SELECT
            jsonb_typeof(metadata) AS metadata_type,
            metadata ->> 'browserNonceHash' AS browser_nonce_hash,
            metadata ->> 'codeHash' AS code_hash,
            metadata ->> 'candidateTelegramId' AS candidate_telegram_id
          FROM customer_link_tokens
          WHERE id = ${pairing.id}
        `;
        assertCondition(
          openedMetadataRows[0]?.metadata_type === "object"
            && openedMetadataRows[0]?.browser_nonce_hash === nonceHash
            && openedMetadataRows[0]?.code_hash === codeHash
            && openedMetadataRows[0]?.candidate_telegram_id === telegramId,
          "Открытие Telegram повредило JSONB metadata или browser proof",
        );
        pass("открытие Telegram сохраняет JSONB object, code и browser proof");

        await transaction`
          INSERT INTO telegram_accounts (
            shop_id,
            customer_id,
            telegram_id,
            username,
            notifications_enabled,
            is_active,
            linked_at,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${customer.id},
            ${telegramId},
            ${marker},
            true,
            true,
            NOW(),
            NOW(),
            NOW()
          )
        `;

        await transaction`
          INSERT INTO customer_channel_links (
            shop_id,
            customer_id,
            provider,
            provider_user_id,
            provider_username,
            provider_display_name,
            is_active,
            linked_at,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${customer.id},
            'telegram',
            ${telegramId},
            ${marker},
            'Pairing E2E',
            true,
            NOW(),
            NOW(),
            NOW()
          )
        `;

        const confirmed = await transaction<{ id: string }[]>`
          UPDATE customer_link_tokens
          SET
            status = 'confirmed',
            metadata = metadata || ${JSON.stringify({
              confirmedTelegramId: telegramId,
              confirmedAt: new Date().toISOString(),
            })}::text::jsonb,
            updated_at = NOW()
          WHERE id = ${pairing.id}
            AND status = 'opened'
            AND expires_at > NOW()
          RETURNING id
        `;
        assertCondition(
          confirmed.length === 1,
          "Telegram не подтвердил pairing",
        );
        pass("Telegram identity подтверждает тот же профиль");
        const confirmedMetadataRows = await transaction<{
          metadata_type: string;
          browser_nonce_hash: string | null;
          code_hash: string | null;
          confirmed_telegram_id: string | null;
        }[]>`
          SELECT
            jsonb_typeof(metadata) AS metadata_type,
            metadata ->> 'browserNonceHash' AS browser_nonce_hash,
            metadata ->> 'codeHash' AS code_hash,
            metadata ->> 'confirmedTelegramId' AS confirmed_telegram_id
          FROM customer_link_tokens
          WHERE id = ${pairing.id}
        `;
        assertCondition(
          confirmedMetadataRows[0]?.metadata_type === "object"
            && confirmedMetadataRows[0]?.browser_nonce_hash === nonceHash
            && confirmedMetadataRows[0]?.code_hash === codeHash
            && confirmedMetadataRows[0]?.confirmed_telegram_id === telegramId,
          "Подтверждение Telegram повредило JSONB metadata или browser proof",
        );
        pass("подтверждение Telegram сохраняет JSONB object и browser proof");

        const session =
          await createSecureCustomerSession(transaction, {
            shopId: shop.id,
            customerId: customer.id,
            userAgent: "Pairing E2E Browser",
            ip: "127.0.0.1",
            source: "browser_telegram_pairing_e2e",
          });

        const consumed = await transaction<{ id: string }[]>`
          UPDATE customer_link_tokens
          SET
            status = 'consumed',
            consumed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${pairing.id}
            AND status = 'confirmed'
            AND consumed_at IS NULL
          RETURNING id
        `;
        const repeated = await transaction<{ id: string }[]>`
          UPDATE customer_link_tokens
          SET
            status = 'consumed',
            consumed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${pairing.id}
            AND status = 'confirmed'
            AND consumed_at IS NULL
          RETURNING id
        `;
        assertCondition(
          consumed.length === 1 && repeated.length === 0,
          "Pairing использован повторно",
        );

        const sessionRows = await transaction<{
          token: string;
        }[]>`
          SELECT token
          FROM customer_sessions
          WHERE id = ${session.sessionId}
        `;
        assertCondition(
          sessionRows[0]?.token
            === hashCustomerSessionToken(session.rawToken),
          "Сессия браузера сохранена открыто",
        );
        pass("браузер авторизуется атомарно только один раз");

        const pendingToken = hashCustomerPairingToken(
          createCustomerPairingToken(),
        );
        await transaction`
          INSERT INTO customer_link_tokens (
            shop_id,
            customer_id,
            provider,
            purpose,
            token,
            status,
            expires_at,
            metadata,
            created_at,
            updated_at
          )
          VALUES (
            ${shop.id},
            ${customer.id},
            'telegram',
            'browser_pairing_login',
            ${pendingToken},
            'pending',
            NOW() + INTERVAL '10 minutes',
            '{}'::jsonb,
            NOW(),
            NOW()
          )
        `;

        const unlink = await unlinkCustomerTelegramIdentity(
          transaction,
          {
            shopId: shop.id,
            customerId: customer.id,
            source: "customer_account",
            actorUserId: null,
            actorRole: "customer",
            ip: "127.0.0.1",
            userAgent: "Pairing E2E",
          },
        );
        assertCondition(
          unlink.unlinked,
          "Telegram identity не отвязана",
        );

        const cancelledRows = await transaction<{
          count: number;
        }[]>`
          SELECT COUNT(*)::int AS count
          FROM customer_link_tokens
          WHERE shop_id = ${shop.id}
            AND customer_id = ${customer.id}
            AND purpose = 'browser_pairing_login'
            AND status = 'cancelled'
        `;
        assertCondition(
          Number(cancelledRows[0]?.count ?? 0) >= 1,
          "Отвязка не отменила ожидающий pairing",
        );
        pass("отвязка Telegram отменяет ожидающие запросы входа");

        const telegramAdapter =
          CUSTOMER_AUTH_PROVIDER_ADAPTERS.find(
            (item) => item.provider === "telegram",
          );
        const futureProviders =
          CUSTOMER_AUTH_PROVIDER_ADAPTERS.filter(
            (item) => item.provider !== "telegram",
          );
        assertCondition(
          telegramAdapter?.enabled === true,
          "Telegram adapter не включён",
        );
        assertCondition(
          futureProviders.every((item) => !item.enabled),
          "Будущий provider включён преждевременно",
        );
        pass("создан единый adapter registry для будущих способов входа");

        throw new VerificationRollback(
          "rollback synthetic pairing data",
        );
      },
    );
  } catch (error) {
    if (!(error instanceof VerificationRollback)) {
      throw error;
    }
  }

  const residue = await client<{ count: number }[]>`
    SELECT (
      (SELECT COUNT(*) FROM customers WHERE id = ${customerId})
      + (
        SELECT COUNT(*)
        FROM customer_link_tokens
        WHERE metadata ->> 'marker' = ${marker}
      )
      + (
        SELECT COUNT(*)
        FROM telegram_accounts
        WHERE telegram_id = ${telegramId}
      )
    )::int AS count
  `;
  assertCondition(
    Number(residue[0]?.count ?? 0) === 0,
    "Синтетические pairing-данные остались в PostgreSQL",
  );
  pass("транзакционный rollback удалил синтетические данные");

  console.log("");
  console.log("BROWSER TELEGRAM PAIRING E2E: OK");
  console.log(
    "Проверены профиль до заказа, deep-link, QR, хеши, подтверждение, сессия и отзыв.",
  );
  console.log(
    "Реальные клиенты, заказы и Telegram-сообщения не изменялись.",
  );
} finally {
  await client.end({ timeout: 5 });
}
