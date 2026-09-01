import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

async function registerUser(email = "alice@example.com") {
  return request(app).post("/api/v1/auth/register").send({
    email,
    name: "Alice",
    password: "correct-horse-battery",
  });
}

describe("POST /api/v1/auth/register", () => {
  it("registers a new user and issues tokens", async () => {
    const res = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("alice@example.com");
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.refreshToken).toBeTypeOf("string");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("rejects a duplicate email with 409 EMAIL_TAKEN", async () => {
    await registerUser();
    const res = await registerUser();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("rejects a wrong password with 401 INVALID_CREDENTIALS", async () => {
    await registerUser();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "alice@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs in with correct credentials", async () => {
    await registerUser();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "alice@example.com", password: "correct-horse-battery" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rotates the refresh token and issues a new access token", async () => {
    const register = await registerUser();
    const originalRefreshToken = register.body.refreshToken;

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: originalRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf("string");
    expect(res.body.refreshToken).not.toBe(originalRefreshToken);
  });

  it("rejects a reused (already-rotated) refresh token", async () => {
    const register = await registerUser();
    const originalRefreshToken = register.body.refreshToken;

    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: originalRefreshToken });

    const reuse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: originalRefreshToken });

    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("REFRESH_TOKEN_INVALID");
  });
});

describe("GET /api/v1/users/me", () => {
  it("rejects a request with no token", async () => {
    const res = await request(app).get("/api/v1/users/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns the current user for a valid access token", async () => {
    const register = await registerUser();
    const res = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${register.body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("alice@example.com");
  });
});
