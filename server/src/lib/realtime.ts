import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../db/client.js";
import { allowedOrigins } from "../middleware/cors.js";

// Shared in-memory registry -- both attachRealtimeServer (the WS server itself, wired up once at
// boot in index.ts) and broadcastGroupChanged (called from service-layer mutations) need to
// reach the same map, same reasoning domain/fx.ts's rateProvider is a plain singleton module.
const groupSockets = new Map<string, Set<WebSocket>>();

export function subscribeToGroup(groupId: string, ws: WebSocket): void {
  let sockets = groupSockets.get(groupId);
  if (!sockets) {
    sockets = new Set();
    groupSockets.set(groupId, sockets);
  }
  sockets.add(ws);
  ws.on("close", () => {
    sockets!.delete(ws);
    if (sockets!.size === 0) {
      groupSockets.delete(groupId);
    }
  });
}

/** Signal-only: clients refetch via the existing REST routes on receipt, never given a diff. */
export function broadcastGroupChanged(groupId: string): void {
  const sockets = groupSockets.get(groupId);
  if (!sockets || sockets.size === 0) return;

  const message = JSON.stringify({ type: "group_changed", groupId });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

export function attachRealtimeServer(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/api/v1/ws" });

  wss.on("connection", (ws, req) => {
    void (async () => {
      try {
        const origin = req.headers.origin;
        if (origin && !allowedOrigins.includes(origin)) {
          ws.close(4003, "Origin not allowed");
          return;
        }

        const url = new URL(req.url ?? "", "http://localhost");
        const token = url.searchParams.get("token");
        const groupId = url.searchParams.get("groupId");
        if (!token || !groupId) {
          ws.close(4001, "Missing token or groupId");
          return;
        }

        let userId: string;
        try {
          const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string };
          userId = payload.sub;
        } catch {
          ws.close(4001, "Invalid token");
          return;
        }

        const membership = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId } },
        });
        if (!membership || membership.leftAt) {
          ws.close(4004, "Not a member of this group");
          return;
        }

        subscribeToGroup(groupId, ws);
        // Lets a client (or test) know the async handshake (JWT + membership check) has
        // actually finished and it's safe to assume broadcasts from now on will be delivered --
        // the "open" event alone only means the HTTP upgrade completed, not that this handler
        // has subscribed the socket yet.
        ws.send(JSON.stringify({ type: "subscribed", groupId }));
      } catch (err) {
        logger.error({ err }, "WebSocket handshake failed");
        ws.close(1011, "Internal error");
      }
    })();
  });
}
