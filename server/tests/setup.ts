import { beforeEach } from "vitest";
import { prisma } from "../src/db/client.js";

beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});
