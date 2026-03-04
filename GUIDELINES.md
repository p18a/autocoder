1. Make the server the single source of truth, and persist every state transition before broadcasting it to clients.

2. Define explicit finite-state machines for `task` and `project` lifecycles, and reject illegal transitions at one central boundary.

3. Require idempotent commands (`start`, `stop`, `cancel`, `seed discovery`) and attach command IDs so retries cannot create duplicates.

4. Use explicit task metadata (`type=discovery|execution`, `originTaskId`) instead of inferring behavior from prompt text.

5. Add ack/error semantics for client commands: no silent drops, clear user-visible failure, and optional retry queue when disconnected.

6. Treat discovery as untrusted input: strict schema validation, minimum field constraints, dedupe, and caps on fan-out per cycle.

7. Add loop safety controls: backoff, max consecutive discovery failures, and circuit-breaker pause before auto-continue resumes.

8. Make cancellation and deletion semantics strict: running tasks must be canceled first; process teardown must be guaranteed and observable.

9. Build restart recovery as a first-class flow: reconcile stale `running` tasks, re-derive project state, and resume queue processing safely.

10. Test the failure paths as hard as the happy paths: disconnect/reconnect races, duplicate commands, partial outputs, crash recovery, and loop runaway scenarios.
