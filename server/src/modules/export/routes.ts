import { Router } from "express";
import { getParam } from "../../lib/params.js";
import * as exportService from "./service.js";

// Mounted onto groupsRouter at "/:id", behind requireGroupRole("MEMBER") there -- same pattern
// as balancesRouter (Phase 4).
export const exportRouter = Router({ mergeParams: true });

exportRouter.get("/export.csv", async (req, res, next) => {
  try {
    const { filename, csv } = await exportService.exportGroupLedgerCsv(getParam(req, "id"));
    res
      .status(200)
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csv);
  } catch (err) {
    next(err);
  }
});
