import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody } from "../../middleware/validate.js";
import { getParam } from "../../lib/params.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { createSettlementSchema } from "./schemas.js";
import * as settlementsService from "./service.js";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RECEIPT_BYTES } });

// Mounted onto groupsRouter at "/:id/settlements", behind requireGroupRole("MEMBER") there --
// same pattern as groupExpensesRouter (Phase 3) and balancesRouter (Phase 4).
export const groupSettlementsRouter = Router({ mergeParams: true });

groupSettlementsRouter.get("/", async (req, res, next) => {
  try {
    const settlements = await settlementsService.listSettlements(getParam(req, "id"));
    res.status(200).json({ settlements });
  } catch (err) {
    next(err);
  }
});

groupSettlementsRouter.post("/", validateBody(createSettlementSchema), async (req, res, next) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      throw new ApiError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "POST requires an Idempotency-Key header.",
      );
    }
    const settlement = await settlementsService.createSettlement(
      getParam(req, "id"),
      req.user.id,
      idempotencyKey,
      req.body,
    );
    res.status(201).json(settlement);
  } catch (err) {
    next(err);
  }
});

// Mounted at /api/v1/settlements. Membership/party checks happen inside the service, since the
// group id isn't in the URL here (it's derived from the settlement itself).
export const settlementRouter = Router();
settlementRouter.use(requireAuth);

settlementRouter.post("/:id/confirm", async (req, res, next) => {
  try {
    const settlement = await settlementsService.confirmSettlement(getParam(req, "id"), req.user.id);
    res.status(200).json(settlement);
  } catch (err) {
    next(err);
  }
});

settlementRouter.post("/:id/reject", async (req, res, next) => {
  try {
    const settlement = await settlementsService.rejectSettlement(getParam(req, "id"), req.user.id);
    res.status(200).json(settlement);
  } catch (err) {
    next(err);
  }
});

settlementRouter.post("/:id/receipt", (req, res, next) => {
  upload.single("receipt")(req, res, (err: unknown) => {
    if (err) {
      next(new ApiError(422, "INVALID_RECEIPT", "Receipt must be an image of 5MB or less."));
      return;
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ApiError(422, "INVALID_RECEIPT", "No file uploaded (expected field 'receipt').");
    }
    const settlement = await settlementsService.uploadReceipt(getParam(req, "id"), req.user.id, {
      buffer: req.file.buffer,
      size: req.file.size,
    });
    res.status(200).json(settlement);
  } catch (err) {
    next(err);
  }
});

settlementRouter.get("/:id/receipt", async (req, res, next) => {
  try {
    const file = await settlementsService.getReceipt(getParam(req, "id"), req.user.id);
    res.status(200).header("Content-Type", file.contentType).send(file.data);
  } catch (err) {
    next(err);
  }
});
