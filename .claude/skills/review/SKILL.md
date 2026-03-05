---
name: review
description: Run a comprehensive architecture and code quality review of the autocoder project. Use when the user asks for a code audit, quality review, or security review.
disable-model-invocation: true
user-invocable: true
argument-hint: [focus-area]
---

# Project Review

Run a thorough code quality, architecture, and security review of the autocoder project. Launch **four parallel research agents** covering the areas below, then compile findings into a single report.

If `$ARGUMENTS` specifies a focus area (e.g., "security", "websocket", "orchestrator"), narrow the review to that area. Otherwise, review all four areas.

## Agents to launch (in parallel)

### 1. Server Orchestrator & Process Management

- **FSM transitions**: illegal state transitions accepted, missing guards, stale `running` tasks after crash/restart
- **Queue processing**: race conditions in concurrent task pickup, queue starvation, backoff/retry logic gaps
- **Process lifecycle**: zombie Claude subprocesses after cancel/timeout, `.kill()` not awaited, PID reuse risks
- **Discovery pipeline**: unbounded fan-out (no cap on tasks per discovery cycle), missing schema validation on discovery output, duplicate task creation
- **Auto-continue loop**: runaway loops without backoff, max consecutive failure circuit breaker, loop safety controls from GUIDELINES.md
- **Restart recovery**: stale `running` tasks not reconciled on server start, orphan processes
- **Timeout handling**: timer cleanup on cancel, race between timeout and normal completion

Search in `src/server/orchestrator/`, `src/server/handlers/`, `src/shared/fsm.ts`, and `src/server/constants.ts`.

### 2. WebSocket Protocol & Data Integrity

- **Command handling**: missing validation on incoming client messages, commands accepted without ack/error response, silent drops
- **Idempotency**: duplicate command handling, missing `commandId` enforcement, retry safety
- **Reconnect correctness**: full state snapshot on reconnect, stale state after disconnect/reconnect races, message ordering guarantees
- **Broadcast consistency**: state persisted to SQLite before broadcasting to clients, race between DB write and WS push
- **Schema validation**: Zod schemas covering all message types, unvalidated fields passed through, type mismatches between server and client
- **Error semantics**: error messages leaking internal details, missing error responses for invalid commands, error propagation from orchestrator to client

Search in `src/server/ws.ts`, `src/server/handlers/`, `src/shared/schema.ts`, `src/shared/types.ts`, and `src/client/stores/`.

### 3. React, Zustand & Frontend Patterns

- **Zustand stores**: selector patterns, `useShallow` usage, stale closure risks, race conditions in async actions, stores written to outside WS message handler (violates IDEA.md rule)
- **Hooks**: missing/incorrect dependency arrays in `useEffect`/`useCallback`/`useMemo`, missing cleanup (AbortController, timers, subscriptions, WS listeners), error state exposure (`string | null` convention)
- **Components**: files over 300 lines, missing loading/error/empty states, accessibility gaps, prop drilling where stores should be used
- **Streaming output**: TaskLog scroll behavior, memory growth from unbounded log accumulation, performance with large log volumes
- **Routing**: TanStack Router usage, missing error boundaries, route-level data loading

Search in `src/client/`, `src/components/ui/`, and `src/index.css`.

### 4. Security, Git Operations & System Safety

- **Command injection**: user-provided `path` or `prompt` values reaching `Bun.spawn` or shell execution unsanitized
- **Path traversal**: project `path` validation — can a user point to `/etc` or `~/.ssh`? Directory existence checks?
- **Git operations**: `isomorphic-git` error handling, hard reset safety (uncommitted work lost), checkpoint/revert atomicity, commit message injection
- **Subprocess security**: `--dangerously-skip-permissions` flag implications, Claude CLI spawned with full filesystem access
- **SQLite safety**: SQL injection via string interpolation (vs parameterized queries), DB file permissions, WAL mode locking
- **MCP server**: authentication/authorization on MCP tools, input validation, access control for task creation
- **Verify command**: shell injection via user-configured `verify_command`, timeout enforcement, resource exhaustion

Search across the entire `src/` directory, plus `CLAUDE.md`, `GUIDELINES.md`, and `build.ts`.

## Output format

After all agents complete, produce a single report organized by severity:

### Severity levels
- **Critical**: Security vulnerabilities, data loss risks, subprocess safety issues, command injection
- **High**: State corruption, race conditions, crash recovery failures, missing error handling that causes data loss
- **Medium**: Code quality violations, silent error swallowing, GUIDELINES.md violations, missing validation
- **Low**: Style inconsistencies, minor cleanup opportunities, test coverage gaps

### Report structure

For each finding, include:
1. **Title** - one-line description
2. **Severity** - Critical / High / Medium / Low
3. **File** - exact path and line number(s)
4. **Problem** - what's wrong, with a code snippet
5. **Recommendation** - how to fix it

End with a summary table:

```
| Category                    | Rating | Key Issues |
|-----------------------------|--------|------------|
| Orchestrator & Processes    | ...    | ...        |
| WebSocket & Data Integrity  | ...    | ...        |
| React & Frontend            | ...    | ...        |
| Security & System Safety    | ...    | ...        |
```

Also note areas that are well-implemented - the report should acknowledge strengths, not just weaknesses.

### GUIDELINES.md compliance

Cross-reference each of the 10 guidelines in `GUIDELINES.md` and note which are fully implemented, partially implemented, or missing. Flag any violations found during the review.
