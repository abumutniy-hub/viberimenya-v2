"use client";

import { useState } from "react";

type DeliveryAddressActionsProps = {
  address?: string | null;
};

export function DeliveryAddressActions({ address }: DeliveryAddressActionsProps) {
  const [copied, setCopied] = useState(false);
  const addressText = String(address || "").trim();

  if (!addressText) return null;

  const encodedAddress = encodeURIComponent(addressText);
  const yandexUrl = `https://yandex.ru/maps/?text=${encodedAddress}`;
  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  async function copyAddress() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(addressText);
      } else {
        window.prompt("Скопируйте адрес", addressText);
      }

      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Скопируйте адрес", addressText);
    }
  }

  return (
    <div className="admin-delivery-actions">
      <a className="admin-delivery-action" href={yandexUrl} target="_blank" rel="noreferrer">
        Яндекс.Карты
      </a>

      <a className="admin-delivery-action" href={googleUrl} target="_blank" rel="noreferrer">
        Google Maps
      </a>

      <button type="button" className="admin-delivery-action" onClick={copyAddress}>
        {copied ? "Скопировано" : "Скопировать адрес"}
      </button>
    </div>
  );
}
