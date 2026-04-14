import { Cron } from "croner";

/**
 * Computes the next run time for a cron expression in the given timezone.
 * Returns an ISO string or null if no future run exists.
 */
export function getNextRunAt(cronExpr: string, timezone: string): string | null {
  try {
    const job = new Cron(cronExpr, { timezone });
    const next = job.nextRun();
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the job is due (nextRunAt is in the past or present).
 */
export function isDue(nextRunAt: string): boolean {
  return new Date(nextRunAt) <= new Date();
}

/**
 * Returns true if the job is within the catch-up window after a restart.
 */
export function isWithinCatchUpWindow(
  nextRunAt: string,
  catchUpWindowMinutes: number
): boolean {
  const windowMs = catchUpWindowMinutes * 60 * 1000;
  const jobTime = new Date(nextRunAt).getTime();
  const now = Date.now();
  return jobTime >= now - windowMs && jobTime <= now;
}
