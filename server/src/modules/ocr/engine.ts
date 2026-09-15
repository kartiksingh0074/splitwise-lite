import { createWorker } from "tesseract.js";

export interface OcrEngine {
  recognize(buffer: Buffer): Promise<string>;
}

// One worker per request rather than a persistent pool -- simplest safe choice for a
// low-traffic demo app; a pool would add lifecycle complexity this scale doesn't need.
export class TesseractOcrEngine implements OcrEngine {
  async recognize(buffer: Buffer): Promise<string> {
    const worker = await createWorker("eng");
    try {
      const { data } = await worker.recognize(buffer);
      return data.text;
    } finally {
      await worker.terminate();
    }
  }
}

let ocrEngine: OcrEngine = new TesseractOcrEngine();

export function getOcrEngine(): OcrEngine {
  return ocrEngine;
}

// Test-only seam: lets server/tests/ocr.test.ts exercise the real HTTP route (multer, auth,
// image-type validation) without invoking real Tesseract, mirroring how domain/fx.ts's tests
// always substitute a fake RateFetcher instead of hitting the real network.
export function setOcrEngineForTesting(engine: OcrEngine): void {
  ocrEngine = engine;
}
