import { Router } from "express";
import { getParam } from "../../lib/params.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody } from "../../middleware/validate.js";
import { createRecurringExpenseSchema, setActiveSchema } from "./schemas.js";
import * as recurringExpensesService from "./service.js";

// Mounted onto groupsRouter at "/:id/recurring-expenses", behind requireGroupRole("MEMBER")
// there -- same pattern as groupExpensesRouter (Phase 3).
export const groupRecurringExpensesRouter = Router({ mergeParams: true });

groupRecurringExpensesRouter.get("/", async (req, res, next) => {
  try {
    const recurringExpenses = await recurringExpensesService.listRecurringExpenses(getParam(req, "id"));
    res.status(200).json({ recurringExpenses });
  } catch (err) {
    next(err);
  }
});

groupRecurringExpensesRouter.post(
  "/",
  validateBody(createRecurringExpenseSchema),
  async (req, res, next) => {
    try {
      const recurringExpense = await recurringExpensesService.createRecurringExpense(
        getParam(req, "id"),
        req.user.id,
        req.body,
      );
      res.status(201).json(recurringExpense);
    } catch (err) {
      next(err);
    }
  },
);

// Mounted at /api/v1/recurring-expenses. Membership/creator-or-owner checks happen inside the
// service, since the group id isn't in the URL here -- same split as expenseRouter (Phase 3).
export const recurringExpenseRouter = Router();
recurringExpenseRouter.use(requireAuth);

recurringExpenseRouter.patch(
  "/:id",
  validateBody(setActiveSchema),
  async (req, res, next) => {
    try {
      const recurringExpense = await recurringExpensesService.setActive(
        getParam(req, "id"),
        req.user.id,
        req.body.active,
      );
      res.status(200).json(recurringExpense);
    } catch (err) {
      next(err);
    }
  },
);

recurringExpenseRouter.delete("/:id", async (req, res, next) => {
  try {
    await recurringExpensesService.deleteRecurringExpense(getParam(req, "id"), req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
