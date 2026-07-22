import { createHash, timingSafeEqual } from "node:crypto";

const TOKEN_CONTEXT =
  "viberimenya:browser-telegram-pairing:token:v1";
const CODE_CONTEXT =
  "viberimenya:browser-telegram-pairing:code:v1";

function hashSecret(context: string, value: string) {
  return `sha256:${createHash("sha256")
    .update(`${context}:${value}`)
    .digest("hex")}`;
}

export function hashBrowserPairingToken(value: string) {
  return hashSecret(TOKEN_CONTEXT, value);
}

export function hashBrowserPairingCode(value: string) {
  return hashSecret(CODE_CONTEXT, value.replace(/\D/g, ""));
}

export function normalizePairingPhone(value: string) {
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

export function pairingPhoneMatches(
  expected: string,
  actual: string,
) {
  const left = normalizePairingPhone(expected);
  const right = normalizePairingPhone(actual);

  if (!left || !right) return false;

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function browserPairingCanConfirm(status: string) {
  return status === "pending" || status === "opened";
}

export function browserPairingIsConfirmed(status: string) {
  return status === "confirmed" || status === "consumed";
}

export function normalizeBrowserPairingMetadata(
  value: unknown,
) {
  const result: Record<string, unknown> = {};
  const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);

  const visit = (candidate: unknown, depth: number) => {
    if (depth > 8 || candidate === null || candidate === undefined) return;

    if (typeof candidate === "string") {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (parsed !== candidate) visit(parsed, depth + 1);
      } catch {
        // Ignore malformed legacy fragments.
      }
      return;
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }

    if (typeof candidate !== "object") return;

    for (const [key, item] of Object.entries(candidate)) {
      if (!blockedKeys.has(key)) result[key] = item;
    }
  };

  visit(value, 0);
  return result;
}


export function browserPairingMetadataText(
  metadata: unknown,
  key: string,
) {
  const normalized = normalizeBrowserPairingMetadata(metadata);
  const value = normalized[key];
  return typeof value === "string" ? value : "";
}

export function selectBrowserPairingForContact<
  T extends { phone: string; metadata: unknown },
>(
  rows: T[],
  telegramId: string,
  contactPhone: string,
) {
  return rows.find((item) =>
    browserPairingMetadataText(item.metadata, "candidateTelegramId") === telegramId
      && pairingPhoneMatches(item.phone, contactPhone))
    || rows.find((item) => pairingPhoneMatches(item.phone, contactPhone))
    || null;
}

export function parsePairingStartPayload(value: string) {
  const match = /^pair_([a-z0-9_-]{16,64})$/i.exec(value.trim());
  return match?.[1]?.toLowerCase() || "";
}

export function isPairingManualCode(value: string) {
  return /^\d{6}$/.test(value.replace(/\D/g, ""));
}

export function pairingApproveCallback(id: string) {
  return `pair:approve:${id}`;
}

export function pairingCancelCallback(id: string) {
  return `pair:cancel:${id}`;
}

export function pairingCodeDisplay(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length === 6
    ? `${digits.slice(0, 3)} ${digits.slice(3)}`
    : digits;
}
