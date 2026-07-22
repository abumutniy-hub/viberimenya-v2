# RELEASE 17B-2C.3.6.12.4 — CLIENT BOUQUET APPROVAL + MOBILE CHECKOUT NAV — UPLOAD PERMISSION + INSTALLER LITERAL FIX

## Причина

Файл готового букета существовал и имел режим `0644`, API возвращал корректный URL и статус согласования, но каталог `storage/uploads/bouquets` имел режим `0700`. Nginx работает от `www-data`, поэтому не мог пройти в каталог и возвращал `403 Permission denied`.

## Исправления

- Nginx `/uploads/` использует `alias` без конфликтующего `try_files $uri`.
- Существующие публичные каталоги `bouquets` и `deliveries` получают режим `0755`.
- Telegram-бот создаёт и нормализует каталоги загрузки с режимом `0755`.
- Telegram-бот сохраняет публичные фотографии с режимом `0644`.
- В профиле и разделе «Мои заказы» доступны кнопки «Одобряю» и «Нужна правка».
- Нижнее мобильное меню возвращено на checkout; панели действий подняты над ним.

## Безопасность и совместимость

- Изменяются только права публичных каталогов и файлов букетов/доставок.
- `.env`, приватные документы, база и Telegram authentication не затрагиваются.
- Схема БД и migrations не меняются.
- До изменения production выполняются source-contract, permission probe, baseline typecheck и WEB build.
- После применения выполняются повторные typecheck/build, HTTP/MIME/byte runtime и backup restore-check.


Дополнение 3.6.12.4: служебный текст `try_files $uri` выводится как литерал и не раскрывается Bash при `set -u`.
