// Client-side reimplementation of server/src/domain/simplify.ts's simplifyGreedy, for the
// "explain" animation only -- illustrative, never authoritative. The real settle-plan always
// comes from GET /groups/:id/settle-plan. Mirrors that loop exactly (full re-sort both arrays
// descending each iteration, mutate in place, shift off a side when it zeroes out) so the
// intermediate steps and tie-breaking order match what the server actually does.

interface Party {
  userId: string;
  name: string;
  amountMinor: number;
}

export interface SimplifyStep {
  creditors: Party[];
  debtors: Party[];
  fromUserId: string;
  toUserId: string;
  transferMinor: number;
}

function byAmountDesc(a: Party, b: Party): number {
  return b.amountMinor - a.amountMinor;
}

export function computeSimplifySteps(
  net: { userId: string; name: string; amount: string }[],
): SimplifyStep[] {
  const creditors: Party[] = [];
  const debtors: Party[] = [];

  for (const b of net) {
    const amountMinor = Math.round(Number(b.amount) * 100);
    if (amountMinor > 0) {
      creditors.push({ userId: b.userId, name: b.name, amountMinor });
    } else if (amountMinor < 0) {
      debtors.push({ userId: b.userId, name: b.name, amountMinor: -amountMinor });
    }
  }

  const steps: SimplifyStep[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountDesc);
    debtors.sort(byAmountDesc);

    steps.push({
      creditors: creditors.map((c) => ({ ...c })),
      debtors: debtors.map((d) => ({ ...d })),
      fromUserId: debtors[0]!.userId,
      toUserId: creditors[0]!.userId,
      transferMinor: Math.min(creditors[0]!.amountMinor, debtors[0]!.amountMinor),
    });

    const c = creditors[0]!;
    const d = debtors[0]!;
    const amount = Math.min(c.amountMinor, d.amountMinor);

    c.amountMinor -= amount;
    d.amountMinor -= amount;

    if (c.amountMinor === 0) creditors.shift();
    if (d.amountMinor === 0) debtors.shift();
  }

  return steps;
}
