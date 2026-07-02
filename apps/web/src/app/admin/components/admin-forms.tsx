"use client";

import { useState } from "react";

type CategoryOption = {
  id: string;
  name: string;
};

type SettingsData = {
  phone?: unknown;
  whatsapp?: unknown;
  telegram?: unknown;
  instagram?: unknown;
  address?: unknown;
  work_hours?: unknown;
  hero_title?: unknown;
  hero_subtitle?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function submitJson(path: string, data: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Ошибка сохранения");
  }

  return response.json();
}

export function SettingsForm({ settings }: { settings: SettingsData | null }) {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="admin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);

        const form = new FormData(event.currentTarget);

        try {
          await submitJson("/api/admin/settings", {
            phone: form.get("phone"),
            whatsapp: form.get("whatsapp"),
            telegram: form.get("telegram"),
            instagram: form.get("instagram"),
            address: form.get("address"),
            workHours: form.get("workHours"),
            heroTitle: form.get("heroTitle"),
            heroSubtitle: form.get("heroSubtitle")
          });

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Ошибка сохранения");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Телефон</span>
          <input name="phone" defaultValue={stringValue(settings?.phone)} />
        </label>

        <label>
          <span>WhatsApp</span>
          <input name="whatsapp" defaultValue={stringValue(settings?.whatsapp)} />
        </label>

        <label>
          <span>Telegram</span>
          <input name="telegram" defaultValue={stringValue(settings?.telegram)} />
        </label>

        <label>
          <span>Instagram</span>
          <input name="instagram" defaultValue={stringValue(settings?.instagram)} />
        </label>

        <label className="wide">
          <span>Адрес</span>
          <input name="address" defaultValue={stringValue(settings?.address)} />
        </label>

        <label>
          <span>График</span>
          <input name="workHours" defaultValue={stringValue(settings?.work_hours)} />
        </label>

        <label className="wide">
          <span>Заголовок главной</span>
          <input name="heroTitle" defaultValue={stringValue(settings?.hero_title)} />
        </label>

        <label className="wide">
          <span>Подзаголовок главной</span>
          <textarea name="heroSubtitle" defaultValue={stringValue(settings?.hero_subtitle)} />
        </label>
      </div>

      <button type="submit" disabled={isSaving}>
        {isSaving ? "Сохраняем..." : "Сохранить настройки"}
      </button>
    </form>
  );
}

export function CategoryForm() {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="admin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);

        const form = new FormData(event.currentTarget);

        try {
          await submitJson("/api/admin/categories", {
            name: form.get("name"),
            slug: form.get("slug"),
            description: form.get("description"),
            sortOrder: form.get("sortOrder"),
            isActive: true
          });

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Ошибка сохранения");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Название</span>
          <input name="name" required />
        </label>

        <label>
          <span>Slug</span>
          <input name="slug" placeholder="naprimer-bukety" />
        </label>

        <label>
          <span>Сортировка</span>
          <input name="sortOrder" type="number" defaultValue="100" />
        </label>

        <label className="wide">
          <span>Описание</span>
          <textarea name="description" />
        </label>
      </div>

      <button type="submit" disabled={isSaving}>
        {isSaving ? "Сохраняем..." : "Добавить категорию"}
      </button>
    </form>
  );
}

export function ProductForm({ categories }: { categories: CategoryOption[] }) {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <form
      className="admin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);

        const form = new FormData(event.currentTarget);

        try {
          await submitJson("/api/admin/products", {
            categoryId: form.get("categoryId"),
            name: form.get("name"),
            slug: form.get("slug"),
            shortDescription: form.get("shortDescription"),
            description: form.get("description"),
            price: form.get("price"),
            stockQuantity: form.get("stockQuantity"),
            status: form.get("status"),
            isFeatured: form.get("isFeatured") === "on",
            sortOrder: form.get("sortOrder")
          });

          window.location.reload();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Ошибка сохранения");
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <div className="admin-form-grid">
        <label>
          <span>Название</span>
          <input name="name" required />
        </label>

        <label>
          <span>Slug</span>
          <input name="slug" placeholder="korolevskiy-buket" />
        </label>

        <label>
          <span>Категория</span>
          <select name="categoryId">
            <option value="">Без категории</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Цена, ₽</span>
          <input name="price" type="number" min="0" required />
        </label>

        <label>
          <span>Остаток</span>
          <input name="stockQuantity" type="number" min="0" defaultValue="0" />
        </label>

        <label>
          <span>Статус</span>
          <select name="status" defaultValue="active">
            <option value="active">Активен</option>
            <option value="draft">Черновик</option>
            <option value="hidden">Скрыт</option>
            <option value="archived">Архив</option>
          </select>
        </label>

        <label>
          <span>Сортировка</span>
          <input name="sortOrder" type="number" defaultValue="100" />
        </label>

        <label className="checkbox-label">
          <span>Показывать в хитах</span>
          <input name="isFeatured" type="checkbox" />
        </label>

        <label className="wide">
          <span>Короткое описание</span>
          <input name="shortDescription" />
        </label>

        <label className="wide">
          <span>Полное описание</span>
          <textarea name="description" />
        </label>
      </div>

      <button type="submit" disabled={isSaving}>
        {isSaving ? "Сохраняем..." : "Добавить товар"}
      </button>
    </form>
  );
}
