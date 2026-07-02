import { buildApi } from "./app";
import { env } from "./lib/env";

const app = await buildApi();

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
