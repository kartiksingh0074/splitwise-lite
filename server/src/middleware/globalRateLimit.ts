import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

// A generous, global backstop -- the auth routes already have their own much stricter 10/min
// limiter on top of this. Skipped in tests: the lifecycle integration test and the existing
// suite's rapid sequential requests would otherwise trip a global limit that isn't the thing
// being tested.
export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
});
