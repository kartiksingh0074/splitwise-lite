import { randomUUID } from "node:crypto";
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
  opts: {
    description: string;
    amount: string;
    payerId: string;
    participantIds: string[];
    currency?: string;
  },
) {
  return request(app)
    .post(`/api/v1/groups/${groupId}/expenses`)
    .set(authHeader(token))
    .send({
      description: opts.description,
      currency: opts.currency ?? "USD",
      amount: opts.amount,
      splitType: "EQUAL",
      splits: opts.participantIds.map((userId) => ({ userId })),
      payers: [{ userId: opts.payerId }],
      paidAt: new Date().toISOString(),
    });
}

function recordSettlement(
  groupId: string,
  token: string,
  body: { toUserId: string; amount: string; currency?: string },
) {
  return request(app)
    .post(`/api/v1/groups/${groupId}/settlements`)
    .set({ ...authHeader(token), "Idempotency-Key": randomUUID() })
    .send(body);
}

describe("GET /groups/:id/export.csv", () => {
  it("returns a CSV file with Expenses and Settlements sections", async () => {
    const { users, groupId } = await setupGroup(2, "exp");
    const ids = users.map((u) => u.user.id);

    await addExpense(groupId, users[0]!.accessToken, {
      description: "Dinner",
      amount: "50.00",
      payerId: ids[0]!,
      participantIds: ids,
    });
    const settlement = await recordSettlement(groupId, users[1]!.accessToken, {
      toUserId: ids[0]!,
      amount: "25.00",
    });
    await request(app)
      .post(`/api/v1/settlements/${settlement.body.id}/confirm`)
      .set(authHeader(users[0]!.accessToken));

    const res = await request(app)
      .get(`/api/v1/groups/${groupId}/export.csv`)
      .set(authHeader(users[0]!.accessToken));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="/);
    expect(res.text).toContain("Expenses");
    expect(res.text).toContain("Settlements");
    expect(res.text).toContain("Dinner");
    expect(res.text).toContain("exp0: 50.00");
    expect(res.text).toContain("CONFIRMED");
  });

  it("escapes a description containing a comma and a quote per RFC 4180", async () => {
    const { users, groupId } = await setupGroup(2, "quo");
    const ids = users.map((u) => u.user.id);

    await addExpense(groupId, users[0]!.accessToken, {
      description: 'Dinner, "fancy" place',
      amount: "20.00",
      payerId: ids[0]!,
      participantIds: ids,
    });

    const res = await request(app)
      .get(`/api/v1/groups/${groupId}/export.csv`)
      .set(authHeader(users[0]!.accessToken));

    expect(res.status).toBe(200);
    expect(res.text).toContain('"Dinner, ""fancy"" place"');
  });

  it("excludes soft-deleted expenses", async () => {
    const { users, groupId } = await setupGroup(2, "del");
    const ids = users.map((u) => u.user.id);

    const created = await addExpense(groupId, users[0]!.accessToken, {
      description: "Gone Soon",
      amount: "10.00",
      payerId: ids[0]!,
      participantIds: ids,
    });
    await request(app)
      .delete(`/api/v1/expenses/${created.body.id}`)
      .set(authHeader(users[0]!.accessToken));

    const res = await request(app)
      .get(`/api/v1/groups/${groupId}/export.csv`)
      .set(authHeader(users[0]!.accessToken));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Gone Soon");
  });

  it("returns 200 with section headers and no data rows for an empty group", async () => {
    const { users, groupId } = await setupGroup(1, "empty");

    const res = await request(app)
      .get(`/api/v1/groups/${groupId}/export.csv`)
      .set(authHeader(users[0]!.accessToken));

    expect(res.status).toBe(200);
    expect(res.text).toContain("Expenses");
    expect(res.text).toContain("Settlements");
  });

  it("non-member gets 404", async () => {
    const { groupId } = await setupGroup(2, "expnm");
    const stranger = await registerUser("expnm-stranger@example.com", "Stranger");

    const res = await request(app)
      .get(`/api/v1/groups/${groupId}/export.csv`)
      .set(authHeader(stranger.accessToken));

    expect(res.status).toBe(404);
  });
});
