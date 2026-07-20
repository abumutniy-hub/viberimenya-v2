type SqlExecutor = {
  <
    T extends readonly (object | undefined)[] =
      Record<string, unknown>[]
  >(
    strings: TemplateStringsArray,
    ...parameters: any[]
  ): PromiseLike<T>;
};

export type CustomerTelegramUnlinkSource =
  | "customer_account"
  | "admin_customer_card";

export type CustomerTelegramUnlinkResult = {
  unlinked: boolean;
  disconnectedAccounts: number;
  staffLinksPreserved: number;
  cancelledTokens: number;
  skippedOutbox: number;
  skippedDeliveries: number;
};

export async function unlinkCustomerTelegramIdentity(
  transaction: SqlExecutor,
  params: {
    shopId: string;
    customerId: string;
    source: CustomerTelegramUnlinkSource;
    actorUserId?: string | null;
    actorRole?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<CustomerTelegramUnlinkResult> {
  const accounts = await transaction<
    {
      id: string;
      telegram_id: string;
      user_id: string | null;
    }[]
  >`
    SELECT id, telegram_id, user_id
    FROM telegram_accounts
    WHERE shop_id = ${params.shopId}
      AND customer_id = ${params.customerId}
      AND is_active = true
    ORDER BY linked_at DESC, updated_at DESC
    FOR UPDATE
  `;

  if (accounts.length === 0) {
    return {
      unlinked: false,
      disconnectedAccounts: 0,
      staffLinksPreserved: 0,
      cancelledTokens: 0,
      skippedOutbox: 0,
      skippedDeliveries: 0,
    };
  }

  const accountRows = await transaction<
    { id: string; user_id: string | null }[]
  >`
    UPDATE telegram_accounts
    SET
      customer_id = NULL,
      is_active = CASE
        WHEN user_id IS NOT NULL THEN true
        ELSE false
      END,
      notifications_enabled = CASE
        WHEN user_id IS NOT NULL THEN notifications_enabled
        ELSE false
      END,
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND customer_id = ${params.customerId}
      AND is_active = true
    RETURNING id, user_id
  `;

  await transaction`
    UPDATE customer_channel_links
    SET
      is_active = false,
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND customer_id = ${params.customerId}
      AND provider = 'telegram'
      AND is_active = true
  `;

  const cancelledTokens = await transaction<{ id: string }[]>`
    UPDATE customer_link_tokens
    SET
      status = 'cancelled',
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND customer_id = ${params.customerId}
      AND (
        (provider = 'telegram' AND purpose IN (
          'connect_channel',
          'browser_pairing_login'
        ))
        OR (provider = 'site' AND purpose = 'magic_login')
      )
      AND status IN ('pending', 'opened', 'confirmed')
      AND consumed_at IS NULL
    RETURNING id
  `;

  const skippedDeliveries = await transaction<{ id: string }[]>`
    UPDATE notification_deliveries
    SET
      status = 'skipped',
      locked_at = NULL,
      locked_by = NULL,
      last_error = 'Telegram отвязан от профиля покупателя',
      failed_at = COALESCE(failed_at, NOW()),
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND channel = 'telegram'
      AND recipient_customer_id = ${params.customerId}
      AND status IN ('pending', 'processing')
    RETURNING id
  `;

  const skippedOutbox = await transaction<{ id: string }[]>`
    UPDATE notification_outbox
    SET
      status = 'skipped',
      locked_at = NULL,
      locked_by = NULL,
      last_error = 'Telegram отвязан от профиля покупателя',
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}
      AND channel = 'telegram'
      AND recipient_customer_id = ${params.customerId}
      AND status IN ('pending', 'processing')
    RETURNING id
  `;

  const staffLinksPreserved = accountRows.filter(
    (account) => Boolean(account.user_id),
  ).length;

  await transaction`
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
      ${params.shopId},
      ${params.actorUserId ?? null},
      ${params.actorRole ?? "customer"},
      'customer.telegram_unlinked',
      'customer',
      ${params.customerId},
      'warning',
      ${params.ip ?? null},
      ${params.userAgent ?? null},
      'Telegram отвязан от профиля покупателя',
      ${JSON.stringify({
        source: params.source,
        disconnectedAccounts: accountRows.length,
        staffLinksPreserved,
        cancelledTokens: cancelledTokens.length,
        skippedOutbox: skippedOutbox.length,
        skippedDeliveries: skippedDeliveries.length,
      })}::jsonb,
      NOW()
    )
  `;

  return {
    unlinked: true,
    disconnectedAccounts: accountRows.length,
    staffLinksPreserved,
    cancelledTokens: cancelledTokens.length,
    skippedOutbox: skippedOutbox.length,
    skippedDeliveries: skippedDeliveries.length,
  };
}
