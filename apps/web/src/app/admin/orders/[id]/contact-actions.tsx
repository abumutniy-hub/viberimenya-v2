"use client";

import { useState } from "react";

type ContactActionsProps = {
  phone?: string | null;
};

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }

  if (digits.length === 11 && digits.startsWith("7")) {
    return digits;
  }

  if (digits.length === 10) {
    return `7${digits}`;
  }

  return digits;
}

export function ContactActions({ phone }: ContactActionsProps) {
  const [copied, setCopied] = useState(false);
  const rawPhone = String(phone || "").trim();

  if (!rawPhone) return null;

  const normalizedPhone = normalizePhone(rawPhone);
  const telHref = normalizedPhone ? `tel:+${normalizedPhone}` : `tel:${rawPhone}`;
  const whatsappHref = normalizedPhone ? `https://wa.me/${normalizedPhone}` : "";

  async function copyPhone() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawPhone);
      } else {
        window.prompt("Скопируйте телефон", rawPhone);
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Скопируйте телефон", rawPhone);
    }
  }

  return (
    <div className="admin-contact-actions">
      <a className="admin-contact-action" href={telHref}>
        Позвонить
      </a>

      {whatsappHref ? (
        <a className="admin-contact-action" href={whatsappHref} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
      ) : null}

      <button type="button" className="admin-contact-action" onClick={copyPhone}>
        {copied ? "Скопировано" : "Скопировать"}
      </button>
    </div>
  );
}
