import { Router } from "express";
import { validateQuery } from "../../middleware/validate.js";
import { getParam } from "../../lib/params.js";
import { listActivityQuerySchema } from "./schemas.js";
import * as activityService from "./service.js";

// Mounted onto groupsRouter at "/:id/activity", behind requireGroupRole("MEMBER") there -- same
// pattern as groupExpensesRouter (Phase 3) and balancesRouter (Phase 4).
export const activityRouter = Router({ mergeParams: true });

activityRouter.get("/", validateQuery(listActivityQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as ReturnType<typeof listActivityQuerySchema.parse>;
    const result = await activityService.listActivity(getParam(req, "id"), query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
