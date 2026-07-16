import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ENV_FILE_PATH, env } from "../../lib/env";

export type YooKassaRuntimeSettings = {
  shopId: string;
  secretKey: string;
  testMode: boolean;
};

const MANAGED_KEYS = [
  "YOOKASSA_SHOP_ID",
  "YOOKASSA_SECRET_KEY",
  "YOOKASSA_TEST_MODE"
] as const;

function envLine(key: string, value: string) {
  return `${key}=${JSON.stringify(value)}`;
}

function replaceManagedValues(
  source: string,
  values: Record<(typeof MANAGED_KEYS)[number], string>
) {
  const replaced = new Set<string>();
  const lines = source.split(/\r?\n/).filter((line, index, all) => {
    return index < all.length - 1 || line !== "";
  });

  const nextLines = lines.map((line) => {
    for (const key of MANAGED_KEYS) {
      if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
        if (replaced.has(key)) {
          return null;
        }

        replaced.add(key);
        return envLine(key, values[key]);
      }
    }

    return line;
  }).filter((line): line is string => line !== null);

  for (const key of MANAGED_KEYS) {
    if (!replaced.has(key)) {
      nextLines.push(envLine(key, values[key]));
    }
  }

  return `${nextLines.join("\n").trimEnd()}\n`;
}

export function currentYooKassaRuntimeSettings(): YooKassaRuntimeSettings {
  return {
    shopId: env.YOOKASSA_SHOP_ID,
    secretKey: env.YOOKASSA_SECRET_KEY,
    testMode: env.YOOKASSA_TEST_MODE
  };
}

export async function persistYooKassaRuntimeSettings(
  settings: YooKassaRuntimeSettings
) {
  const envPath = ENV_FILE_PATH;
  const directory = dirname(envPath);
  const temporaryPath = join(
    directory,
    `.env.yookassa-${process.pid}-${randomUUID()}.tmp`
  );

  let source = "";
  let mode = 0o600;

  try {
    source = await readFile(envPath, "utf8");
    const fileStat = await stat(envPath);
    mode = fileStat.mode & 0o777;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";

    if (code !== "ENOENT") {
      throw error;
    }
  }

  const nextSource = replaceManagedValues(source, {
    YOOKASSA_SHOP_ID: settings.shopId,
    YOOKASSA_SECRET_KEY: settings.secretKey,
    YOOKASSA_TEST_MODE: settings.testMode ? "true" : "false"
  });

  await writeFile(temporaryPath, nextSource, {
    encoding: "utf8",
    mode: mode || 0o600,
    flag: "wx"
  });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, envPath);
  await chmod(envPath, 0o600);

  process.env.YOOKASSA_SHOP_ID = settings.shopId;
  process.env.YOOKASSA_SECRET_KEY = settings.secretKey;
  process.env.YOOKASSA_TEST_MODE = settings.testMode ? "true" : "false";

  env.YOOKASSA_SHOP_ID = settings.shopId;
  env.YOOKASSA_SECRET_KEY = settings.secretKey;
  env.YOOKASSA_TEST_MODE = settings.testMode;
}
