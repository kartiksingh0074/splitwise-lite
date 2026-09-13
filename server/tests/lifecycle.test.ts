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

describe("Full lifecycle: create group -> 10 expenses -> balances -> settle-plan -> settle all -> zero", () => {
  it("ends with every member's balance at exactly zero", async () => {
    const users = await Promise.all(
      Array.from({ length: 4 }, (_, i) => registerUser(`life${i}@example.com`, `Life${i}`)),
    );
    const ids = users.map((u) => u.user.id);

    const createRes = await request(app)
      .post("/api/v1/groups")
      .set(authHeader(users[0]!.accessToken))
      .send({
        name: "Lifecycle Group",
        baseCurrency: "USD",
        memberEmails: users.slice(1).map((u) => u.user.email),
      });
    expect(createRes.status).toBe(201);
    const groupId = createRes.body.group.id as string;

    // 10 expenses: mixed split types, mixed payers, one multi-payer.
    const splitTypeCycle = ["EQUAL", "EXACT", "PERCENT", "SHARES"] as const;
    for (let i = 0; i < 10; i++) {
      const payerIndex = i % 4;
      const splitType = splitTypeCycle[i % splitTypeCycle.length]!;
      const amount = (10 + i * 5).toFixed(2);

      let splits: { userId: string; input?: string }[];
      if (splitType === "EQUAL") {
        splits = ids.map((userId) => ({ userId }));
      } else if (splitType === "EXACT") {
        // amount is always a whole number of dollars here, so cents split evenly across 4.
        const totalCents = Math.round(Number(amount) * 100);
        const base = Math.floor(totalCents / 4);
        const remainder = totalCents - base * 4;
        splits = ids.map((userId, idx) => ({
          userId,
          input: String(base + (idx < remainder ? 1 : 0)),
        }));
      } else if (splitType === "PERCENT") {
        splits = [
          { userId: ids[0]!, input: "25.00" },
          { userId: ids[1]!, input: "25.00" },
          { userId: ids[2]!, input: "25.00" },
          { userId: ids[3]!, input: "25.00" },
        ];
      } else {
        splits = ids.map((userId) => ({ userId, input: "1" }));
      }

      const payers =
        i === 3
          ? [ids[0]!, ids[1]!].map((userId) => ({ userId })) // one multi-payer expense
          : [{ userId: ids[payerIndex]! }];

      const res = await request(app)
        .post(`/api/v1/groups/${groupId}/expenses`)
        .set(authHeader(users[payerIndex]!.accessToken))
        .send({
          description: `Lifecycle expense ${i}`,
          currency: "USD",
          amount,
          splitType,
          splits,
          payers,
          paidAt: new Date().toISOString(),
        });
      expect(res.status).toBe(201);
    }

    const balancesRes = await request(app)
      .get(`/api/v1/groups/${groupId}/balances`)
      .set(authHeader(users[0]!.accessToken));
    expect(balancesRes.status).toBe(200);
    const netSum = balancesRes.body.net.reduce(
      (sum: number, b: { amount: string }) => sum + Math.round(Number(b.amount) * 100),
      0,
    );
    expect(netSum).toBe(0);
    // At least one non-zero balance should exist -- otherwise the settle-plan step below is vacuous.
    expect(balancesRes.body.net.some((b: { amount: string }) => b.amount !== "0.00")).toBe(true);

    const settlePlanRes = await request(app)
      .get(`/api/v1/groups/${groupId}/settle-plan?strategy=greedy`)
      .set(authHeader(users[0]!.accessToken));
    expect(settlePlanRes.status).toBe(200);
    expect(settlePlanRes.body.transferCount).toBeLessThanOrEqual(ids.length - 1);

    // Settle every suggested transfer: the payer records it, the receiver confirms it.
    for (const transfer of settlePlanRes.body.transfers as {
      from: string;
      to: string;
      amount: string;
    }[]) {
      const payerUser = users.find((u) => u.user.id === transfer.from)!;
      const receiverUser = users.find((u) => u.user.id === transfer.to)!;

      const record = await request(app)
        .post(`/api/v1/groups/${groupId}/settlements`)
        .set({ ...authHeader(payerUser.accessToken), "Idempotency-Key": randomUUID() })
        .send({ toUserId: transfer.to, amount: transfer.amount });
      expect(record.status).toBe(201);

      const confirm = await request(app)
        .post(`/api/v1/settlements/${record.body.id}/confirm`)
        .set(authHeader(receiverUser.accessToken));
      expect(confirm.status).toBe(200);
    }

    const finalBalancesRes = await request(app)
      .get(`/api/v1/groups/${groupId}/balances`)
      .set(authHeader(users[0]!.accessToken));
    expect(finalBalancesRes.status).toBe(200);
    for (const b of finalBalancesRes.body.net as { amount: string }[]) {
      expect(b.amount).toBe("0.00");
    }
  });
});
