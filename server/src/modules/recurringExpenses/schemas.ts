import { z } from "zod";
import { decimalAmount, payerInputSchema, splitInputSchema } from "../expenses/schemas.js";

export const createRecurringExpenseSchema = z
  .object({
    description: z.string().min(1).max(200),
    category: z.string().max(60).optional(),
    currency: z
      .string()
      .length(3)
      .transform((v) => v.toUpperCase()),
    amount: decimalAmount,
    splitType: z.enum(["EQUAL", "EXACT", "PERCENT", "SHARES"]),
    splits: z.array(splitInputSchema).min(1),
    payers: z.array(payerInputSchema).min(1),
    interval: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]),
    startAt: z.string().datetime(),
  })
  .refine(
    (data) =>
      data.payers.every((p) => p.amount !== undefined) ||
      data.payers.every((p) => p.amount === undefined),
    { message: "Either every payer must specify an amount, or none of them may", path: ["payers"] },
  );

export const setActiveSchema = z.object({
  active: z.boolean(),
});
