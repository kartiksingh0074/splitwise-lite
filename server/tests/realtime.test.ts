import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, afterEach } from "vitest";
import request from "supertest";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { attachRealtimeServer, broadcastGroupChanged } from "../src/lib/realtime.js";

const app = createApp();

async function registerUser(email: string, name: string) {
  const res = await request(app).post("/api/v1/auth/register").send({
    email,
    name,
    password: "correct-horse-battery",
  });
  return res.body as { user: { id: string; email: string }; accessToken: string };
}

async function setupGroup(n: number, prefix: string) {
  const users = await Promise.all(
    Array.from({ length: n }, (_, i) => registerUser(`${prefix}${i}@example.com`, `${prefix}${i}`)),
  );
  const createRes = await request(app)
    .post("/api/v1/groups")
    .set("Authorization", `Bearer ${users[0]!.accessToken}`)
    .send({
      name: "Test Group",
      baseCurrency: "USD",
      memberEmails: users.slice(1).map((u) => u.user.email),
    });
  return { users, groupId: createRes.body.group.id as string };
}

let activeServer: ReturnType<typeof createServer> | null = null;

function startRealtimeServer(): Promise<number> {
  const httpServer = createServer(app);
  attachRealtimeServer(httpServer);
  activeServer = httpServer;
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      resolve((httpServer.address() as AddressInfo).port);
    });
  });
}

afterEach(() => {
  activeServer?.close();
  activeServer = null;
});

function waitForMessage(ws: WebSocket): Promise<{ type: string; groupId: string }> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}

function waitForClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once("close", (code: number) => resolve(code));
  });
}

describe("realtime WebSocket server", () => {
  it("delivers a group_changed message to a subscribed, authenticated member", async () => {
    const { users, groupId } = await setupGroup(2, "rt");
    const port = await startRealtimeServer();

    const ws = new WebSocket(
      `ws://localhost:${port}/api/v1/ws?groupId=${groupId}&token=${users[0]!.accessToken}`,
    );
    // Wait for the server's "subscribed" ack, not just the client-side "open" event -- "open"
    // only means the HTTP upgrade completed, not that the async handshake (JWT + membership
    // check) has finished subscribing this socket yet.
    const subscribedAck = await waitForMessage(ws);
    expect(subscribedAck).toEqual({ type: "subscribed", groupId });

    const messagePromise = waitForMessage(ws);
    broadcastGroupChanged(groupId);
    const message = await messagePromise;

    expect(message).toEqual({ type: "group_changed", groupId });
    ws.close();
  });

  it("closes the socket with 4001 for a missing token", async () => {
    const { groupId } = await setupGroup(1, "rtnotoken");
    const port = await startRealtimeServer();

    const ws = new WebSocket(`ws://localhost:${port}/api/v1/ws?groupId=${groupId}`);
    const code = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("closes the socket with 4001 for an invalid token", async () => {
    const { groupId } = await setupGroup(1, "rtbadtoken");
    const port = await startRealtimeServer();

    const ws = new WebSocket(`ws://localhost:${port}/api/v1/ws?groupId=${groupId}&token=not-a-real-jwt`);
    const code = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("closes the socket with 4004 for a non-member", async () => {
    const { groupId } = await setupGroup(1, "rtmember");
    const stranger = await registerUser("rt-stranger@example.com", "Stranger");
    const port = await startRealtimeServer();

    const ws = new WebSocket(
      `ws://localhost:${port}/api/v1/ws?groupId=${groupId}&token=${stranger.accessToken}`,
    );
    const code = await waitForClose(ws);
    expect(code).toBe(4004);
  });
});
