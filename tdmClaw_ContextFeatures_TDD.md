# tdmClaw Context Features Technical Design Document

## Document Metadata

- Project: tdmClaw
- Document Type: Technical Design Document — Personality, Skills, and Memories
- Version: 0.1
- Status: Draft
- Related Documents: `tdmClaw_TDD.md`, `tdmClaw_IP.md`, `tdmClaw_CLI_TDD.md`, `tdmClaw_ContextFeatures_IP.md`
- Target Runtime: Raspberry Pi / Node.js 22+
- Primary Language: TypeScript

---

## 1. Purpose

This document defines three post-v1 context features for tdmClaw:

1. configurable personality files in the workspace
2. reusable skills injected into the prompt when relevant
3. durable memories stored in SQLite and surfaced selectively

These features are intentionally smaller and more explicit than OpenClaw’s equivalents. They must preserve tdmClaw’s current design priorities: bounded prompt size, deterministic file layout, simple operational model, and minimal hidden behavior.

---

## 2. Design Goals

### 2.1 Functional Goals

1. Allow the owner to enable or disable personality, skills, and memories independently in `config.yaml`.
2. Seed default personality and skill templates during `install.sh` and bootstrap if they do not already exist.
3. Let the agent adopt a configurable personality and user profile without hardcoding that content into the repo.
4. Let the application inject only the skills relevant to the current user request.
5. Give the agent durable long-term memory using SQLite, with explicit creation/update/deletion tools instead of opaque background summarization.

### 2.2 Technical Goals

1. Keep context assembly deterministic and inspectable.
2. Avoid loading all skills or all memories into every prompt.
3. Use the existing workspace and SQLite infrastructure where possible.
4. Make feature state easy to manage later from the CLI.
5. Reuse existing bootstrap seeding patterns already used for jobs.

### 2.3 Non-Goals

1. Dynamic remote plugin loading.
2. Embeddings or vector search in v1 of memories.
3. Arbitrary skill package installation from the internet.
4. Fully autonomous skill creation without a reviewable file written to the workspace.

---

## 3. Architecture Overview

These features add a new prompt-context assembly layer between session/history loading and the final system prompt. At a high level:

```text
config + workspace files + SQLite memories
    -> context loaders
    -> prompt context assembler
    -> system prompt / injected context
    -> agent loop
```

New modules:

| Module | Responsibility |
|--------|----------------|
| `src/context/personality.ts` | Load `PERSONALITY.md` and `USER.md` when enabled |
| `src/context/skills.ts` | Discover workspace skills, parse metadata, match triggers, inject selected `SKILL.md` files |
| `src/context/memories.ts` | Query and format relevant memories for the current turn |
| `src/context/assembler.ts` | Build the final injected context block used by `buildSystemPrompt()` |
| `src/storage/memories.ts` | CRUD operations for memory records |
| `src/tools/memory-*.ts` | Model-callable memory tools |
| `src/workspace/seeding.ts` | Seed personality and skill templates into the workspace |

---

## 4. Configuration Model

The main config gains three new top-level sections:

```ts
personality: {
  enabled: boolean;
  dir: string;              // default "personality"
  personalityFile: string;  // default "PERSONALITY.md"
  userFile: string;         // default "USER.md"
}

skills: {
  enabled: boolean;
  dir: string;              // default "skills"
  maxInjectedSkills: number;    // default 2
  maxSkillChars: number;        // default 6000
}

memories: {
  enabled: boolean;
  maxInjectedMemories: number;  // default 8
  maxMemoryChars: number;       // default 4000
}
```

All paths are relative to `workspace.root`. This keeps the feature content portable with the rest of the workspace.

---

## 5. Personality

### 5.1 Workspace Layout

```text
<workspace>/personality/
  PERSONALITY.md
  USER.md
```

Both files are seeded from repo templates if missing. The bootstrap process must never overwrite user edits.

### 5.2 Prompt Behavior

When `personality.enabled = true`, the loader reads both files and injects them into a dedicated section of the system prompt:

```text
Personality:
<PERSONALITY.md contents>

User Profile:
<USER.md contents>
```

If one file is missing, the other may still be used. Missing files are non-fatal and should be logged at `warn` only if seeding failed.

---

## 6. Skills

### 6.1 Skill Format

Each skill lives under its own directory:

```text
<workspace>/skills/job_creation/SKILL.md
<workspace>/skills/skill_creation/SKILL.md
```

`SKILL.md` begins with YAML front matter:

```md
---
name: job_creation
description: Create a new scheduled job in jobs.json
triggers:
  - create scheduled job
  - add cron job
  - schedule a recurring task
requires:
  - current_jobs
  - scheduler_rules
tools:
  - read_file
  - write_file
---

Instruction body goes here.
```

### 6.2 Skill Selection

Skill injection is application-driven, not model-driven. For each turn:

1. scan the skill directory
2. parse front matter
3. score trigger phrases against the current user message
4. select up to `maxInjectedSkills`
5. load any declared `requires` providers
6. inject a compact skill block into the prompt

This keeps skill use deterministic and avoids asking the model to discover skills on its own.

### 6.3 `requires` Providers

`requires` values map to small context providers implemented in code. Initial built-ins:

- `current_jobs` -> compact summary of `jobs/jobs.json`
- `scheduler_rules` -> static guidance about job schema and scheduler expectations
- `job_schema` -> example JSON structure for a scheduled job
- `current_skills` -> list of installed skills

Unknown `requires` entries are ignored with a warning.

---

## 7. Memories

### 7.1 Data Model

Memories are stored in SQLite, not markdown files.

```ts
type MemoryRecord = {
  id: string;
  scope: "user" | "global";
  subject: string;
  content: string;
  tagsJson?: string;
  importance: number;   // 1-5
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}
```

### 7.2 Retrieval Model

v1 uses explicit, non-vector retrieval:

1. normalize the current user message into keywords
2. search `subject`, `content`, and tags with SQL `LIKE`
3. rank by match count, importance, and recency
4. inject up to `maxInjectedMemories`

### 7.3 Memory Mutation

The model manages memories through explicit tools:

- `memory_list`
- `memory_create`
- `memory_update`
- `memory_delete`

This is preferred over automatic extraction because it keeps behavior auditable and easier to debug. The system prompt should instruct the model to store durable user preferences, recurring facts, and long-lived project context, not ephemeral turn state.

---

## 8. Bootstrap and Install Seeding

Templates live in the repo:

```text
templates/personality/PERSONALITY.md
templates/personality/USER.md
templates/skills/job_creation/SKILL.md
templates/skills/skill_creation/SKILL.md
```

Both `install.sh` and `src/app/bootstrap.ts` call shared seeding helpers:

1. create `<workspace>/personality` and `<workspace>/skills`
2. copy template files only when missing
3. log what was created

This mirrors the existing jobs-file seeding approach.

---

## 9. Prompt Assembly Contract

The final system prompt becomes:

1. base runtime rules
2. personality block (optional)
3. relevant skills block (optional)
4. relevant memories block (optional)
5. tool list

Each block must be clearly delimited so the agent can tell which context came from configuration, which came from skills, and which came from memories.

---

## 10. Security and Failure Modes

1. Personality and skill files are trusted local content owned by the operator.
2. Memories may contain sensitive user data; they must never be dumped wholesale.
3. Missing template files should not prevent startup; the feature simply degrades.
4. Oversized personality or skill files must be truncated before prompt injection with an explicit notice.
5. Memory tools must validate input length and reject secret-like values when obvious (tokens, bearer headers, etc.).

---

## 11. Acceptance Criteria

Implementation is complete when all of the following are true:

1. A fresh install creates seeded personality and skill templates in the workspace.
2. Bootstrap recreates any missing default files without overwriting edited ones.
3. Enabling personality changes the injected system prompt using workspace files only.
4. A request such as "create a scheduled job" causes the relevant skill to be injected automatically.
5. The agent can create, list, update, and delete memories through SQLite-backed tools.
6. Memory retrieval stays bounded and does not inject unrelated records into every turn.
7. Disabling any of the three features removes its runtime effects without breaking the rest of the system.
