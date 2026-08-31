import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    id: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.id = req.headers["x-request-id"]?.toString() ?? randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
}
