import { z } from "zod";

export const createSettlementSchema = z.object({
  toUserId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a non-negative decimal amount"),
  currency: z
    .string()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
  note: z.string().max(500).optional(),
  settledAt: z.string().datetime().optional(),
  method: z.enum(["CASH", "GATEWAY"]).default("CASH"),
});
