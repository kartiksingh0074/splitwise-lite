import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getGroup, type GroupDetail } from "../features/groups/api.ts";
import { listAllExpenses, type Expense } from "../features/expenses/api.ts";
import { listSettlements, type Settlement } from "../features/settlements/api.ts";
import { getBalances, type Balances } from "../features/balances/api.ts";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { friendlyErrorMessage } from "../lib/errorMessages.ts";

export function GroupExportPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([getGroup(id), listAllExpenses(id), listSettlements(id), getBalances(id)])
      .then(([g, e, s, b]) => {
        setGroup(g);
        setExpenses(e);
        setSettlements(s.settlements);
        setBalances(b);
      })
      .catch((err: unknown) => setError(friendlyErrorMessage(err)));
  }, [id]);

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-10 text-sm text-red-600">{error}</p>;
  }

  if (!group || !expenses || !settlements || !balances) {
    return <PageSkeleton />;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">
          {group.name} — Ledger <span className="text-sm font-normal text-slate-500">({group.baseCurrency})</span>
        </h1>
        <button
          onClick={() => window.print()}
          className="print:hidden rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
        >
          Print / Save as PDF
        </button>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Balances</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-1 pr-4">Member</th>
              <th className="py-1">Net</th>
            </tr>
          </thead>
          <tbody>
            {balances.net.map((b) => (
              <tr key={b.userId} className="border-b border-slate-100">
                <td className="py-1 pr-4">{b.name}</td>
                <td className="py-1">{b.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Expenses ({expenses.length})
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-1 pr-4">Date</th>
              <th className="py-1 pr-4">Description</th>
              <th className="py-1 pr-4">Paid By</th>
              <th className="py-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-slate-100">
                <td className="py-1 pr-4">{e.paidAt.slice(0, 10)}</td>
                <td className="py-1 pr-4">{e.description}</td>
                <td className="py-1 pr-4">{e.payers.map((p) => p.name).join(", ")}</td>
                <td className="py-1">
                  {e.currency} {e.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Settlements ({settlements.length})
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-1 pr-4">Date</th>
              <th className="py-1 pr-4">From</th>
              <th className="py-1 pr-4">To</th>
              <th className="py-1 pr-4">Status</th>
              <th className="py-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((s) => (
              <tr key={s.id} className="border-b border-slate-100">
                <td className="py-1 pr-4">{s.settledAt.slice(0, 10)}</td>
                <td className="py-1 pr-4">{s.fromUserName}</td>
                <td className="py-1 pr-4">{s.toUserName}</td>
                <td className="py-1 pr-4">{s.status}</td>
                <td className="py-1">
                  {s.currency} {s.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
