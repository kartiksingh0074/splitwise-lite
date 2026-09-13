import { prisma } from "../src/db/client.js";
import { hashPassword } from "../src/domain/password.js";
import { parseMinor } from "../src/domain/money.js";
import { uuidv7 } from "../src/lib/id.js";
import { createGroup } from "../src/modules/groups/service.js";
import { createExpense } from "../src/modules/expenses/service.js";
import { createSettlement, confirmSettlement } from "../src/modules/settlements/service.js";
import type { SplitType } from "../src/domain/split.js";

const DEMO_PASSWORD = "password123";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Builds valid per-member split inputs for every split type, always summing exactly right. */
function buildSplits(
  splitType: SplitType,
  members: string[],
  amount: string,
  currency: string,
): { userId: string; input?: string }[] {
  const n = members.length;

  if (splitType === "EQUAL") {
    return members.map((userId) => ({ userId }));
  }

  if (splitType === "EXACT") {
    const totalMinor = parseMinor(amount, currency);
    const base = totalMinor / BigInt(n);
    const remainder = totalMinor - base * BigInt(n);
    return members.map((userId, i) => ({
      userId,
      input: (base + (i < Number(remainder) ? 1n : 0n)).toString(),
    }));
  }

  if (splitType === "PERCENT") {
    const baseHundredths = Math.floor(10000 / n);
    const remainder = 10000 - baseHundredths * n;
    return members.map((userId, i) => {
      const hundredths = baseHundredths + (i < remainder ? 1 : 0);
      const whole = Math.floor(hundredths / 100);
      const frac = (hundredths % 100).toString().padStart(2, "0");
      return { userId, input: `${whole}.${frac}` };
    });
  }

  // SHARES: varied small integer weights, for realism.
  return members.map((userId, i) => ({ userId, input: String(1 + (i % 3)) }));
}

async function cleanup() {
  // Same order as tests/setup.ts: ExpensePayer/ExpenseSplit have a DB trigger enforcing
  // sum(payers) == sum(splits) == Expense.amountMinor, deferred to COMMIT, so these go in one
  // transaction with Expense itself (which short-circuits the trigger once it's gone too).
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
}

async function createUser(email: string, name: string) {
  return prisma.user.create({
    data: {
      id: uuidv7(),
      email,
      name,
      passwordHash: await hashPassword(DEMO_PASSWORD),
    },
  });
}

async function seed() {
  console.log("Cleaning up existing data...");
  await cleanup();

  console.log("Creating users (all share the password 'password123')...");
  const alice = await createUser("alice@example.com", "Alice");
  const bob = await createUser("bob@example.com", "Bob");
  const carol = await createUser("carol@example.com", "Carol");
  const dave = await createUser("dave@example.com", "Dave");
  const eve = await createUser("eve@example.com", "Eve");

  console.log("Creating groups...");
  const goaTrip = await createGroup(alice.id, {
    name: "Goa Trip",
    baseCurrency: "INR",
    memberEmails: [bob.email, carol.email, dave.email],
  });
  const goaTripId = goaTrip.group.id;

  const apartment = await createGroup(alice.id, {
    name: "Apartment 4B",
    baseCurrency: "USD",
    memberEmails: [bob.email, eve.email],
  });
  const apartmentId = apartment.group.id;

  const goaMembers = [alice.id, bob.id, carol.id, dave.id];
  const apartmentMembers = [alice.id, bob.id, eve.id];

  const goaDescriptions = [
    "Beach shack lunch",
    "Scooter rental",
    "Hotel booking",
    "Water sports",
    "Taxi to airport",
    "Group dinner",
    "Snacks & drinks",
    "Sunset cruise",
    "Spice market shopping",
    "Breakfast buffet",
  ];
  const apartmentDescriptions = [
    "Groceries",
    "Electricity bill",
    "Internet bill",
    "Cleaning supplies",
    "Rent top-up",
    "Furniture",
    "Gas bill",
    "Water bill",
    "Pizza night",
    "Streaming subscription",
  ];
  const splitTypes: SplitType[] = ["EQUAL", "EXACT", "PERCENT", "SHARES"];

  console.log("Creating expenses...");
  let expenseCount = 0;

  for (let i = 0; i < 20; i++) {
    const currency = i % 7 === 0 ? "EUR" : "INR";
    const payer = pick(goaMembers);
    const splitType = i % 5 === 0 ? splitTypes[1]! : i % 5 === 1 ? splitTypes[2]! : i % 5 === 2 ? splitTypes[3]! : splitTypes[0]!;
    const amount = (50 + Math.floor(Math.random() * 500)).toFixed(2);

    await createExpense(goaTripId, payer, {
      description: pick(goaDescriptions),
      currency,
      amount,
      splitType,
      splits: buildSplits(splitType, goaMembers, amount, currency),
      payers: [{ userId: payer }],
      paidAt: daysAgo(25 - i),
    });
    expenseCount++;
  }

  for (let i = 0; i < 20; i++) {
    const currency = i % 6 === 0 ? "INR" : "USD";
    const payer = pick(apartmentMembers);
    const splitType = i % 4 === 0 ? splitTypes[1]! : splitTypes[0]!;
    const amount = (20 + Math.floor(Math.random() * 200)).toFixed(2);
    const payers =
      i === 5
        ? apartmentMembers.slice(0, 2).map((userId) => ({ userId }))
        : [{ userId: payer }];

    await createExpense(apartmentId, payer, {
      description: pick(apartmentDescriptions),
      currency,
      amount,
      splitType,
      splits: buildSplits(splitType, apartmentMembers, amount, currency),
      payers,
      paidAt: daysAgo(25 - i),
    });
    expenseCount++;
  }

  console.log(`Created ${expenseCount} expenses across INR/USD/EUR.`);

  console.log("Creating settlements...");
  const confirmed = await createSettlement(goaTripId, bob.id, `seed-${uuidv7()}`, {
    toUserId: alice.id,
    amount: "500.00",
    currency: "INR",
    note: "Cash handed over at the hotel",
  });
  await confirmSettlement(confirmed.id, alice.id);

  await createSettlement(apartmentId, eve.id, `seed-${uuidv7()}`, {
    toUserId: alice.id,
    amount: "25.00",
    currency: "USD",
  });

  console.log("Seed complete:");
  console.log("  5 users (password: password123)");
  console.log(`  2 groups: "Goa Trip" (${goaTripId}), "Apartment 4B" (${apartmentId})`);
  console.log(`  ${expenseCount} expenses, 2 settlements (1 confirmed, 1 pending)`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
