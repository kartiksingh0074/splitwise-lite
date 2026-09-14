import type { RecurringExpense } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db/client.js";
import { logger } from "../../config/logger.js";
import { formatMinor } from "../../domain/money.js";
import { advanceByInterval } from "../../domain/recurrence.js";
import { createExpense } from "../expenses/service.js";
import type { payerInputSchema, splitInputSchema } from "../expenses/schemas.js";

type SplitInput = z.infer<typeof splitInputSchema>;
type PayerInput = z.infer<typeof payerInputSchema>;

const MAX_CATCHUP_OCCURRENCES = 12;

interface SchedulerOptions {
  intervalMs?: number;
  autoStart?: boolean;
}

/**
 * Mirrors domain/fx.ts's CachedRateProvider shape (setInterval(...).unref(), a public method
 * tests call directly), but is NOT auto-started at construction -- unlike a read-only cache
 * refresh, tick() creates real Expense rows, so starting it is left to the caller (server boot).
 */
export class RecurringExpenseScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(private options: SchedulerOptions = {}) {
    if (options.autoStart) {
      this.start();
    }
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = this.options.intervalMs ?? 60 * 60 * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    const due = await prisma.recurringExpense.findMany({
      where: { active: true, nextRunAt: { lte: new Date() } },
    });

    for (const template of due) {
      try {
        await this.materialize(template);
      } catch (err) {
        logger.error(
          { err, recurringExpenseId: template.id },
          "recurring expense materialization failed, will retry next tick",
        );
      }
    }
  }

  private async materialize(template: RecurringExpense): Promise<void> {
    const now = new Date();
    let nextRunAt = template.nextRunAt;
    let occurrences = 0;

    while (nextRunAt <= now && occurrences < MAX_CATCHUP_OCCURRENCES) {
      const splits = template.splitsPayload as unknown as SplitInput[];
      const payers = template.payersPayload as unknown as PayerInput[];

      await createExpense(template.groupId, template.createdById, {
        description: template.description,
        category: template.category ?? undefined,
        currency: template.currency,
        amount: formatMinor(template.amountMinor, template.currency),
        splitType: template.splitType,
        splits,
        payers,
        paidAt: nextRunAt.toISOString(),
      });

      nextRunAt = advanceByInterval(nextRunAt, template.interval);
      occurrences += 1;

      // Persist progress after each occurrence, not once at the end -- if a later catch-up
      // occurrence in this same tick throws, the ones that already succeeded must not be
      // recreated on the next tick.
      await prisma.recurringExpense.update({
        where: { id: template.id },
        data: { nextRunAt },
      });
    }
  }
}

export const recurringExpenseScheduler = new RecurringExpenseScheduler({ autoStart: false });
