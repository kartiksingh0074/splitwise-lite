import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

// Minimal single-origin CORS for local dev. Phase 8 replaces this with a
// proper multi-origin allowlist alongside Helmet and rate limiting.
export function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", env.WEB_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,If-Match,Idempotency-Key");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
