import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { pairingQrDataUrl } from "./pairing-qr.service";

const TOKEN_CONTEXT =
  "viberimenya:browser-telegram-pairing:token:v1";
const CODE_CONTEXT =
  "viberimenya:browser-telegram-pairing:code:v1";
const BROWSER_CONTEXT =
  "viberimenya:browser-telegram-pairing:browser:v1";
const IP_CONTEXT =
  "viberimenya:browser-telegram-pairing:ip:v1";

export const CUSTOMER_PAIRING_COOKIE = "vm_customer_pairing";
export const CUSTOMER_PAIRING_COOKIE_PREFIX = "vm_customer_pairing_";
export const CUSTOMER_PAIRING_TTL_SECONDS = 600;
export const CUSTOMER_PAIRING_MAX_ATTEMPTS = 5;

export type CustomerAuthProvider =
  | "telegram"
  | "email"
  | "yandex"
  | "sber"
  | "max"
  | "passkey";

export type CustomerAuthProviderAdapter = {
  provider: CustomerAuthProvider;
  enabled: boolean;
  label: string;
  supportsPairing: boolean;
  supportsLogin: boolean;
};

export const CUSTOMER_AUTH_PROVIDER_ADAPTERS:
  CustomerAuthProviderAdapter[] = [
    {
      provider: "telegram",
      enabled: true,
      label: "Telegram",
      supportsPairing: true,
      supportsLogin: true,
    },
    {
      provider: "email",
      enabled: false,
      label: "Email",
      supportsPairing: false,
      supportsLogin: false,
    },
    {
      provider: "yandex",
      enabled: false,
      label: "Яндекс ID",
      supportsPairing: false,
      supportsLogin: false,
    },
    {
      provider: "sber",
      enabled: false,
      label: "Сбер ID",
      supportsPairing: false,
      supportsLogin: false,
    },
    {
      provider: "max",
      enabled: false,
      label: "MAX",
      supportsPairing: false,
      supportsLogin: false,
    },
    {
      provider: "passkey",
      enabled: false,
      label: "Passkey",
      supportsPairing: false,
      supportsLogin: false,
    },
  ];

function hashSecret(context: string, value: string) {
  return `sha256:${createHash("sha256")
    .update(`${context}:${value}`)
    .digest("hex")}`;
}

export function createCustomerPairingToken() {
  return randomBytes(16).toString("hex");
}

export function createCustomerPairingBrowserNonce() {
  return randomBytes(24).toString("hex");
}

export function createCustomerPairingCode() {
  return String(randomInt(100000, 1000000));
}

export function hashCustomerPairingToken(value: string) {
  return hashSecret(TOKEN_CONTEXT, value);
}

export function hashCustomerPairingCode(value: string) {
  return hashSecret(CODE_CONTEXT, value.replace(/\D/g, ""));
}

export function hashCustomerPairingBrowserNonce(value: string) {
  return hashSecret(BROWSER_CONTEXT, value);
}

export function hashCustomerPairingIp(value: string) {
  return hashSecret(IP_CONTEXT, value || "unknown");
}

export function safeHashEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function normalizeCustomerPhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    return `+7${digits.slice(1)}`;
  }

  if (digits.length === 11 && digits.startsWith("7")) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return "";
}

export function customerPhoneDigits(value: string) {
  const normalized = normalizeCustomerPhone(value);
  return normalized.replace(/\D/g, "");
}

export function customerPairingCookieSecuritySuffix(
  nodeEnv: string,
) {
  return nodeEnv === "production" ? "; Secure" : "";
}

export function customerPairingCookieName(requestId: string) {
  const compactId = requestId.replace(/[^a-zA-Z0-9]/g, "");
  return `${CUSTOMER_PAIRING_COOKIE_PREFIX}${compactId}`;
}

export function customerPairingCookiePath(requestId: string) {
  return `/api/public/account/auth/pairing/${encodeURIComponent(requestId)}`;
}

export function buildCustomerPairingCookie(
  requestId: string,
  rawNonce: string,
  nodeEnv: string,
) {
  return [
    `${customerPairingCookieName(requestId)}=${encodeURIComponent(rawNonce)}`,
    "HttpOnly",
    `Path=${customerPairingCookiePath(requestId)}`,
    "SameSite=Lax",
    `Max-Age=${CUSTOMER_PAIRING_TTL_SECONDS}`,
  ].join("; ") + customerPairingCookieSecuritySuffix(nodeEnv);
}

export function clearCustomerPairingCookie(
  requestId: string,
  nodeEnv: string,
) {
  return [
    `${customerPairingCookieName(requestId)}=`,
    "HttpOnly",
    `Path=${customerPairingCookiePath(requestId)}`,
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ") + customerPairingCookieSecuritySuffix(nodeEnv);
}

export function clearLegacyCustomerPairingCookie(nodeEnv: string) {
  return [
    `${CUSTOMER_PAIRING_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ") + customerPairingCookieSecuritySuffix(nodeEnv);
}

let cachedBotUsername = "";
let cachedBotUsernameUntil = 0;

export async function resolveTelegramBotUsername(
  token: string,
) {
  const explicit = String(
    process.env.TELEGRAM_BOT_USERNAME || "",
  )
    .trim()
    .replace(/^@/, "");

  if (/^[a-zA-Z0-9_]{5,64}$/.test(explicit)) {
    return explicit;
  }

  if (
    cachedBotUsername
    && cachedBotUsernameUntil > Date.now()
  ) {
    return cachedBotUsername;
  }

  if (!token) return "";

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      {
        headers: {
          accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) return "";

    const payload = await response.json() as {
      ok?: boolean;
      result?: {
        username?: string;
      };
    };
    const username = String(
      payload.result?.username || "",
    )
      .trim()
      .replace(/^@/, "");

    if (!payload.ok || !/^[a-zA-Z0-9_]{5,64}$/.test(username)) {
      return "";
    }

    cachedBotUsername = username;
    cachedBotUsernameUntil = Date.now() + 6 * 60 * 60 * 1000;

    return username;
  } catch {
    return "";
  }
}

export function createTelegramPairingUrl(
  username: string,
  rawToken: string,
) {
  if (!username) return "";

  return `https://t.me/${username}?start=pair_${rawToken}`;
}

export function createTelegramPairingQrDataUrl(
  pairingUrl: string,
) {
  if (!pairingUrl) return "";

  try {
    return pairingQrDataUrl(pairingUrl);
  } catch {
    return "";
  }
}

export function customerPairingStatusLabel(status: string) {
  if (status === "confirmed") return "confirmed";
  if (status === "consumed") return "authenticated";
  if (status === "cancelled") return "cancelled";
  if (status === "rejected") return "rejected";
  if (status === "expired") return "expired";
  return "pending";
}
