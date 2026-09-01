import type { Request } from "express";
import { ApiError } from "../middleware/errorHandler.js";

// Express 5 types route params as `string | string[]` (repeated-segment patterns can
// produce arrays); every route in this app uses simple single-segment params, so this
// narrows that back to `string` at the boundary instead of asserting it everywhere.
export function getParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") {
    throw new ApiError(400, "BAD_REQUEST", `Missing or invalid path parameter: ${name}`);
  }
  return value;
}
