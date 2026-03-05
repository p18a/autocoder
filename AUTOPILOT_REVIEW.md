# Autopilot Feature Review — Findings & Improvement Ideas

Captured 2026-03-06. See also: IDEA.md for architecture context.

## Robustness Improvements (not yet implemented)

### High Priority
- **Verify command timeout**: `runVerifyCommand()` (process.ts:46-80) has no timeout. A hanging test suite blocks the queue indefinitely. Add a timeout (e.g., 5 min).
- **Exponential backoff**: queue.ts:87 always uses fixed 30s `AUTO_CONTINUE_DELAY_MS`. Should scale with `failStreak`: `delay = BASE * 2^failStreak`, capped at 10 min.
- **Crash recovery — revert checkpoint**: `recoverStaleTasks()` (project.ts:16-46) marks crashed tasks as `failed` but doesn't revert to git checkpoint. Partial uncommitted changes remain in repo.
- **Process kill escalation**: `proc.kill()` sends SIGTERM with no verification. Should await `proc.exited` with short timeout, then escalate to SIGKILL.

### Medium Priority
- **Per-project auto-continue check**: queue.ts:96-100 checks global `getQueuedTasks()` instead of per-project. A task enqueued in Project B skips discovery for idle Project A.
- **Timeout config validation**: `Number("invalid")` returns `NaN`, `NaN > 0` is false, so `timeoutMs = 0` (no timeout). Validate at config-set boundary.
- **Semantic deduplication**: `dedupeIssues()` (discovery.ts:137-149) compares exact prompts. Semantically identical tasks with different wording pass through. Consider including existing task titles in discovery prompt so Claude avoids them naturally.

### Low Priority
- **Discovery field validation**: Add minimum length checks (title >= 5 chars, prompt >= 20 chars) in `enqueueDiscoveryIssues()`.
- **Error messaging for remove_task**: handlers/task.ts:44-55 silently fails if task is running. Send explicit error message.

## Creativity Improvements (not yet implemented)

- **Custom instructions in autopilot mode**: `buildAutopilotPrompt()` (discovery.ts:65-74) doesn't incorporate `custom_instructions`, only `project_purpose`. Should merge both.
- **Task priority/ordering**: Tasks execute in creation order. Add a `priority` field; have autopilot output explicit ordering rationale. Queue sorts by priority within a project.
- **Architecture context in discovery**: Before discovery, run a lightweight analysis (file tree, package.json scripts, key entry points) and inject into discovery prompt. Focuses Claude on high-impact areas.

## Long-Term Vision (not yet implemented)

- **Quality feedback loop**: Track verification pass/fail rates by discovery category. Adjust prompt strategy for categories that consistently fail.
- **Per-project tool allowlist**: `ALLOWED_TOOLS` (constants.ts:37) is global. Some projects may need `Bash(docker:*)` or `Bash(cargo:*)`. Make per-project config.
- **Multi-project awareness**: Allow "project groups" for monorepos where discovery can span related projects.
- **MCP server completion**: The stub MCP server would allow external agents to feed tasks into the queue.

## Testing Gaps

- No integration test for auto-continue loop
- No test for circuit breaker triggering (discovery failure streak)
- No test for interruptible sleep (wake-up on new task)
- No test for crash recovery (recoverStaleTasks scenarios)
- No test for task timeout handling
- No test for verify command failure + retry cycle
