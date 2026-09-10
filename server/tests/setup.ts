import { beforeEach } from "vitest";
import { prisma } from "../src/db/client.js";

beforeEach(async () => {
  // ExpensePayer/ExpenseSplit have a DB trigger enforcing sum(payers) == sum(splits) ==
  // Expense.amountMinor, deferred to COMMIT. Deleting them as separate statements from Expense
  // would transiently violate it (the trigger fires per statement's own commit), so these all go
  // in one transaction -- Expense is gone too by commit time, so the trigger short-circuits.
  await prisma.$transaction([
    prisma.activity.deleteMany(),
    prisma.ledgerEntry.deleteMany(),
    prisma.expensePayer.deleteMany(),
    prisma.expenseSplit.deleteMany(),
    prisma.expense.deleteMany(),
  ]);

  await prisma.settlement.deleteMany();
  await prisma.groupInvite.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});
