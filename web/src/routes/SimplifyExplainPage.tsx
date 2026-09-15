import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getBalances } from "../features/balances/api.ts";
import { computeSimplifySteps, type SimplifyStep } from "../features/balances/simplifyExplain.ts";
import { PageSkeleton } from "../components/Skeleton.tsx";
import { friendlyErrorMessage } from "../lib/errorMessages.ts";

function formatMinor(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export function SimplifyExplainPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const [steps, setSteps] = useState<SimplifyStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!groupId) return;
    getBalances(groupId)
      .then((balances) => setSteps(computeSimplifySteps(balances.net)))
      .catch((err: unknown) => setError(friendlyErrorMessage(err)));
  }, [groupId]);

  useEffect(() => {
    if (!playing || !steps) return;
    intervalRef.current = setInterval(() => {
      setStepIndex((i) => {
        if (i >= steps.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1200);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, steps]);

  if (error) {
    return <p className="mx-auto max-w-2xl px-4 py-10 text-sm text-red-600">{error}</p>;
  }

  if (!steps) {
    return <PageSkeleton />;
  }

  if (steps.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center sm:px-6">
        <p className="text-lg text-slate-900">Already settled! 🎉</p>
        <Link to={`/groups/${groupId}`} className="mt-4 inline-block text-sm text-slate-600 underline">
          Back to group
        </Link>
      </div>
    );
  }

  const current = steps[stepIndex]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">How the settle-plan is computed</h1>
        <Link to={`/groups/${groupId}`} className="text-sm text-slate-600 underline">
          Back to group
        </Link>
      </div>

      <p className="mb-6 text-sm text-slate-600">
        Each step matches whoever is owed the most against whoever owes the most, and transfers
        the smaller of the two amounts — repeating until everyone's balanced. This is the same
        greedy algorithm the real settle-plan uses (illustrative here, not authoritative).
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Creditors (owed money)</h2>
          <ul className="flex flex-col gap-2">
            {current.creditors.map((c, i) => (
              <li
                key={c.userId}
                className={`rounded border px-3 py-2 text-sm transition-all duration-300 ${
                  i === 0
                    ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-900"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                {c.name}: {formatMinor(c.amountMinor)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Debtors (owe money)</h2>
          <ul className="flex flex-col gap-2">
            {current.debtors.map((d, i) => (
              <li
                key={d.userId}
                className={`rounded border px-3 py-2 text-sm transition-all duration-300 ${
                  i === 0
                    ? "border-red-500 bg-red-50 font-medium text-red-900"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                {d.name}: {formatMinor(d.amountMinor)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="my-6 rounded-lg bg-slate-900 px-4 py-3 text-center text-sm text-white transition-all duration-300">

        {current.debtors[0]?.name ?? "?"} pays {current.creditors[0]?.name ?? "?"}:{" "}
        <span className="font-semibold">{formatMinor(current.transferMinor)}</span>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setPlaying(false);
              setStepIndex((i) => Math.max(0, i - 1));
            }}
            disabled={isFirst}
            className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            onClick={() => {
              if (playing) {
                setPlaying(false);
                return;
              }
              if (isLast) setStepIndex(0);
              setPlaying(true);
            }}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            {playing ? "Pause" : isLast ? "Replay" : "Play"}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setStepIndex((i) => Math.min(steps.length - 1, i + 1));
            }}
            disabled={isLast}
            className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
          >
            Next
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setStepIndex(0);
            }}
            className="rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-700"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
