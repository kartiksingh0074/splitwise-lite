import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

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

async function addExpense(
  groupId: string,
  token: string,
  opts: { description: string; amount: string; payerId: string; participantIds: string[] },
) {
  return request(app)
    .post(`/api/v1/groups/${groupId}/expenses`)
    .set(authHeader(token))
    .send({
      description: opts.description,
      currency: "USD",
      amount: opts.amount,
      splitType: "EQUAL",
      splits: opts.participantIds.map((userId) => ({ userId })),
      payers: [{ userId: opts.payerId }],
      paidAt: new Date().toISOString(),
    });
}

describe("GET /groups/:id/balances", () => {
  it("net balances always sum to zero after several expenses", async () => {
    const { users, groupId } = await setupGroup(3, "bal");
    const ids = users.map((u) => u.user.id);

    await addExpense(groupId, users[0]!.accessToken, {
      description: "Dinner",
      amount: "90.00",
      payerId: ids[0]!,
      participantIds: ids,
    });
    await addExpense(groupId, users[1]!.accessToken, {
      description: "Cab",
      amount: "30.00",
      payerId: ids[1]!,
      participantIds: ids,
    });

    const res = await request(app)
      .get(`/api/v1/groups/${groupId}/balances`)
      .set(authHeader(users[0]!.accessToken));

    expect(res.status).toBe(200);
    const total = res.body.net.reduce(
      (sum: number, b: { amount: string }) => sum + Math.round(Number(b.amount) * 100),
      0,
    );
    expect(total).toBe(0);
  });

  it("non-member gets 404", async () => {
    const { groupId } = await setupGroup(2, "balnm");
    const stranger = await registerUser("balnm-stranger@example.com", "Stranger");

    const res = await request(app)
      .get(`/api/v1/groups/${groupId}/balances`)
      .set(authHeader(stranger.accessToken));

    expect(res.status).toBe(404);
  });
});

describe("GET /groups/:id/settle-plan", () => {
  it("greedy and subset transfers both zero every balance when applied", async () => {
    const { users, groupId } = await setupGroup(4, "sp");
    const ids = users.map((u) => u.user.id);

    await addExpense(groupId, users[0]!.accessToken, {
      description: "Groceries",
      amount: "120.00",
      payerId: ids[0]!,
      participantIds: ids,
    });
    await addExpense(groupId, users[2]!.accessToken, {
      description: "Gas",
      amount: "40.00",
      payerId: ids[2]!,
      participantIds: [ids[1]!, ids[2]!, ids[3]!],
    });

    const balancesRes = await request(app)
      .get(`/api/v1/groups/${groupId}/balances`)
      .set(authHeader(users[0]!.accessToken));
    const netByUser = new Map<string, number>(
      balancesRes.body.net.map((b: { userId: string; amount: string }) => [
        b.userId,
        Math.round(Number(b.amount) * 100),
      ]),
    );

    for (const strategy of ["greedy", "subset"]) {
      const res = await request(app)
        .get(`/api/v1/groups/${groupId}/settle-plan?strategy=${strategy}`)
        .set(authHeader(users[0]!.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.strategy).toBe(strategy);
      expect(res.body.transferCount).toBe(res.body.transfers.length);
      expect(res.body.transferCount).toBeLessThanOrEqual(ids.length - 1);

      const applied = new Map(netByUser);
      for (const t of res.body.transfers as { from: string; to: string; amount: string }[]) {
        const cents = Math.round(Number(t.amount) * 100);
        applied.set(t.from, (applied.get(t.from) ?? 0) + cents);
        applied.set(t.to, (applied.get(t.to) ?? 0) - cents);
      }
      for (const amount of applied.values()) {
        expect(amount).toBe(0);
      }
    }
  });

  it("subset strategy never produces more transfers than greedy", async () => {
    const { users, groupId } = await setupGroup(4, "spc");
    const ids = users.map((u) => u.user.id);

    await addExpense(groupId, users[0]!.accessToken, {
      description: "Rent",
      amount: "200.00",
      payerId: ids[0]!,
      participantIds: [ids[0]!, ids[1]!],
    });
    await addExpense(groupId, users[2]!.accessToken, {
      description: "Utilities",
      amount: "60.00",
      payerId: ids[2]!,
      participantIds: [ids[2]!, ids[3]!],
    });

    const greedy = await request(app)
      .get(`/api/v1/groups/${groupId}/settle-plan?strategy=greedy`)
      .set(authHeader(users[0]!.accessToken));
    const subset = await request(app)
      .get(`/api/v1/groups/${groupId}/settle-plan?strategy=subset`)
      .set(authHeader(users[0]!.accessToken));

    expect(subset.body.transferCount).toBeLessThanOrEqual(greedy.body.transferCount);
  });
});

describe("DELETE /groups/:id/members/:userId with a non-zero balance", () => {
  it("is blocked with 409 MEMBER_HAS_BALANCE", async () => {
    const { users, groupId } = await setupGroup(2, "memb");
    const ids = users.map((u) => u.user.id);

    await addExpense(groupId, users[0]!.accessToken, {
      description: "Dinner",
      amount: "50.00",
      payerId: ids[0]!,
      participantIds: ids,
    });

    const res = await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${ids[1]}`)
      .set(authHeader(users[0]!.accessToken));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MEMBER_HAS_BALANCE");
  });
});
