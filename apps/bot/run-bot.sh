#!/usr/bin/env bash
set -e
cd /var/www/viberimenya-v2
export BOT_DRY_RUN=false
export BOT_RUN_ONCE=false
export BOT_POLL_INTERVAL_MS=15000
exec pnpm --filter @viberimenya/bot start
