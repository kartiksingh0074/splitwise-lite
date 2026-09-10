import type { z } from "zod";
import { prisma } from "../../db/client.js";
import type { listActivityQuerySchema } from "./schemas.js";

type ListQuery = z.infer<typeof listActivityQuerySchema>;

export async function listActivity(groupId: string, query: ListQuery) {
  const rows = await prisma.activity.findMany({
    where: { groupId },
    include: { actor: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]!.id : null;

  return {
    activities: page.map((a) => ({
      id: a.id,
      type: a.type,
      entityType: a.entityType,
      entityId: a.entityId,
      actorId: a.actorId,
      actorName: a.actor.name,
      payload: a.payload,
      createdAt: a.createdAt,
    })),
    nextCursor,
  };
}
