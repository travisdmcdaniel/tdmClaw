# tdmClaw CLI Technical Design Document

## Document Metadata

- Project: tdmClaw
- Document Type: Technical Design Document — CLI Subsystem
- Version: 0.1
- Status: Draft
- Related Documents: `tdmClaw_TDD.md`, `tdmClaw_IP.md`, `tdmClaw_CLI_IP.md`
- Target Runtime: Any platform where the service runs (Linux, macOS)
- Primary Language: TypeScript
- Primary Runtime: Node.js 22+

---

## 1. Purpose

This document defines the technical design for the `tdmclaw` command-line management tool. The CLI allows the owner to inspect and modify the service configuration, manage allowed Telegram users, query live runtime state from the SQLite database, and perform other administrative tasks — without editing YAML files by hand or restarting the service.

The CLI shares the same binary entry point as the service (`dist/index.js`). When invoked with no arguments or with `start`, it runs the service. When invoked with a recognized subcommand, it routes to the CLI runtime instead.

---

## 2. Design Goals

### 2.1 Functional Goals

1. Allow the owner to add or remove allowed Telegram user IDs without editing config.yaml.
2. Allow reading and writing scalar config values by dotted key path.
3. Allow inspecting live state: active model, Google connection status, recent sessions, scheduled jobs.
4. Allow writing the active model selection directly to the SQLite database.
5. Produce output that is readable at a glance and optionally machine-parseable.

### 2.2 Technical Goals

1. CLI commands must not start the full service stack (no Telegram polling, no scheduler, no HTTP server).
2. Config edits must preserve YAML comments and existing formatting as much as possible.
3. Database access must be read-only for query commands; only explicit write commands may mutate state.
4. All commands must resolve config and database paths consistently with how the service does (same config path logic, same `TDMCLAW_CONFIG_PATH` env var).
5. The CLI must not require root or any system-level privilege.
6. Error messages must be specific, actionable, and exit with a non-zero code on failure.

### 2.3 Non-Goals

1. A REPL or interactive shell mode.
2. Remote management (SSH, API, web UI).
3. Full database administration (schema migrations, raw SQL).
4. Log tailing (use `journalctl` or `tail`).
5. Google OAuth flows via CLI (those remain Telegram-only for v1).

---

## 3. Architecture Overview

### 3.1 Entry Point Dispatch

The `dist/index.js` binary is the single entry point for both the service and the CLI. Dispatch happens at the top of `src/index.ts` based on `process.argv`:

```
tdmclaw              → service mode (no args → same as "start")
tdmclaw start        → service mode (explicit)
tdmclaw <command>    → CLI mode (anything else)
```

```typescript
// src/index.ts
#!/usr/bin/env node

const subcommand = process.argv[2];

if (!subcommand || subcommand === "start") {
  // Service mode — existing bootstrap
  import("./app/bootstrap").then(({ bootstrap }) =>
    bootstrap().catch((err: unknown) => {
      console.error("Fatal error during startup:", err);
      process.exit(1);
    })
  );
} else {
  // CLI mode
  import("./cli/index").then(({ runCli }) => runCli());
}
```

This dispatch is purely positional — it does not use a flag parser — so the service mode is not sensitive to commander's option parsing.

### 3.2 CLI Runtime

The CLI runtime lives in `src/cli/`. It uses `commander` for command/option parsing. It does not import any service-layer modules (no `bootstrap`, `bot`, `scheduler`, `polling`, etc.). It shares only:

- `src/app/config.ts` — config loader
- `src/app/env.ts` — env resolution
- `src/storage/db.ts` — database open function
- Specific DAO modules accessed read-only

### 3.3 Shared Infrastructure

| Module | How the CLI uses it |
|--------|---------------------|
| `src/app/config.ts` | Locates and parses config.yaml; same path resolution as the service |
| `src/app/env.ts` | Reads `TDMCLAW_CONFIG_PATH` and `TDMCLAW_DATA_DIR` overrides |
| `src/storage/db.ts` | Opens SQLite (in `readonly` mode for query commands; WAL mode for write commands) |
| `src/storage/settings.ts` | Read/write active model selection |
| `src/storage/sessions.ts` | Read-only: list recent sessions |
| `src/storage/jobs.ts` | Read-only: list scheduled jobs |
| `src/storage/credentials.ts` | Read-only: check Google auth state |

---

## 4. Command Reference

### 4.1 Command Tree

```
tdmclaw [start]                   Start the service (default)

tdmclaw config get <key>          Print a config value
tdmclaw config set <key> <value>  Set a scalar config value
tdmclaw config list               Print all resolved config values

tdmclaw users list                List allowed Telegram user IDs
tdmclaw users add <id>            Add a Telegram user ID
tdmclaw users remove <id>         Remove a Telegram user ID

tdmclaw status                    Show service/system health summary

tdmclaw model get                 Show active model and fallback chain
tdmclaw model set <name>          Set the active model (writes to DB)

tdmclaw jobs list                 List scheduled jobs and last-run status
tdmclaw jobs run <name>           Manually trigger a job by name (Phase 4+)
```

### 4.2 `config get <key>`

Reads a value from config.yaml by dotted path.

```
$ tdmclaw config get telegram.botToken
env:TDMCLAW_TELEGRAM_BOT_TOKEN

$ tdmclaw config get models.baseUrl
http://127.0.0.1:11434

$ tdmclaw config get telegram.allowedUserIds
123456789
987654321
```

Array values are printed one entry per line. Scalar values are printed as-is. The raw YAML value is shown (not the resolved env substitution), because the purpose is config inspection, not secret exposure.

Options:
- `--json` — emit as JSON

### 4.3 `config set <key> <value>`

Sets a scalar config value in config.yaml.

```
$ tdmclaw config set models.baseUrl http://192.168.1.50:11434
Updated models.baseUrl → http://192.168.1.50:11434

$ tdmclaw config set app.logLevel debug
Updated app.logLevel → debug
```

Constraints:
- Only scalar string and numeric values may be set this way. Arrays must use `users add/remove` or be edited manually.
- The YAML file is rewritten with comments and structure preserved (see §6.2).
- A backup of the previous config is written to `config.yaml.bak` before any write.

### 4.4 `config list`

Prints all resolved config keys and their values in `key = value` format. Sensitive fields (botToken, apiKey) are partially redacted: `env:...` values show the env var name, bare secrets show `***`.

### 4.5 `users list`

Reads `telegram.allowedUserIds` from config.yaml and prints them, one per line.

```
$ tdmclaw users list
123456789
987654321
```

### 4.6 `users add <id>`

Appends a Telegram user ID to `telegram.allowedUserIds` in config.yaml if it is not already present.

```
$ tdmclaw users add 555000111
Added 555000111 to telegram.allowedUserIds.

$ tdmclaw users add 555000111
555000111 is already in telegram.allowedUserIds. No change.
```

The ID is validated as a non-empty string of digits before writing.

### 4.7 `users remove <id>`

Removes a Telegram user ID from `telegram.allowedUserIds` in config.yaml.

```
$ tdmclaw users remove 555000111
Removed 555000111 from telegram.allowedUserIds.

$ tdmclaw users remove 555000111
555000111 was not found in telegram.allowedUserIds. No change.
```

Attempting to remove the last user ID is blocked with an error:

```
$ tdmclaw users remove 123456789
Error: Cannot remove the last allowed user ID. Add another user first.
```

### 4.8 `status`

Prints a summary of system state. Does not require the service to be running. Reads from config.yaml and SQLite.

```
$ tdmclaw status
Config:       config/config.yaml
Data dir:     /home/user/.tdmclaw/data
Database:     tdmclaw.db (ok, 1.2 MB)
Active model: qwen2.5-coder-7b-instruct (from DB)
Fallbacks:    llama3.2
Google:       connected as user@gmail.com
Scheduler:    enabled, poll every 20s
Sessions:     3 total
Jobs:         2 scheduled (next: daily_briefing in 4h 12m)
```

If the database does not exist yet:

```
Database:     not found (run tdmclaw to initialize)
```

### 4.9 `model get`

Reads the active model and fallback chain from the `settings` table in SQLite.

```
$ tdmclaw model get
Active model: qwen2.5-coder-7b-instruct
Fallbacks:    llama3.2, mistral
```

Falls back to config values if the `settings` table has no entry.

### 4.10 `model set <name>`

Writes the active model to the `settings` table. The service picks up the change on its next model use (the in-memory `ModelDiscovery` is not updated — a service restart is needed to reflect discovery state, but the persisted selection is respected on startup).

```
$ tdmclaw model set llama3.2
Active model set to: llama3.2
Note: restart the service for the change to take effect immediately.
```

### 4.11 `jobs list`

Lists scheduled jobs from the `scheduled_jobs` table.

```
$ tdmclaw jobs list
NAME              ENABLED  SCHEDULE       LAST RUN              STATUS
daily_briefing    yes      0 7 * * *      2026-04-16 07:00:01   ok
email_digest      no       0 12 * * *     never                 -
```

### 4.12 `jobs run <name>` (Phase 4+)

Manually triggers a job by name. Requires the service to be stopped (or uses a separate lightweight job runner that does not conflict with a running instance). Implementation is deferred to after Phase 4 of the main plan.

---

## 5. Entry Dispatch Design

### 5.1 Argv Check

The dispatch in `src/index.ts` is intentionally simple. It reads `process.argv[2]` before any module is imported. This avoids initializing the heavy service stack for CLI commands.

```typescript
const subcommand = process.argv[2];
const isServiceMode = !subcommand || subcommand === "start" || subcommand === "--help" && process.argv.length === 3;
```

`--help` with no other argument shows the top-level dispatch hint:

```
Usage: tdmclaw [start]
       tdmclaw <command> [options]

Commands:
  start          Start the tdmclaw service (default)
  config         Manage configuration
  users          Manage allowed Telegram users
  status         Show system status
  model          View or change the active model
  jobs           View scheduled jobs

Run 'tdmclaw <command> --help' for command-specific help.
```

### 5.2 Dynamic Import

Both branches use dynamic `import()` so that only the relevant module tree is loaded. This avoids any accidental initialization side effects from service-layer modules being required at module-parse time.

---

## 6. Config Read/Write Design

### 6.1 Reading Config

The CLI uses the same config loader as the service (`src/app/config.ts`). However, for commands that display raw config values (not fully-resolved ones), the CLI reads the YAML file directly via the `yaml` package's `parseDocument()` API, which preserves comment positions and formatting metadata.

```typescript
import { parseDocument } from "yaml";

function readConfigDocument(configPath: string): Document {
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseDocument(raw);
}
```

### 6.2 Writing Config (Comment-Preserving)

When writing config changes, the CLI uses the `yaml` package's `Document` API to mutate a parsed document and serialize it back. This approach preserves comments, blank lines, and key ordering in the surrounding structure.

```typescript
import { parseDocument, stringify } from "yaml";

function setConfigValue(configPath: string, keyPath: string, value: string): void {
  const raw = fs.readFileSync(configPath, "utf-8");
  const doc = parseDocument(raw);
  const keys = keyPath.split(".");
  // Walk the key path and set the leaf value
  setNestedValue(doc, keys, value);
  fs.writeFileSync(configPath, doc.toString(), "utf-8");
}
```

The `yaml` package's `Document.setIn()` method handles nested key traversal and preserves the surrounding document structure. This is why `yaml` is used rather than serializing a plain JavaScript object back to YAML (which would destroy comments).

### 6.3 Backup Before Write

Any command that modifies config.yaml writes a backup first:

```typescript
function backupConfig(configPath: string): void {
  const backupPath = configPath + ".bak";
  fs.copyFileSync(configPath, backupPath);
}
```

The backup is a silent, unconditional copy. No rotation or cleanup is done in v1.

### 6.4 Array Mutation for `users add/remove`

`telegram.allowedUserIds` is a YAML sequence node. The CLI reads the sequence, modifies it in memory using the `yaml` `Document` API, and writes back.

```typescript
function addUserId(doc: Document, id: string): "added" | "duplicate" {
  const seq = doc.getIn(["telegram", "allowedUserIds"]);
  if (!(seq instanceof YAMLSeq)) throw new Error("allowedUserIds is not a sequence");
  const existing = seq.items.map((i: any) => String(i.value ?? i));
  if (existing.includes(id)) return "duplicate";
  seq.add(new Scalar(id));
  return "added";
}
```

---

## 7. Database Access Design

### 7.1 Open Mode

Query commands open the database in WAL read-only mode:

```typescript
import Database from "better-sqlite3";

function openReadOnly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}
```

Write commands (`model set`) open in WAL read-write mode, the same as the service.

### 7.2 Database Path Resolution

The database path is resolved the same way the service resolves it: from the `dataDir` field of the loaded config, combined with the hardcoded filename `tdmclaw.db`.

```typescript
function resolveDbPath(config: AppConfig): string {
  return path.join(config.app.dataDir, "tdmclaw.db");
}
```

### 7.3 Concurrency Safety

SQLite in WAL mode is safe for concurrent readers and a single writer. A read-only CLI command running concurrently with the service is safe. A write command (`model set`) acquires an exclusive write lock for a single `UPDATE` statement; this is a millisecond-level operation that does not conflict materially with the service.

### 7.4 Missing Database Handling

If the database file does not exist (service has never been started), commands that require it print a clear message and exit non-zero rather than crashing:

```
Error: Database not found at /home/user/.tdmclaw/data/tdmclaw.db.
       Start the service at least once to initialize it: tdmclaw
```

---

## 8. Output Formatting

### 8.1 Default (Human-Readable)

All commands default to plain-text output designed to be readable in a terminal. Tables use fixed-width columns with `\t` spacing or simple padding. No color is used by default (the Pi terminal environment may not support it).

### 8.2 `--json` Flag

All commands support `--json`, which emits a JSON object to stdout. This supports scripting and integration with other tools.

```
$ tdmclaw users list --json
["123456789","987654321"]

$ tdmclaw status --json
{
  "configPath": "config/config.yaml",
  "dataDir": "/home/user/.tdmclaw/data",
  "databaseOk": true,
  "databaseSizeBytes": 1258496,
  "activeModel": "qwen2.5-coder-7b-instruct",
  "fallbackModels": ["llama3.2"],
  "googleConnected": true,
  "googleEmail": "user@gmail.com",
  "schedulerEnabled": true,
  "sessionCount": 3,
  "jobCount": 2
}
```

### 8.3 Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (bad config, missing database, etc.) |
| 2 | Invalid arguments or usage error |
| 3 | No change was made (e.g., `users add` when ID already exists) — optional informational code |

---

## 9. Dependency: commander

`commander` is the CLI framework. It provides:
- Subcommand hierarchy (`config`, `users`, `model`, `jobs`)
- Option parsing (`--json`, `--config <path>`)
- Auto-generated `--help` output
- Version display (`--version`)

No other CLI framework is needed. `commander` is small, has no runtime dependencies, and is well-maintained.

Add to `package.json` dependencies:

```json
"commander": "^12.0.0"
```

No other new dependencies are required.

---

## 10. `--config` Global Option

All commands respect a `--config <path>` global option that overrides `TDMCLAW_CONFIG_PATH`:

```
$ tdmclaw --config /etc/tdmclaw/config.yaml users list
```

This is useful when the service is deployed to a non-default location.

---

## 11. Repository Layout

New files added by the CLI:

```text
src/
  index.ts              Updated — dispatch logic
  cli/
    index.ts            CLI entry, commander root setup
    context.ts          CliContext — loaded config + db handle
    output.ts           Formatters (table, json, key-value)
    commands/
      config.ts         config get / set / list
      users.ts          users list / add / remove
      status.ts         status
      model.ts          model get / set
      jobs.ts           jobs list / run
```

The CLI does not add any new storage modules. It reuses existing DAOs from `src/storage/`.

---

## 12. CLI Context

A `CliContext` object is constructed once at the start of any CLI command and passed to command handlers. It holds the loaded config and an open database handle (or null if the database doesn't exist yet).

```typescript
export type CliContext = {
  config: AppConfig;
  configPath: string;
  db: Database.Database | null;
  jsonMode: boolean;
};

export async function buildCliContext(opts: {
  configPath?: string;
  json?: boolean;
  requireDb?: boolean;
}): Promise<CliContext> {
  const configPath = opts.configPath ?? resolveConfigPath();
  const config = loadConfig(configPath);
  const dbPath = resolveDbPath(config);
  let db: Database.Database | null = null;

  if (fs.existsSync(dbPath)) {
    db = openReadOnly(dbPath);
  } else if (opts.requireDb) {
    die(`Database not found at ${dbPath}. Start the service at least once: tdmclaw`);
  }

  return { config, configPath, db, jsonMode: opts.json ?? false };
}
```

---

## 13. Security Design

### 13.1 Config File Permissions

The CLI reads and writes config.yaml, which may contain the Telegram bot token and other sensitive values. No additional permission check is imposed — the file system permissions on config.yaml (set during `install.sh`) are the access control mechanism.

### 13.2 No Secret Exposure in Output

`config get` and `config list` display the raw YAML value, not the resolved environment variable value. If the config contains `botToken: env:TDMCLAW_TELEGRAM_BOT_TOKEN`, the output shows `env:TDMCLAW_TELEGRAM_BOT_TOKEN`, not the token itself.

For bare string values (not using `env:` syntax), scalar tokens in `config list` are partially masked: any value in a field named `token`, `secret`, or `apiKey` is shown as `***`.

### 13.3 Database Write Safety

Write commands that update the database use single-statement transactions. The CLI never runs migrations or DDL statements. It only updates rows in well-known tables using existing DAO methods.

---

## 14. Error Handling

| Condition | Behavior |
|-----------|----------|
| config.yaml not found | Print the resolved path and exit 1 |
| config.yaml is invalid YAML | Show parse error, exit 1 |
| Database not found (query command) | Print message, exit 1 |
| Database not found (status command) | Show "not initialized" line, continue |
| Unknown `config get` key path | Exit 1 with list of top-level sections |
| `config set` on an array key | Exit 1 with instruction to use `users add/remove` |
| `users remove` on last user | Exit 1 with message |
| `model set` on non-existent model | Print a warning but still write (the service validates on use) |
| Write backup fails | Exit 1 before writing; do not partially update the config |

---

## 15. Testing Strategy

### 15.1 Unit Tests

| Module | Critical Test Cases |
|--------|---------------------|
| `config.ts` (CLI) | `config get` returns correct value for nested keys; array keys return one value per line; unknown keys return error |
| `config.ts` (CLI) | `config set` writes scalar; YAML round-trip preserves comment text |
| `users.ts` | `add` appends ID; `add` duplicate is idempotent; `remove` removes; `remove` last ID blocked |
| `output.ts` | `--json` mode produces valid JSON; table mode aligns columns |
| Entry dispatch | `argv[2] === undefined` routes to service; `argv[2] === "users"` routes to CLI; `argv[2] === "start"` routes to service |

### 15.2 Integration Tests

- Full round-trip: `users add`, `users list` shows added ID, `users remove`, `users list` no longer shows ID.
- `config set` followed by `config get` returns the new value from the written file.
- `status` with a pre-populated test database shows all expected fields.

### 15.3 Manual Smoke Tests

- Install to a fresh clone, run `tdmclaw users add 999` before starting the service, verify config.yaml contains the new ID.
- Run `tdmclaw status` before and after starting the service; both should succeed.
- Run `tdmclaw model set <name>` and verify the DB row is updated; verify the service reads the new model on next restart.

---

## 16. Open Questions

1. Should `jobs run` require the service to be stopped, or should it be safe to run concurrently? The safest v1 answer is to require the service to be stopped to avoid double-execution.
2. Should `config set` support boolean and numeric coercion, or always write strings? The YAML library can infer types from the value string (e.g., `"true"` → boolean, `"60"` → integer).
3. Should `tdmclaw` (no args) print a short help hint along with starting the service, or start silently? Silent is less surprising.
4. Should the `--config` global option also be readable from a `TDMCLAW_CONFIG_PATH` env var? Yes — same logic as the service.
