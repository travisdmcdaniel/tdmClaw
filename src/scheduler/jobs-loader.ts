import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, isAbsolute, join } from "path";
import type { Database } from "better-sqlite3";
import type { JobDefinition } from "./types";
import { upsertJob, deleteJobsNotIn } from "../storage/jobs";
import { getNextRunAt } from "./timing";
import { childLogger } from "../app/logger";

const log = childLogger("scheduler");

/**
 * Loads job definitions from the jobs file, upserts them into the
 * scheduled_jobs table, and removes any DB rows that are no longer present
 * in the file. jobs.json is the source of truth.
 *
 * - New jobs get next_run_at = next future occurrence of their cron expression.
 * - Existing jobs keep their next_run_at unless the cron expression changed.
 * - Jobs removed from the file are deleted from the DB (skipped if currently
 *   claimed/running — they will not be rescheduled after they finish).
 *
 * Path resolution:
 *   - Absolute paths are used as-is.
 *   - Relative paths are resolved against workspaceRoot.
 *   - Default: {workspaceRoot}/jobs/jobs.json
 */
export function loadJobsFromFile(
  db: Database,
  jobsFilePath: string,
  workspaceRoot: string
): void {
  const resolved = isAbsolute(jobsFilePath)
    ? jobsFilePath
    : resolve(join(workspaceRoot, jobsFilePath));

  if (!existsSync(resolved)) {
    log.info({ path: resolved }, "No jobs.json found — skipping job load");
    return;
  }

  let defs: JobDefinition[];
  try {
    const raw = readFileSync(resolved, "utf-8");
    defs = JSON.parse(raw) as JobDefinition[];
  } catch (err) {
    log.error({ path: resolved, err }, "Failed to parse jobs.json — skipping job load");
    return;
  }

  if (!Array.isArray(defs)) {
    log.error({ path: resolved }, "jobs.json must be a JSON array — skipping job load");
    return;
  }

  const now = new Date().toISOString();
  let loaded = 0;
  const validIds = new Set<string>();

  for (const def of defs) {
    if (!def.id || !def.cronExpr || !def.chatId || !def.prompt) {
      log.warn({ def }, "Skipping job with missing required fields (id, cronExpr, chatId, prompt)");
      continue;
    }

    const nextRunAt = getNextRunAt(def.cronExpr, def.timezone ?? "UTC") ?? now;

    upsertJob(db, {
      id: def.id,
      name: def.name ?? def.id,
      type: "prompt",
      cronExpr: def.cronExpr,
      timezone: def.timezone ?? "UTC",
      enabled: def.enabled ?? true,
      payloadJson: JSON.stringify({ prompt: def.prompt, chatId: def.chatId }),
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    });

    validIds.add(def.id);
    loaded++;
  }

  const removed = deleteJobsNotIn(db, validIds);
  if (removed > 0) {
    log.info({ removed }, "Removed jobs no longer present in jobs.json");
  }

  log.info({ loaded, total: defs.length, path: resolved }, "Jobs loaded from jobs.json");
}

/**
 * Ensures the jobs directory exists within the workspace.
 * Called during bootstrap so the LLM can write jobs.json there.
 */
export function ensureJobsDir(workspaceRoot: string, jobsFilePath: string): void {
  const resolved = isAbsolute(jobsFilePath)
    ? jobsFilePath
    : resolve(join(workspaceRoot, jobsFilePath));
  try {
    mkdirSync(dirname(resolved), { recursive: true });
  } catch {
    // Non-fatal — loader handles missing file gracefully
  }
}

/**
 * Reads and parses job definitions from the jobs file without touching the DB.
 * Returns an empty array if the file doesn't exist or is invalid.
 */
export function readJobDefinitions(
  jobsFilePath: string,
  workspaceRoot: string
): JobDefinition[] {
  const resolved = isAbsolute(jobsFilePath)
    ? jobsFilePath
    : resolve(join(workspaceRoot, jobsFilePath));

  if (!existsSync(resolved)) return [];

  try {
    const raw = readFileSync(resolved, "utf-8");
    const defs = JSON.parse(raw) as JobDefinition[];
    return Array.isArray(defs) ? defs : [];
  } catch {
    return [];
  }
}

/**
 * Copies the example jobs file to the workspace jobs path if no jobs.json
 * exists there yet. Gives the user (and LLM) a starting template to edit.
 */
export function seedJobsFileFromExample(
  workspaceRoot: string,
  jobsFilePath: string,
  examplePath: string
): void {
  const resolved = isAbsolute(jobsFilePath)
    ? jobsFilePath
    : resolve(join(workspaceRoot, jobsFilePath));

  if (existsSync(resolved)) return; // already exists — don't overwrite

  const resolvedExample = resolve(examplePath);
  if (!existsSync(resolvedExample)) {
    log.debug({ examplePath: resolvedExample }, "No jobs.example.json found — skipping seed");
    return;
  }

  try {
    const content = readFileSync(resolvedExample, "utf-8");
    writeFileSync(resolved, content, "utf-8");
    log.info({ path: resolved }, "Seeded jobs.json from example");
  } catch (err) {
    log.warn({ path: resolved, err }, "Failed to seed jobs.json from example (non-fatal)");
  }
}
