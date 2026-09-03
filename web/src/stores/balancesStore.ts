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

/** Which transfer list to render -- switching `view` is instant, no refetch. */
export function selectDisplayedTransfers(state: BalancesState): PairwiseDebt[] {
  if (state.view === "simplified") return state.settlePlan?.transfers ?? [];
  return state.balances?.pairwise ?? [];
}
