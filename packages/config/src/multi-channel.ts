export const channelProviderValues = [
  "site",
  "telegram",
  "max"
] as const;

export type ChannelProvider = typeof channelProviderValues[number];

export type ChannelCapabilities = {
  authentication: boolean;
  notifications: boolean;
  bot: boolean;
  miniApp: boolean;
  media: boolean;
  interactiveButtons: boolean;
};

export const channelCapabilities: Record<ChannelProvider, ChannelCapabilities> = {
  site: {
    authentication: true,
    notifications: true,
    bot: false,
    miniApp: false,
    media: true,
    interactiveButtons: true
  },
  telegram: {
    authentication: true,
    notifications: true,
    bot: true,
    miniApp: false,
    media: true,
    interactiveButtons: true
  },
  max: {
    authentication: true,
    notifications: true,
    bot: true,
    miniApp: true,
    media: true,
    interactiveButtons: true
  }
};

export const platformFeatureDefaults = {
  maxEnabled: false,
  maxAuthEnabled: false,
  maxNotificationsEnabled: false,
  maxMiniAppEnabled: false,
  referralsEnabled: false,
  subscriptionsEnabled: false,
  siteChatEnabled: false
} as const;

export type PlatformFeatureFlags = {
  [Key in keyof typeof platformFeatureDefaults]: boolean;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return fallback;
}

export function readPlatformFeatureFlags(settings: unknown): PlatformFeatureFlags {
  const root = asRecord(settings);
  const features = asRecord(root.features);

  return {
    maxEnabled: asBoolean(features.maxEnabled, platformFeatureDefaults.maxEnabled),
    maxAuthEnabled: asBoolean(
      features.maxAuthEnabled,
      platformFeatureDefaults.maxAuthEnabled
    ),
    maxNotificationsEnabled: asBoolean(
      features.maxNotificationsEnabled,
      platformFeatureDefaults.maxNotificationsEnabled
    ),
    maxMiniAppEnabled: asBoolean(
      features.maxMiniAppEnabled,
      platformFeatureDefaults.maxMiniAppEnabled
    ),
    referralsEnabled: asBoolean(
      features.referralsEnabled,
      platformFeatureDefaults.referralsEnabled
    ),
    subscriptionsEnabled: asBoolean(
      features.subscriptionsEnabled,
      platformFeatureDefaults.subscriptionsEnabled
    ),
    siteChatEnabled: asBoolean(
      features.siteChatEnabled,
      platformFeatureDefaults.siteChatEnabled
    )
  };
}

export function isChannelProvider(value: unknown): value is ChannelProvider {
  return channelProviderValues.includes(value as ChannelProvider);
}

export function normalizeChannelProvider(value: unknown): ChannelProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase();

  return isChannelProvider(normalized)
    ? normalized
    : null;
}

export type ChannelNotificationRequest = {
  idempotencyKey: string;
  recipientAddress: string;
  templateKey: string;
  text: string;
  imageUrl?: string;
  buttons?: Array<{
    id: string;
    label: string;
    url?: string;
    payload?: string;
  }>;
  metadata?: Record<string, unknown>;
};

export type ChannelNotificationResult = {
  providerMessageId: string | null;
  deliveredAt?: Date;
  metadata?: Record<string, unknown>;
};

export interface ChannelProviderAdapter {
  readonly provider: ChannelProvider;
  readonly capabilities: ChannelCapabilities;
  sendNotification(
    request: ChannelNotificationRequest
  ): Promise<ChannelNotificationResult>;
}
