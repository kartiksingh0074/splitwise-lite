import type { ActivityEntry } from "./api.ts";

export function formatActivityLabel(a: ActivityEntry): string {
  const p = a.payload;
  switch (a.type) {
    case "GROUP_CREATED":
      return `${a.actorName} created the group`;
    case "MEMBER_JOINED":
      return `${String(p.name ?? "Someone")} joined`;
    case "MEMBER_REMOVED":
      return `${a.actorName} removed ${String(p.name ?? "a member")}`;
    case "EXPENSE_ADDED":
      return `${a.actorName} added "${String(p.description ?? "an expense")}" (${String(p.currency ?? "")} ${String(p.amount ?? "")})`;
    case "EXPENSE_EDITED": {
      const changes = (p.changes ?? {}) as Record<string, unknown>;
      const fields = Object.keys(changes);
      return fields.length > 0
        ? `${a.actorName} edited an expense (${fields.join(", ")})`
        : `${a.actorName} edited an expense`;
    }
    case "EXPENSE_DELETED":
      return `${a.actorName} deleted "${String(p.description ?? "an expense")}"`;
    case "SETTLEMENT_RECORDED":
      return `${a.actorName} recorded a payment of ${String(p.currency ?? "")} ${String(p.amount ?? "")}`;
    case "SETTLEMENT_CONFIRMED":
      return `${a.actorName} confirmed a settlement`;
    case "SETTLEMENT_REJECTED":
      return `${a.actorName} rejected a settlement`;
    default:
      return `${a.actorName} did something`;
  }
}

export function activityLink(groupId: string, a: ActivityEntry): string | null {
  if (a.entityType === "Expense") {
    return `/groups/${groupId}/expenses/${a.entityId}/edit`;
  }
  return null;
}

export function formatDayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function groupByDay(activities: ActivityEntry[]): [string, ActivityEntry[]][] {
  const groups = new Map<string, ActivityEntry[]>();
  for (const a of activities) {
    const key = new Date(a.createdAt).toDateString();
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  return [...groups.entries()];
}
