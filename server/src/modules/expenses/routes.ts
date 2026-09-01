import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { getParam } from "../../lib/params.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { expenseWriteSchema, listExpensesQuerySchema } from "./schemas.js";
import * as expensesService from "./service.js";

// Mounted onto groupsRouter at "/:id/expenses", behind requireGroupRole("MEMBER") there.
export const groupExpensesRouter = Router({ mergeParams: true });

groupExpensesRouter.get("/", validateQuery(listExpensesQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as ReturnType<typeof listExpensesQuerySchema.parse>;
    const result = await expensesService.listExpenses(getParam(req, "id"), query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

groupExpensesRouter.post("/", validateBody(expenseWriteSchema), async (req, res, next) => {
  try {
    const expense = await expensesService.createExpense(getParam(req, "id"), req.user.id, req.body);
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

// Mounted at /api/v1/expenses. Membership/creator-or-owner checks happen inside the service,
// since the group id isn't in the URL here (it's derived from the expense itself).
export const expenseRouter = Router();
expenseRouter.use(requireAuth);

expenseRouter.get("/:id", async (req, res, next) => {
  try {
    const expense = await expensesService.getExpense(getParam(req, "id"), req.user.id);
    res.status(200).json(expense);
  } catch (err) {
    next(err);
  }
});

expenseRouter.patch("/:id", validateBody(expenseWriteSchema), async (req, res, next) => {
  try {
    const ifMatch = req.headers["if-match"];
    if (typeof ifMatch !== "string" || !/^\d+$/.test(ifMatch)) {
      throw new ApiError(
        400,
        "IF_MATCH_REQUIRED",
        "PATCH requires an If-Match header set to the expense's current integer version.",
      );
    }
    const expense = await expensesService.updateExpense(
      getParam(req, "id"),
      req.user.id,
      Number(ifMatch),
      req.body,
    );
    res.status(200).json(expense);
  } catch (err) {
    next(err);
  }
});

expenseRouter.delete("/:id", async (req, res, next) => {
  try {
    await expensesService.deleteExpense(getParam(req, "id"), req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
