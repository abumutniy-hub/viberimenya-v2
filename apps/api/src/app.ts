import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { healthRoutes } from "./routes/health";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { HttpError } from "./lib/http-error";

export async function buildApi() {
  const app = Fastify({
    logger: {
      level: "info"
    }
  });

  await app.register(helmet, {
    global: true
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute"
  });

  await app.register(healthRoutes);
  await app.register(publicRoutes);
  await app.register(adminRoutes);

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send({
      ok: false,
      error: "Route not found"
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        ok: false,
        error: error.message
      });
    }

    request.log.error(error);

    return reply.status(500).send({
      ok: false,
      error: "Internal server error"
    });
  });

  return app;
}
