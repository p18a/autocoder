# Autocoder — Autonomous Coding Agent Orchestrator

## Overview

Autocoder is a local coding agent orchestrator that automates incremental codebase improvements. You point it at a project directory, and it runs a loop: **discover** (Claude analyzes the codebase for issues) → **execute** (Claude implements each fix) → repeat. A web dashboard provides full control and monitoring. An MCP server allows external agents to interact with the task queue.

## Core Loop

```
┌─────────────────────────────────────────────────────┐
│  1. DISCOVER (optional, per-project)                │
│     - Spawns Claude CLI against the project dir     │
│     - Analyzes codebase for bugs, quality issues,   │
│       missing error handling, perf, security, etc.  │
│     - Custom instructions can focus the analysis    │
│     - Creates tasks in the project's queue          │
├─────────────────────────────────────────────────────┤
│  2. EXECUTE (sequential per task)                   │
│     - Spawns Claude CLI with the task prompt        │
│     - Streams output to the dashboard in real time  │
│     - Marks task completed or failed                │
├─────────────────────────────────────────────────────┤
│  3. AUTO-CONTINUE (if enabled)                      │
│     - When queue empties, seeds a new discovery     │
│       task and re-enters the loop                   │
│     - Otherwise marks the project as stopped        │
└─────────────────────────────────────────────────────┘
```

## Architecture

### Server (Bun)

- **`Bun.serve()`** handles HTTP routes, WebSocket connections, and static file serving
- **SQLite (`bun:sqlite`)** for persistence — built into Bun, zero dependencies, single-file DB, perfect for local use
- **WebSockets** for real-time client ↔ server communication (preferred over SSE: bidirectional, native Bun support, simpler for push + request patterns)

### State Management — Server as Single Source of Truth

This is the most critical design decision. The rules:

1. **All state lives in SQLite.** Server reads from DB, never from in-memory caches that could drift.
2. **Mutations go through the server.** Client sends commands via WS → server writes to DB → server broadcasts the new state to all connected clients.
3. **Client hydrates on connect.** When a WS connection opens, the server sends the full current state snapshot. No stale state survives a reconnect.
4. **Incremental updates after hydration.** After the initial snapshot, the server pushes diffs (e.g., `task_updated`, `task_log`) so the client stays in sync without polling.
5. **Zustand stores are write-only from WS messages.** Components read from Zustand, but Zustand is only written to by the WS message handler — never directly by UI actions. UI actions send WS commands, which round-trip through the server.

This means: **refresh the page → WS reconnects → full state snapshot → UI is correct.** No local persistence needed. No sync bugs.

### Database Schema (SQLite)

```sql
projects (
  id          TEXT PRIMARY KEY,  -- ulid
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,     -- target codebase directory
  created_at  TEXT,
  updated_at  TEXT
)

tasks (
  id          TEXT PRIMARY KEY,  -- ulid
  project_id  TEXT REFERENCES projects(id),
  prompt      TEXT NOT NULL,     -- what Claude should do
  status      TEXT,              -- queued | running | completed | failed | cancelled
  created_at  TEXT,
  updated_at  TEXT
)

task_logs (
  id          TEXT PRIMARY KEY,  -- ulid
  task_id     TEXT REFERENCES tasks(id),
  content     TEXT,
  stream      TEXT,              -- stdout | stderr | system
  created_at  TEXT
)

config (
  key         TEXT PRIMARY KEY,  -- e.g. "started:<projectId>", "auto_continue:<projectId>"
  value       TEXT
)
```

### WebSocket Protocol

Messages are JSON with a `type` field:

**Client → Server (commands):**
- `{ type: "create_project", name, path }`
- `{ type: "delete_project", projectId }`
- `{ type: "add_task", projectId, prompt }`
- `{ type: "cancel_task", taskId }`
- `{ type: "remove_task", taskId }`
- `{ type: "get_task_logs", taskId }`
- `{ type: "set_config", key, value }`
- `{ type: "start_project", projectId, mode }` — mode is `"discover"` or `"execute"`
- `{ type: "stop_project", projectId }`

**Server → Client (events):**
- `{ type: "init", projects, tasks, config }` — full state on connect
- `{ type: "project_created", project }`
- `{ type: "project_deleted", projectId }`
- `{ type: "task_added", task }`
- `{ type: "task_updated", task }`
- `{ type: "task_removed", taskId }`
- `{ type: "task_log", log }` — streaming output line
- `{ type: "task_logs", taskId, logs }` — bulk logs for a task
- `{ type: "config_updated", config }`
- `{ type: "error", message }`

### Agent Integration

Agents are invoked via the **Claude CLI** (`claude -p --output-format stream-json --verbose --dangerously-skip-permissions --mcp-config <config>`), spawned as subprocesses with `Bun.spawn`. This uses the user's subscription account directly — no API key needed.

Each spawned Claude process is configured with `--mcp-config` pointing to a generated JSON file that registers the autocoder MCP server. This gives agents access to project management and journal tools during execution.

The streaming JSON output (JSONL) is parsed line-by-line:
- `content_block_start` with text → logged as stdout
- `content_block_start` with tool_use → logged as system message (tool name)
- `result` / `subtype: "result"` → captured as final output

**Discovery uses MCP-based task creation:**
- Discovery agents analyze the codebase and call `add_task` via MCP for each issue found
- The MCP `add_task` tool handles deduplication and per-cycle caps automatically
- After discovery completes, the orchestrator counts how many tasks were created by that cycle
- No post-processing or second Claude call needed — task creation happens during execution

Process management uses a `Map<projectId, Subprocess>` so `stopProject()` can `.kill()` the running Claude process immediately.

### MCP Server

Separate entry point (`src/mcp/server.ts`) — runs both standalone (stdio) and as a subprocess spawned for each Claude agent.

**Tools:**
- `list_projects` — list all projects
- `add_task` — create an execution task with title, prompt, origin tracking, dedup, and per-cycle caps
- `list_tasks` — list tasks for a project (filterable by status)
- `cancel_task` — cancel a queued or running task
- `read_journal` — read journal entries across all tiers
- `write_journal` — append a journal entry
- `search_journal` — search journal by content

The MCP server shares the same SQLite database as the main server. Tasks created via MCP are picked up by the queue processor on its next iteration.

### Frontend (React + Zustand + shadcn)

**Layout**: Full-width dashboard, no wasted horizontal space.

**Key views:**
- **Project list** — left sidebar. Create new projects, see which are started.
- **Project detail** — task queue with status badges, start/stop controls, auto-continue toggle.
- **Task log** — scrollable streaming output (fixed height, internal scroll).

**UI constraints:**
- All scrollable sections have fixed/max heights with `overflow-y: auto`
- No unbounded growing elements
- Responsive but optimized for wide screens (this is a dev tool)

### Directory Structure

```
src/
  server/         — Bun.serve entry, SQLite DB, WS handler, orchestrator
  shared/         — Types and Zod schemas shared between server & client
  client/
    stores/       — Zustand stores (connection, projects, tasks, config)
    components/   — Dashboard, project list/detail, task log
  mcp/            — MCP server (stub)
  components/ui/  — shadcn components
```

### Verification & Auto-Commit

Each execution task goes through a post-execution pipeline:

1. **Git checkpoint** — Before execution, the orchestrator saves the current HEAD SHA as a checkpoint for potential revert.

2. **Task execution** — Claude runs with the task prompt. The prompt is augmented with a conventional commit footer instruction, so Claude includes a `type(scope): description` summary.

3. **Verify command** (optional) — If `verify_command` is configured for the project (e.g. `bun check && bun test`), the orchestrator runs it after execution:
   - **Pass** → auto-commit and mark completed.
   - **Fail** → retry once: Claude gets the failure output and tries to fix. Verify runs again.
     - **Pass** → auto-commit and mark completed.
     - **Fail** → revert to checkpoint (git hard reset) and mark task failed.

4. **Auto-commit** — On success, changes are committed with a conventional commit message extracted from Claude's output (regex → Sonnet fallback → generic fallback). The commit author is `Autocoder <autocoder@localhost>`.

5. **No verify command** — If no verify command is set, auto-commit runs unconditionally after execution.

**Config keys** (stored in the `config` table as `<key>:<projectId>`):
- `timeout_minutes` — Minutes before killing a task (default `15`, `0` = no limit)
- `verify_command` — Shell command to run after each execution task (empty = disabled)
- `discovery_mode` — `"janitor"` (default) or `"autopilot"`
- `project_purpose` — Free-text description of what the project should become (autopilot mode)

Git operations use native `git` CLI via `src/server/git.ts`.

### Discovery Modes

**Janitor** (default): Asks "What's broken?" — finds bugs, security issues, code quality problems. Stateless, codebase-only analysis.

**Autopilot**: Asks "What should we build next?" — reads the project purpose doc, checks git history for recent work, then spawns two subagents in parallel: one for quality/improvements (3-5 fix tasks) and one for features (1-2 new feature tasks). The subagents run concurrently, each calling `add_task` via MCP for the issues they find.

The mode is read at discovery-seed time. Switching mid-cycle is safe — in-flight tasks complete, and the next discovery uses the new mode. If autopilot has no purpose doc, it falls back to janitor mode.

### Dev Journal

Agents have access to a per-project dev journal — a persistent notepad for recording decisions, discoveries, abandoned approaches, and multi-task plans. Unlike `git log` (which records what changed), the journal records **intent, reasoning, and failures** — things that have no trace in commits.

**MCP Tools** (available to Claude during both discovery and execution):
- `read_journal(projectId, limit?, tier?)` — read recent entries, optionally filtered by tier
- `write_journal(projectId, content)` — append a new entry
- `search_journal(projectId, query, limit?)` — search by content

**Three-tier compression** (system-driven, automatic):
1. **Recent** (full entries) — everything the agent writes lands here
2. **Summary** (compressed bullet points) — when recent exceeds 20 entries, the oldest 10 are compressed into concise summaries via a Claude call
3. **Historical** (key decisions only) — when summaries exceed 20, the oldest 10 are rolled up into a paragraph of architectural decisions and strategic context. Trivial details are dropped.

A hard cap (200 entries) acts as a safety net. Compression runs in the background after task completion.

**Prompt integration**: Discovery prompts (both janitor and autopilot) include journal context automatically. Execution tasks are told to write discoveries to the journal.

**What belongs in the journal**:
- Abandoned approaches and why
- Architectural constraints or gotchas
- Multi-step plans where only part is done
- Recurring patterns not documented elsewhere

**What does NOT belong**:
- Routine task completions (that's in git log)
- Implementation details (that's in the code)
- Restating the task prompt

## Non-Goals

- No CLI interface (dashboard only + MCP)
- No multi-user / auth (local tool)
- No remote/cloud deployment considerations
- No predefined task categories (prompt is flexible)
- No internationalization (English only is fine)
