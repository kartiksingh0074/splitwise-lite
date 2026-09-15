import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setOcrEngineForTesting, type OcrEngine } from "../src/modules/ocr/engine.js";

const app = createApp();

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function registerUser(email = "ocr@example.com") {
  const res = await request(app).post("/api/v1/auth/register").send({
    email,
    name: "Ocr Tester",
    password: "correct-horse-battery",
  });
  return res.body as { accessToken: string };
}

function fakeEngine(text: string): OcrEngine {
  return { recognize: () => Promise.resolve(text) };
}

describe("POST /api/v1/ocr/receipt", () => {
  it("returns recognized text and guessed fields for a valid image", async () => {
    setOcrEngineForTesting(fakeEngine("Corner Cafe\nTotal: $42.50\n"));
    const { accessToken } = await registerUser();

    const res = await request(app)
      .post("/api/v1/ocr/receipt")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("receipt", JPEG_BYTES, "receipt.jpg");

    expect(res.status).toBe(200);
    expect(res.body.rawText).toBe("Corner Cafe\nTotal: $42.50\n");
    expect(res.body.guessedAmount).toBe("42.50");
    expect(res.body.guessedMerchant).toBe("Corner Cafe");
  });

  it("rejects non-image bytes with 422 INVALID_RECEIPT", async () => {
    setOcrEngineForTesting(fakeEngine("should never be called"));
    const { accessToken } = await registerUser("ocr-badimage@example.com");

    const res = await request(app)
      .post("/api/v1/ocr/receipt")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("receipt", Buffer.from("not an image, just text"), "receipt.jpg");

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_RECEIPT");
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/v1/ocr/receipt").attach("receipt", JPEG_BYTES, "receipt.jpg");
    expect(res.status).toBe(401);
  });
});
