# RELEASE 17C-1.3 — MAX IDENTITY + AUTHENTICATION

Base commit: `20962b8e38ed10f0115bff286700a06b5674f310`

## Назначение

Добавить безопасную идентификацию и вход покупателя через MAX поверх общего multi-channel foundation без включения MAX в production до получения реальных реквизитов.

## Реализовано

- серверная проверка подписи MAX `WebAppData` по HMAC-SHA256;
- проверка `auth_date`, допустимого clock skew и повторяющихся параметров;
- нормализация MAX user/chat identity;
- одноразовый короткоживущий link intent;
- хранение link token только в SHA-256 виде;
- привязка через подписанный `start_param`;
- запрет автоматического создания нового customer;
- запрет перепривязки внешней MAX identity другому customer;
- replay protection через `channel_updates` и уникальный `query_id`;
- создание общей защищённой `customer_sessions` сессии;
- security audit событий привязки, входа и отвязки;
- динамический auth provider registry.

## Публичные endpoints

- `POST /api/public/account/auth/max/link-intent`;
- `POST /api/public/account/auth/max/session`;
- `DELETE /api/public/account/auth/max/link`.

## Feature flags

MAX остаётся выключенным до отдельной настройки магазина:

- `features.maxEnabled=false`;
- `features.maxAuthEnabled=false`.

Также нужны переменные окружения:

- `MAX_BOT_TOKEN`;
- `MAX_BOT_USERNAME`;
- `MAX_WEBAPP_AUTH_MAX_AGE_SECONDS=3600` — необязательно.

Установщик не изменяет `.env` и не включает feature flags.

## Не входит в этап

- MAX webhook;
- MAX notifications;
- MAX bot catalog;
- MAX Mini App commerce UI;
- referrals;
- subscriptions;
- site chat.

## Схема БД

Миграция не требуется. Используются существующие таблицы:

- `customer_channel_links`;
- `customer_link_tokens`;
- `customer_sessions`;
- `channel_updates`;
- `admin_audit_log`.

Итоговая схема остаётся `37 таблиц / 482 колонки`.
