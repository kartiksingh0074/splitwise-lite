import { create } from "zustand";
import type { Balances, PairwiseDebt, SettlePlan } from "../features/balances/api.ts";

type View = "simplified" | "direct";

interface BalancesState {
  balances: Balances | null;
  settlePlan: SettlePlan | null;
  view: View;
  setData: (balances: Balances, settlePlan: SettlePlan) => void;
  setView: (view: View) => void;
}

export const useBalancesStore = create<BalancesState>((set) => ({
  balances: null,
  settlePlan: null,
  view: "simplified",
  setData: (balances, settlePlan) => set({ balances, settlePlan }),
  setView: (view) => set({ view }),
}));

// Shared fallback: a selector must return a stable reference. A fresh `[]` on every call makes
// Zustand v5 (useSyncExternalStore) see a changed snapshot each render and loop forever.
const NO_TRANSFERS: PairwiseDebt[] = [];

/** Which transfer list to render -- switching `view` is instant, no refetch. */
export function selectDisplayedTransfers(state: BalancesState): PairwiseDebt[] {
  if (state.view === "simplified") return state.settlePlan?.transfers ?? NO_TRANSFERS;
  return state.balances?.pairwise ?? NO_TRANSFERS;
}
