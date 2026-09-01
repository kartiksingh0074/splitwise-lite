import { beforeEach } from "vitest";
import { prisma } from "../src/db/client.js";

beforeEach(async () => {
  await prisma.groupInvite.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});
