export type RecurrenceInterval = "WEEKLY" | "MONTHLY" | "YEARLY";

/**
 * Advances `date` by one occurrence of `interval`. Monthly/yearly steps clamp the day-of-month
 * to the target month's last day (e.g. Jan 31 + 1 month -> Feb 28, not JS's native rollover to
 * Mar 3) so a rent-on-the-31st template doesn't drift forward across short months.
 */
export function advanceByInterval(date: Date, interval: RecurrenceInterval): Date {
  if (interval === "WEEKLY") {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }

  const monthsToAdd = interval === "MONTHLY" ? 1 : 12;
  const year = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + monthsToAdd;
  const daysInTargetMonth = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), daysInTargetMonth);

  return new Date(
    Date.UTC(
      year,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}
