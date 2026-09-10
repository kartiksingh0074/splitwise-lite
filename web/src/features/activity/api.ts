import { apiFetch } from "../../lib/api.ts";

export type ActivityType =
  | "GROUP_CREATED"
  | "MEMBER_JOINED"
  | "MEMBER_REMOVED"
  | "EXPENSE_ADDED"
  | "EXPENSE_EDITED"
  | "EXPENSE_DELETED"
  | "SETTLEMENT_RECORDED"
  | "SETTLEMENT_CONFIRMED"
  | "SETTLEMENT_REJECTED";

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  entityType: string;
  entityId: string;
  actorId: string;
  actorName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function listActivity(groupId: string, cursor?: string) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<{ activities: ActivityEntry[]; nextCursor: string | null }>(
    `/groups/${groupId}/activity${qs}`,
    { method: "GET" },
  );
}
