import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { recurringExpenseScheduler } from "./modules/recurringExpenses/scheduler.js";
import { attachRealtimeServer } from "./lib/realtime.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`server listening on port ${env.PORT}`);
});

attachRealtimeServer(server);

// Not auto-started at import time (unlike domain/fx.ts's rate-cache refresher) since it creates
// real Expense rows -- explicitly gated to real server boot, never under the test suite.
if (env.NODE_ENV !== "test") {
  recurringExpenseScheduler.start();
}
