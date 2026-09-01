import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";
import { validateBody } from "../../middleware/validate.js";
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from "./schemas.js";
import * as authService from "./service.js";

const authRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Auth-flow tests deliberately make several rapid calls per file; they're not
  // testing rate-limiting itself, so the limiter is skipped under NODE_ENV=test.
  skip: () => env.NODE_ENV === "test",
});

export const authRouter = Router();

authRouter.use(authRateLimit);

authRouter.post("/register", validateBody(registerSchema), async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", validateBody(refreshSchema), async (req, res, next) => {
  try {
    const result = await authService.refresh(req.body.refreshToken);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", validateBody(logoutSchema), async (req, res, next) => {
  try {
    await authService.logout(req.body.refreshToken);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
