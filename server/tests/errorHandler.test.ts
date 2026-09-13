import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("body size limit", () => {
  it("rejects a request body over 1MB with 413 PAYLOAD_TOO_LARGE", async () => {
    const app = createApp();
    const oversized = "a".repeat(1024 * 1024 + 1);
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "big@example.com", name: "Big", password: oversized });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
