"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "vm_cookie_consent_v1";

type ConsentValue = "accepted" | "rejected";

type YandexWindow = typeof window & {
  ym?: ((...args: unknown[]) => void) & {
    a?: unknown[];
    l?: number;
  };
};

function isSafeAnalyticsPath(pathname: string) {
  return (
    pathname === "/"
    || pathname.startsWith("/catalog")
    || pathname.startsWith("/product/")
    || pathname === "/privacy"
    || pathname === "/consent"
    || pathname === "/offer"
    || pathname === "/delivery"
    || pathname === "/returns"
  );
}

function installYandexMetrika(counterId: string) {
  if (!/^\d{4,12}$/.test(counterId)) return;

  const win = window as YandexWindow;

  if (!win.ym) {
    const queue = ((...args: unknown[]) => {
      queue.a = queue.a || [];
      queue.a.push(args);
    }) as NonNullable<YandexWindow["ym"]>;

    queue.l = Date.now();
    win.ym = queue;
  }

  if (!document.getElementById("vm-yandex-metrika")) {
    const script = document.createElement("script");
    script.id = "vm-yandex-metrika";
    script.async = true;
    script.src = "https://mc.yandex.ru/metrika/tag.js";
    document.head.appendChild(script);

    win.ym(Number(counterId), "init", {
      defer: true,
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
    });
  }
}

function sendSafeHit(counterId: string, pathname: string) {
  if (!isSafeAnalyticsPath(pathname)) return;

  const win = window as YandexWindow;
  win.ym?.(Number(counterId), "hit", pathname, {
    title: document.title,
  });
}

export function CookieConsent({
  enabled,
  yandexMetrikaId,
}: {
  enabled: boolean;
  yandexMetrikaId: string;
}) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const lastHit = useRef("");

  useEffect(() => {
    if (
      !enabled
      || !/^\d{4,12}$/.test(yandexMetrikaId)
      || !isSafeAnalyticsPath(pathname)
    ) {
      setVisible(false);
      return;
    }

    const saved = localStorage.getItem(STORAGE_KEY) as ConsentValue | null;

    if (saved === "accepted") {
      installYandexMetrika(yandexMetrikaId);

      if (lastHit.current !== pathname) {
        sendSafeHit(yandexMetrikaId, pathname);
        lastHit.current = pathname;
      }

      return;
    }

    if (saved !== "rejected") {
      setVisible(true);
    }
  }, [enabled, pathname, yandexMetrikaId]);

  if (!visible) return null;

  function choose(value: ConsentValue) {
    localStorage.setItem(STORAGE_KEY, value);
    setVisible(false);

    if (value === "accepted") {
      installYandexMetrika(yandexMetrikaId);
      sendSafeHit(yandexMetrikaId, pathname);
      lastHit.current = pathname;
    }
  }

  return (
    <aside className="vm-cookie-consent" aria-label="Настройки cookies">
      <div>
        <strong>Улучшать сайт с помощью аналитики?</strong>
        <p>
          Необязательные аналитические cookies включаются только после вашего
          согласия. Страницы корзины, аккаунта и заказов не отслеживаются.
          Подробнее — в <Link href="/privacy">политике</Link>.
        </p>
      </div>

      <div className="vm-cookie-actions">
        <button type="button" onClick={() => choose("rejected")}>
          Только необходимые
        </button>
        <button type="button" className="is-primary" onClick={() => choose("accepted")}>
          Разрешить аналитику
        </button>
      </div>
    </aside>
  );
}
