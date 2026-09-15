import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { completePayment, getPaymentByLink, type Settlement } from "../features/settlements/api.ts";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { friendlyErrorMessage } from "../lib/errorMessages.ts";
import { showErrorToast } from "../stores/toastStore.ts";

export function PaymentCheckoutPage() {
  const { paymentLinkId } = useParams<{ paymentLinkId: string }>();
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!paymentLinkId) return;
    getPaymentByLink(paymentLinkId)
      .then(setSettlement)
      .catch((err: unknown) => setError(friendlyErrorMessage(err)));
  }, [paymentLinkId]);

  const handlePay = async () => {
    if (!paymentLinkId) return;
    setPaying(true);
    try {
      const updated = await completePayment(paymentLinkId);
      setSettlement(updated);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      showErrorToast(err);
    } finally {
      setPaying(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center sm:px-6">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!settlement) {
    return <PageSkeleton />;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6">
      <div className="rounded-lg bg-white p-6 text-center shadow">
        <p className="text-xs uppercase tracking-wide text-slate-500">Simulated checkout — no real payment is processed</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {settlement.currency} {settlement.amount}
        </h1>
        <p className="mt-1 text-sm text-slate-600">to {settlement.toUserName}</p>

        {settlement.status === "CONFIRMED" && (
          <div className="mt-6">
            <p className="text-lg text-emerald-700">Payment successful! ✅</p>
            <Link to={`/groups/${settlement.groupId}`} className="mt-4 inline-block text-sm text-slate-600 underline">
              Back to group
            </Link>
          </div>
        )}

        {settlement.status === "REJECTED" && (
          <div className="mt-6">
            <p className="text-sm text-red-600">This payment was rejected by the recipient.</p>
            <Link to={`/groups/${settlement.groupId}`} className="mt-4 inline-block text-sm text-slate-600 underline">
              Back to group
            </Link>
          </div>
        )}

        {settlement.status === "PENDING" && (
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={handlePay}
              disabled={paying}
              className="rounded bg-slate-900 py-2 text-white disabled:opacity-50"
            >
              {paying ? "Processing…" : "Pay with UPI"}
            </button>
            <button
              onClick={handlePay}
              disabled={paying}
              className="rounded bg-slate-100 py-2 text-slate-700 disabled:opacity-50"
            >
              {paying ? "Processing…" : "Pay with Card"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
