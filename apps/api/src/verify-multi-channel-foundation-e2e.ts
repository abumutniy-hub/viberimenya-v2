import { randomBytes, randomInt } from "node:crypto";
import {
  ChannelIdentityConflictError,
  createDb,
  enqueueChannelUpdate,
  markChannelUpdateProcessed,
  upsertCustomerChannelLink
} from "@viberimenya/db";
import {
  channelCapabilities,
  readPlatformFeatureFlags
} from "@viberimenya/config";

class RollbackProbe extends Error {}

function assertCondition(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const { client } = createDb();
const suffix = randomBytes(8).toString("hex");
const phoneSuffix = randomInt(10_000_000, 99_999_999).toString();
const resultRef: { current: Record<string, unknown> | null } = { current: null };

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
          ${`verify-multichannel-${suffix}`}::text,
          'Multi-channel verification',
          'active',
          'Europe/Moscow',
          'RUB'
        )
        RETURNING id
      `;
      const shopId = shopRows[0]?.id;

      assertCondition(shopId, "Не удалось создать тестовый магазин");

      const customers = await sql<{ id: string }[]>`
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
      const firstCustomerId = customers[0]?.id;
      const secondCustomerId = customers[1]?.id;

      assertCondition(
        firstCustomerId && secondCustomerId,
        "Не удалось создать тестовых клиентов"
      );

      const firstLink = await upsertCustomerChannelLink(sql, {
        shopId,
        customerId: firstCustomerId,
        provider: "max",
        providerUserId: `max-user-${suffix}`,
        providerUsername: `max_${suffix}`,
        providerDisplayName: "MAX Test User",
        providerChatId: `max-chat-${suffix}`,
        notificationsEnabled: true,
        verifiedAt: new Date(),
        metadata: {
          source: "foundation-e2e",
          verified: true
        }
      });

      const repeatedLink = await upsertCustomerChannelLink(sql, {
        shopId,
        customerId: firstCustomerId,
        provider: "max",
        providerUserId: `max-user-${suffix}`,
        providerDisplayName: "MAX Test User Updated",
        metadata: {
          repeated: true
        }
      });

      assertCondition(
        firstLink.id === repeatedLink.id,
        "Повторная привязка создала дубль"
      );
      assertCondition(
        repeatedLink.metadata.source === "foundation-e2e"
          && repeatedLink.metadata.repeated === true,
        "Metadata привязки не объединена"
      );

      let identityConflict = false;

      try {
        await upsertCustomerChannelLink(sql, {
          shopId,
          customerId: secondCustomerId,
          provider: "max",
          providerUserId: `max-user-${suffix}`
        });
      } catch (error) {
        identityConflict = error instanceof ChannelIdentityConflictError;
      }

      assertCondition(
        identityConflict,
        "Внешнюю MAX identity удалось перепривязать другому клиенту"
      );

      const firstUpdate = await enqueueChannelUpdate(sql, {
        shopId,
        provider: "max",
        externalUpdateId: `update-${suffix}`,
        updateType: "message_callback",
        payload: {
          callback: "verify",
          source: "foundation-e2e"
        }
      });
      const duplicateUpdate = await enqueueChannelUpdate(sql, {
        shopId,
        provider: "max",
        externalUpdateId: `update-${suffix}`,
        updateType: "message_callback",
        payload: {
          callback: "duplicate"
        }
      });

      assertCondition(firstUpdate.created, "Первое событие не отмечено новым");
      assertCondition(
        !duplicateUpdate.created && duplicateUpdate.id === firstUpdate.id,
        "Идемпотентность channel_updates нарушена"
      );

      const processed = await markChannelUpdateProcessed(sql, {
        id: firstUpdate.id,
        workerId: "foundation-e2e"
      });

      assertCondition(processed, "Событие не переведено в processed");

      const processedRows = await sql<{
        status: string;
        processed_at: Date | null;
      }[]>`
        SELECT status, processed_at
        FROM channel_updates
        WHERE id = ${firstUpdate.id}::uuid
      `;
      const processedRow = processedRows[0];

      assertCondition(
        processedRow,
        "Финальный channel update не найден"
      );
      assertCondition(
        processedRow.status === "processed" && processedRow.processed_at,
        "Финальный статус channel update некорректен"
      );

      const defaults = readPlatformFeatureFlags({});
      const explicit = readPlatformFeatureFlags({
        features: {
          maxEnabled: true,
          maxAuthEnabled: true,
          referralsEnabled: "true"
        }
      });

      assertCondition(
        Object.values(defaults).every((value) => value === false),
        "Новые feature flags должны быть выключены по умолчанию"
      );
      assertCondition(
        explicit.maxEnabled
          && explicit.maxAuthEnabled
          && explicit.referralsEnabled
          && !explicit.maxNotificationsEnabled,
        "Feature flag parser работает некорректно"
      );
      assertCondition(
        channelCapabilities.max.authentication
          && channelCapabilities.max.notifications
          && channelCapabilities.max.miniApp,
        "MAX capabilities не определены"
      );

      resultRef.current = {
        channelLinkId: firstLink.id,
        identityConflictProtected: identityConflict,
        channelUpdateId: firstUpdate.id,
        duplicateCreated: duplicateUpdate.created,
        finalUpdateStatus: processedRow.status,
        featureDefaults: defaults,
        maxCapabilities: channelCapabilities.max
      };

      throw new RollbackProbe("rollback foundation e2e");
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
      (SELECT COUNT(*) FROM shops WHERE slug = ${`verify-multichannel-${suffix}`}::text)
      + (SELECT COUNT(*) FROM customer_channel_links WHERE provider_user_id = ${`max-user-${suffix}`}::text)
      + (SELECT COUNT(*) FROM channel_updates WHERE external_update_id = ${`update-${suffix}`}::text)
    )::int AS count
  `;

  assertCondition(
    leftovers[0]?.count === 0,
    "Rollback E2E оставил тестовые данные"
  );

  console.log(JSON.stringify({ ok: true, ...result, rollbackClean: true }));
  console.log("MULTI_CHANNEL_FOUNDATION_E2E: OK");
} finally {
  await client.end();
}
