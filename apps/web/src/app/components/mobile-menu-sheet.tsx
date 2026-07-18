"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PublicSiteSettings } from "../lib/public-settings";
import { ShellIcon } from "./shell-icon";

type CustomerSummary = {
  id: string;
  phone: string;
  name: string | null;
  bonus_balance: number;
  total_orders: number;
};

type AccountResponse = {
  ok?: boolean;
  customer?: CustomerSummary;
};

function money(value: number) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function phoneHref(value: string) {
  const normalized = value.replace(/[^+\d]/g, "");
  return normalized ? `tel:${normalized}` : "";
}

function telegramHref(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const username = trimmed
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_]/g, "");

  return username ? `https://t.me/${username}` : "";
}

function whatsappHref(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

export function MobileMenuSheet({
  settings
}: {
  settings: PublicSiteSettings;
}) {
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const pointerStartX = useRef<number | null>(null);

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const loadAccount = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/public/account/me", {
        credentials: "include",
        cache: "no-store"
      });

      if (!response.ok) {
        setCustomer(null);
        return;
      }

      const data = await response.json() as AccountResponse;
      setCustomer(data.ok && data.customer ? data.customer : null);
    } catch {
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function showMenu() {
    setOpen(true);
    void loadAccount();
  }

  function closeMenu() {
    setOpen(false);
  }

  async function logout() {
    try {
      await fetch("/api/public/account/logout", {
        method: "POST",
        credentials: "include"
      });
    } finally {
      setCustomer(null);
      closeMenu();
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);

      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;

      window.scrollTo(0, scrollY);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    };
  }, [open]);

  const phone = phoneHref(settings.phone);
  const telegram = telegramHref(settings.telegram);
  const whatsapp = whatsappHref(settings.whatsapp);
  const supportHref = telegram || whatsapp || phone;
  const supportExternal = supportHref.startsWith("https://");

  const accountTitle = customer
    ? customer.name?.trim() || "Покупатель"
    : "Войти или зарегистрироваться";

  const accountSubtitle = customer
    ? customer.phone
    : "Вход по номеру телефона";

  const sheet = open ? (
    <div
      className="vm-mobile-menu-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Меню магазина"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeMenu();
        }
      }}
    >
      <aside
        className="vm-mobile-menu-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          pointerStartX.current = event.clientX;
        }}
        onPointerUp={(event) => {
          const startX = pointerStartX.current;
          pointerStartX.current = null;

          if (startX !== null && event.clientX - startX > 72) {
            closeMenu();
          }
        }}
        onPointerCancel={() => {
          pointerStartX.current = null;
        }}
      >
        <header className="vm-mobile-menu-header">
          <div>
            <span>Меню</span>
            <strong>{settings.site.brandName || "Выбери Меня"}</strong>
          </div>

          <button
            ref={closeRef}
            type="button"
            className="vm-mobile-menu-close"
            onClick={closeMenu}
            aria-label="Закрыть меню"
          >
            ×
          </button>
        </header>

        <div className="vm-mobile-menu-main">
          <Link
            href="/account"
            className="vm-mobile-account-link"
            onClick={closeMenu}
          >
            <div className="vm-mobile-account-copy">
              <span>Личный кабинет</span>

              {loading ? (
                <strong>Проверяем данные…</strong>
              ) : (
                <>
                  <strong>{accountTitle}</strong>
                  <small>{accountSubtitle}</small>
                </>
              )}
            </div>

            {customer && !loading ? (
              <div className="vm-mobile-account-bonus">
                <small>Бонусы</small>
                <strong>{money(customer.bonus_balance)}</strong>
              </div>
            ) : (
              <b aria-hidden="true">→</b>
            )}
          </Link>

          <nav
            className="vm-mobile-menu-quick-actions"
            aria-label="Быстрые действия"
          >
            <Link
              href={settings.site.deliveryTermsUrl || "/delivery"}
              onClick={closeMenu}
            >
              <span>Доставка</span>
              <strong>Условия и оплата</strong>
              <b aria-hidden="true">→</b>
            </Link>

            {supportHref ? (
              <a
                href={supportHref}
                target={supportExternal ? "_blank" : undefined}
                rel={supportExternal ? "noopener noreferrer" : undefined}
                onClick={closeMenu}
              >
                <span>Помощь с выбором</span>
                <strong>Написать флористу</strong>
                <b aria-hidden="true">→</b>
              </a>
            ) : null}
          </nav>
        </div>

        <div className="vm-mobile-menu-bottom">
          <details className="vm-mobile-menu-about">
            <summary>О магазине</summary>

            <div>
              <p>
                {settings.site.footerDescription
                  || "Собираем букеты под заказ и бережно доставляем получателю."}
              </p>

              {(settings.address || settings.workHours) ? (
                <dl>
                  {settings.address ? (
                    <div>
                      <dt>Адрес</dt>
                      <dd>{settings.address}</dd>
                    </div>
                  ) : null}

                  {settings.workHours ? (
                    <div>
                      <dt>Режим работы</dt>
                      <dd>{settings.workHours}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </div>
          </details>

          {(phone || telegram || whatsapp) ? (
            <section className="vm-mobile-menu-contacts">
              <span>Связаться с нами</span>

              <div className="vm-mobile-menu-contact-row">
                {phone ? <a href={phone}>Позвонить</a> : null}

                {telegram ? (
                  <a href={telegram} target="_blank" rel="noopener noreferrer">
                    Telegram
                  </a>
                ) : null}

                {whatsapp ? (
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    WhatsApp
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          <nav
            className="vm-mobile-menu-secondary"
            aria-label="Документы магазина"
          >
            <Link
              href={settings.site.policyUrl || "/privacy"}
              onClick={closeMenu}
            >
              Конфиденциальность
            </Link>

            <Link
              href={settings.site.offerUrl || "/offer"}
              onClick={closeMenu}
            >
              Оферта
            </Link>

            <Link
              href={settings.site.returnsUrl || "/returns"}
              onClick={closeMenu}
            >
              Возврат
            </Link>
          </nav>

          {customer ? (
            <button
              type="button"
              className="vm-mobile-menu-logout"
              onClick={() => void logout()}
            >
              Выйти из аккаунта
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={open || pathname.startsWith("/account") ? "is-active" : ""}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={showMenu}
      >
        <span className="vm-clean-mobile-icon">
          <ShellIcon name="menu" />
        </span>
        <span>Меню</span>
      </button>

      {mounted && sheet ? createPortal(sheet, document.body) : null}
    </>
  );
}
