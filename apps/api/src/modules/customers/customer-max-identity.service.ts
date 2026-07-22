import {
  ChannelIdentityConflictError,
  enqueueChannelUpdate,
  markChannelUpdateProcessed,
  upsertCustomerChannelLink,
} from "@viberimenya/db";
import {
  createSecureCustomerSession,
  type CustomerSqlExecutor,
  writeCustomerSecurityAudit,
} from "./customer-session-security.service";
import {
  createMaxIdentityLinkStartParam,
  createMaxIdentityLinkToken,
  extractMaxIdentityLinkToken,
  hashMaxIdentityLinkToken,
  MAX_IDENTITY_LINK_PURPOSE,
  MAX_IDENTITY_LINK_TTL_SECONDS,
  type ValidatedMaxWebAppData,
} from "./customer-max-auth.service";

export type MaxIdentityAuthErrorCode =
  | "max_link_required"
  | "max_link_token_invalid"
  | "max_identity_conflict"
  | "max_auth_replayed";

export class MaxIdentityAuthError extends Error {
  readonly code: MaxIdentityAuthErrorCode;

  constructor(code: MaxIdentityAuthErrorCode, message: string) {
    super(message);
    this.name = "MaxIdentityAuthError";
    this.code = code;
  }
}

export type MaxIdentitySqlExecutor = CustomerSqlExecutor;

function asMultiChannelSql(sql: MaxIdentitySqlExecutor) {
  return sql as Parameters<typeof enqueueChannelUpdate>[0];
}

export async function createMaxIdentityLinkIntent(
  sql: MaxIdentitySqlExecutor,
  params: {
    shopId: string;
    customerId: string;
    redirectPath: string;
    ip: string | null;
    userAgent: string | null;
  },
) {
  const rawToken = createMaxIdentityLinkToken();
  const storedToken = hashMaxIdentityLinkToken(rawToken);

  await sql`
    UPDATE customer_link_tokens
    SET
      status = 'cancelled',
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}::uuid
      AND customer_id = ${params.customerId}::uuid
      AND provider = 'max'
      AND purpose = ${MAX_IDENTITY_LINK_PURPOSE}::text
      AND status IN ('pending', 'opened')
      AND consumed_at IS NULL
  `;

  const rows = await sql<{
    id: string;
    expires_at: string;
  }[]>`
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
      ${params.shopId}::uuid,
      ${params.customerId}::uuid,
      'max',
      ${MAX_IDENTITY_LINK_PURPOSE}::text,
      ${storedToken}::text,
      'pending',
      NOW() + ${MAX_IDENTITY_LINK_TTL_SECONDS}::int * INTERVAL '1 second',
      ${JSON.stringify({
        redirectPath: params.redirectPath,
        tokenStorage: "sha256-v1",
        source: "customer_account",
      })}::text::jsonb,
      NOW(),
      NOW()
    )
    RETURNING id, expires_at::text
  `;
  const row = rows[0];

  if (!row) {
    throw new Error("Не удалось создать MAX link intent");
  }

  await writeCustomerSecurityAudit(sql, {
    shopId: params.shopId,
    customerId: params.customerId,
    eventType: "customer.max_link_intent_created",
    entityId: row.id,
    summary: "Создан одноразовый запрос привязки MAX",
    ip: params.ip,
    userAgent: params.userAgent,
    metadata: {
      provider: "max",
      expiresAt: row.expires_at,
      redirectPath: params.redirectPath,
    },
  });

  return {
    id: row.id,
    rawToken,
    startParam: createMaxIdentityLinkStartParam(rawToken),
    expiresAt: row.expires_at,
  };
}

export async function authenticateCustomerWithMax(
  sql: MaxIdentitySqlExecutor,
  params: {
    shopId: string;
    validatedData: ValidatedMaxWebAppData;
    redirectPath: string;
    requestIp: string | null;
    userAgent: string | null;
  },
) {
  const data = params.validatedData;
  const channelSql = asMultiChannelSql(sql);
  const channelUpdate = await enqueueChannelUpdate(channelSql, {
    shopId: params.shopId,
    provider: "max",
    externalUpdateId: `webapp-auth:${data.queryId}`,
    updateType: "webapp_authentication",
    payload: {
      queryId: data.queryId,
      authDate: data.authDate,
      providerUserId: data.user.id,
      providerChatId: data.chat?.id ?? null,
      startParamPresent: Boolean(data.startParam),
    },
  });

  if (!channelUpdate.created) {
    throw new MaxIdentityAuthError(
      "max_auth_replayed",
      "Эти данные MAX уже использовались для входа",
    );
  }

  const linkRows = await sql<{
    id: string;
    customer_id: string;
    is_active: boolean;
  }[]>`
    SELECT id, customer_id, is_active
    FROM customer_channel_links
    WHERE shop_id = ${params.shopId}::uuid
      AND provider = 'max'
      AND provider_user_id = ${data.user.id}::text
    LIMIT 1
    FOR UPDATE
  `;
  const existingLink = linkRows[0] ?? null;
  const rawLinkToken = extractMaxIdentityLinkToken(data.startParam);
  const storedLinkToken = rawLinkToken
    ? hashMaxIdentityLinkToken(rawLinkToken)
    : "";
  const tokenRows = storedLinkToken
    ? await sql<{
        id: string;
        customer_id: string;
        expires_at: string;
        metadata: Record<string, unknown>;
      }[]>`
        SELECT id, customer_id, expires_at::text, metadata
        FROM customer_link_tokens
        WHERE shop_id = ${params.shopId}::uuid
          AND provider = 'max'
          AND purpose = ${MAX_IDENTITY_LINK_PURPOSE}::text
          AND token = ${storedLinkToken}::text
          AND status IN ('pending', 'opened')
          AND consumed_at IS NULL
          AND expires_at > NOW()
        LIMIT 1
        FOR UPDATE
      `
    : [];
  const linkToken = tokenRows[0] ?? null;

  if (rawLinkToken && !linkToken) {
    throw new MaxIdentityAuthError(
      "max_link_token_invalid",
      "Ссылка привязки MAX недействительна или устарела",
    );
  }

  if (
    existingLink
    && linkToken
    && existingLink.customer_id !== linkToken.customer_id
  ) {
    throw new MaxIdentityAuthError(
      "max_identity_conflict",
      "Эта учётная запись MAX уже связана с другим клиентом",
    );
  }

  const customerId = existingLink?.is_active
    ? existingLink.customer_id
    : linkToken?.customer_id ?? "";

  if (!customerId) {
    throw new MaxIdentityAuthError(
      "max_link_required",
      "Сначала привяжите MAX к существующему профилю покупателя",
    );
  }

  let linkedNow = false;

  try {
    await upsertCustomerChannelLink(channelSql, {
      shopId: params.shopId,
      customerId,
      provider: "max",
      providerUserId: data.user.id,
      providerUsername: data.user.username,
      providerDisplayName: [data.user.firstName, data.user.lastName]
        .filter(Boolean)
        .join(" "),
      providerChatId: data.chat?.id ?? null,
      notificationsEnabled: false,
      verifiedAt: new Date(data.authDate * 1000),
      metadata: {
        authMethod: "max_webapp_init_data",
        queryId: data.queryId,
        languageCode: data.user.languageCode,
        chatType: data.chat?.type ?? null,
        notificationsStage: "disabled_until_17c14",
      },
    });
    linkedNow = !existingLink?.is_active;
  } catch (error) {
    if (error instanceof ChannelIdentityConflictError) {
      throw new MaxIdentityAuthError(
        "max_identity_conflict",
        "Эта учётная запись MAX уже связана с другим клиентом",
      );
    }

    throw error;
  }

  if (linkToken) {
    const consumed = await sql<{ id: string }[]>`
      UPDATE customer_link_tokens
      SET
        status = 'consumed',
        consumed_at = NOW(),
        metadata = metadata || ${JSON.stringify({
          providerUserId: data.user.id,
          queryId: data.queryId,
          consumedBy: "max_webapp_auth",
        })}::text::jsonb,
        updated_at = NOW()
      WHERE id = ${linkToken.id}::uuid
        AND status IN ('pending', 'opened')
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING id
    `;

    if (consumed.length !== 1) {
      throw new MaxIdentityAuthError(
        "max_link_token_invalid",
        "Ссылка привязки MAX уже использована",
      );
    }
  }

  const session = await createSecureCustomerSession(sql, {
    shopId: params.shopId,
    customerId,
    userAgent: params.userAgent,
    ip: params.requestIp,
    source: "max_webapp_auth",
  });

  const processed = await markChannelUpdateProcessed(channelSql, {
    id: channelUpdate.id,
    workerId: "max-webapp-auth",
  });

  if (!processed) {
    throw new Error("MAX auth update не переведён в processed");
  }

  if (linkedNow) {
    await writeCustomerSecurityAudit(sql, {
      shopId: params.shopId,
      customerId,
      eventType: "customer.max_identity_linked",
      entityId: data.user.id,
      summary: "MAX привязан к профилю покупателя",
      ip: params.requestIp,
      userAgent: params.userAgent,
      metadata: {
        provider: "max",
        providerUserId: data.user.id,
        linkTokenId: linkToken?.id ?? null,
      },
    });
  }

  await writeCustomerSecurityAudit(sql, {
    shopId: params.shopId,
    customerId,
    eventType: "customer.max_authenticated",
    entityId: session.sessionId,
    summary: "Покупатель вошёл через MAX",
    ip: params.requestIp,
    userAgent: params.userAgent,
    metadata: {
      provider: "max",
      providerUserId: data.user.id,
      queryId: data.queryId,
      linkedNow,
      redirectPath: params.redirectPath,
    },
  });

  return {
    customerId,
    linkedNow,
    rawSessionToken: session.rawToken,
    sessionId: session.sessionId,
    providerUserId: data.user.id,
  };
}

export async function disableCustomerMaxIdentity(
  sql: MaxIdentitySqlExecutor,
  params: {
    shopId: string;
    customerId: string;
    ip: string | null;
    userAgent: string | null;
  },
) {
  const links = await sql<{ id: string }[]>`
    UPDATE customer_channel_links
    SET
      is_active = false,
      notifications_enabled = false,
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}::uuid
      AND customer_id = ${params.customerId}::uuid
      AND provider = 'max'
      AND is_active = true
    RETURNING id
  `;

  const cancelledTokens = await sql<{ id: string }[]>`
    UPDATE customer_link_tokens
    SET
      status = 'cancelled',
      updated_at = NOW()
    WHERE shop_id = ${params.shopId}::uuid
      AND customer_id = ${params.customerId}::uuid
      AND provider = 'max'
      AND purpose = ${MAX_IDENTITY_LINK_PURPOSE}::text
      AND status IN ('pending', 'opened')
      AND consumed_at IS NULL
    RETURNING id
  `;

  if (links.length > 0 || cancelledTokens.length > 0) {
    await writeCustomerSecurityAudit(sql, {
      shopId: params.shopId,
      customerId: params.customerId,
      eventType: "customer.max_identity_unlinked",
      summary: "MAX отвязан от профиля покупателя",
      ip: params.ip,
      userAgent: params.userAgent,
      metadata: {
        provider: "max",
        disabledLinks: links.length,
        cancelledTokens: cancelledTokens.length,
      },
    });
  }

  return {
    unlinked: links.length > 0,
    disabledLinks: links.length,
    cancelledTokens: cancelledTokens.length,
  };
}
