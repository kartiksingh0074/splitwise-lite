import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { z } from "zod";
import type { User } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { uuidv7 } from "../../lib/id.js";
import { hashPassword, verifyPassword } from "../../domain/password.js";
import { ApiError } from "../../middleware/errorHandler.js";
import type { loginSchema, registerSchema } from "./schemas.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

async function issueRefreshToken(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("base64url");
  await prisma.refreshToken.create({
    data: {
      id: uuidv7(),
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return rawToken;
}

async function issueTokens(userId: string) {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId),
    issueRefreshToken(userId),
  ]);
  return { accessToken, refreshToken };
}

export async function register(input: z.infer<typeof registerSchema>) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists.");
  }

  const user = await prisma.user.create({
    data: {
      id: uuidv7(),
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    },
  });

  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(user), ...tokens };
}

export async function login(input: z.infer<typeof loginSchema>) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }

  const tokens = await issueTokens(user.id);
  return { user: toPublicUser(user), ...tokens };
}

export async function refresh(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new ApiError(401, "REFRESH_TOKEN_INVALID", "Refresh token is invalid or expired.");
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueTokens(stored.userId);
}

export async function logout(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
