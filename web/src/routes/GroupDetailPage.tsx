import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  createInvite,
  getGroup,
  removeMember,
  updateGroup,
  type GroupDetail,
} from "../features/groups/api.ts";
import { deleteExpense, listExpenses } from "../features/expenses/api.ts";
import { getBalances, getSettlePlan } from "../features/balances/api.ts";
import {
  confirmSettlement,
  listSettlements,
  rejectSettlement,
  type Settlement,
} from "../features/settlements/api.ts";
import { listActivity, type ActivityEntry } from "../features/activity/api.ts";
import { getExportCsvBlobUrl } from "../features/export/api.ts";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { activityLink, formatActivityLabel, formatDayHeading, groupByDay } from "../features/activity/format.ts";
import { friendlyErrorMessage } from "../lib/errorMessages.ts";
import { useAuthStore } from "../stores/authStore.ts";
import { selectDisplayedTransfers, useBalancesStore } from "../stores/balancesStore.ts";
import { showErrorToast } from "../stores/toastStore.ts";
import { useExpensesStore } from "../stores/expensesStore.ts";

const TABS = ["Members", "Expenses", "Balances", "Activity"] as const;
type Tab = (typeof TABS)[number];

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const userId = useAuthStore((state) => state.user?.id);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>((location.state as { tab?: Tab } | null)?.tab ?? "Members");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const expenses = useExpensesStore((state) => (id ? state.byGroup[id] : undefined));
  const setExpenses = useExpensesStore((state) => state.setExpenses);
  const removeExpenseFromStore = useExpensesStore((state) => state.removeExpense);
  const balancesData = useBalancesStore((state) => state.balances);
  const settlePlan = useBalancesStore((state) => state.settlePlan);
  const view = useBalancesStore((state) => state.view);
  const setBalancesData = useBalancesStore((state) => state.setData);
  const setView = useBalancesStore((state) => state.setView);
  const displayedTransfers = useBalancesStore(selectDisplayedTransfers);
  const [settlements, setSettlements] = useState<Settlement[] | null>(null);
  const [activities, setActivities] = useState<ActivityEntry[] | null>(null);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);

  const loadActivity = () => {
    if (!id) return;
    listActivity(id)
      .then((res) => {
        setActivities(res.activities);
        setActivityCursor(res.nextCursor);
      })
      .catch(() => setError("Couldn't load activity."));
  };

  const loadMoreActivity = async () => {
    if (!id || !activityCursor) return;
    setActivityLoadingMore(true);
    try {
      const res = await listActivity(id, activityCursor);
      setActivities((prev) => [...(prev ?? []), ...res.activities]);
      setActivityCursor(res.nextCursor);
    } catch {
      setError("Couldn't load more activity.");
    } finally {
      setActivityLoadingMore(false);
    }
  };

  const loadSettlements = () => {
    if (!id) return;
    listSettlements(id)
      .then((res) => setSettlements(res.settlements))
      .catch(() => setError("Couldn't load settlements."));
  };

  const loadExpenses = () => {
    if (!id) return;
    listExpenses(id)
      .then((res) => setExpenses(id, res.expenses))
      .catch(() => setError("Couldn't load expenses."));
  };

  const loadBalances = () => {
    if (!id) return;
    Promise.all([getBalances(id), getSettlePlan(id, "greedy")])
      .then(([balances, plan]) => setBalancesData(balances, plan))
      .catch(() => setError("Couldn't load balances."));
    loadSettlements();
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
    if (tab === "Activity") loadActivity();
  }, [tab, id]);

  const isOwner = group?.members.some((m) => m.userId === userId && m.role === "OWNER") ?? false;

  const handleDeleteExpense = async (expenseId: string) => {
    try {
      await deleteExpense(expenseId);
      if (id) removeExpenseFromStore(id, expenseId);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    }
  };

  const handleRename = async () => {
    if (!id) return;
    try {
      await updateGroup(id, { name: nameDraft });
      setRenaming(false);
      load();
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    }
  };

  const handleExportCsv = async () => {
    if (!id || !group) return;
    try {
      const url = await getExportCsvBlobUrl(id);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${group.name}-ledger.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    }
  };

  const handleCreateInvite = async () => {
    if (!id) return;
    try {
      const invite = await createInvite(id);
      setInviteCode(invite.code);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    }
  };

  const handleConfirmSettlement = async (settlementId: string) => {
    try {
      await confirmSettlement(settlementId);
      loadSettlements();
      loadBalances();
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    }
  };

  const handleRejectSettlement = async (settlementId: string) => {
    try {
      await rejectSettlement(settlementId);
      loadSettlements();
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    }
  };

  const handleRemove = async (targetUserId: string) => {
    if (!id) return;
    try {
      await removeMember(id, targetUserId);
      load();
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    }
  };

  if (error && !group) {
    return <p className="mx-auto max-w-2xl px-4 py-10 sm:px-6 text-sm text-red-600">{error}</p>;
  }

  if (!group) {
    return <PageSkeleton />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
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
        {!renaming && (
          <div className="flex items-center gap-3">
            <button onClick={handleExportCsv} className="text-sm text-slate-600 underline">
              Export CSV
            </button>
            <Link to={`/groups/${id}/export-print`} className="text-sm text-slate-600 underline">
              Print / PDF
            </Link>
            {isOwner && (
              <button onClick={() => setRenaming(true)} className="text-sm text-slate-600 underline">
                Rename
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex gap-4 overflow-x-auto border-b border-slate-200 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 border-b-2 px-1 py-2 ${
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
              const isPending = expense.id.startsWith("temp-");
              return (
                <li
                  key={expense.id}
                  className={`flex items-center justify-between rounded border px-4 py-3 ${
                    isPending ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"
                  }`}
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {expense.description}
                      {isPending && <span className="ml-2 text-xs font-normal text-slate-500">Saving…</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {expense.currency} {expense.amount}
                      {expense.currency !== expense.baseCurrency &&
                        ` (${expense.baseCurrency} ${expense.amountBase})`}
                      {" · "}
                      {new Date(expense.paidAt).toLocaleDateString()}
                    </p>
                  </div>
                  {canEdit && !isPending && (
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

          {balancesData && balancesData.byCurrency.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Per-currency breakdown</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {balancesData.byCurrency.map((b, i) => {
                  const amount = Number(b.amount);
                  return (
                    <li key={`${b.userId}-${b.currency}-${i}`} className="text-slate-600">
                      <span className="font-medium text-slate-900">{b.name}</span>:{" "}
                      <span className={amount > 0 ? "text-green-700" : amount < 0 ? "text-red-700" : ""}>
                        {amount > 0 && "+"}
                        {b.currency} {b.amount}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

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
              {displayedTransfers.map((t, i) => {
                const pending = settlements?.some(
                  (s) => s.status === "PENDING" && s.fromUserId === t.from && s.toUserId === t.to,
                );
                return (
                  <li
                    key={`${t.from}-${t.to}-${i}`}
                    className="flex items-center justify-between rounded border border-slate-200 bg-white px-4 py-3 text-sm"
                  >
                    <div>
                      <span className="font-medium text-slate-900">{t.fromName}</span>
                      <span className="text-slate-500"> owes </span>
                      <span className="font-medium text-slate-900">{t.toName}</span>
                      <span className="text-slate-500"> </span>
                      <span className="font-medium text-slate-900">
                        {group.baseCurrency} {t.amount}
                      </span>
                      {pending && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                          Pending confirmation
                        </span>
                      )}
                    </div>
                    {t.from === userId && !pending && (
                      <button
                        onClick={() =>
                          navigate(`/groups/${id}/settle-up`, {
                            state: { toUserId: t.to, toUserName: t.toName, amount: t.amount },
                          })
                        }
                        className="rounded bg-slate-900 px-3 py-1 text-xs text-white"
                      >
                        Settle up
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {settlements && settlements.filter((s) => s.status === "PENDING").length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Pending settlements</h2>
              <ul className="flex flex-col gap-2">
                {settlements
                  .filter((s) => s.status === "PENDING")
                  .map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <span className="font-medium text-slate-900">{s.fromUserName}</span>
                        <span className="text-slate-500"> paid </span>
                        <span className="font-medium text-slate-900">{s.toUserName}</span>
                        <span className="text-slate-500"> </span>
                        <span className="font-medium text-slate-900">
                          {s.currency} {s.amount}
                        </span>
                        {s.currency !== s.baseCurrency && (
                          <span className="text-slate-500"> ({s.baseCurrency} {s.amountBase})</span>
                        )}
                      </div>
                      {s.toUserId === userId ? (
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleConfirmSettlement(s.id)}
                            className="text-green-700 underline"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => handleRejectSettlement(s.id)}
                            className="text-red-600 underline"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">Awaiting confirmation</span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {tab === "Activity" && (
        <div className="flex flex-col gap-6">
          {activities && activities.length === 0 && (
            <p className="text-sm text-slate-600">No activity yet.</p>
          )}

          {activities &&
            groupByDay(activities).map(([day, entries]) => (
              <div key={day}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {formatDayHeading(entries[0]!.createdAt)}
                </h2>
                <ul className="flex flex-col gap-2">
                  {entries.map((a) => {
                    const link = activityLink(id ?? "", a);
                    const content = (
                      <>
                        <p className="text-sm text-slate-900">{formatActivityLabel(a)}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(a.createdAt).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                      </>
                    );
                    return (
                      <li
                        key={a.id}
                        className="rounded border border-slate-200 bg-white px-4 py-3"
                      >
                        {link ? (
                          <Link to={link} className="block hover:underline">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

          {activityCursor && (
            <button
              onClick={loadMoreActivity}
              disabled={activityLoadingMore}
              className="self-center rounded bg-slate-100 px-4 py-1.5 text-sm text-slate-700 disabled:opacity-50"
            >
              {activityLoadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
