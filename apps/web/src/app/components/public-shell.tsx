"use client";

import type {
  ReactNode
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

type PublicShellProps = {
  children: ReactNode;
};

function BrandWordmark() {
  return (
    <span className="vm-clean-wordmark">
      <span className="vm-clean-wordmark-line">
        <span>Выбери</span>

        <span
          className="vm-clean-flower"
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
          <i />
          <b />
        </span>

        <span>Меня</span>
      </span>

      <small>
        ЦВЕТЫ И ПОДАРКИ
      </small>
    </span>
  );
}

export function PublicShell({
  children
}: PublicShellProps) {
  const pathname =
    usePathname();

  if (
    pathname.startsWith(
      "/admin"
    )
  ) {
    return children;
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
    );

  const year =
    new Date().getFullYear();

  return (
    <div className="vm-clean-shell">
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
            Удобные интервалы доставки
          </span>
        </div>
      </div>

      <header className="vm-clean-header">
        <div className="vm-clean-container vm-clean-header-inner">
          <Link
            href="/"
            className="vm-clean-brand"
            aria-label={
              "Выбери Меня — "
              + "перейти на главную"
            }
          >
            <BrandWordmark />
          </Link>

          <nav
            className="vm-clean-desktop-nav"
            aria-label={
              "Основная навигация"
            }
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
              <ShellIcon
                name="profile"
              />

              <span>
                Профиль
              </span>
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
                <ShellIcon
                  name="cart"
                />

                <CartCountBadge />
              </span>

              <span>
                Корзина
              </span>
            </Link>
          </div>

          <Link
            href="/catalog"
            className="vm-clean-mobile-search"
            aria-label={
              "Перейти к поиску "
              + "по каталогу"
            }
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
              <BrandWordmark />
            </Link>

            <p>
              Собираем букеты под заказ,
              показываем готовую работу
              перед отправкой и бережно
              доставляем получателю.
            </p>
          </section>

          <nav
            className="vm-clean-footer-column"
            aria-label={
              "Разделы магазина"
            }
          >
            <strong>
              Покупателям
            </strong>

            <Link href="/catalog">
              Каталог
            </Link>

            <Link href="/cart">
              Корзина
            </Link>

            <Link href="/orders">
              Мои заказы
            </Link>

            <Link href="/account">
              Профиль
            </Link>
          </nav>

          <section className="vm-clean-footer-column">
            <strong>
              Наш сервис
            </strong>

            <span>
              Сборка под заказ
            </span>

            <span>
              Фото готового букета
            </span>

            <span>
              Выбор интервала доставки
            </span>

            <span>
              Отслеживание заказа
            </span>
          </section>
        </div>

        <div className="vm-clean-footer-bottom">
          <div className="vm-clean-container">
            <span>
              © {year} Выбери Меня
            </span>

            <span>
              Цветы и подарки
            </span>
          </div>
        </div>
      </footer>

      <MobileTabbar />
    </div>
  );
}
