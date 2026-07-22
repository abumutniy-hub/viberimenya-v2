import type { ISql } from "postgres";
export type ChannelProvider = "site" | "telegram" | "max";

export class ChannelIdentityConflictError extends Error {
  constructor() {
    super("Внешняя учётная запись уже связана с другим клиентом");
  }
}

export type CustomerChannelLinkInput = {
  shopId: string;
  customerId: string;
  provider: ChannelProvider;
  providerUserId: string;
  providerUsername?: string | null;
  providerDisplayName?: string | null;
  providerChatId?: string | null;
  notificationsEnabled?: boolean;
  verifiedAt?: Date | null;
  metadata?: Record<string, unknown>;
};

export type CustomerChannelLinkRecord = {
  id: string;
  shop_id: string;
  customer_id: string;
  provider: string;
  provider_user_id: string;
  provider_username: string | null;
  provider_display_name: string | null;
  provider_chat_id: string | null;
  notifications_enabled: boolean;
  is_active: boolean;
  verified_at: Date | null;
  last_seen_at: Date | null;
  linked_at: Date;
  metadata: Record<string, unknown>;
};

export type ChannelUpdateInput = {
  shopId: string;
  provider: ChannelProvider;
  externalUpdateId: string;
  updateType: string;
  payload: Record<string, unknown>;
};

export type ChannelUpdateRecord = {
  id: string;
  shop_id: string;
  provider: string;
  external_update_id: string;
  update_type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date;
  received_at: Date;
  processed_at: Date | null;
  created: boolean;
};

function requiredText(value: string, field: string, maxLength: number) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} не может быть пустым`);
  }

  if (normalized.length > maxLength) {
    throw new Error(`${field} превышает ${maxLength} символов`);
  }

  return normalized;
}

function optionalText(value: string | null | undefined, maxLength: number) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new Error(`Значение превышает ${maxLength} символов`);
  }

  return normalized;
}

export async function upsertCustomerChannelLink(
  sql: ISql,
  input: CustomerChannelLinkInput
): Promise<CustomerChannelLinkRecord> {
  const providerUserId = requiredText(
    input.providerUserId,
    "providerUserId",
    160
  );
  const providerUsername = optionalText(input.providerUsername, 160);
  const providerDisplayName = optionalText(input.providerDisplayName, 220);
  const providerChatId = optionalText(input.providerChatId, 180);
  const verifiedAt = input.verifiedAt?.toISOString() ?? null;
  const metadata = JSON.stringify(input.metadata ?? {});

  const rows = await sql<CustomerChannelLinkRecord[]>`
    INSERT INTO customer_channel_links (
      shop_id,
      customer_id,
      provider,
      provider_user_id,
      provider_username,
      provider_display_name,
      provider_chat_id,
      notifications_enabled,
      is_active,
      verified_at,
      last_seen_at,
      metadata,
      updated_at
    )
    VALUES (
      ${input.shopId}::uuid,
      ${input.customerId}::uuid,
      ${input.provider}::text,
      ${providerUserId}::text,
      ${providerUsername}::text,
      ${providerDisplayName}::text,
      ${providerChatId}::text,
      ${input.notificationsEnabled ?? true}::boolean,
      true,
      ${verifiedAt}::timestamptz,
      NOW(),
      ${metadata}::text::jsonb,
      NOW()
    )
    ON CONFLICT (shop_id, provider, provider_user_id)
    DO UPDATE SET
      provider_username = COALESCE(
        EXCLUDED.provider_username,
        customer_channel_links.provider_username
      ),
      provider_display_name = COALESCE(
        EXCLUDED.provider_display_name,
        customer_channel_links.provider_display_name
      ),
      provider_chat_id = COALESCE(
        EXCLUDED.provider_chat_id,
        customer_channel_links.provider_chat_id
      ),
      notifications_enabled = EXCLUDED.notifications_enabled,
      is_active = true,
      verified_at = COALESCE(
        customer_channel_links.verified_at,
        EXCLUDED.verified_at
      ),
      last_seen_at = NOW(),
      metadata = customer_channel_links.metadata || EXCLUDED.metadata,
      updated_at = NOW()
    WHERE customer_channel_links.customer_id = EXCLUDED.customer_id
    RETURNING
      id,
      shop_id,
      customer_id,
      provider,
      provider_user_id,
      provider_username,
      provider_display_name,
      provider_chat_id,
      notifications_enabled,
      is_active,
      verified_at,
      last_seen_at,
      linked_at,
      metadata
  `;

  const row = rows[0];

  if (row) {
    return row;
  }

  throw new ChannelIdentityConflictError();
}

export async function disableCustomerChannelLink(
  sql: ISql,
  input: {
    shopId: string;
    customerId: string;
    provider: ChannelProvider;
    providerUserId?: string;
  }
) {
  const providerUserId = optionalText(input.providerUserId, 160);

  const rows = await sql<{ id: string }[]>`
    UPDATE customer_channel_links
    SET
      is_active = false,
      notifications_enabled = false,
      updated_at = NOW()
    WHERE shop_id = ${input.shopId}::uuid
      AND customer_id = ${input.customerId}::uuid
      AND provider = ${input.provider}::text
      AND (
        ${providerUserId}::text IS NULL
        OR provider_user_id = ${providerUserId}::text
      )
    RETURNING id
  `;

  return rows.length;
}

export async function enqueueChannelUpdate(
  sql: ISql,
  input: ChannelUpdateInput
): Promise<ChannelUpdateRecord> {
  const externalUpdateId = requiredText(
    input.externalUpdateId,
    "externalUpdateId",
    220
  );
  const updateType = requiredText(input.updateType, "updateType", 120);
  const payload = JSON.stringify(input.payload ?? {});

  const rows = await sql<ChannelUpdateRecord[]>`
    WITH inserted AS (
      INSERT INTO channel_updates (
        shop_id,
        provider,
        external_update_id,
        update_type,
        payload
      )
      VALUES (
        ${input.shopId}::uuid,
        ${input.provider}::text,
        ${externalUpdateId}::text,
        ${updateType}::text,
        ${payload}::text::jsonb
      )
      ON CONFLICT (shop_id, provider, external_update_id)
      DO NOTHING
      RETURNING
        id,
        shop_id,
        provider,
        external_update_id,
        update_type,
        payload,
        status,
        attempts,
        max_attempts,
        next_attempt_at,
        received_at,
        processed_at,
        true AS created
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT
      id,
      shop_id,
      provider,
      external_update_id,
      update_type,
      payload,
      status,
      attempts,
      max_attempts,
      next_attempt_at,
      received_at,
      processed_at,
      false AS created
    FROM channel_updates
    WHERE shop_id = ${input.shopId}::uuid
      AND provider = ${input.provider}::text
      AND external_update_id = ${externalUpdateId}::text
      AND NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1
  `;

  const row = rows[0];

  if (!row) {
    throw new Error("Не удалось сохранить входящее событие канала");
  }

  return row;
}

export async function markChannelUpdateProcessed(
  sql: ISql,
  input: {
    id: string;
    workerId: string;
  }
) {
  const workerId = requiredText(input.workerId, "workerId", 160);

  const rows = await sql<{ id: string }[]>`
    UPDATE channel_updates
    SET
      status = 'processed',
      processed_at = NOW(),
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      updated_at = NOW()
    WHERE id = ${input.id}::uuid
      AND status IN ('pending', 'processing', 'failed')
      AND (
        locked_by IS NULL
        OR locked_by = ${workerId}::text
      )
    RETURNING id
  `;

  return rows.length === 1;
}
