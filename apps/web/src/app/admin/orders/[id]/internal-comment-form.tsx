"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type InternalCommentFormProps = {
  orderId: string;
  initialValue?: string | null;
};

export function InternalCommentForm({ orderId, initialValue }: InternalCommentFormProps) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialValue || ""));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function saveComment() {
    setStatus("saving");

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/internal-comment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internalComment: value
        })
      });

      if (!response.ok) {
        throw new Error("Не удалось сохранить комментарий");
      }

      setStatus("saved");
      router.refresh();
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="admin-internal-comment-form">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Например: клиент просил не звонить, букет нужен до 15:00, проверить открытку..."
        rows={7}
      />

      <div className="admin-internal-comment-actions">
        <button type="button" onClick={saveComment} disabled={status === "saving"}>
          {status === "saving" ? "Сохраняю..." : "Сохранить комментарий"}
        </button>

        {status === "saved" ? <span>Сохранено</span> : null}
        {status === "error" ? <span className="is-error">Ошибка сохранения</span> : null}
      </div>
    </div>
  );
}
