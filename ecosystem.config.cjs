module.exports = {
  apps: [
    {
      name: "viberimenya-api-v2",
      cwd: "/var/www/viberimenya-v2",
      script: "pnpm",
      args: "--filter @viberimenya/api start",
      env: {
        NODE_ENV: "development"
      },
      max_memory_restart: "350M",
      autorestart: true,
      watch: false
    }
  ]
};
