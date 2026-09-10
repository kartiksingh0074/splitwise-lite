import { apiFetch, apiFetchBlob } from "../../lib/api.ts";

export type SettlementStatus = "PENDING" | "CONFIRMED" | "REJECTED";

export interface Settlement {
  id: string;
  groupId: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  currency: string;
  amount: string;
  baseCurrency: string;
  amountBase: string;
  fxRateToBase: string;
  note: string | null;
  hasReceipt: boolean;
  status: SettlementStatus;
  settledAt: string;
  createdById: string;
  createdAt: string;
}

export interface CreateSettlementInput {
  toUserId: string;
  amount: string;
  currency?: string;
  note?: string;
  settledAt?: string;
}

export function listSettlements(groupId: string) {
  return apiFetch<{ settlements: Settlement[] }>(`/groups/${groupId}/settlements`, {
    method: "GET",
  });
}

export function createSettlement(groupId: string, input: CreateSettlementInput) {
  return apiFetch<Settlement>(`/groups/${groupId}/settlements`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}

export function confirmSettlement(settlementId: string) {
  return apiFetch<Settlement>(`/settlements/${settlementId}/confirm`, { method: "POST" });
}

export function rejectSettlement(settlementId: string) {
  return apiFetch<Settlement>(`/settlements/${settlementId}/reject`, { method: "POST" });
}

export function uploadReceipt(settlementId: string, file: File) {
  const formData = new FormData();
  formData.append("receipt", file);
  return apiFetch<Settlement>(`/settlements/${settlementId}/receipt`, {
    method: "POST",
    body: formData,
  });
}

export async function getReceiptBlobUrl(settlementId: string): Promise<string> {
  const blob = await apiFetchBlob(`/settlements/${settlementId}/receipt`, { method: "GET" });
  return URL.createObjectURL(blob);
}
