import { apiFetch } from "../../lib/api.ts";

export interface GroupSummary {
  id: string;
  name: string;
  baseCurrency: string;
  createdById: string;
  createdAt: string;
  archivedAt: string | null;
  role: "OWNER" | "MEMBER";
}

export interface GroupMemberInfo {
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "MEMBER";
  joinedAt: string;
}

export interface GroupBase {
  id: string;
  name: string;
  baseCurrency: string;
  createdById: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface GroupDetail extends GroupBase {
  members: GroupMemberInfo[];
}

interface PendingInvite {
  email: string;
  code: string;
  expiresAt: string;
}

export function listGroups() {
  return apiFetch<{ groups: GroupSummary[] }>("/groups", { method: "GET" });
}

export function createGroup(input: { name: string; baseCurrency: string; memberEmails: string[] }) {
  return apiFetch<{ group: GroupBase; pendingInvites: PendingInvite[] }>("/groups", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getGroup(groupId: string) {
  return apiFetch<GroupDetail>(`/groups/${groupId}`, { method: "GET" });
}

export function updateGroup(groupId: string, input: { name?: string; archived?: boolean }) {
  return apiFetch<GroupBase>(`/groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createInvite(groupId: string) {
  return apiFetch<{ code: string; expiresAt: string }>(`/groups/${groupId}/invites`, {
    method: "POST",
  });
}

export function acceptInvite(code: string) {
  return apiFetch<GroupBase>(`/invites/${code}/accept`, { method: "POST" });
}

export function removeMember(groupId: string, userId: string) {
  return apiFetch<void>(`/groups/${groupId}/members/${userId}`, { method: "DELETE" });
}
