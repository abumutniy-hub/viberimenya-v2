"use client";

import { useMemo, useState } from "react";
import styles from "./catalog-import.module.css";

type ImportRow = {
  rowNumber: number;
  name: string;
  slug: string;
  category: string;
  price: number;
  oldPrice: number | null;
  costPrice: number | null;
  stockQuantity: number;
  status: "draft" | "active" | "hidden";
  isFeatured: boolean;
  sortOrder: number;
  shortDescription: string;
  description: string;
  composition: string;
  careText: string;
  imageUrl: string;
  errors: string[];
};

const templateHeaders = [
  "Название",
  "Slug",
  "Категория",
  "Цена",
  "Старая цена",
  "Себестоимость",
  "Остаток",
  "Статус",
  "Хит",
  "Порядок",
  "Короткое описание",
  "Описание",
  "Состав",
  "Уход",
  "Фото URL",
];

const aliases: Record<string, keyof Omit<ImportRow, "rowNumber" | "errors">> = {
  "название": "name",
  "name": "name",
  "slug": "slug",
  "слаг": "slug",
  "категория": "category",
  "category": "category",
  "цена": "price",
  "price": "price",
  "старая цена": "oldPrice",
  "old price": "oldPrice",
  "себестоимость": "costPrice",
  "cost price": "costPrice",
  "остаток": "stockQuantity",
  "stock": "stockQuantity",
  "статус": "status",
  "status": "status",
  "хит": "isFeatured",
  "featured": "isFeatured",
  "порядок": "sortOrder",
  "sort order": "sortOrder",
  "короткое описание": "shortDescription",
  "short description": "shortDescription",
  "описание": "description",
  "description": "description",
  "состав": "composition",
  "composition": "composition",
  "уход": "careText",
  "care": "careText",
  "фото url": "imageUrl",
  "image url": "imageUrl",
};

function parseCsv(text: string, delimiter: ";" | ",") {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function moneyNumber(value: string) {
  const normalized = value.replace(/\s|₽/g, "").replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function booleanValue(value: string) {
  return ["1", "true", "да", "yes", "y", "+"].includes(value.trim().toLowerCase());
}

function statusValue(value: string): ImportRow["status"] {
  const normalized = value.trim().toLowerCase();
  if (["active", "активен", "опубликован", "да"].includes(normalized)) return "active";
  if (["hidden", "скрыт"].includes(normalized)) return "hidden";
  return "draft";
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return /[";,\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(name: string, content: string) {
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function CatalogImport() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [mode, setMode] = useState<"upsert" | "create_only">("upsert");
  const [createCategories, setCreateCategories] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const validRows = useMemo(() => rows.filter((row) => row.errors.length === 0), [rows]);
  const invalidRows = rows.length - validRows.length;

  function template() {
    const example = [
      "Букет Нежность",
      "buket-nezhnost",
      "Букеты",
      4500,
      5200,
      2500,
      10,
      "draft",
      "нет",
      100,
      "Нежный авторский букет",
      "Подробное описание букета",
      "Розы, эустома, зелень",
      "Подрезать стебли и менять воду ежедневно",
      "",
    ];
    download("viberimenya-catalog-template.csv", `${templateHeaders.map(csvCell).join(";")}\n${example.map(csvCell).join(";")}\n`);
  }

  async function chooseFile(file: File | null) {
    setMessage("");
    setRows([]);
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setMessage("Сохраните таблицу Excel в формате CSV UTF-8 и загрузите файл .csv.");
      return;
    }

    const fileText = await file.text();
    const firstLine = fileText.split(/\r?\n/, 1)[0] ?? "";
    const delimiter: ";" | "," =
      (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0)
        ? ";"
        : ",";
    const table = parseCsv(fileText, delimiter);
    if (table.length < 2) {
      setMessage("В файле нет строк товаров.");
      return;
    }

    const header = table[0]!.map((value) => value.trim().toLowerCase());
    const mapped = header.map((value) => aliases[value] ?? null);

    if (!mapped.includes("name") || !mapped.includes("price")) {
      setMessage("Обязательные колонки: Название и Цена. Используйте готовый шаблон.");
      return;
    }

    const parsed = table.slice(1, 501).map((values, index) => {
      const raw: Record<string, string> = {};
      mapped.forEach((key, column) => {
        if (key) raw[key] = String(values[column] ?? "").trim();
      });

      const price = moneyNumber(raw.price ?? "");
      const oldPrice = moneyNumber(raw.oldPrice ?? "");
      const costPrice = moneyNumber(raw.costPrice ?? "");
      const stock = moneyNumber(raw.stockQuantity ?? "") ?? 0;
      const sortOrder = moneyNumber(raw.sortOrder ?? "") ?? 100;
      const errors: string[] = [];

      if ((raw.name ?? "").length < 2) errors.push("Не указано название");
      if (price === null || price < 0) errors.push("Некорректная цена");
      if (stock < 0) errors.push("Остаток меньше нуля");
      if ((raw.imageUrl ?? "") && !/^\/uploads\/products\/[a-zA-Z0-9._-]+$/.test(raw.imageUrl ?? "")) {
        errors.push("Фото должно быть из /uploads/products/");
      }

      return {
        rowNumber: index + 2,
        name: raw.name ?? "",
        slug: raw.slug ?? "",
        category: raw.category ?? "",
        price: price ?? 0,
        oldPrice: oldPrice && oldPrice > 0 ? oldPrice : null,
        costPrice: costPrice && costPrice > 0 ? costPrice : null,
        stockQuantity: Math.max(0, stock),
        status: statusValue(raw.status ?? "draft"),
        isFeatured: booleanValue(raw.isFeatured ?? ""),
        sortOrder: Math.max(0, sortOrder),
        shortDescription: raw.shortDescription ?? "",
        description: raw.description ?? "",
        composition: raw.composition ?? "",
        careText: raw.careText ?? "",
        imageUrl: raw.imageUrl ?? "",
        errors,
      } satisfies ImportRow;
    });

    setRows(parsed);
    if (table.length > 501) {
      setMessage("За один импорт обрабатывается до 500 товаров. Остальные строки не включены.");
    }
  }

  async function runImport() {
    if (!validRows.length || invalidRows > 0) return;
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/catalog/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          createMissingCategories: createCategories,
          rows: validRows.map(({ errors, rowNumber, ...row }) => ({ ...row, sourceRow: rowNumber })),
        }),
      });
      const data = (await response.json()) as {
        message?: string;
        error?: string;
        result?: { created: number; updated: number; skipped: number; categoriesCreated: number };
      };

      if (!response.ok) throw new Error(data.message || data.error || "Импорт не выполнен");

      const result = data.result;
      setMessage(
        `Импорт завершён: создано ${result?.created ?? 0}, обновлено ${result?.updated ?? 0}, пропущено ${result?.skipped ?? 0}, новых категорий ${result?.categoriesCreated ?? 0}.`,
      );
      window.setTimeout(() => window.location.reload(), 1100);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Импорт не выполнен");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <div>
          <h2>Массовый импорт каталога</h2>
          <p>До 500 товаров за одну загрузку. Excel: «Сохранить как → CSV UTF-8».</p>
        </div>
        <div className={styles.headActions}>
          <button type="button" onClick={template}>Скачать шаблон</button>
          <a href="/api/admin/catalog/export.csv">Выгрузить текущий каталог</a>
        </div>
      </div>

      <div className={styles.controls}>
        <label>
          <span>CSV-файл</span>
          <input type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)} />
        </label>
        <label>
          <span>Повторяющийся slug</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="upsert">Обновить существующий товар</option>
            <option value="create_only">Пропустить существующий товар</option>
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={createCategories} onChange={(event) => setCreateCategories(event.target.checked)} />
          Создавать новые категории
        </label>
      </div>

      {rows.length ? (
        <>
          <div className={styles.summary}>
            <span>Строк: {rows.length}</span>
            <span>Готово: {validRows.length}</span>
            {invalidRows ? <span className={styles.error}>Ошибок: {invalidRows}</span> : null}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Строка</th><th>Название</th><th>Категория</th><th>Цена</th><th>Остаток</th><th>Статус</th><th>Проверка</th></tr></thead>
              <tbody>
                {rows.slice(0, 30).map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td><td>{row.name || "—"}</td><td>{row.category || "Без категории"}</td><td>{row.price.toLocaleString("ru-RU")} ₽</td><td>{row.stockQuantity}</td><td>{row.status}</td><td className={row.errors.length ? styles.rowError : ""}>{row.errors.join("; ") || "Готово"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className={styles.footer}>
        <span className={styles.message}>{message || "Импорт выполняется одной транзакцией: при ошибке частичных изменений не останется."}</span>
        <button type="button" disabled={loading || !validRows.length || invalidRows > 0} onClick={() => void runImport()}>
          {loading ? "Импортируем…" : `Импортировать ${validRows.length || ""}`}
        </button>
      </div>
    </section>
  );
}
