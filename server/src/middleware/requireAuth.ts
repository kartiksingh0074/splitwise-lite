import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { ApiError } from "./errorHandler.js";

declare module "express-serve-static-core" {
  interface Request {
    user: { id: string };
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    next(new ApiError(401, "UNAUTHORIZED", "Missing or invalid Authorization header."));
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string };
    req.user = { id: payload.sub };
    next();
  } catch {
    next(new ApiError(401, "UNAUTHORIZED", "Invalid or expired access token."));
  }
}
