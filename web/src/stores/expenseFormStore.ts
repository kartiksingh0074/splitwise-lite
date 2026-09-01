import { create } from "zustand";
import { parseMinor } from "../lib/money.ts";
import type { SplitType } from "../features/expenses/api.ts";

interface ExpenseFormState {
  amount: string;
  currency: string;
  splitType: SplitType;
  participantIds: string[];
  splitInputs: Record<string, string>;
  payerIds: string[];
  payerAmounts: Record<string, string>;

  setAmount: (amount: string) => void;
  setCurrency: (currency: string) => void;
  setSplitType: (splitType: SplitType) => void;
  toggleParticipant: (userId: string) => void;
  setSplitInput: (userId: string, value: string) => void;
  togglePayer: (userId: string) => void;
  setPayerAmount: (userId: string, value: string) => void;
  reset: () => void;
  hydrate: (state: {
    amount: string;
    currency: string;
    splitType: SplitType;
    participantIds: string[];
    splitInputs: Record<string, string>;
    payerIds: string[];
    payerAmounts: Record<string, string>;
  }) => void;
}

const initial = {
  amount: "",
  currency: "USD",
  splitType: "EQUAL" as SplitType,
  participantIds: [] as string[],
  splitInputs: {} as Record<string, string>,
  payerIds: [] as string[],
  payerAmounts: {} as Record<string, string>,
};

export const useExpenseFormStore = create<ExpenseFormState>((set) => ({
  ...initial,
  setAmount: (amount) => set({ amount }),
  setCurrency: (currency) => set({ currency }),
  setSplitType: (splitType) => set({ splitType }),
  toggleParticipant: (userId) =>
    set((state) => ({
      participantIds: state.participantIds.includes(userId)
        ? state.participantIds.filter((id) => id !== userId)
        : [...state.participantIds, userId],
    })),
  setSplitInput: (userId, value) =>
    set((state) => ({ splitInputs: { ...state.splitInputs, [userId]: value } })),
  togglePayer: (userId) =>
    set((state) => ({
      payerIds: state.payerIds.includes(userId)
        ? state.payerIds.filter((id) => id !== userId)
        : [...state.payerIds, userId],
    })),
  setPayerAmount: (userId, value) =>
    set((state) => ({ payerAmounts: { ...state.payerAmounts, [userId]: value } })),
  reset: () => set(initial),
  hydrate: (state) => set(state),
}));

/** "Remaining to allocate" only has a literal meaning for EXACT (currency) and PERCENT splits. */
export function selectRemainingToAllocate(state: ExpenseFormState): string | null {
  if (state.splitType === "EXACT") {
    let totalMinor: bigint;
    try {
      totalMinor = parseMinor(state.amount || "0", state.currency);
    } catch {
      return null;
    }
    let allocated = 0n;
    for (const userId of state.participantIds) {
      const raw = state.splitInputs[userId];
      if (raw && /^\d+$/.test(raw)) allocated += BigInt(raw);
    }
    const remainingMinor = totalMinor - allocated;
    return remainingMinor.toString();
  }

  if (state.splitType === "PERCENT") {
    let allocated = 0;
    for (const userId of state.participantIds) {
      const raw = state.splitInputs[userId];
      const value = raw ? Number.parseFloat(raw) : 0;
      if (!Number.isNaN(value)) allocated += value;
    }
    return (100 - allocated).toFixed(2);
  }

  return null;
}
