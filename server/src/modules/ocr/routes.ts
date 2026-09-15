import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { ApiError } from "../../middleware/errorHandler.js";
import { detectImageType } from "../../lib/imageType.js";
import { guessAmount, guessMerchant } from "../../domain/receiptParsing.js";
import { getOcrEngine } from "./engine.js";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RECEIPT_BYTES } });

// Tighter than the global rate limit -- OCR recognition is CPU-heavy, unlike most routes.
const ocrRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
});

export const ocrRouter = Router();
ocrRouter.use(requireAuth);
ocrRouter.use(ocrRateLimit);

ocrRouter.post(
  "/receipt",
  (req, res, next) => {
    upload.single("receipt")(req, res, (err: unknown) => {
      if (err) {
        next(new ApiError(422, "INVALID_RECEIPT", "Receipt must be an image of 5MB or less."));
        return;
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(422, "INVALID_RECEIPT", "No file uploaded (expected field 'receipt').");
      }
      if (!detectImageType(req.file.buffer)) {
        throw new ApiError(422, "INVALID_RECEIPT", "Receipt must be a JPEG, PNG, or WEBP image.");
      }

      const rawText = await getOcrEngine().recognize(req.file.buffer);
      res.status(200).json({
        rawText,
        guessedAmount: guessAmount(rawText),
        guessedMerchant: guessMerchant(rawText),
      });
    } catch (err) {
      next(err);
    }
  },
);
