import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { recurringExpenseScheduler } from "../src/modules/recurringExpenses/scheduler.js";

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

function createRecurringExpense(
  groupId: string,
  token: string,
  opts: { description: string; amount: string; payerId: string; participantIds: string[]; startAt: string; interval?: "WEEKLY" | "MONTHLY" | "YEARLY" },
) {
  return request(app)
    .post(`/api/v1/groups/${groupId}/recurring-expenses`)
    .set(authHeader(token))
    .send({
      description: opts.description,
      currency: "USD",
      amount: opts.amount,
      splitType: "EQUAL",
      splits: opts.participantIds.map((userId) => ({ userId })),
      payers: [{ userId: opts.payerId }],
      interval: opts.interval ?? "MONTHLY",
      startAt: opts.startAt,
    });
}

function listRecurringExpenses(groupId: string, token: string) {
  return request(app)
    .get(`/api/v1/groups/${groupId}/recurring-expenses`)
    .set(authHeader(token));
}

function listExpenses(groupId: string, token: string) {
  return request(app).get(`/api/v1/groups/${groupId}/expenses?limit=100`).set(authHeader(token));
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

describe("recurring expenses: create/list/permissions", () => {
  it("creates a template and lists it back", async () => {
    const { users, groupId } = await setupGroup(2, "rec");
    const ids = users.map((u) => u.user.id);

    const createRes = await createRecurringExpense(groupId, users[0]!.accessToken, {
      description: "Rent",
      amount: "1000.00",
      payerId: ids[0]!,
      participantIds: ids,
      startAt: daysAgo(-30),
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.description).toBe("Rent");
    expect(createRes.body.active).toBe(true);

    const listRes = await listRecurringExpenses(groupId, users[0]!.accessToken);
    expect(listRes.status).toBe(200);
    expect(listRes.body.recurringExpenses).toHaveLength(1);
  });

  it("a non-creator, non-owner member cannot pause or delete; the owner can", async () => {
    const { users, groupId } = await setupGroup(3, "recperm");
    const ids = users.map((u) => u.user.id);

    // users[1] creates it (owner is users[0]).
    const createRes = await createRecurringExpense(groupId, users[1]!.accessToken, {
      description: "Internet",
      amount: "50.00",
      payerId: ids[1]!,
      participantIds: ids,
      startAt: daysAgo(-30),
    });
    const recId = createRes.body.id as string;

    const forbidden = await request(app)
      .patch(`/api/v1/recurring-expenses/${recId}`)
      .set(authHeader(users[2]!.accessToken))
      .send({ active: false });
    expect(forbidden.status).toBe(403);

    const ownerPause = await request(app)
      .patch(`/api/v1/recurring-expenses/${recId}`)
      .set(authHeader(users[0]!.accessToken))
      .send({ active: false });
    expect(ownerPause.status).toBe(200);
    expect(ownerPause.body.active).toBe(false);

    const ownerDelete = await request(app)
      .delete(`/api/v1/recurring-expenses/${recId}`)
      .set(authHeader(users[0]!.accessToken));
    expect(ownerDelete.status).toBe(204);
  });
});

describe("recurring expenses: scheduler", () => {
  it("materializes a due template into a real expense and advances nextRunAt", async () => {
    const { users, groupId } = await setupGroup(2, "sched");
    const ids = users.map((u) => u.user.id);

    await createRecurringExpense(groupId, users[0]!.accessToken, {
      description: "Rent",
      amount: "1000.00",
      payerId: ids[0]!,
      participantIds: ids,
      interval: "MONTHLY",
      startAt: daysAgo(1),
    });

    const before = await listRecurringExpenses(groupId, users[0]!.accessToken);
    const nextRunBefore = before.body.recurringExpenses[0].nextRunAt;

    await recurringExpenseScheduler.tick();

    const expensesRes = await listExpenses(groupId, users[0]!.accessToken);
    expect(expensesRes.body.expenses).toHaveLength(1);
    expect(expensesRes.body.expenses[0].description).toBe("Rent");
    expect(expensesRes.body.expenses[0].amount).toBe("1000.00");

    const after = await listRecurringExpenses(groupId, users[0]!.accessToken);
    const nextRunAfter = after.body.recurringExpenses[0].nextRunAt;
    expect(new Date(nextRunAfter).getTime()).toBeGreaterThan(new Date(nextRunBefore).getTime());
  });

  it("catches up multiple overdue occurrences in a single tick", async () => {
    const { users, groupId } = await setupGroup(2, "catchup");
    const ids = users.map((u) => u.user.id);

    // WEEKLY, started 20 days ago -> due at -20, -13, -6 days (3 occurrences); the 4th
    // would land 1 day in the future, so it's not due yet.
    await createRecurringExpense(groupId, users[0]!.accessToken, {
      description: "Cleaning",
      amount: "40.00",
      payerId: ids[0]!,
      participantIds: ids,
      interval: "WEEKLY",
      startAt: daysAgo(20),
    });

    await recurringExpenseScheduler.tick();

    const expensesRes = await listExpenses(groupId, users[0]!.accessToken);
    expect(expensesRes.body.expenses).toHaveLength(3);
  });

  it("skips a template whose participant left the group, without throwing or advancing nextRunAt", async () => {
    const { users, groupId } = await setupGroup(2, "leftmem");
    const ids = users.map((u) => u.user.id);

    await createRecurringExpense(groupId, users[0]!.accessToken, {
      description: "Utilities",
      amount: "20.00",
      payerId: ids[0]!,
      participantIds: ids,
      startAt: daysAgo(1),
    });

    // Owner removes the other member (zero balance so far -- no expenses have materialized yet).
    await request(app)
      .delete(`/api/v1/groups/${groupId}/members/${ids[1]}`)
      .set(authHeader(users[0]!.accessToken));

    const before = await listRecurringExpenses(groupId, users[0]!.accessToken);
    const nextRunBefore = before.body.recurringExpenses[0].nextRunAt;

    await recurringExpenseScheduler.tick();

    const expensesRes = await listExpenses(groupId, users[0]!.accessToken);
    expect(expensesRes.body.expenses).toHaveLength(0);

    const after = await listRecurringExpenses(groupId, users[0]!.accessToken);
    expect(after.body.recurringExpenses[0].nextRunAt).toBe(nextRunBefore);
  });
});
