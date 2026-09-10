import { randomUUID } from "node:crypto";
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

async function addExpense(
  groupId: string,
  token: string,
  opts: { amount: string; payerId: string; participantIds: string[] },
) {
  return request(app)
    .post(`/api/v1/groups/${groupId}/expenses`)
    .set(authHeader(token))
    .send({
      description: "Dinner",
      currency: "USD",
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
  body: { toUserId: string; amount: string; note?: string },
  idempotencyKey = randomUUID(),
) {
  return request(app)
    .post(`/api/v1/groups/${groupId}/settlements`)
    .set({ ...authHeader(token), "Idempotency-Key": idempotencyKey })
    .send(body);
}

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("POST /groups/:id/settlements", () => {
  it("requires an Idempotency-Key header", async () => {
    const { users, groupId } = await setupGroup(2, "idk");
    const res = await request(app)
      .post(`/api/v1/groups/${groupId}/settlements`)
      .set(authHeader(users[0]!.accessToken))
      .send({ toUserId: users[1]!.user.id, amount: "10.00" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("a duplicate Idempotency-Key returns the original settlement, not a second one", async () => {
    const { users, groupId } = await setupGroup(2, "dup");
    const key = randomUUID();

    const first = await recordSettlement(
      groupId,
      users[0]!.accessToken,
      { toUserId: users[1]!.user.id, amount: "25.00" },
      key,
    );
    const second = await recordSettlement(
      groupId,
      users[0]!.accessToken,
      { toUserId: users[1]!.user.id, amount: "25.00" },
      key,
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const count = await prisma.settlement.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });
});

describe("Confirm / reject flow", () => {
  it("non-receiver cannot confirm; non-member gets 404", async () => {
    const { users, groupId } = await setupGroup(3, "conf");
    const rec = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: users[1]!.user.id,
      amount: "10.00",
    });
    const settlementId = rec.body.id;

    const wrongMember = await request(app)
      .post(`/api/v1/settlements/${settlementId}/confirm`)
      .set(authHeader(users[2]!.accessToken));
    expect(wrongMember.status).toBe(403);
    expect(wrongMember.body.error.code).toBe("FORBIDDEN");

    const stranger = await registerUser("conf-stranger@example.com", "Stranger");
    const nonMember = await request(app)
      .post(`/api/v1/settlements/${settlementId}/confirm`)
      .set(authHeader(stranger.accessToken));
    expect(nonMember.status).toBe(404);
  });

  it("confirming writes ledger entries that combine with expenses to net the group to zero", async () => {
    const { users, groupId } = await setupGroup(2, "netz");
    const ids = users.map((u) => u.user.id);

    await addExpense(groupId, users[0]!.accessToken, {
      amount: "100.00",
      payerId: ids[0]!,
      participantIds: ids,
    });

    const rec = await recordSettlement(groupId, users[1]!.accessToken, {
      toUserId: ids[0]!,
      amount: "50.00",
    });
    expect(rec.status).toBe(201);
    expect(rec.body.status).toBe("PENDING");

    const beforeConfirm = await prisma.ledgerEntry.findMany({ where: { sourceId: rec.body.id } });
    expect(beforeConfirm).toHaveLength(0);

    const confirm = await request(app)
      .post(`/api/v1/settlements/${rec.body.id}/confirm`)
      .set(authHeader(users[0]!.accessToken));
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("CONFIRMED");

    const settlementEntries = await prisma.ledgerEntry.findMany({
      where: { sourceId: rec.body.id },
    });
    expect(settlementEntries).toHaveLength(2);
    const payerEntry = settlementEntries.find((e) => e.userId === ids[1]);
    const receiverEntry = settlementEntries.find((e) => e.userId === ids[0]);
    expect(payerEntry?.amountBaseMinor).toBe(5000n);
    expect(receiverEntry?.amountBaseMinor).toBe(-5000n);

    const allEntries = await prisma.ledgerEntry.findMany({ where: { groupId } });
    const total = allEntries.reduce((sum, e) => sum + e.amountBaseMinor, 0n);
    expect(total).toBe(0n);
  });

  it("concurrent confirms on the same settlement: exactly one wins, the other 409s", async () => {
    const { users, groupId } = await setupGroup(2, "race");
    const ids = users.map((u) => u.user.id);
    const rec = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "15.00",
    });

    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/v1/settlements/${rec.body.id}/confirm`)
        .set(authHeader(users[1]!.accessToken)),
      request(app)
        .post(`/api/v1/settlements/${rec.body.id}/confirm`)
        .set(authHeader(users[1]!.accessToken)),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe("SETTLEMENT_NOT_PENDING");

    const entries = await prisma.ledgerEntry.findMany({ where: { sourceId: rec.body.id } });
    expect(entries).toHaveLength(2);
  });

  it("reject leaves no ledger entries and is terminal", async () => {
    const { users, groupId } = await setupGroup(2, "rej");
    const ids = users.map((u) => u.user.id);
    const rec = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "20.00",
    });

    const reject = await request(app)
      .post(`/api/v1/settlements/${rec.body.id}/reject`)
      .set(authHeader(users[1]!.accessToken));
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe("REJECTED");

    const entries = await prisma.ledgerEntry.findMany({ where: { sourceId: rec.body.id } });
    expect(entries).toHaveLength(0);

    const confirmAfterReject = await request(app)
      .post(`/api/v1/settlements/${rec.body.id}/confirm`)
      .set(authHeader(users[1]!.accessToken));
    expect(confirmAfterReject.status).toBe(409);
    expect(confirmAfterReject.body.error.code).toBe("SETTLEMENT_NOT_PENDING");
  });
});

describe("Receipt upload", () => {
  it("accepts a valid JPEG and serves it back", async () => {
    const { users, groupId } = await setupGroup(2, "rcpt");
    const ids = users.map((u) => u.user.id);
    const rec = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "5.00",
    });

    const upload = await request(app)
      .post(`/api/v1/settlements/${rec.body.id}/receipt`)
      .set(authHeader(users[0]!.accessToken))
      .attach("receipt", JPEG_BYTES, "receipt.jpg");

    expect(upload.status).toBe(200);
    expect(upload.body.hasReceipt).toBe(true);

    const get = await request(app)
      .get(`/api/v1/settlements/${rec.body.id}/receipt`)
      .set(authHeader(users[1]!.accessToken));
    expect(get.status).toBe(200);
    expect(get.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.compare(get.body as Buffer, JPEG_BYTES)).toBe(0);
  });

  it("rejects a non-image file with 422 INVALID_RECEIPT", async () => {
    const { users, groupId } = await setupGroup(2, "badtype");
    const ids = users.map((u) => u.user.id);
    const rec = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "5.00",
    });

    const upload = await request(app)
      .post(`/api/v1/settlements/${rec.body.id}/receipt`)
      .set(authHeader(users[0]!.accessToken))
      .attach("receipt", Buffer.from("not an image, just text"), "receipt.jpg");

    expect(upload.status).toBe(422);
    expect(upload.body.error.code).toBe("INVALID_RECEIPT");
  });

  it("rejects an oversized upload with 422 INVALID_RECEIPT", async () => {
    const { users, groupId } = await setupGroup(2, "big");
    const ids = users.map((u) => u.user.id);
    const rec = await recordSettlement(groupId, users[0]!.accessToken, {
      toUserId: ids[1]!,
      amount: "5.00",
    });

    const oversized = Buffer.concat([JPEG_BYTES, Buffer.alloc(6 * 1024 * 1024, 0)]);

    const upload = await request(app)
      .post(`/api/v1/settlements/${rec.body.id}/receipt`)
      .set(authHeader(users[0]!.accessToken))
      .attach("receipt", oversized, "big.jpg");

    expect(upload.status).toBe(422);
    expect(upload.body.error.code).toBe("INVALID_RECEIPT");
  });
});
