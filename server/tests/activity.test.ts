import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";

const app = createApp();

async function registerUser(email: string, name: string) {
  const res = await request(app).post("/api/v1/auth/register").send({
    email,
    name,
    password: "correct-horse-battery",
  });
  return res.body as { user: { id: string; email: string }; accessToken: string };
}

function authHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function setupGroup(n: number, prefix: string) {
  const users = await Promise.all(
    Array.from({ length: n }, (_, i) => registerUser(`${prefix}${i}@example.com`, `${prefix}${i}`)),
  );

  const createRes = await request(app)
    .post("/api/v1/groups")
    .set(authHeader(users[0]!.accessToken))
    .send({
      name: "Test Group",
      baseCurrency: "USD",
      memberEmails: users.slice(1).map((u) => u.user.email),
    });

  return { users, groupId: createRes.body.group.id as string };
}

function getActivity(groupId: string, token: string, cursor?: string) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request(app)
    .get(`/api/v1/groups/${groupId}/activity${qs}`)
    .set(authHeader(token));
}

describe("Activity on group creation / membership", () => {
  it("GROUP_CREATED fires once; MEMBER_JOINED fires for an added member, not the creator", async () => {
    const { users, groupId } = await setupGroup(2, "act");

    const res = await getActivity(groupId, users[0]!.accessToken);
    expect(res.status).toBe(200);

    const created = res.body.activities.filter((a: { type: string }) => a.type === "GROUP_CREATED");
    expect(created).toHaveLength(1);
    expect(created[0].actorId).toBe(users[0]!.user.id);

    const joined = res.body.activities.filter((a: { type: string }) => a.type === "MEMBER_JOINED");
    expect(joined).toHaveLength(1);
    expect(joined[0].payload.userId).toBe(users[1]!.user.id);
  });

  it("acceptInvite fires MEMBER_JOINED for the joining user", async () => {
    const { users, groupId } = await setupGroup(1, "inv");
    const joiner = await registerUser("inv-joiner@example.com", "Joiner");

    const invite = await request(app)
      .post(`/api/v1/groups/${groupId}/invites`)
      .set(authHeader(users[0]!.accessToken));

    await request(app)
      .post(`/api/v1/invites/${invite.body.code}/accept`)
      .set(authHeader(joiner.accessToken));

    const res = await getActivity(groupId, users[0]!.accessToken);
    const joined = res.body.activities.filter(
      (a: { type: string; payload: { userId: string } }) =>
        a.type === "MEMBER_JOINED" && a.payload.userId === joiner.user.id,
    );
    expect(joined).toHaveLength(1);
    expect(joined[0].actorId).toBe(joiner.user.id);
  });

  it("removeMember fires MEMBER_REMOVED with the remover as actor", async () => {
    const { users, groupId } = await setupGroup(2, "rm");

    await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${users[1]!.user.id}`)
      .set(authHeader(users[0]!.accessToken));

    const res = await getActivity(groupId, users[0]!.accessToken);
    const removed = res.body.activities.filter((a: { type: string }) => a.type === "MEMBER_REMOVED");
    expect(removed).toHaveLength(1);
    expect(removed[0].actorId).toBe(users[0]!.user.id);
    expect(removed[0].payload.userId).toBe(users[1]!.user.id);
  });
});

describe("Activity on expense edit", () => {
  it("produces exactly one EXPENSE_EDITED row with a correct diff, surviving deletion", async () => {
    const { users, groupId } = await setupGroup(2, "edt");
    const ids = users.map((u) => u.user.id);

    const create = await request(app)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .set(authHeader(users[0]!.accessToken))
      .send({
        description: "Original",
        currency: "USD",
        amount: "20.00",
        splitType: "EQUAL",
        splits: ids.map((userId) => ({ userId })),
        payers: [{ userId: ids[0]! }],
        paidAt: new Date().toISOString(),
      });
    const expenseId = create.body.id;

    const edit = await request(app)
      .patch(`/api/v1/expenses/${expenseId}`)
      .set({ ...authHeader(users[0]!.accessToken), "If-Match": String(create.body.version) })
      .send({
        description: "Updated",
        currency: "USD",
        amount: "50.00",
        splitType: "EQUAL",
        splits: ids.map((userId) => ({ userId })),
        payers: [{ userId: ids[0]! }],
        paidAt: new Date().toISOString(),
      });
    expect(edit.status).toBe(200);

    const beforeDelete = await prisma.activity.findMany({
      where: { entityId: expenseId, type: "EXPENSE_EDITED" },
    });
    expect(beforeDelete).toHaveLength(1);

    const payload = beforeDelete[0]!.payload as {
      changes: Record<string, { before: string | null; after: string | null }>;
    };
    expect(payload.changes.description).toEqual({ before: "Original", after: "Updated" });
    expect(payload.changes.amount).toEqual({ before: "20.00", after: "50.00" });
    expect(payload.changes.currency).toBeUndefined();

    await request(app)
      .delete(`/api/v1/expenses/${expenseId}`)
      .set(authHeader(users[0]!.accessToken));

    const afterDelete = await prisma.activity.findMany({
      where: { entityId: expenseId, type: "EXPENSE_EDITED" },
    });
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0]!.payload).toEqual(beforeDelete[0]!.payload);
  });
});

describe("GET /groups/:id/activity", () => {
  it("paginates with a working cursor and rejects non-members", async () => {
    const { users, groupId } = await setupGroup(1, "pg");
    const ids = [users[0]!.user.id];

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/v1/groups/${groupId}/expenses`)
        .set(authHeader(users[0]!.accessToken))
        .send({
          description: `Expense ${i}`,
          currency: "USD",
          amount: "10.00",
          splitType: "EQUAL",
          splits: ids.map((userId) => ({ userId })),
          payers: [{ userId: ids[0]! }],
          paidAt: new Date().toISOString(),
        });
    }

    const firstPage = await getActivity(groupId, users[0]!.accessToken);
    const limited = await request(app)
      .get(`/api/v1/groups/${groupId}/activity?limit=3`)
      .set(authHeader(users[0]!.accessToken));

    expect(limited.status).toBe(200);
    expect(limited.body.activities).toHaveLength(3);
    expect(limited.body.nextCursor).not.toBeNull();

    const secondPage = await getActivity(groupId, users[0]!.accessToken, limited.body.nextCursor);
    expect(secondPage.status).toBe(200);
    const firstPageIds = new Set(
      limited.body.activities.map((a: { id: string }) => a.id),
    );
    for (const a of secondPage.body.activities as { id: string }[]) {
      expect(firstPageIds.has(a.id)).toBe(false);
    }
    expect(firstPage.body.activities.length).toBeGreaterThanOrEqual(6); // GROUP_CREATED + 5 expenses

    const stranger = await registerUser("pg-stranger@example.com", "Stranger");
    const forbidden = await getActivity(groupId, stranger.accessToken);
    expect(forbidden.status).toBe(404);
  });
});
