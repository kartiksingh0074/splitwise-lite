import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

const allowedOrigins = env.CORS_ALLOWED_ORIGINS
  ? env.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : [env.WEB_ORIGIN];

// Multi-origin allowlist: reflects back the request's Origin only if it's on the list (never a
// wildcard), so credentials-bearing cross-origin requests stay scoped to known frontends.
export function cors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,If-Match,Idempotency-Key");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
