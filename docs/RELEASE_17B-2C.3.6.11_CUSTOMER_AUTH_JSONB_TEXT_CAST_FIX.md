# RELEASE 17B-2C.3.6.11 — Customer Auth JSONB Text Cast Fix

Исправляет завершение регистрации и входа клиента через Telegram после переключения между Яндекс.Браузером и приложением Telegram.

## Причина

В production используется `postgres` 3.4.9. Передача JavaScript-объекта напрямую и helper `sql.json(...)` в фактической конфигурации драйвера приводили к `ERR_INVALID_ARG_TYPE`. Предварительный `JSON.stringify` без явного приведения мог записывать metadata в несовместимом виде.

## Решение

Все pairing и security JSONB-параметры передаются как строка и явно приводятся PostgreSQL:

```sql
${JSON.stringify(value)}::text::jsonb
```

Метод подтверждён отдельным TEMP TABLE preflight на production до изменения кода.

## Проверки

- source-contract без `sql.json/client.json/transaction.json`;
- TEMP TABLE JSONB text-cast preflight до backup и применения payload;
- pairing E2E для API и Telegram-бота;
- browser-proof E2E;
- полный workspace typecheck;
- production WEB build;
- ремонт старой malformed metadata;
- runtime HTTP/security smoke;
- backup и restore-check до и после релиза.

Схема базы и migrations не изменяются. SMS не добавляются.
