import { z } from "zod";

export const decimalAmount = z.string().regex(/^\d+(\.\d+)?$/, "Must be a non-negative decimal amount");

export const splitInputSchema = z.object({
  userId: z.string().uuid(),
  input: z.string().optional(),
});

export const payerInputSchema = z.object({
  userId: z.string().uuid(),
  amount: decimalAmount.optional(),
});

export const expenseWriteSchema = z
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
    paidAt: z.string().datetime(),
  })
  .refine(
    (data) =>
      data.payers.every((p) => p.amount !== undefined) ||
      data.payers.every((p) => p.amount === undefined),
    { message: "Either every payer must specify an amount, or none of them may", path: ["payers"] },
  );

export const listExpensesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  paidBy: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
