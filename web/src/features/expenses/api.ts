import { apiFetch } from "../../lib/api.ts";

export type SplitType = "EQUAL" | "EXACT" | "PERCENT" | "SHARES";

export interface ExpenseSplitLine {
  userId: string;
  name: string;
  amount: string;
  amountBase: string;
  input: string | null;
}

export interface ExpensePayerLine {
  userId: string;
  name: string;
  amount: string;
  amountBase: string;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  category: string | null;
  currency: string;
  amount: string;
  baseCurrency: string;
  amountBase: string;
  fxRateToBase: string;
  splitType: SplitType;
  paidAt: string;
  createdById: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  payers: ExpensePayerLine[];
  splits: ExpenseSplitLine[];
}

export interface ExpenseWriteInput {
  description: string;
  category?: string;
  currency: string;
  amount: string;
  splitType: SplitType;
  splits: Array<{ userId: string; input?: string }>;
  payers: Array<{ userId: string; amount?: string }>;
  paidAt: string;
}

export function listExpenses(groupId: string, cursor?: string) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<{ expenses: Expense[]; nextCursor: string | null }>(
    `/groups/${groupId}/expenses${qs}`,
    { method: "GET" },
  );
}

/** Pages through listExpenses with limit=100 until exhausted -- for full-list views like export-print. */
export async function listAllExpenses(groupId: string): Promise<Expense[]> {
  const all: Expense[] = [];
  let cursor: string | undefined;
  do {
    const qs = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const page = await apiFetch<{ expenses: Expense[]; nextCursor: string | null }>(
      `/groups/${groupId}/expenses${qs}`,
      { method: "GET" },
    );
    all.push(...page.expenses);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

export function createExpense(groupId: string, input: ExpenseWriteInput) {
  return apiFetch<Expense>(`/groups/${groupId}/expenses`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getExpense(expenseId: string) {
  return apiFetch<Expense>(`/expenses/${expenseId}`, { method: "GET" });
}

export function updateExpense(expenseId: string, version: number, input: ExpenseWriteInput) {
  return apiFetch<Expense>(`/expenses/${expenseId}`, {
    method: "PATCH",
    headers: { "If-Match": String(version) },
    body: JSON.stringify(input),
  });
}

export function deleteExpense(expenseId: string) {
  return apiFetch<void>(`/expenses/${expenseId}`, { method: "DELETE" });
}
