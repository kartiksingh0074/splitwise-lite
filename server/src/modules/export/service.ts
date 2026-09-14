import { prisma } from "../../db/client.js";
import { csvRow } from "../../lib/csv.js";
import { listAllExpenses } from "../expenses/service.js";
import { listSettlements } from "../settlements/service.js";

function toDateOnly(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  return date.toISOString().slice(0, 10);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function exportGroupLedgerCsv(groupId: string): Promise<{ filename: string; csv: string }> {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { name: true, baseCurrency: true },
  });

  const [expenses, settlements] = await Promise.all([
    listAllExpenses(groupId),
    listSettlements(groupId),
  ]);

  settlements.sort((a, b) => (a.settledAt < b.settledAt ? -1 : a.settledAt > b.settledAt ? 1 : 0));

  let csv = "﻿";
  csv += csvRow(["Group", group.name]);
  csv += csvRow(["Base Currency", group.baseCurrency]);
  csv += csvRow(["Exported At", new Date().toISOString()]);
  csv += "\r\n";

  csv += csvRow(["Expenses"]);
  csv += csvRow([
    "Date",
    "Description",
    "Category",
    "Currency",
    "Amount",
    "Base Currency",
    "Amount (Base)",
    "FX Rate",
    "Split Type",
    "Paid By",
    "Splits",
    "Created At",
  ]);
  for (const e of expenses) {
    csv += csvRow([
      toDateOnly(e.paidAt),
      e.description,
      e.category ?? "",
      e.currency,
      e.amount,
      e.baseCurrency,
      e.amountBase,
      e.fxRateToBase,
      e.splitType,
      e.payers.map((p) => `${p.name}: ${p.amount}`).join("; "),
      e.splits.map((s) => `${s.name}: ${s.amount}`).join("; "),
      e.createdAt.toISOString(),
    ]);
  }
  csv += "\r\n";

  csv += csvRow(["Settlements"]);
  csv += csvRow([
    "Date",
    "From",
    "To",
    "Currency",
    "Amount",
    "Base Currency",
    "Amount (Base)",
    "FX Rate",
    "Status",
    "Note",
    "Created At",
  ]);
  for (const s of settlements) {
    csv += csvRow([
      toDateOnly(s.settledAt),
      s.fromUserName,
      s.toUserName,
      s.currency,
      s.amount,
      s.baseCurrency,
      s.amountBase,
      s.fxRateToBase,
      s.status,
      s.note ?? "",
      s.createdAt.toISOString(),
    ]);
  }

  const filename = `${slugify(group.name)}-ledger-${toDateOnly(new Date())}.csv`;
  return { filename, csv };
}
