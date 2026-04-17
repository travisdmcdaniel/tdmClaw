import { readFileSync } from "fs";
import { resolve, join, isAbsolute } from "path";
import { parse as parseYaml } from "yaml";
import Database from "better-sqlite3";
import { resolveConfigPath } from "../config-path";

type RawConfig = {
  app?: { dataDir?: string };
  scheduler?: { jobsFile?: string };
  workspace?: { root?: string };
};

type JobRow = {
  name: string;
  enabled: number;
  cronExpr: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

type RunRow = {
  status: string;
  startedAt: string;
  errorText: string | null;
};

/**
 * Prints a summary of the current application state: DB health, job statuses,
 * and the most recent run result for each job.
 */
export function status(): void {
  const configPath = resolveConfigPath();
  const raw = parseYaml(readFileSync(configPath, "utf-8")) as RawConfig;

  const dataDir = resolve(raw.app?.dataDir ?? "./data");
  const dbPath = join(dataDir, "tdmclaw.db");

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    console.error(`Could not open database at "${dbPath}".`);
    console.error("Is the dataDir correct in config.yaml?");
    process.exit(1);
  }

  try {
    const version = (db.pragma("user_version", { simple: true }) as number) ?? 0;
    console.log(`Database: ${dbPath} (schema version ${version})\n`);

    const sessions = db
      .prepare("SELECT COUNT(*) as c FROM sessions")
      .get() as { c: number };
    const messages = db
      .prepare("SELECT COUNT(*) as c FROM messages")
      .get() as { c: number };
    console.log(`Sessions: ${sessions.c}   Messages: ${messages.c}`);

    // Jobs
    let jobs: JobRow[] = [];
    try {
      jobs = db
        .prepare(
          `SELECT name, enabled, cron_expr AS cronExpr,
                  next_run_at AS nextRunAt, last_run_at AS lastRunAt
           FROM scheduled_jobs ORDER BY name`
        )
        .all() as JobRow[];
    } catch {
      // Table may not exist yet
    }

    console.log(`\nScheduled jobs (${jobs.length}):`);
    if (jobs.length === 0) {
      console.log("  (none)");
    } else {
      for (const job of jobs) {
        const state = job.enabled ? "enabled" : "disabled";
        const next = job.nextRunAt
          ? new Date(job.nextRunAt).toLocaleString()
          : "—";
        const last = job.lastRunAt
          ? new Date(job.lastRunAt).toLocaleString()
          : "never";

        console.log(`  ${job.name} [${state}]  cron: ${job.cronExpr}`);
        console.log(`    last run: ${last}  |  next run: ${next}`);

        // Last run result
        let lastRun: RunRow | undefined;
        try {
          lastRun = db
            .prepare(
              `SELECT status, started_at AS startedAt, error_text AS errorText
               FROM job_runs WHERE job_id = (
                 SELECT id FROM scheduled_jobs WHERE name = ?
               ) ORDER BY started_at DESC LIMIT 1`
            )
            .get(job.name) as RunRow | undefined;
        } catch {
          // job_runs table may not exist yet
        }

        if (lastRun) {
          const errNote = lastRun.errorText ? `  error: ${lastRun.errorText}` : "";
          console.log(`    last result: ${lastRun.status}${errNote}`);
        }
      }
    }

    // Settings
    let settings: Array<{ key: string; value: string }> = [];
    try {
      settings = db
        .prepare("SELECT key, value FROM settings ORDER BY key")
        .all() as Array<{ key: string; value: string }>;
    } catch {
      // Table may not exist yet
    }

    if (settings.length > 0) {
      console.log("\nSettings:");
      for (const s of settings) {
        console.log(`  ${s.key} = ${s.value}`);
      }
    }
  } finally {
    db.close();
  }
}
