import { apiFetch } from "../../lib/api.ts";

export interface NetBalance {
  userId: string;
  name: string;
  amount: string;
}

export interface PairwiseDebt {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: string;
}

export interface Balances {
  net: NetBalance[];
  pairwise: PairwiseDebt[];
}

export interface SettlePlan {
  strategy: "greedy" | "subset";
  transfers: PairwiseDebt[];
  transferCount: number;
  naiveCount: number;
}

export function getBalances(groupId: string) {
  return apiFetch<Balances>(`/groups/${groupId}/balances`, { method: "GET" });
}

export function getSettlePlan(groupId: string, strategy: "greedy" | "subset" = "greedy") {
  return apiFetch<SettlePlan>(`/groups/${groupId}/settle-plan?strategy=${strategy}`, {
    method: "GET",
  });
}
