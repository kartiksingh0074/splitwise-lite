import type { Prisma } from "@prisma/client";
import { uuidv7 } from "./id.js";

interface RecordActivityInput {
  groupId: string;
  actorId: string;
  type: string;
  entityType: string;
  entityId: string;
  payload: Prisma.InputJsonValue;
}

export function recordActivity(tx: Prisma.TransactionClient, input: RecordActivityInput) {
  return tx.activity.create({
    data: {
      id: uuidv7(),
      groupId: input.groupId,
      actorId: input.actorId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload,
    },
  });
}
