import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const MAX_WEBAPP_SECRET_CONTEXT = "WebAppData";
const MAX_IDENTITY_LINK_TOKEN_CONTEXT =
  "viberimenya:max-identity-link:v1";

export const MAX_IDENTITY_LINK_PURPOSE = "max_identity_link";
export const MAX_IDENTITY_LINK_TTL_SECONDS = 600;
export const MAX_WEBAPP_AUTH_DEFAULT_MAX_AGE_SECONDS = 3600;
export const MAX_WEBAPP_AUTH_FUTURE_SKEW_SECONDS = 300;

export type MaxWebAppUser = {
  id: string;
  firstName: string;
  lastName: string;
  username: string | null;
  languageCode: string | null;
  photoUrl: string | null;
};

export type MaxWebAppChat = {
  id: string;
  type: "DIALOG" | "CHAT" | "CHANNEL";
};

export type ValidatedMaxWebAppData = {
  queryId: string;
  authDate: number;
  user: MaxWebAppUser;
  chat: MaxWebAppChat | null;
  startParam: string | null;
  ip: string | null;
  signatureHash: string;
};

export type MaxWebAppValidationErrorCode =
  | "max_init_data_missing"
  | "max_init_data_malformed"
  | "max_init_data_duplicate_parameter"
  | "max_init_data_hash_missing"
  | "max_init_data_signature_invalid"
  | "max_init_data_expired"
  | "max_init_data_from_future"
  | "max_init_data_user_invalid"
  | "max_init_data_chat_invalid";

export class MaxWebAppValidationError extends Error {
  readonly code: MaxWebAppValidationErrorCode;

  constructor(code: MaxWebAppValidationErrorCode, message: string) {
    super(message);
    this.name = "MaxWebAppValidationError";
    this.code = code;
  }
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function limitedText(
  value: unknown,
  maximumLength: number,
): string {
  return String(value ?? "").trim().slice(0, maximumLength);
}

function optionalText(
  value: unknown,
  maximumLength: number,
): string | null {
  const normalized = limitedText(value, maximumLength);
  return normalized || null;
}

function maxIdentifier(value: unknown, field: string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new MaxWebAppValidationError(
      field === "user.id"
        ? "max_init_data_user_invalid"
        : "max_init_data_chat_invalid",
      `Некорректный идентификатор ${field}`,
    );
  }

  const normalized = String(value ?? "").trim();

  if (!/^[1-9]\d{0,39}$/.test(normalized)) {
    throw new MaxWebAppValidationError(
      field === "user.id"
        ? "max_init_data_user_invalid"
        : "max_init_data_chat_invalid",
      `Некорректный идентификатор ${field}`,
    );
  }

  return normalized;
}

function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left.toLowerCase(), "hex");
  const rightBuffer = Buffer.from(right.toLowerCase(), "hex");

  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeMaxValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new MaxWebAppValidationError(
      "max_init_data_malformed",
      "MAX initData содержит некорректное URL-кодирование",
    );
  }
}

function parseMaxWebAppParameters(rawInitData: string) {
  const normalized = rawInitData.trim();

  if (!normalized || normalized.length > 16_384) {
    throw new MaxWebAppValidationError(
      "max_init_data_missing",
      "MAX initData отсутствует или превышает допустимый размер",
    );
  }

  const parts = normalized.split("&");

  if (parts.length < 3 || parts.length > 64) {
    throw new MaxWebAppValidationError(
      "max_init_data_malformed",
      "MAX initData имеет некорректную структуру",
    );
  }

  const parameters = new Map<string, string>();

  for (const part of parts) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex <= 0) {
      throw new MaxWebAppValidationError(
        "max_init_data_malformed",
        "MAX initData содержит некорректный параметр",
      );
    }

    const key = part.slice(0, separatorIndex);
    const rawValue = part.slice(separatorIndex + 1);

    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key)) {
      throw new MaxWebAppValidationError(
        "max_init_data_malformed",
        "MAX initData содержит недопустимое имя параметра",
      );
    }

    if (parameters.has(key)) {
      throw new MaxWebAppValidationError(
        "max_init_data_duplicate_parameter",
        `MAX initData содержит повторяющийся параметр ${key}`,
      );
    }

    parameters.set(key, decodeMaxValue(rawValue));
  }

  return parameters;
}

function parseMaxUser(value: string): MaxWebAppUser {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MaxWebAppValidationError(
      "max_init_data_user_invalid",
      "MAX initData содержит некорректные данные пользователя",
    );
  }

  const user = asRecord(parsed);
  const id = maxIdentifier(user.id, "user.id");
  const firstName = limitedText(user.first_name, 120);
  const lastName = limitedText(user.last_name, 120);

  if (!firstName && !lastName) {
    throw new MaxWebAppValidationError(
      "max_init_data_user_invalid",
      "MAX initData не содержит имя пользователя",
    );
  }

  return {
    id,
    firstName,
    lastName,
    username: optionalText(user.username, 160),
    languageCode: optionalText(user.language_code, 20),
    photoUrl: optionalText(user.photo_url, 1000),
  };
}

function parseMaxChat(value: string | undefined): MaxWebAppChat | null {
  if (!value) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MaxWebAppValidationError(
      "max_init_data_chat_invalid",
      "MAX initData содержит некорректные данные чата",
    );
  }

  const chat = asRecord(parsed);
  const type = String(chat.type ?? "").trim().toUpperCase();

  if (!(["DIALOG", "CHAT", "CHANNEL"] as const).includes(
    type as MaxWebAppChat["type"],
  )) {
    throw new MaxWebAppValidationError(
      "max_init_data_chat_invalid",
      "MAX initData содержит неизвестный тип чата",
    );
  }

  return {
    id: maxIdentifier(chat.id, "chat.id"),
    type: type as MaxWebAppChat["type"],
  };
}

export function validateMaxWebAppData(
  rawInitData: string,
  botToken: string,
  options: {
    nowMs?: number;
    maximumAgeSeconds?: number;
  } = {},
): ValidatedMaxWebAppData {
  const normalizedBotToken = botToken.trim();

  if (!normalizedBotToken) {
    throw new MaxWebAppValidationError(
      "max_init_data_signature_invalid",
      "MAX Bot Token не настроен",
    );
  }

  const parameters = parseMaxWebAppParameters(rawInitData);
  const originalHash = parameters.get("hash") ?? "";

  if (!originalHash) {
    throw new MaxWebAppValidationError(
      "max_init_data_hash_missing",
      "MAX initData не содержит подпись",
    );
  }

  const launchParameters = [...parameters.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", MAX_WEBAPP_SECRET_CONTEXT)
    .update(normalizedBotToken)
    .digest();
  const calculatedHash = createHmac("sha256", secretKey)
    .update(launchParameters)
    .digest("hex");

  if (!safeHexEqual(calculatedHash, originalHash)) {
    throw new MaxWebAppValidationError(
      "max_init_data_signature_invalid",
      "Подпись MAX initData недействительна",
    );
  }

  const authDateRaw = parameters.get("auth_date") ?? "";
  const authDate = Number(authDateRaw);

  if (!/^\d{9,12}$/.test(authDateRaw) || !Number.isSafeInteger(authDate)) {
    throw new MaxWebAppValidationError(
      "max_init_data_malformed",
      "MAX initData содержит некорректный auth_date",
    );
  }

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const maximumAgeSeconds = Math.min(
    86_400,
    Math.max(
      60,
      Math.trunc(
        options.maximumAgeSeconds
        ?? MAX_WEBAPP_AUTH_DEFAULT_MAX_AGE_SECONDS,
      ),
    ),
  );

  if (authDate > nowSeconds + MAX_WEBAPP_AUTH_FUTURE_SKEW_SECONDS) {
    throw new MaxWebAppValidationError(
      "max_init_data_from_future",
      "MAX initData выдано в будущем",
    );
  }

  if (nowSeconds - authDate > maximumAgeSeconds) {
    throw new MaxWebAppValidationError(
      "max_init_data_expired",
      "Срок действия MAX initData истёк",
    );
  }

  const queryId = limitedText(parameters.get("query_id"), 220);

  if (!queryId || /[\u0000-\u001f\u007f]/.test(queryId)) {
    throw new MaxWebAppValidationError(
      "max_init_data_malformed",
      "MAX initData не содержит корректный query_id",
    );
  }

  const userRaw = parameters.get("user");

  if (!userRaw) {
    throw new MaxWebAppValidationError(
      "max_init_data_user_invalid",
      "MAX initData не содержит пользователя",
    );
  }

  return {
    queryId,
    authDate,
    user: parseMaxUser(userRaw),
    chat: parseMaxChat(parameters.get("chat")),
    startParam: optionalText(parameters.get("start_param"), 180),
    ip: optionalText(parameters.get("ip"), 64),
    signatureHash: originalHash.toLowerCase(),
  };
}

function hashMaxIdentityLinkSecret(rawToken: string) {
  return `sha256:${createHash("sha256")
    .update(`${MAX_IDENTITY_LINK_TOKEN_CONTEXT}:${rawToken}`)
    .digest("hex")}`;
}

export function createMaxIdentityLinkToken() {
  return randomBytes(24).toString("base64url");
}

export function hashMaxIdentityLinkToken(rawToken: string) {
  return hashMaxIdentityLinkSecret(rawToken.trim());
}

export function createMaxIdentityLinkStartParam(rawToken: string) {
  return `link_${rawToken.trim()}`;
}

export function extractMaxIdentityLinkToken(startParam: string | null) {
  const normalized = String(startParam ?? "").trim();
  const match = /^link_([A-Za-z0-9_-]{24,96})$/.exec(normalized);
  return match?.[1] ?? "";
}

export function normalizeMaxBotUsername(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^@/, "");

  return /^[A-Za-z0-9_.-]{3,100}$/.test(normalized)
    ? normalized
    : "";
}

export function createMaxMiniAppLink(
  botUsername: string,
  rawLinkToken: string,
) {
  const username = normalizeMaxBotUsername(botUsername);

  if (!username || !rawLinkToken) return "";

  const startParam = createMaxIdentityLinkStartParam(rawLinkToken);

  return `https://max.ru/${encodeURIComponent(username)}?startapp=${encodeURIComponent(startParam)}`;
}
