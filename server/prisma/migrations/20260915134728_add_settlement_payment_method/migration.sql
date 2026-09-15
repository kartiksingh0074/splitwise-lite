-- CreateEnum
CREATE TYPE "SettlementMethod" AS ENUM ('CASH', 'GATEWAY');

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "method" "SettlementMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "paymentLinkId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_paymentLinkId_key" ON "Settlement"("paymentLinkId");
