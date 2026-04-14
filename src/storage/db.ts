import Database from "better-sqlite3";
import { join } from "path";
import { childLogger } from "../app/logger";

const log = childLogger("db");

export { Database };

/**
 * Opens (or creates) the SQLite database at dataDir/tdmclaw.db.
 * Sets WAL mode and reasonable pragmas for a single-writer workload.
 */
export function openDatabase(dataDir: string): Database.Database {
  const dbPath = join(dataDir, "tdmclaw.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  log.info({ path: dbPath }, "Database opened");
  return db;
}
