import { z } from "zod";

export const updateMeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});
