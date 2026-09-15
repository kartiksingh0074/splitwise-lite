import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getGroup, type GroupMemberInfo } from "../features/groups/api.ts";
import {
  createSettlement,
  uploadReceipt,
  type SettlementMethod,
} from "../features/settlements/api.ts";
import { friendlyErrorMessage } from "../lib/errorMessages.ts";
import { useAuthStore } from "../stores/authStore.ts";
import { showErrorToast } from "../stores/toastStore.ts";

interface PrefillState {
  toUserId?: string;
  toUserName?: string;
  amount?: string;
}

export function SettleUpPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as PrefillState | null) ?? {};
  const currentUserId = useAuthStore((state) => state.user?.id);

  const [members, setMembers] = useState<GroupMemberInfo[] | null>(null);
  const [toUserId, setToUserId] = useState(prefill.toUserId ?? "");
  const [amount, setAmount] = useState(prefill.amount ?? "");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<SettlementMethod>("CASH");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    getGroup(groupId)
      .then((g) => setMembers(g.members.filter((m) => m.userId !== currentUserId)))
      .catch((err) => {
        setError("Couldn't load group members.");
        showErrorToast(err);
      });
  }, [groupId, currentUserId]);

  useEffect(() => {
    if (!receiptFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(receiptFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [receiptFile]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!groupId) return;
    setError(null);

    if (!toUserId) {
      setError("Pick who you're paying.");
      return;
    }

    setSubmitting(true);
    try {
      const settlement = await createSettlement(groupId, {
        toUserId,
        amount,
        note: note || undefined,
        method,
      });
      if (receiptFile) {
        await uploadReceipt(settlement.id, receiptFile);
      }
      if (settlement.method === "GATEWAY" && settlement.paymentLinkId) {
        navigate(`/pay/${settlement.paymentLinkId}`);
      } else {
        navigate(`/groups/${groupId}`);
      }
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-lg bg-white p-6 shadow"
      >
        <h1 className="text-xl font-semibold text-slate-900">Settle up</h1>

        <div className="flex flex-col gap-1">
          <label htmlFor="toUserId" className="text-sm text-slate-700">
            Paying
          </label>
          <select
            id="toUserId"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="">Select a member…</option>
            {members?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
          {prefill.toUserName && (
            <p className="text-xs text-slate-500">Pre-filled from the settle plan.</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="amount" className="text-sm text-slate-700">
            Amount
          </label>
          <input
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="20.00"
            className="rounded border border-slate-300 px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm text-slate-700">How are you paying?</span>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setMethod("CASH")}
              className={`rounded px-2 py-1 ${
                method === "CASH" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              Cash
            </button>
            <button
              type="button"
              onClick={() => setMethod("GATEWAY")}
              className={`rounded px-2 py-1 ${
                method === "GATEWAY" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              UPI / Card (simulated)
            </button>
          </div>
          {method === "GATEWAY" && (
            <p className="text-xs text-slate-500">
              You'll be taken to a simulated checkout page — no real payment is processed.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="note" className="text-sm text-slate-700">
            Note (optional)
          </label>
          <input
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="receipt" className="text-sm text-slate-700">
            Receipt (optional)
          </label>
          <input
            id="receipt"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          />
          {previewUrl && (
            <img src={previewUrl} alt="Receipt preview" className="mt-2 max-h-48 rounded border" />
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-900 py-2 text-white disabled:opacity-50"
        >
          {submitting ? "Recording…" : "Record settlement"}
        </button>
      </form>
    </div>
  );
}
