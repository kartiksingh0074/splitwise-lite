import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { getGroup, type GroupMemberInfo } from "../features/groups/api.ts";
import {
  createExpense,
  getExpense,
  updateExpense,
  type SplitType,
} from "../features/expenses/api.ts";
import { ApiError } from "../lib/api.ts";
import { useAuthStore } from "../stores/authStore.ts";
import { selectRemainingToAllocate, useExpenseFormStore } from "../stores/expenseFormStore.ts";

const SPLIT_TYPES: SplitType[] = ["EQUAL", "EXACT", "PERCENT", "SHARES"];

const scalarSchema = z.object({
  description: z.string().min(1, "Description is required").max(200),
  category: z.string().max(60).optional(),
  currency: z
    .string()
    .length(3, "3-letter currency code")
    .transform((v) => v.toUpperCase()),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Enter a decimal amount, e.g. 20.00"),
  paidAt: z.string().min(1, "Date is required"),
});

type ScalarForm = z.infer<typeof scalarSchema>;

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExpenseFormPage() {
  const { id: groupId, expenseId } = useParams<{ id: string; expenseId?: string }>();
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const isEdit = Boolean(expenseId);

  const [members, setMembers] = useState<GroupMemberInfo[] | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const store = useExpenseFormStore();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ScalarForm>({
    resolver: zodResolver(scalarSchema),
    defaultValues: { description: "", category: "", currency: "USD", amount: "", paidAt: "" },
  });

  useEffect(() => {
    if (!groupId) return;

    let cancelled = false;

    async function load() {
      try {
        const group = await getGroup(groupId!);
        if (cancelled) return;
        setMembers(group.members);

        if (expenseId) {
          const expense = await getExpense(expenseId);
          if (cancelled) return;
          setVersion(expense.version);
          reset({
            description: expense.description,
            category: expense.category ?? "",
            currency: expense.currency,
            amount: expense.amount,
            paidAt: toDatetimeLocal(expense.paidAt),
          });
          store.hydrate({
            amount: expense.amount,
            currency: expense.currency,
            splitType: expense.splitType,
            participantIds: expense.splits.map((s) => s.userId),
            splitInputs: Object.fromEntries(
              expense.splits.filter((s) => s.input !== null).map((s) => [s.userId, s.input!]),
            ),
            payerIds: expense.payers.map((p) => p.userId),
            payerAmounts: Object.fromEntries(expense.payers.map((p) => [p.userId, p.amount])),
          });
        } else {
          store.reset();
          if (currentUserId) {
            store.togglePayer(currentUserId);
            store.toggleParticipant(currentUserId);
          }
        }
      } catch {
        if (!cancelled) setError("Couldn't load this form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [groupId, expenseId]);

  const remaining = selectRemainingToAllocate(store);

  const onSubmit = async (scalar: ScalarForm) => {
    setError(null);

    if (store.participantIds.length === 0) {
      setError("Select at least one participant.");
      return;
    }
    if (store.payerIds.length === 0) {
      setError("Select at least one payer.");
      return;
    }

    const anyPayerAmountSet = store.payerIds.some((id) => store.payerAmounts[id]?.trim());

    const payload = {
      description: scalar.description,
      category: scalar.category || undefined,
      currency: scalar.currency,
      amount: scalar.amount,
      splitType: store.splitType,
      splits: store.participantIds.map((userId) => ({
        userId,
        input: store.splitType === "EQUAL" ? undefined : store.splitInputs[userId],
      })),
      payers: store.payerIds.map((userId) => ({
        userId,
        amount: anyPayerAmountSet ? store.payerAmounts[userId] || "0.00" : undefined,
      })),
      paidAt: new Date(scalar.paidAt).toISOString(),
    };

    try {
      if (isEdit && expenseId && version !== null) {
        await updateExpense(expenseId, version, payload);
      } else if (groupId) {
        await createExpense(groupId, payload);
      }
      navigate(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  };

  if (loading) {
    return <p className="mx-auto max-w-2xl px-6 py-10 text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-6 text-xl font-semibold text-slate-900">
        {isEdit ? "Edit expense" : "Add expense"}
      </h1>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-white p-6 shadow">
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-sm text-slate-700">Description</label>
            <input className="rounded border border-slate-300 px-3 py-2" {...register("description")} />
            {errors.description && <p className="text-sm text-red-600">{errors.description.message}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-700">Category</label>
            <input className="rounded border border-slate-300 px-3 py-2" {...register("category")} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-700">Currency</label>
            <input
              className="rounded border border-slate-300 px-3 py-2 uppercase"
              maxLength={3}
              {...register("currency", { onChange: (e) => store.setCurrency(e.target.value.toUpperCase()) })}
            />
            {errors.currency && <p className="text-sm text-red-600">{errors.currency.message}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-700">Amount</label>
            <input
              className="rounded border border-slate-300 px-3 py-2"
              placeholder="20.00"
              {...register("amount", { onChange: (e) => store.setAmount(e.target.value) })}
            />
            {errors.amount && <p className="text-sm text-red-600">{errors.amount.message}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-slate-700">Paid at</label>
            <input
              type="datetime-local"
              className="rounded border border-slate-300 px-3 py-2"
              {...register("paidAt")}
            />
            {errors.paidAt && <p className="text-sm text-red-600">{errors.paidAt.message}</p>}
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Payers</h2>
          <div className="flex flex-col gap-2">
            {members?.map((m) => (
              <label key={m.userId} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={store.payerIds.includes(m.userId)}
                  onChange={() => store.togglePayer(m.userId)}
                />
                <span className="flex-1">{m.name}</span>
                {store.payerIds.includes(m.userId) && (
                  <input
                    className="w-24 rounded border border-slate-300 px-2 py-1"
                    placeholder="split equally"
                    value={store.payerAmounts[m.userId] ?? ""}
                    onChange={(e) => store.setPayerAmount(m.userId, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Leave amounts blank to split the total equally among selected payers.
          </p>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Split</h2>
            <div className="flex gap-2 text-sm">
              {SPLIT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => store.setSplitType(t)}
                  className={`rounded px-2 py-1 ${
                    store.splitType === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {members?.map((m) => (
              <label key={m.userId} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={store.participantIds.includes(m.userId)}
                  onChange={() => store.toggleParticipant(m.userId)}
                />
                <span className="flex-1">{m.name}</span>
                {store.splitType !== "EQUAL" && store.participantIds.includes(m.userId) && (
                  <input
                    className="w-28 rounded border border-slate-300 px-2 py-1"
                    placeholder={
                      store.splitType === "EXACT"
                        ? "minor units"
                        : store.splitType === "PERCENT"
                          ? "%"
                          : "shares"
                    }
                    value={store.splitInputs[m.userId] ?? ""}
                    onChange={(e) => store.setSplitInput(m.userId, e.target.value)}
                  />
                )}
              </label>
            ))}
          </div>

          {remaining !== null && (
            <p className="mt-3 text-sm text-slate-600">
              Remaining to allocate: <span className="font-medium">{remaining}</span>
              {store.splitType === "PERCENT" ? "%" : ""}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-slate-900 py-2 text-white disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Add expense"}
        </button>
      </form>
    </div>
  );
}
