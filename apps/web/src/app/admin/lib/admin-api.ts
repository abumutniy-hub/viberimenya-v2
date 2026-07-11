import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type AdminRow = Record<string, unknown>;

export async function fetchAdmin<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4001";

  try {
    const cookieHeader = (await cookies()).toString();
    const init: RequestInit = { cache: "no-store" };

    if (cookieHeader) {
      init.headers = { cookie: cookieHeader };
    }

    const response = await fetch(`${baseUrl}${path}`, init);

    if (response.status === 401) {
      redirect("/admin/login");
    }

    if (response.status === 403) {
      redirect("/admin");
    }

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    throw error;
  }
}

export function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (typeof value === "number") return value.toLocaleString("ru-RU");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function displayDate(value: unknown) {
  if (!value) return "—";

  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return displayValue(value);
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
