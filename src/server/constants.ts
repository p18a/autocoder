// ── Orchestrator tunables ───────────────────────────────────────────
// Centralised so every magic number is discoverable and easy to tweak.

/** How long a single task execution may run before being killed (10 min). */
export const TASK_TIMEOUT_MS = 10 * 60 * 1000;

/** Timeout for the Phase-2 structured-extraction Claude call. */
export const EXTRACTION_TIMEOUT_MS = 60_000;

/** Consecutive discovery failures before auto-continue pauses the project. */
export const MAX_DISCOVERY_FAILS = 3;

/** Delay between automatic discovery cycles (ms). */
export const AUTO_CONTINUE_DELAY_MS = 30_000;

/** Max issues enqueued from a single discovery task. */
export const MAX_DISCOVERY_ISSUES = 20;

/** Max characters stored per task-log entry (longer content is truncated). */
export const MAX_LOG_CONTENT_LENGTH = 10_000;

// ── WebSocket tunables ──────────────────────────────────────────────

/** Max inbound WebSocket message size in bytes (64 KB). */
export const WS_MAX_MESSAGE_SIZE = 64 * 1024;

/** Max messages a single client may send per sliding window. */
export const WS_RATE_LIMIT_MAX = 50;

/** Sliding window duration for rate limiting (ms). */
export const WS_RATE_LIMIT_WINDOW_MS = 1_000;

/** Claude CLI tools the orchestrator is allowed to invoke. */
export const ALLOWED_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(bun:*)", "Bash(git:*)", "Bash(bunx:*)"];

/** Environment variables forwarded to Claude subprocesses. */
export const ALLOWED_ENV_KEYS = [
	"PATH",
	"HOME",
	"USER",
	"LANG",
	"LC_ALL",
	"SHELL",
	"TERM",
	"TMPDIR",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_CACHE_HOME",
	"ANTHROPIC_API_KEY",
];
