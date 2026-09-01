import { z } from "zod";

export const createGroupSchema = z.object({
  name: z.string().min(1).max(120),
  baseCurrency: z
    .string()
    .length(3)
    .transform((v) => v.toUpperCase()),
  memberEmails: z.array(z.string().email()).default([]),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});
