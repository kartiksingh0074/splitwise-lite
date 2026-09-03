import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createInvite,
  getGroup,
  removeMember,
  updateGroup,
  type GroupDetail,
} from "../features/groups/api.ts";
import { deleteExpense, listExpenses, type Expense } from "../features/expenses/api.ts";
import { getBalances, getSettlePlan } from "../features/balances/api.ts";
import { ApiError } from "../lib/api.ts";
import { useAuthStore } from "../stores/authStore.ts";
import { selectDisplayedTransfers, useBalancesStore } from "../stores/balancesStore.ts";

const TABS = ["Members", "Expenses", "Balances", "Activity"] as const;
type Tab = (typeof TABS)[number];

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = useAuthStore((state) => state.user?.id);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Members");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const balancesData = useBalancesStore((state) => state.balances);
  const settlePlan = useBalancesStore((state) => state.settlePlan);
  const view = useBalancesStore((state) => state.view);
  const setBalancesData = useBalancesStore((state) => state.setData);
  const setView = useBalancesStore((state) => state.setView);
  const displayedTransfers = useBalancesStore(selectDisplayedTransfers);

  const loadExpenses = () => {
    if (!id) return;
    listExpenses(id)
      .then((res) => setExpenses(res.expenses))
      .catch(() => setError("Couldn't load expenses."));
  };

  const loadBalances = () => {
    if (!id) return;
    Promise.all([getBalances(id), getSettlePlan(id, "greedy")])
      .then(([balances, plan]) => setBalancesData(balances, plan))
      .catch(() => setError("Couldn't load balances."));
  };

  const load = () => {
    if (!id) return;
    getGroup(id)
      .then((g) => {
        setGroup(g);
        setNameDraft(g.name);
      })
      .catch(() => setError("Couldn't load this group."));
  };

  useEffect(load, [id]);

  useEffect(() => {
    if (tab === "Expenses") loadExpenses();
    if (tab === "Balances") loadBalances();
  }, [tab, id]);

  const isOwner = group?.members.some((m) => m.userId === userId && m.role === "OWNER") ?? false;

  const handleDeleteExpense = async (expenseId: string) => {
    try {
      await deleteExpense(expenseId);
      loadExpenses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that expense.");
    }
  };

  const handleRename = async () => {
    if (!id) return;
    try {
      await updateGroup(id, { name: nameDraft });
      setRenaming(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't rename the group.");
    }
  };

  const handleCreateInvite = async () => {
    if (!id) return;
    try {
      const invite = await createInvite(id);
      setInviteCode(invite.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create an invite.");
    }
  };

  const handleRemove = async (targetUserId: string) => {
    if (!id) return;
    try {
      await removeMember(id, targetUserId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that member.");
    }
  };

  if (error && !group) {
    return <p className="mx-auto max-w-2xl px-6 py-10 text-sm text-red-600">{error}</p>;
  }

  if (!group) {
    return <p className="mx-auto max-w-2xl px-6 py-10 text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        {renaming ? (
          <div className="flex items-center gap-2">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xl font-semibold"
            />
            <button onClick={handleRename} className="text-sm text-slate-900 underline">
              Save
            </button>
            <button onClick={() => setRenaming(false)} className="text-sm text-slate-500">
              Cancel
            </button>
          </div>
        ) : (
          <h1 className="text-xl font-semibold text-slate-900">
            {group.name}{" "}
            <span className="text-sm font-normal text-slate-500">({group.baseCurrency})</span>
          </h1>
        )}
        {isOwner && !renaming && (
          <button onClick={() => setRenaming(true)} className="text-sm text-slate-600 underline">
            Rename
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex gap-4 border-b border-slate-200 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-1 py-2 ${
              tab === t ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Members" && (
        <div className="flex flex-col gap-4">
          {isOwner && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleCreateInvite}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                Create invite
              </button>
              {inviteCode && (
                <span className="text-sm text-slate-600">
                  Code: <code className="rounded bg-slate-100 px-1.5 py-0.5">{inviteCode}</code>
                </span>
              )}
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {group.members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between rounded border border-slate-200 bg-white px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{m.name}</p>
                  <p className="text-xs text-slate-500">{m.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500">{m.role}</span>
                  {isOwner && (
                    <button
                      onClick={() => handleRemove(m.userId)}
                      className="text-sm text-red-600 underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "Expenses" && (
        <div className="flex flex-col gap-4">
          <Link
            to={`/groups/${id}/expenses/new`}
            className="self-start rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            Add expense
          </Link>

          {expenses && expenses.length === 0 && (
            <p className="text-sm text-slate-600">No expenses yet.</p>
          )}

          <ul className="flex flex-col gap-2">
            {expenses?.map((expense) => {
              const canEdit = isOwner || expense.createdById === userId;
              return (
                <li
                  key={expense.id}
                  className="flex items-center justify-between rounded border border-slate-200 bg-white px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-slate-900">{expense.description}</p>
                    <p className="text-xs text-slate-500">
                      {expense.currency} {expense.amount}
                      {expense.currency !== expense.baseCurrency &&
                        ` (${expense.baseCurrency} ${expense.amountBase})`}
                      {" · "}
                      {new Date(expense.paidAt).toLocaleDateString()}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-3 text-sm">
                      <Link
                        to={`/groups/${id}/expenses/${expense.id}/edit`}
                        className="text-slate-600 underline"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => handleDeleteExpense(expense.id)}
                        className="text-red-600 underline"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {tab === "Balances" && (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Net balances</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {balancesData?.net.map((b) => {
                const amount = Number(b.amount);
                const positive = amount > 0;
                const negative = amount < 0;
                return (
                  <div
                    key={b.userId}
                    className={`rounded border px-3 py-2 ${
                      positive
                        ? "border-green-200 bg-green-50"
                        : negative
                          ? "border-red-200 bg-red-50"
                          : "border-slate-200 bg-white"
                    }`}
                  >
                    <p className="text-sm font-medium text-slate-900">{b.name}</p>
                    <p
                      className={`text-sm ${
                        positive ? "text-green-700" : negative ? "text-red-700" : "text-slate-500"
                      }`}
                    >
                      {positive && "+"}
                      {group.baseCurrency} {b.amount}
                      {positive && " owed"}
                      {negative && " owes"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Settle plan
                {settlePlan && (
                  <span className="ml-2 font-normal text-slate-500">
                    {settlePlan.naiveCount} transactions → {settlePlan.transferCount}
                  </span>
                )}
              </h2>
              <div className="flex gap-2 text-sm">
                <button
                  onClick={() => setView("simplified")}
                  className={`rounded px-2 py-1 ${
                    view === "simplified" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  Simplified
                </button>
                <button
                  onClick={() => setView("direct")}
                  className={`rounded px-2 py-1 ${
                    view === "direct" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  Direct
                </button>
              </div>
            </div>

            {displayedTransfers.length === 0 && (
              <p className="text-sm text-slate-600">Nobody owes anybody anything.</p>
            )}

            <ul className="flex flex-col gap-2">
              {displayedTransfers.map((t, i) => (
                <li
                  key={`${t.from}-${t.to}-${i}`}
                  className="rounded border border-slate-200 bg-white px-4 py-3 text-sm"
                >
                  <span className="font-medium text-slate-900">{t.fromName}</span>
                  <span className="text-slate-500"> owes </span>
                  <span className="font-medium text-slate-900">{t.toName}</span>
                  <span className="text-slate-500"> </span>
                  <span className="font-medium text-slate-900">
                    {group.baseCurrency} {t.amount}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {tab === "Activity" && (
        <p className="text-sm text-slate-500">Coming in Phase 6.</p>
      )}
    </div>
  );
}
