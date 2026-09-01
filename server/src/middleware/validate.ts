import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { ApiError } from "./errorHandler.js";

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new ApiError(422, "VALIDATION_ERROR", "Request body failed validation.", {
          issues: result.error.issues,
        }),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}
