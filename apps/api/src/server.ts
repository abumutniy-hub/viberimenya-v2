import { buildApi } from "./app";
import { env } from "./lib/env";

const app = await buildApi();
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, "API shutdown started");

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "API shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({
    host: env.API_HOST,
    port: env.API_PORT
  });

  app.log.info(`API started on http://${env.API_HOST}:${env.API_PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
