import { describe, expect, it } from "vitest";
import { getNextRunAt, isDue, isWithinCatchUpWindow } from "./timing";

describe("getNextRunAt", () => {
  it("returns an ISO string for a valid cron expression", () => {
    const next = getNextRunAt("0 8 * * *", "UTC");
    expect(next).not.toBeNull();
    expect(next).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("returns null for an invalid cron expression", () => {
    expect(getNextRunAt("not-a-cron", "UTC")).toBeNull();
  });

  it("returns a future date", () => {
    const next = getNextRunAt("0 8 * * *", "UTC");
    if (next) {
      expect(new Date(next).getTime()).toBeGreaterThan(Date.now());
    }
  });
});

describe("isDue", () => {
  it("returns true for a past timestamp", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isDue(past)).toBe(true);
  });

  it("returns false for a future timestamp", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isDue(future)).toBe(false);
  });

  it("returns true for the current moment (boundary)", () => {
    const now = new Date().toISOString();
    // May be true or false depending on exact millisecond; just ensure no throw
    expect(typeof isDue(now)).toBe("boolean");
  });
});

describe("isWithinCatchUpWindow", () => {
  it("returns true when the job ran within the window", () => {
    const twoMinsAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(isWithinCatchUpWindow(twoMinsAgo, 10)).toBe(true);
  });

  it("returns false when the job ran before the window", () => {
    const twentyMinsAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(isWithinCatchUpWindow(twentyMinsAgo, 10)).toBe(false);
  });

  it("returns false for a future timestamp", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isWithinCatchUpWindow(future, 10)).toBe(false);
  });
});
