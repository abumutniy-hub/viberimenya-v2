"use client";

import {
  type FormEvent,
  useState
} from "react";

export type CategoryManagerItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  productsTotal: number;
  activeProducts: number;
  draftProducts: number;
  hiddenProducts: number;
  archivedProducts: number;
};

async function readError(
  response: Response
) {
  try {
    const data = await response.json() as {
      message?: unknown;
      error?: unknown;
    };

    const message = String(
      data.message
      ?? data.error
      ?? ""
    ).trim();

    if (message) {
      return message;
    }
  } catch {
    // Ответ мог быть не JSON.
  }

  return `Ошибка: HTTP ${response.status}`;
}

export function CategoryManager({
  categories
}: {
  categories: CategoryManagerItem[];
}) {
  const [actionId, setActionId] =
    useState("");

  const [messages, setMessages] =
    useState<Record<string, string>>({});

  function setMessage(
    id: string,
    message: string
  ) {
    setMessages((current) => ({
      ...current,
      [id]: message
    }));
  }

  async function saveCategory(
    event: FormEvent<HTMLFormElement>,
    categoryId: string
  ) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    setActionId(`save:${categoryId}`);
    setMessage(categoryId, "Сохраняем...");

    try {
      const response = await fetch(
        `/api/admin/categories/${categoryId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: form.get("name"),
            slug: form.get("slug"),
            description:
              form.get("description"),
            sortOrder:
              form.get("sortOrder"),
            isActive:
              form.get("isActive") === "on"
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          await readError(response)
        );
      }

      setMessage(
        categoryId,
        "Изменения сохранены"
      );

      window.setTimeout(() => {
        window.location.reload();
      }, 400);
    } catch (error) {
      setMessage(
        categoryId,
        error instanceof Error
          ? error.message
          : "Не удалось сохранить категорию"
      );
    } finally {
      setActionId("");
    }
  }

  async function deleteCategory(
    category: CategoryManagerItem
  ) {
    if (category.productsTotal > 0) {
      window.alert(
        `В категории «${category.name}» `
        + `${category.productsTotal} товар(ов).\n\n`
        + "Сначала перенесите товары или "
        + "отключите категорию."
      );

      return;
    }

    if (
      !window.confirm(
        `Удалить пустую категорию `
        + `«${category.name}»?`
      )
    ) {
      return;
    }

    setActionId(`delete:${category.id}`);
    setMessage(category.id, "Удаляем...");

    try {
      const response = await fetch(
        `/api/admin/categories/${category.id}`,
        {
          method: "DELETE"
        }
      );

      if (!response.ok) {
        throw new Error(
          await readError(response)
        );
      }

      window.location.reload();
    } catch (error) {
      setMessage(
        category.id,
        error instanceof Error
          ? error.message
          : "Не удалось удалить категорию"
      );

      setActionId("");
    }
  }

  if (!categories.length) {
    return (
      <div className="admin-category-manager-empty">
        <strong>Категорий пока нет</strong>
        <span>
          Добавьте первую категорию через форму ниже.
        </span>
      </div>
    );
  }

  return (
    <div className="admin-category-manager-grid">
      {categories.map((category) => {
        const isSaving =
          actionId === `save:${category.id}`;

        const isDeleting =
          actionId === `delete:${category.id}`;

        return (
          <form
            className={
              category.isActive
                ? "admin-category-manager-card"
                : "admin-category-manager-card is-inactive"
            }
            key={category.id}
            onSubmit={(event) => {
              void saveCategory(
                event,
                category.id
              );
            }}
          >
            <div className="admin-category-manager-head">
              <div>
                <span>
                  {category.isActive
                    ? "Активная категория"
                    : "Категория отключена"}
                </span>

                <h3>{category.name}</h3>
              </div>

              <strong>
                {category.productsTotal}
              </strong>
            </div>

            <div className="admin-category-manager-stats">
              <div>
                <span>Опубликовано</span>
                <strong>
                  {category.activeProducts}
                </strong>
              </div>

              <div>
                <span>Черновики</span>
                <strong>
                  {category.draftProducts}
                </strong>
              </div>

              <div>
                <span>Скрыто</span>
                <strong>
                  {category.hiddenProducts
                    + category.archivedProducts}
                </strong>
              </div>
            </div>

            <div className="admin-category-manager-fields">
              <label>
                <span>Название</span>
                <input
                  name="name"
                  defaultValue={category.name}
                  minLength={2}
                  maxLength={160}
                  required
                />
              </label>

              <label>
                <span>Slug</span>
                <input
                  name="slug"
                  defaultValue={category.slug}
                  maxLength={120}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                />
              </label>

              <label>
                <span>Порядок</span>
                <input
                  name="sortOrder"
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  defaultValue={
                    category.sortOrder
                  }
                  required
                />
              </label>

              <label className="admin-category-manager-toggle">
                <input
                  name="isActive"
                  type="checkbox"
                  defaultChecked={
                    category.isActive
                  }
                />

                <span>
                  Показывать клиентам
                </span>
              </label>

              <label className="wide">
                <span>Описание</span>
                <textarea
                  name="description"
                  maxLength={5000}
                  defaultValue={
                    category.description
                  }
                  placeholder="Описание категории"
                />
              </label>
            </div>

            <div className="admin-category-manager-footer">
              <div>
                {messages[category.id] ? (
                  <strong>
                    {messages[category.id]}
                  </strong>
                ) : category.productsTotal > 0 ? (
                  <span>
                    Категорию с товарами можно
                    отключить, но нельзя удалить.
                  </span>
                ) : (
                  <span>
                    Пустую категорию можно удалить.
                  </span>
                )}
              </div>

              <div className="admin-category-manager-actions">
                <button
                  type="submit"
                  disabled={Boolean(actionId)}
                >
                  {isSaving
                    ? "Сохраняем..."
                    : "Сохранить"}
                </button>

                <button
                  className="secondary"
                  type="button"
                  disabled={
                    Boolean(actionId)
                    || category.productsTotal > 0
                  }
                  onClick={() => {
                    void deleteCategory(category);
                  }}
                >
                  {isDeleting
                    ? "Удаляем..."
                    : "Удалить"}
                </button>
              </div>
            </div>
          </form>
        );
      })}
    </div>
  );
}
