# Skill: Expand Capabilities Review

Perform a comprehensive review of this project's architecture, implementation, and feature set, then propose concrete expansions that unlock more powerful autonomous agentic workflows.

## Step 1 — Audit current state

1. Read `IDEA.md`, `GUIDELINES.md`, and `CLAUDE.md` to understand the vision and constraints.
2. Scan the server orchestrator (`src/server/orchestrator/`), shared types/FSM (`src/shared/`), and MCP layer (`src/mcp/`) to map every implemented capability.
3. Identify which guidelines are fully implemented, partially implemented, or still aspirational.
4. Note any dead code, stubs, or TODO comments that signal planned-but-missing work.

## Step 2 — Evaluate autonomous workflow gaps

Identify the most impactful gaps between what the system can do today and what would make it a significantly more powerful autonomous agent. Think broadly — consider the full lifecycle from task discovery through execution, verification, and learning. Focus on gaps that, if filled, would unlock qualitatively new workflows rather than incremental improvements.

## Step 3 — Propose expansions

For each gap, produce a concrete proposal:

- **What**: One-sentence description of the feature.
- **Why**: What autonomous workflow it unlocks or improves.
- **How** (high-level): Key implementation touchpoints (DB schema changes, new orchestrator modules, UI additions, MCP tools).
- **Complexity**: Low / Medium / High.
- **Dependencies**: Other proposals this builds on, if any.

Rank proposals by impact-to-effort ratio (highest first).

## Step 4 — Output

Present findings as a structured report with these sections:

1. **Current Capability Summary** — What the system can do today, in bullet form.
2. **Gap Analysis Table** — Area | Current State | Gap | Severity.
3. **Ranked Proposals** — Ordered list with the fields from Step 3.
4. **Suggested Roadmap** — Group proposals into 3 phases: quick wins, core expansions, advanced capabilities.
5. **Update `IDEA.md`** — Append a "Future Directions" section reflecting the accepted proposals.

Keep the tone direct and actionable. Avoid vague suggestions — every proposal must be specific enough to become a task in this system's own queue.
