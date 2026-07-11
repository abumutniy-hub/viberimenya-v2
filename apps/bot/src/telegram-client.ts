const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DRY_RUN = process.env.BOT_DRY_RUN !== "false";

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

const TELEGRAM_RETRY_ATTEMPTS = envNumber("BOT_TELEGRAM_RETRY_ATTEMPTS", 3, 1, 5);

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: {
    retry_after?: number;
  };
};

function sleep(ms: number) {
  return new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

function isRetryableTelegramFailure(status: number | undefined, description: string) {
  if (status === 429) return true;
  if (status && status >= 500) return true;

  return /too many requests|bad gateway|gateway timeout|etimedout|econnreset|network|timeout/i.test(description);
}

function telegramRetryDelayMs(attempt: number, retryAfterSeconds?: number) {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(30000, retryAfterSeconds * 1000 + 250);
  }

  return Math.min(8000, 500 * 2 ** attempt + Math.floor(Math.random() * 300));
}

export async function telegramApi<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const requestInit: RequestInit = body
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    : {
        method: "GET"
      };

  for (let attempt = 0; attempt < TELEGRAM_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, requestInit);
      const data = await response.json().catch(() => ({
        ok: false,
        description: response.statusText
      })) as TelegramApiResponse<T>;

      if (response.ok && data.ok) {
        return data.result as T;
      }

      const description = data.description || response.statusText || "unknown error";
      const retryAfter = data.parameters?.retry_after;

      if (attempt < TELEGRAM_RETRY_ATTEMPTS - 1 && isRetryableTelegramFailure(response.status, description)) {
        await sleep(telegramRetryDelayMs(attempt, retryAfter));
        continue;
      }

      throw new Error(`Telegram ${method} failed: ${description}`);
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);

      if (attempt < TELEGRAM_RETRY_ATTEMPTS - 1 && isRetryableTelegramFailure(undefined, description)) {
        await sleep(telegramRetryDelayMs(attempt));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Telegram ${method} failed after retries`);
}

export async function sendTelegramMessage(chatId: string | number, message: string, extra?: Record<string, unknown>) {
  if (DRY_RUN) {
    console.log(`[bot-worker] dry-run send chat=${chatId}`);
    console.log(message);
    return;
  }

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true,
    ...(extra || {})
  });
}

export async function sendTelegramPhoto(chatId: string | number, photoUrl: string, caption: string, extra?: Record<string, unknown>) {
  if (DRY_RUN) {
    console.log(`[bot-worker] dry-run send photo chat=${chatId} photo=${photoUrl}`);
    console.log(caption);
    return;
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    photo: photoUrl,
    caption
  };

  if (extra) {
    Object.assign(payload, extra);
  }

  await telegramApi("sendPhoto", payload);
}

export async function editTelegramMessageText(chatId: string | number, messageId: number, message: string, extra?: Record<string, unknown>) {
  if (DRY_RUN) {
    console.log(`[bot-worker] dry-run edit chat=${chatId} message=${messageId}`);
    console.log(message);
    return;
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: message,
    disable_web_page_preview: true
  };

  if (extra) {
    Object.assign(payload, extra);
  }

  await telegramApi("editMessageText", payload);
}

export async function deleteTelegramMessage(chatId: string | number, messageId: number) {
  if (DRY_RUN) {
    console.log(`[bot-worker] dry-run delete chat=${chatId} message=${messageId}`);
    return;
  }

  await telegramApi("deleteMessage", {
    chat_id: chatId,
    message_id: messageId
  });
}

export async function sendOrEditTelegramMessage(
  chatId: string | number,
  message: string,
  extra: Record<string, unknown>,
  messageId?: number
) {
  if (messageId) {
    try {
      await editTelegramMessageText(chatId, messageId, message, extra);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("message is not modified")) {
        return;
      }

      console.warn(`[bot-worker] edit failed, sending new message instead: ${errorMessage}`);
    }
  }

  await sendTelegramMessage(chatId, message, extra);
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  if (DRY_RUN) {
    return;
  }

  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId
  };

  if (text) {
    body.text = text;
  }

  await telegramApi("answerCallbackQuery", body);
}
