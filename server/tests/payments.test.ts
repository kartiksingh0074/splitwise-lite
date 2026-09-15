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

function recordSettlement(
  groupId: string,
  token: string,
  body: { toUserId: string; amount: string; method?: "CASH" | "GATEWAY" },
) {
  return request(app)
    .post(`/api/v1/groups/${groupId}/settlements`)
    .set({ ...authHeader(token), "Idempotency-Key": randomUUID() })
    .send(body);
}

describe("Payment-gateway settle-up (simulated)", () => {
  it("a GATEWAY settlement gets a paymentLinkId/paymentLink; a CASH one gets null for both", async () => {
    const { users, groupId } = await setupGroup(2, "pgcreate");
    const ids = users.map((u) => u.user.id);

    const gateway = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "20.00",
      method: "GATEWAY",
    });
    expect(gateway.status).toBe(201);
    expect(gateway.body.method).toBe("GATEWAY");
    expect(gateway.body.paymentLinkId).toBeTypeOf("string");
    expect(gateway.body.paymentLink).toContain(gateway.body.paymentLinkId);

    const cash = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "10.00",
    });
    expect(cash.body.method).toBe("CASH");
    expect(cash.body.paymentLinkId).toBeNull();
    expect(cash.body.paymentLink).toBeNull();
  });

  it("the payer can GET the payment link; the receiver and a stranger get 403", async () => {
    const { users, groupId } = await setupGroup(2, "pgauth");
    const ids = users.map((u) => u.user.id);
    const stranger = await registerUser("pgauth-stranger@example.com", "Stranger");

    const settlement = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "15.00",
      method: "GATEWAY",
    });
    const linkId = settlement.body.paymentLinkId as string;

    const asPayer = await request(app)
      .get(`/api/v1/payments/${linkId}`)
      .set(authHeader(users[0]!.accessToken));
    expect(asPayer.status).toBe(200);

    const asReceiver = await request(app)
      .get(`/api/v1/payments/${linkId}`)
      .set(authHeader(users[1]!.accessToken));
    expect(asReceiver.status).toBe(403);

    const asStranger = await request(app)
      .get(`/api/v1/payments/${linkId}`)
      .set(authHeader(stranger.accessToken));
    expect(asStranger.status).toBe(403);
  });

  it("completing the payment confirms the settlement with correct, zero-summing ledger entries", async () => {
    const { users, groupId } = await setupGroup(2, "pgcomplete");
    const ids = users.map((u) => u.user.id);

    const settlement = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "30.00",
      method: "GATEWAY",
    });
    const linkId = settlement.body.paymentLinkId as string;

    const completeRes = await request(app)
      .post(`/api/v1/payments/${linkId}/complete`)
      .set(authHeader(users[0]!.accessToken));
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("CONFIRMED");

    const balancesRes = await request(app)
      .get(`/api/v1/groups/${groupId}/balances`)
      .set(authHeader(users[0]!.accessToken));
    const total = balancesRes.body.net.reduce(
      (sum: number, b: { amount: string }) => sum + Math.round(Number(b.amount) * 100),
      0,
    );
    expect(total).toBe(0);
    // Confirming a settlement writes a +amount ledger entry for the payer (fromUserId) and a
    // -amount entry for the receiver -- paying off a debt nets the payer's balance up.
    const payerBalance = balancesRes.body.net.find((b: { userId: string }) => b.userId === ids[0]!);
    expect(payerBalance.amount).toBe("30.00");
    const receiverBalance = balancesRes.body.net.find((b: { userId: string }) => b.userId === ids[1]!);
    expect(receiverBalance.amount).toBe("-30.00");
  });

  it("completing twice returns 409 SETTLEMENT_NOT_PENDING on the second call", async () => {
    const { users, groupId } = await setupGroup(2, "pgtwice");
    const ids = users.map((u) => u.user.id);

    const settlement = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "12.00",
      method: "GATEWAY",
    });
    const linkId = settlement.body.paymentLinkId as string;

    await request(app).post(`/api/v1/payments/${linkId}/complete`).set(authHeader(users[0]!.accessToken));
    const second = await request(app)
      .post(`/api/v1/payments/${linkId}/complete`)
      .set(authHeader(users[0]!.accessToken));

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("SETTLEMENT_NOT_PENDING");
  });

  it("the receiver can still manually confirm a GATEWAY settlement the old way", async () => {
    const { users, groupId } = await setupGroup(2, "pgmanual");
    const ids = users.map((u) => u.user.id);

    const settlement = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "8.00",
      method: "GATEWAY",
    });

    const confirmRes = await request(app)
      .post(`/api/v1/settlements/${settlement.body.id}/confirm`)
      .set(authHeader(users[1]!.accessToken));
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe("CONFIRMED");
  });

  it("a nonexistent payment link returns 404", async () => {
    const { users } = await setupGroup(1, "pgmissing");
    const res = await request(app)
      .get(`/api/v1/payments/${randomUUID()}`)
      .set(authHeader(users[0]!.accessToken));
    expect(res.status).toBe(404);
  });
});
