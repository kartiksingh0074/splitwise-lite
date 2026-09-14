import { describe, expect, it } from "vitest";
import { advanceByInterval } from "../src/domain/recurrence.js";

describe("advanceByInterval", () => {
  it("WEEKLY: adds exactly 7 days", () => {
    const next = advanceByInterval(new Date("2026-01-05T10:00:00.000Z"), "WEEKLY");
    expect(next.toISOString()).toBe("2026-01-12T10:00:00.000Z");
  });

  it("MONTHLY: adds one month on an ordinary day", () => {
    const next = advanceByInterval(new Date("2026-03-15T10:00:00.000Z"), "MONTHLY");
    expect(next.toISOString()).toBe("2026-04-15T10:00:00.000Z");
  });

  it("MONTHLY: clamps Jan 31 + 1 month to Feb 28 (non-leap year), not Mar 3", () => {
    const next = advanceByInterval(new Date("2026-01-31T10:00:00.000Z"), "MONTHLY");
    expect(next.toISOString()).toBe("2026-02-28T10:00:00.000Z");
  });

  it("MONTHLY: clamps Jan 31 + 1 month to Feb 29 in a leap year", () => {
    const next = advanceByInterval(new Date("2028-01-31T10:00:00.000Z"), "MONTHLY");
    expect(next.toISOString()).toBe("2028-02-29T10:00:00.000Z");
  });

  it("YEARLY: adds 12 months, preserving month/day", () => {
    const next = advanceByInterval(new Date("2026-06-10T10:00:00.000Z"), "YEARLY");
    expect(next.toISOString()).toBe("2027-06-10T10:00:00.000Z");
  });

  it("YEARLY: Feb 29 in a leap year clamps to Feb 28 the following (non-leap) year", () => {
    const next = advanceByInterval(new Date("2028-02-29T10:00:00.000Z"), "YEARLY");
    expect(next.toISOString()).toBe("2029-02-28T10:00:00.000Z");
  });
});
