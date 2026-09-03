import { Router } from "express";
import { getParam } from "../../lib/params.js";
import { ApiError } from "../../middleware/errorHandler.js";
import * as balancesService from "./service.js";

// Mounted onto groupsRouter at "/:id/balances" and "/:id/settle-plan", behind
// requireGroupRole("MEMBER") there -- same pattern as groupExpensesRouter in Phase 3.
export const balancesRouter = Router({ mergeParams: true });

balancesRouter.get("/balances", async (req, res, next) => {
  try {
    const result = await balancesService.getBalances(getParam(req, "id"));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

balancesRouter.get("/settle-plan", async (req, res, next) => {
  try {
    const strategyParam = req.query.strategy;
    if (strategyParam !== undefined && strategyParam !== "greedy" && strategyParam !== "subset") {
      throw new ApiError(422, "VALIDATION_ERROR", "strategy must be 'greedy' or 'subset'.");
    }
    const strategy = strategyParam === "subset" ? "subset" : "greedy";
    const result = await balancesService.getSettlePlan(getParam(req, "id"), strategy);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
