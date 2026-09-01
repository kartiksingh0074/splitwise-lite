import type { GroupRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/client.js";
import { getParam } from "../lib/params.js";
import { ApiError } from "./errorHandler.js";

declare module "express-serve-static-core" {
  interface Request {
    membership: { role: GroupRole };
  }
}

const ROLE_RANK: Record<GroupRole, number> = { MEMBER: 0, OWNER: 1 };

export function requireGroupRole(minRole: GroupRole) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: getParam(req, "id"), userId: req.user.id } },
      });

      if (!membership || membership.leftAt) {
        next(new ApiError(404, "NOT_FOUND", "Group not found."));
        return;
      }

      if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
        next(new ApiError(403, "FORBIDDEN", "You don't have permission to do that."));
        return;
      }

      req.membership = { role: membership.role };
      next();
    } catch (err) {
      next(err);
    }
  };
}
