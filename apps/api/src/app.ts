import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { healthRoutes } from "./routes/health";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { paymentRoutes } from "./routes/payments";
import { env } from "./lib/env";
import { HttpError } from "./lib/http-error";

function allowedCorsOrigins() {
  const origins = new Set<string>();
  const appUrl = new URL(env.APP_URL);

  origins.add(appUrl.origin);

  if (appUrl.hostname.startsWith("www.")) {
    const apexUrl = new URL(appUrl.origin);
    apexUrl.hostname = appUrl.hostname.slice(4);
    origins.add(apexUrl.origin);
  } else {
    const wwwUrl = new URL(appUrl.origin);
    wwwUrl.hostname = `www.${appUrl.hostname}`;
    origins.add(wwwUrl.origin);
  }

  if (env.NODE_ENV !== "production") {
    origins.add("http://127.0.0.1:3000");
    origins.add("http://localhost:3000");
  }

  return origins;
}

export async function buildApi() {
  const corsOrigins = allowedCorsOrigins();
  const app = Fastify({
    trustProxy: "127.0.0.1",
    disableRequestLogging: env.NODE_ENV === "production",
    logger: {
      level: "info"
    }
  });

  await app.register(helmet, {
    global: true
  });

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, !origin || corsOrigins.has(origin));
    },
    credentials: true
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute"
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send({
      ok: false,
      error: "Route not found"
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid request",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

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

  await app.register(healthRoutes);
  await app.register(publicRoutes);
  await app.register(paymentRoutes);
  await app.register(adminRoutes);

  return app;
}
