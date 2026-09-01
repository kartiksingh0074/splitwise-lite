-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('EQUAL', 'EXACT', 'PERCENT', 'SHARES');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('EXPENSE', 'EXPENSE_REVERSAL', 'SETTLEMENT', 'SETTLEMENT_REVERSAL');

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "fxRateToBase" DECIMAL(18,8) NOT NULL,
    "amountBaseMinor" BIGINT NOT NULL,
    "splitType" "SplitType" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpensePayer" (
    "expenseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "amountBaseMinor" BIGINT NOT NULL,

    CONSTRAINT "ExpensePayer_pkey" PRIMARY KEY ("expenseId","userId")
);

-- CreateTable
CREATE TABLE "ExpenseSplit" (
    "expenseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "shareInput" DECIMAL(18,8),
    "amountMinor" BIGINT NOT NULL,
    "amountBaseMinor" BIGINT NOT NULL,

    CONSTRAINT "ExpenseSplit_pkey" PRIMARY KEY ("expenseId","userId")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "counterpartyId" UUID,
    "amountBaseMinor" BIGINT NOT NULL,
    "sourceType" "LedgerSourceType" NOT NULL,
    "sourceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_groupId_createdAt_idx" ON "Expense"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_groupId_userId_idx" ON "LedgerEntry"("groupId", "userId");

-- CreateIndex
CREATE INDEX "LedgerEntry_sourceId_idx" ON "LedgerEntry"("sourceId");

-- CreateIndex
CREATE INDEX "Activity_groupId_createdAt_idx" ON "Activity"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayer" ADD CONSTRAINT "ExpensePayer_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayer" ADD CONSTRAINT "ExpensePayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseSplit" ADD CONSTRAINT "ExpenseSplit_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseSplit" ADD CONSTRAINT "ExpenseSplit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce project.md rule #2 in the database, not just application code:
-- sum(ExpensePayer.amountMinor) == sum(ExpenseSplit.amountMinor) == Expense.amountMinor.
-- A DEFERRABLE INITIALLY DEFERRED constraint trigger checks at COMMIT, not per-row, so a
-- transaction that inserts several payer/split rows for one expense isn't rejected mid-way.
CREATE OR REPLACE FUNCTION check_expense_balance() RETURNS trigger AS $$
DECLARE
  target_expense_id uuid;
  expense_total bigint;
  payer_sum bigint;
  split_sum bigint;
BEGIN
  target_expense_id := COALESCE(NEW."expenseId", OLD."expenseId");

  SELECT "amountMinor" INTO expense_total FROM "Expense" WHERE id = target_expense_id;
  IF expense_total IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM("amountMinor"), 0) INTO payer_sum FROM "ExpensePayer" WHERE "expenseId" = target_expense_id;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO split_sum FROM "ExpenseSplit" WHERE "expenseId" = target_expense_id;

  IF payer_sum <> expense_total OR split_sum <> expense_total THEN
    RAISE EXCEPTION 'Expense % is unbalanced: payers=%, splits=%, total=%', target_expense_id, payer_sum, split_sum, expense_total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER expense_payer_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON "ExpensePayer"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_balance();

CREATE CONSTRAINT TRIGGER expense_split_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON "ExpenseSplit"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_balance();
