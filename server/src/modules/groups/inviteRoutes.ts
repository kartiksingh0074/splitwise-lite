import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { getParam } from "../../lib/params.js";
import * as groupsService from "./service.js";

export const inviteRouter = Router();

inviteRouter.post("/:code/accept", requireAuth, async (req, res, next) => {
  try {
    const group = await groupsService.acceptInvite(getParam(req, "code"), req.user.id);
    res.status(200).json(group);
  } catch (err) {
    next(err);
  }
});
