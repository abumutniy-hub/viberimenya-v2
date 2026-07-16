# Восстановление «ВЫБЕРИ МЕНЯ v2»

Автоматические резервные копии находятся в:

`/root/viberimenya-backups/automatic`

Каждая завершённая копия содержит:

- `database.dump` — PostgreSQL в custom-формате;
- `uploads.tar.gz` — фотографии товаров, букетов и доставок;
- `env.enc` — зашифрованный `.env`;
- `source-state.txt` — Git-коммит и состояние кода;
- `SHA256SUMS` — контрольные суммы;
- `manifest.json` — состав и время копии.

Ключ расшифровки создаётся отдельно:

`/root/viberimenya-backups/recovery/backup-encryption.key`

Скачайте этот файл через Termius и храните вне сервера. Не отправляйте его в чат и не добавляйте в Git.

## Перед восстановлением

1. Не удаляйте работающий проект.
2. Создайте дополнительный ручной backup в CRM → Система.
3. Скачайте выбранную резервную копию и ключ на отдельный компьютер.
4. Проверьте `SHA256SUMS`.
5. Восстанавливайте сначала на временном сервере или во временной базе.

## Проверка базы без изменения магазина

CRM → Система → «Проверить восстановление» создаёт временную PostgreSQL-базу, загружает в неё последнюю копию, проверяет таблицу магазина и затем удаляет временную базу.

## Расшифровка `.env`

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in env.enc \
  -out .env.restored \
  -pass file:/root/viberimenya-backups/recovery/backup-encryption.key
chmod 600 .env.restored
```

## Восстановление фотографий

```bash
tar -xzf uploads.tar.gz -C /var/www/viberimenya-v2/storage
```

## Восстановление PostgreSQL

Команды ниже являются примером. Имя рабочей базы нужно брать из `DATABASE_URL`.

```bash
sudo -u postgres pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname=<ИМЯ_БАЗЫ> \
  database.dump
```

После восстановления:

```bash
cd /var/www/viberimenya-v2
pnpm --filter @viberimenya/api typecheck
pnpm --filter @viberimenya/web typecheck
pnpm --filter @viberimenya/bot typecheck
pnpm --filter @viberimenya/web build
pm2 restart viberimenya-api-v2
pm2 restart viberimenya-web-v2
pm2 restart viberimenya-bot-v2
curl -fsS http://127.0.0.1:4001/api/health
```

Полное восстановление рабочей базы выполняйте только после проверки выбранной копии и наличия дополнительного дампа текущего состояния.
