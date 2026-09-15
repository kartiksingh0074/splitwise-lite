import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./config/logger.js";
import { requestId } from "./middleware/requestId.js";
import { cors } from "./middleware/cors.js";
import { globalRateLimit } from "./middleware/globalRateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { groupsRouter } from "./modules/groups/routes.js";
import { inviteRouter } from "./modules/groups/inviteRoutes.js";
import { expenseRouter } from "./modules/expenses/routes.js";
import { settlementRouter } from "./modules/settlements/routes.js";
import { recurringExpenseRouter } from "./modules/recurringExpenses/routes.js";
import { ocrRouter } from "./modules/ocr/routes.js";

export function createApp() {
  const app = express();

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
    }),
  );
  app.use(
    helmet({
      // The receipt endpoint is fetched cross-origin by the dev frontend (a different port);
      // Helmet's default same-origin CORP would silently block that read.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(cors);
  app.use(globalRateLimit);
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/groups", groupsRouter);
  app.use("/api/v1/invites", inviteRouter);
  app.use("/api/v1/expenses", expenseRouter);
  app.use("/api/v1/settlements", settlementRouter);
  app.use("/api/v1/recurring-expenses", recurringExpenseRouter);
  app.use("/api/v1/ocr", ocrRouter);

  app.use((req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}`, details: {} },
    });
  });

  app.use(errorHandler);

  return app;
}
