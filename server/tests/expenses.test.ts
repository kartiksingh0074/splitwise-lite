import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/client.js";

const app = createApp();

async function registerUser(email: string, name = "Test User") {
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

/** Registers `n` users and creates a group owned by the first, with all as members. */
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

describe("POST /groups/:id/expenses", () => {
  it("creates an EQUAL split among 3 members with ledger entries summing to zero", async () => {
    const { users, groupId } = await setupGroup(3, "eq");

    const res = await request(app)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .set(authHeader(users[0]!.accessToken))
      .send({
        description: "Dinner",
        currency: "USD",
        amount: "100.00",
        splitType: "EQUAL",
        splits: users.map((u) => ({ userId: u.user.id })),
        payers: [{ userId: users[0]!.user.id }],
        paidAt: new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.amount).toBe("100.00");
    expect(res.body.splits).toHaveLength(3);

    const splitAmounts = res.body.splits.map((s: { amount: string }) => s.amount).sort();
    expect(splitAmounts).toEqual(["33.33", "33.33", "33.34"]);

    const entries = await prisma.ledgerEntry.findMany({ where: { sourceId: res.body.id } });
    const sum = entries.reduce((acc, e) => acc + e.amountBaseMinor, 0n);
    expect(sum).toBe(0n);
  });

  it("rejects a multi-payer expense whose amounts don't sum to the total", async () => {
    const { users, groupId } = await setupGroup(2, "mp");

    const res = await request(app)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .set(authHeader(users[0]!.accessToken))
      .send({
        description: "Groceries",
        currency: "USD",
        amount: "100.00",
        splitType: "EQUAL",
        splits: users.map((u) => ({ userId: u.user.id })),
        payers: [
          { userId: users[0]!.user.id, amount: "40.00" },
          { userId: users[1]!.user.id, amount: "50.00" },
        ],
        paidAt: new Date().toISOString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("SPLIT_MISMATCH");
  });

  it("rejects an EXACT split that doesn't sum to the total with 422 SPLIT_MISMATCH", async () => {
    const { users, groupId } = await setupGroup(2, "ex");

    const res = await request(app)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .set(authHeader(users[0]!.accessToken))
      .send({
        description: "Cab",
        currency: "USD",
        amount: "50.00",
        splitType: "EXACT",
        splits: [
          { userId: users[0]!.user.id, input: "2000" },
          { userId: users[1]!.user.id, input: "2000" },
        ],
        payers: [{ userId: users[0]!.user.id }],
        paidAt: new Date().toISOString(),
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("SPLIT_MISMATCH");
  });
});

describe("PATCH /expenses/:id", () => {
  it("requires If-Match and rejects a stale version with 409", async () => {
    const { users, groupId } = await setupGroup(2, "pv");

    const create = await request(app)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .set(authHeader(users[0]!.accessToken))
      .send({
        description: "Original",
        currency: "USD",
        amount: "20.00",
        splitType: "EQUAL",
        splits: users.map((u) => ({ userId: u.user.id })),
        payers: [{ userId: users[0]!.user.id }],
        paidAt: new Date().toISOString(),
      });
    const expenseId = create.body.id;
    const editPayload = {
      description: "Edited",
      currency: "USD",
      amount: "20.00",
      splitType: "EQUAL",
      splits: users.map((u) => ({ userId: u.user.id })),
      payers: [{ userId: users[0]!.user.id }],
      paidAt: new Date().toISOString(),
    };

    const noIfMatch = await request(app)
      .patch(`/api/v1/expenses/${expenseId}`)
      .set(authHeader(users[0]!.accessToken))
      .send(editPayload);
    expect(noIfMatch.status).toBe(400);
    expect(noIfMatch.body.error.code).toBe("IF_MATCH_REQUIRED");

    const stale = await request(app)
      .patch(`/api/v1/expenses/${expenseId}`)
      .set({ ...authHeader(users[0]!.accessToken), "If-Match": "999" })
      .send(editPayload);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_VERSION");
  });

  it("edit reverses old ledger entries and writes fresh ones that still net to zero", async () => {
    const { users, groupId } = await setupGroup(2, "ed");

    const create = await request(app)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .set(authHeader(users[0]!.accessToken))
      .send({
        description: "Original",
        currency: "USD",
        amount: "20.00",
        splitType: "EQUAL",
        splits: users.map((u) => ({ userId: u.user.id })),
        payers: [{ userId: users[0]!.user.id }],
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
        splits: users.map((u) => ({ userId: u.user.id })),
        payers: [{ userId: users[0]!.user.id }],
        paidAt: new Date().toISOString(),
      });

    expect(edit.status).toBe(200);
    expect(edit.body.amount).toBe("50.00");
    expect(edit.body.version).toBe(2);

    const entries = await prisma.ledgerEntry.findMany({ where: { sourceId: expenseId } });
    const sum = entries.reduce((acc, e) => acc + e.amountBaseMinor, 0n);
    expect(sum).toBe(0n);

    // Net per user should reflect only the latest (50.00) state, not the original 20.00 too.
    const netForPayer = entries
      .filter((e) => e.userId === users[0]!.user.id)
      .reduce((acc, e) => acc + e.amountBaseMinor, 0n);
    expect(netForPayer).toBe(2500n); // paid 50.00, owes half (25.00) => net +25.00
  });

  it("permission matrix: non-member 404s, member 403s, creator and owner can edit", async () => {
    const { users, groupId } = await setupGroup(3, "pm");
    const [owner, creatorMember, plainMember] = users;
    const stranger = await registerUser("pm-stranger@example.com");

    const create = await request(app)
      .post(`/api/v1/groups/${groupId}/expenses`)
      .set(authHeader(creatorMember!.accessToken))
      .send({
        description: "Snacks",
        currency: "USD",
        amount: "30.00",
        splitType: "EQUAL",
        splits: users.map((u) => ({ userId: u.user.id })),
        payers: [{ userId: creatorMember!.user.id }],
        paidAt: new Date().toISOString(),
      });
    const expenseId = create.body.id;

    const nonMemberGet = await request(app)
      .get(`/api/v1/expenses/${expenseId}`)
      .set(authHeader(stranger.accessToken));
    expect(nonMemberGet.status).toBe(404);

    const editPayload = {
      description: "Snacks 2",
      currency: "USD",
      amount: "30.00",
      splitType: "EQUAL",
      splits: users.map((u) => ({ userId: u.user.id })),
      payers: [{ userId: creatorMember!.user.id }],
      paidAt: new Date().toISOString(),
    };

    const memberForbidden = await request(app)
      .patch(`/api/v1/expenses/${expenseId}`)
      .set({ ...authHeader(plainMember!.accessToken), "If-Match": "1" })
      .send(editPayload);
    expect(memberForbidden.status).toBe(403);
    expect(memberForbidden.body.error.code).toBe("FORBIDDEN");

    const creatorEdit = await request(app)
      .patch(`/api/v1/expenses/${expenseId}`)
      .set({ ...authHeader(creatorMember!.accessToken), "If-Match": "1" })
      .send(editPayload);
    expect(creatorEdit.status).toBe(200);

    const ownerDelete = await request(app)
      .delete(`/api/v1/expenses/${expenseId}`)
      .set(authHeader(owner!.accessToken));
    expect(ownerDelete.status).toBe(204);

    const afterDelete = await request(app)
      .get(`/api/v1/expenses/${expenseId}`)
      .set(authHeader(owner!.accessToken));
    expect(afterDelete.status).toBe(404);

    const entries = await prisma.ledgerEntry.findMany({ where: { sourceId: expenseId } });
    const sum = entries.reduce((acc, e) => acc + e.amountBaseMinor, 0n);
    expect(sum).toBe(0n);
  });
});
