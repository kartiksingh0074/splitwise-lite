import express from "express";
import { pinoHttp } from "pino-http";
import { logger } from "./config/logger.js";
import { requestId } from "./middleware/requestId.js";
import { cors } from "./middleware/cors.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
    }),
  );
  app.use(cors);
  app.use(express.json());

  app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use((req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}`, details: {} },
    });
  });

  app.use(errorHandler);

  return app;
}
