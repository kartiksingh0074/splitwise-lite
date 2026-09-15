import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { getParam } from "../../lib/params.js";
import * as settlementsService from "./service.js";

// Mounted flat at /api/v1/payments -- the lookup key, paymentLinkId, isn't nested under a group
// or settlement id, same flat-router reasoning as settlementRouter.
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.get("/:paymentLinkId", async (req, res, next) => {
  try {
    const settlement = await settlementsService.getPaymentByLink(
      getParam(req, "paymentLinkId"),
      req.user.id,
    );
    res.status(200).json(settlement);
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post("/:paymentLinkId/complete", async (req, res, next) => {
  try {
    const settlement = await settlementsService.completeGatewayPayment(
      getParam(req, "paymentLinkId"),
      req.user.id,
    );
    res.status(200).json(settlement);
  } catch (err) {
    next(err);
  }
});
