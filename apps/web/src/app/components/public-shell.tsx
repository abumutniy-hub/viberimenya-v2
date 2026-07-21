"use client";

import {
  useEffect,
  useState,
  type ReactNode
} from "react";

import Link from "next/link";

import {
  usePathname
} from "next/navigation";

import {
  CartCountBadge
} from "./cart-indicator";

import {
  MobileTabbar
} from "./mobile-tabbar";

import {
  ShellIcon
} from "./shell-icon";

import { CookieConsent } from "./cookie-consent";
import { BrandLogo } from "./brand-logo";
import type { PublicSiteSettings } from "../lib/public-settings";

export type PublicShellSettings = PublicSiteSettings;

type PublicShellProps = {
  children: ReactNode;
  settings: PublicShellSettings;
};

type HomeBrandAnimationMode =
  | "checking"
  | "animate"
  | "settled";

const HOME_BRAND_SESSION_KEY =
  "viberimenya:header-brand-animation:v1";

function contactHref(
  type: "phone" | "whatsapp" | "telegram" | "instagram" | "email",
  value: string
) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (type === "email") {
    return `mailto:${trimmed}`;
  }

  if (type === "phone") {
    const normalized = trimmed.replace(
      /[^+\d]/g,
      ""
    );

    return normalized
      ? `tel:${normalized}`
      : "";
  }

  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (type === "whatsapp") {
    const digits = trimmed.replace(
      /\D/g,
      ""
    );

    return digits
      ? `https://wa.me/${digits}`
      : "";
  }

  if (type === "telegram") {
    const username = trimmed
      .replace(/^@/, "")
      .replace(/[^a-zA-Z0-9_]/g, "");

    return username
      ? `https://t.me/${username}`
      : "";
  }

  return "";
}

export function PublicShell({
  children,
  settings
}: PublicShellProps) {
  const pathname = usePathname();
  const [homeBrandMode, setHomeBrandMode] =
    useState<HomeBrandAnimationMode>("checking");

  useEffect(() => {
    if (pathname !== "/") {
      setHomeBrandMode("settled");
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let seen = false;

    try {
      seen = window.sessionStorage.getItem(
        HOME_BRAND_SESSION_KEY
      ) === "1";
    } catch {
      seen = false;
    }

    if (reducedMotion || seen) {
      setHomeBrandMode("settled");
      return;
    }

    setHomeBrandMode("checking");

    const frame = window.requestAnimationFrame(() => {
      setHomeBrandMode("animate");

      try {
        window.sessionStorage.setItem(
          HOME_BRAND_SESSION_KEY,
          "1"
        );
      } catch {
        // The animation may still run when storage is unavailable.
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  if (
    pathname.startsWith(
      "/admin"
    )
  ) {
    return children;
  }

  const maintenanceAllowed = (
    pathname.startsWith("/order/track/")
    || pathname.startsWith("/orders")
    || pathname.startsWith("/account")
    || pathname.startsWith("/checkout")
    || pathname === "/privacy"
    || pathname === "/consent"
    || pathname === "/offer"
    || pathname === "/delivery"
    || pathname === "/returns"
  );

  if (
    settings.launch.maintenanceMode
    && !maintenanceAllowed
  ) {
    return (
      <div className="vm-maintenance-page">
        <section>
          <span>Технические работы</span>
          <h1>{settings.launch.maintenanceTitle}</h1>
          <p>{settings.launch.maintenanceMessage}</p>
          <div>
            <Link href="/orders">Мои заказы</Link>
            {settings.phone ? (
              <a href={contactHref("phone", settings.phone)}>Связаться с магазином</a>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  const catalogActive =
    pathname.startsWith(
      "/catalog"
    )
    || pathname.startsWith(
      "/product/"
    );

  const ordersActive =
    pathname.startsWith(
      "/orders"
    )
    || pathname.startsWith(
      "/order/track/"
    );

  const accountActive =
    pathname.startsWith(
      "/account"
    );

  const cartActive =
    pathname.startsWith(
      "/cart"
    )
    || pathname.startsWith(
      "/checkout"
    );

  const year = new Date().getFullYear();

  const brandName =
    settings.site.brandName
    || "Выбери Меня";

  const brandSubtitle =
    settings.site.brandSubtitle
    || "ЦВЕТЫ И ПОДАРКИ";

  const contacts = [
    {
      label: "Телефон",
      value: settings.phone,
      href: contactHref(
        "phone",
        settings.phone
      )
    },
    {
      label: "WhatsApp",
      value: settings.whatsapp,
      href: contactHref(
        "whatsapp",
        settings.whatsapp
      )
    },
    {
      label: "Telegram",
      value: settings.telegram,
      href: contactHref(
        "telegram",
        settings.telegram
      )
    },
    {
      label: "Instagram",
      value: settings.instagram,
      href: contactHref(
        "instagram",
        settings.instagram
      )
    },
    {
      label: "Email",
      value: settings.site.email,
      href: contactHref(
        "email",
        settings.site.email
      )
    }
  ].filter(
    (item) => item.value && item.href
  );

  const legalLinks = [
    {
      label: "Политика конфиденциальности",
      href: settings.site.policyUrl || "/privacy"
    },
    {
      label: "Согласие на обработку данных",
      href: "/consent"
    },
    {
      label: "Публичная оферта",
      href: settings.site.offerUrl || "/offer"
    },
    {
      label: "Условия доставки",
      href: settings.site.deliveryTermsUrl || "/delivery"
    },
    {
      label: "Возврат и претензии",
      href: settings.site.returnsUrl || "/returns"
    }
  ].filter((item) => item.href);

  return (
    <div className="vm-clean-shell">
      {!settings.launch.acceptingOrders ? (
        <div className="vm-orders-paused" role="status">
          {settings.launch.ordersPausedMessage}
        </div>
      ) : null}

      <a
        className="vm-clean-skip"
        href="#vm-clean-content"
      >
        Перейти к содержимому
      </a>

      <div className="vm-clean-service">
        <div className="vm-clean-container">
          <span>
            Фото букета перед доставкой
          </span>

          <i aria-hidden="true" />

          <span>
            Бережная сборка под заказ
          </span>

          <i aria-hidden="true" />

          <span>
            {settings.workHours
              || "Удобные интервалы доставки"}
          </span>
        </div>
      </div>

      <header className="vm-clean-header">
        <div className="vm-clean-container vm-clean-header-inner">
          <Link
            href="/"
            className={
              pathname === "/"
                ? `vm-clean-brand is-home-brand-${homeBrandMode}`
                : "vm-clean-brand"
            }
            aria-label={
              `${brandName} — перейти на главную`
            }
          >
            <BrandLogo
              brandName={brandName}
              brandSubtitle={brandSubtitle}
            />
          </Link>

          <nav
            className="vm-clean-desktop-nav"
            aria-label="Основная навигация"
          >
            <Link
              href="/catalog"
              className={
                catalogActive
                  ? "is-active"
                  : ""
              }
              aria-current={
                catalogActive
                  ? "page"
                  : undefined
              }
            >
              Каталог
            </Link>

            <Link
              href="/orders"
              className={
                ordersActive
                  ? "is-active"
                  : ""
              }
              aria-current={
                ordersActive
                  ? "page"
                  : undefined
              }
            >
              Мои заказы
            </Link>
          </nav>

          <div className="vm-clean-desktop-actions">
            <Link
              href="/account"
              className={
                accountActive
                  ? "is-active"
                  : ""
              }
              aria-label="Профиль"
            >
              <ShellIcon name="profile" />
              <span>Профиль</span>
            </Link>

            <Link
              href="/cart"
              className={
                cartActive
                  ? "is-active"
                  : ""
              }
              aria-label="Корзина"
            >
              <span className="vm-clean-action-icon">
                <ShellIcon name="cart" />
                <CartCountBadge />
              </span>
              <span>Корзина</span>
            </Link>
          </div>

          <Link
            href="/catalog"
            className="vm-clean-mobile-search"
            aria-label="Перейти к поиску по каталогу"
          >
            <ShellIcon name="search" />
          </Link>
        </div>
      </header>

      <main
        id="vm-clean-content"
        className="vm-clean-content"
      >
        {children}
      </main>

      <footer className="vm-clean-footer">
        <div className="vm-clean-container vm-clean-footer-grid">
          <section className="vm-clean-footer-brand">
            <Link
              href="/"
              className="vm-clean-brand"
            >
              <BrandLogo
                brandName={brandName}
                brandSubtitle={brandSubtitle}
                compact
              />
            </Link>

            <p>
              {settings.site.footerDescription}
            </p>

            {settings.address ? (
              <span className="vm-clean-footer-note">
                {settings.address}
              </span>
            ) : null}
          </section>

          <nav
            className="vm-clean-footer-column"
            aria-label="Разделы магазина"
          >
            <strong>Покупателям</strong>
            <Link href="/catalog">Каталог</Link>
            <Link href="/cart">Корзина</Link>
            <Link href="/orders">Мои заказы</Link>
            <Link href="/account">Профиль</Link>
          </nav>

          {contacts.length > 0 ? (
            <section className="vm-clean-footer-column">
              <strong>Контакты</strong>

              {contacts.map((contact) => (
                <a
                  key={contact.label}
                  href={contact.href}
                  target={
                    contact.href.startsWith("http")
                      ? "_blank"
                      : undefined
                  }
                  rel={
                    contact.href.startsWith("http")
                      ? "noopener noreferrer"
                      : undefined
                  }
                >
                  {contact.label}
                </a>
              ))}

              {settings.workHours ? (
                <span>{settings.workHours}</span>
              ) : null}
            </section>
          ) : (
            <section className="vm-clean-footer-column">
              <strong>Наш сервис</strong>
              <span>Сборка под заказ</span>
              <span>Фото готового букета</span>
              <span>Выбор интервала доставки</span>
              <span>Отслеживание заказа</span>
            </section>
          )}

          {legalLinks.length > 0 ? (
            <nav
              className="vm-clean-footer-column"
              aria-label="Документы"
            >
              <strong>Документы</strong>

              {legalLinks.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          ) : null}
        </div>

        <div className="vm-clean-footer-bottom">
          <div className="vm-clean-container">
            <span>
              © {year} {brandName}
            </span>

            <span>
              {[
                settings.site.legalName,
                settings.site.inn
                  ? `ИНН ${settings.site.inn}`
                  : "",
                settings.site.ogrn
                  ? `ОГРН ${settings.site.ogrn}`
                  : ""
              ]
                .filter(Boolean)
                .join(" · ")
                || brandSubtitle}
            </span>
          </div>
        </div>
      </footer>

      <MobileTabbar settings={settings} />
      <CookieConsent
        enabled={settings.analytics.enabled}
        yandexMetrikaId={settings.analytics.yandexMetrikaId}
      />

    </div>
  );
}
