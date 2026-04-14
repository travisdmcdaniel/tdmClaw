/**
 * Lightweight deterministic summarization helpers.
 * These preprocess external data BEFORE sending to the model,
 * reducing token costs by trimming, deduplicating, and structuring inputs.
 */

/**
 * Deduplicates emails by threadId, keeping the most recent per thread.
 */
export function deduplicateByThread<T extends { threadId: string; receivedAt: string }>(
  emails: T[]
): T[] {
  const seen = new Map<string, T>();
  for (const email of emails) {
    const existing = seen.get(email.threadId);
    if (!existing || email.receivedAt > existing.receivedAt) {
      seen.set(email.threadId, email);
    }
  }
  return Array.from(seen.values());
}

/**
 * Filters emails to those likely requiring action based on simple heuristics.
 * Does not call the model — purely string-based.
 */
export function classifyActionable(
  emails: Array<{ subject: string; snippet: string }>
): boolean[] {
  const ACTION_KEYWORDS = [
    "action required",
    "please review",
    "response needed",
    "deadline",
    "urgent",
    "asap",
    "follow up",
    "reminder",
    "invoice",
    "meeting",
  ];

  return emails.map((e) => {
    const text = `${e.subject} ${e.snippet}`.toLowerCase();
    return ACTION_KEYWORDS.some((kw) => text.includes(kw));
  });
}
