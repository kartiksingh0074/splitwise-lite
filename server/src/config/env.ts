import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  // Comma-separated allowlist for CORS. Falls back to just WEB_ORIGIN if unset, so existing
  // single-origin dev setups keep working without any config change.
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  UPLOAD_DIR: z.string().default("./uploads"),
  AUTO_CONFIRM_SETTLEMENTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const env = envSchema.parse(process.env);
