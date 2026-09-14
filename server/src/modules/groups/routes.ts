import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireGroupRole } from "../../middleware/requireGroupRole.js";
import { validateBody } from "../../middleware/validate.js";
import { getParam } from "../../lib/params.js";
import { createGroupSchema, updateGroupSchema } from "./schemas.js";
import * as groupsService from "./service.js";
import { groupExpensesRouter } from "../expenses/routes.js";
import { balancesRouter } from "../balances/routes.js";
import { groupSettlementsRouter } from "../settlements/routes.js";
import { activityRouter } from "../activity/routes.js";
import { exportRouter } from "../export/routes.js";
import { groupRecurringExpensesRouter } from "../recurringExpenses/routes.js";

export const groupsRouter = Router();

groupsRouter.use(requireAuth);

groupsRouter.get("/", async (req, res, next) => {
  try {
    const groups = await groupsService.listGroups(req.user.id);
    res.status(200).json({ groups });
  } catch (err) {
    next(err);
  }
});

groupsRouter.post("/", validateBody(createGroupSchema), async (req, res, next) => {
  try {
    const result = await groupsService.createGroup(req.user.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

groupsRouter.get("/:id", requireGroupRole("MEMBER"), async (req, res, next) => {
  try {
    const group = await groupsService.getGroup(getParam(req, "id"));
    res.status(200).json(group);
  } catch (err) {
    next(err);
  }
});

groupsRouter.patch(
  "/:id",
  requireGroupRole("OWNER"),
  validateBody(updateGroupSchema),
  async (req, res, next) => {
    try {
      const group = await groupsService.updateGroup(getParam(req, "id"), req.body);
      res.status(200).json(group);
    } catch (err) {
      next(err);
    }
  },
);

groupsRouter.post("/:id/invites", requireGroupRole("OWNER"), async (req, res, next) => {
  try {
    const invite = await groupsService.createInvite(getParam(req, "id"), req.user.id);
    res.status(201).json(invite);
  } catch (err) {
    next(err);
  }
});

groupsRouter.delete(
  "/:id/members/:userId",
  requireGroupRole("OWNER"),
  async (req, res, next) => {
    try {
      await groupsService.removeMember(getParam(req, "id"), getParam(req, "userId"), req.user.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

groupsRouter.use("/:id/expenses", requireGroupRole("MEMBER"), groupExpensesRouter);
groupsRouter.use("/:id/settlements", requireGroupRole("MEMBER"), groupSettlementsRouter);
groupsRouter.use("/:id/activity", requireGroupRole("MEMBER"), activityRouter);
groupsRouter.use("/:id", requireGroupRole("MEMBER"), balancesRouter);
groupsRouter.use("/:id", requireGroupRole("MEMBER"), exportRouter);
groupsRouter.use(
  "/:id/recurring-expenses",
  requireGroupRole("MEMBER"),
  groupRecurringExpensesRouter,
);
