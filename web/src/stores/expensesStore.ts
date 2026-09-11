import { create } from "zustand";
import type { Expense } from "../features/expenses/api.ts";

interface ExpensesState {
  byGroup: Record<string, Expense[]>;
  setExpenses: (groupId: string, expenses: Expense[]) => void;
  /** Inserts a temp entry immediately, before the create request resolves. */
  addOptimistic: (groupId: string, tempExpense: Expense) => void;
  /** Replaces the temp entry with the real server response once the create succeeds. */
  commit: (groupId: string, tempId: string, realExpense: Expense) => void;
  /** Removes the temp entry if the create request fails. */
  rollback: (groupId: string, tempId: string) => void;
  removeExpense: (groupId: string, expenseId: string) => void;
}

export const useExpensesStore = create<ExpensesState>((set) => ({
  byGroup: {},
  // Preserves any in-flight optimistic (temp-*) entries that a fresh fetch wouldn't know about yet.
  setExpenses: (groupId, expenses) =>
    set((state) => {
      const pendingTemp = (state.byGroup[groupId] ?? []).filter((e) => e.id.startsWith("temp-"));
      return { byGroup: { ...state.byGroup, [groupId]: [...pendingTemp, ...expenses] } };
    }),
  addOptimistic: (groupId, tempExpense) =>
    set((state) => ({
      byGroup: { ...state.byGroup, [groupId]: [tempExpense, ...(state.byGroup[groupId] ?? [])] },
    })),
  commit: (groupId, tempId, realExpense) =>
    set((state) => ({
      byGroup: {
        ...state.byGroup,
        [groupId]: (state.byGroup[groupId] ?? []).map((e) => (e.id === tempId ? realExpense : e)),
      },
    })),
  rollback: (groupId, tempId) =>
    set((state) => ({
      byGroup: {
        ...state.byGroup,
        [groupId]: (state.byGroup[groupId] ?? []).filter((e) => e.id !== tempId),
      },
    })),
  removeExpense: (groupId, expenseId) =>
    set((state) => ({
      byGroup: {
        ...state.byGroup,
        [groupId]: (state.byGroup[groupId] ?? []).filter((e) => e.id !== expenseId),
      },
    })),
}));
