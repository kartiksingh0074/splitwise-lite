import { apiFetch } from "../../lib/api.ts";
import type { SplitType } from "../expenses/api.ts";

export type RecurrenceInterval = "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurringExpense {
  id: string;
  groupId: string;
  description: string;
  category: string | null;
  currency: string;
  amount: string;
  splitType: SplitType;
  splits: Array<{ userId: string; input?: string }>;
  payers: Array<{ userId: string; amount?: string }>;
  interval: RecurrenceInterval;
  nextRunAt: string;
  active: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringExpenseInput {
  description: string;
  category?: string;
  currency: string;
  amount: string;
  splitType: SplitType;
  splits: Array<{ userId: string; input?: string }>;
  payers: Array<{ userId: string; amount?: string }>;
  interval: RecurrenceInterval;
  startAt: string;
}

export function listRecurringExpenses(groupId: string) {
  return apiFetch<{ recurringExpenses: RecurringExpense[] }>(
    `/groups/${groupId}/recurring-expenses`,
    { method: "GET" },
  );
}

export function createRecurringExpense(groupId: string, input: CreateRecurringExpenseInput) {
  return apiFetch<RecurringExpense>(`/groups/${groupId}/recurring-expenses`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function setRecurringExpenseActive(id: string, active: boolean) {
  return apiFetch<RecurringExpense>(`/recurring-expenses/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
}

export function deleteRecurringExpense(id: string) {
  return apiFetch<void>(`/recurring-expenses/${id}`, { method: "DELETE" });
}
