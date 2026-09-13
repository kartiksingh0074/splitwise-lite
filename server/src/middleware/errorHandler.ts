import type { NextFunction, Request, Response } from "express";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  req.log?.error({ err }, "request failed");

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details ?? {} },
    });
    return;
  }

  // body-parser (express.json's underlying parser) throws a plain http-error for an
  // over-limit body, not an ApiError -- map it explicitly instead of letting it fall
  // through to a misleading 500.
  if (err instanceof Error && (err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large.", details: {} },
    });
    return;
  }

  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong.", details: {} },
  });
}
