# RELEASE 17B-2C.3.6.8 — CUSTOMER AUTH BROWSER PROOF FIX

Исправляет завершение Telegram-входа после возврата из Telegram в исходную вкладку Яндекс.Браузера.

## Причина

Даже после перехода на отдельные cookies некоторые мобильные браузеры и WebView не возвращали request-scoped cookie при polling. Telegram подтверждал запрос, но API не видел browser nonce и ошибочно сообщал о другой вкладке или другом браузере.

## Решение

- при создании pairing API возвращает вкладке отдельный 192-битный browser proof;
- proof хранится только в `sessionStorage` исходной вкладки;
- polling и cancel передают proof в HTTPS-заголовке `x-vm-customer-pairing-proof`;
- сервер хранит только SHA-256 proof и сравнивает его constant-time;
- HttpOnly cookie остаётся резервным совместимым каналом;
- старые сохранённые запросы без proof автоматически очищаются;
- ложные сообщения о другой вкладке и другом браузере удалены;
- Telegram bot, база и migrations не меняются.
