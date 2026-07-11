module.exports = {
  apps: [
    {
      name: "viberimenya-api-v2",
      cwd: "/var/www/viberimenya-v2",
      script: "pnpm",
      args: "--filter @viberimenya/api start",
      env: {
        NODE_ENV: "production",
        UPLOADS_DIR: "/var/www/viberimenya-v2/storage/uploads"
      },
      max_memory_restart: "350M",
      autorestart: true,
      watch: false
    },
    {
      name: "viberimenya-web-v2",
      cwd: "/var/www/viberimenya-v2",
      script: "pnpm",
      args: "--filter @viberimenya/web start",
      env: {
        NODE_ENV: "production",
        API_INTERNAL_URL: "http://127.0.0.1:4001",
        NEXT_PUBLIC_API_URL: "/api"
      },
      max_memory_restart: "450M",
      autorestart: true,
      watch: false
    },
    {
      name: "viberimenya-bot-v2",
      cwd: "/var/www/viberimenya-v2",
      script: "apps/bot/run-bot.sh",
      interpreter: "bash",
      env: {
        NODE_ENV: "production",
        UPLOADS_DIR: "/var/www/viberimenya-v2/storage/uploads"
      },
      max_memory_restart: "300M",
      autorestart: true,
      watch: false
    }
  ]
};
