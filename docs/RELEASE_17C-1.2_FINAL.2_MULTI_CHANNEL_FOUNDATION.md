# RELEASE 17C-1.2 FINAL.2 — MULTI-CHANNEL FOUNDATION

Base commit: `11bfa52e361ed2441b99813b600dc4f631a9dda3`

## Назначение

Добавить provider-neutral foundation для `site / telegram / max`, не включая новые функции для пользователей.

## Добавлено

- универсальный provider registry;
- feature flags для MAX, referrals, subscriptions и site chat;
- расширение `customer_channel_links`;
- идемпотентная таблица `channel_updates`;
- защита внешней identity от привязки к другому customer;
- provider-neutral DB service;
- versioned migration `0003_multi_channel_foundation`.

## Безопасность установки

- полная репетиция в отдельном Git worktree;
- отдельная временная PostgreSQL database;
- staging API на отдельном порту;
- staging WEB build и runtime на отдельном порту;
- backup и restore-check перед production cutover;
- автоматический rollback migration, source и `.next` до подтверждения runtime;
- Telegram, payment, Nginx и uploads не изменяются.

## Итоговая схема

`37 таблиц / 482 колонки`.

## Feature flags

Все новые возможности выключены по умолчанию:

- `maxEnabled=false`;
- `maxAuthEnabled=false`;
- `maxNotificationsEnabled=false`;
- `maxMiniAppEnabled=false`;
- `referralsEnabled=false`;
- `subscriptionsEnabled=false`;
- `siteChatEnabled=false`.
