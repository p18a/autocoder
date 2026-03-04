Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Standard check - always run these after changes

- Use `bun check` to run Biome linter & formatter. Don't use ESLint or Prettier.
- Use `bun typecheck` to check for TS issues.

**NOTE**: when fixing issues, never use "as" type casting, and prefer to avoid suppression comments. Strive for real fixes & type guards.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile.
- Bun.$`ls` instead of execa.

## Hooks

- All data-fetching hooks must expose an `error` state — never silently swallow fetch
  errors.
- Error state type is `string | null`. Don't use `Error | null` — UI components display
  error strings directly.

## Frontend

- TypeScript strict mode is enabled. Don't use `as any` or unvalidated type assertions.
  Use zod for type guards.

## UI Components

ALWAYS use shadcn components when applicable.
Add new components with: `bunx --bun shadcn@latest add <component>`.

## State Management

Use Zustand for client-side state management. Don't use React Context for shared state —
it causes unnecessary re-renders across all consumers when any slice changes. Define
stores with typed selector hooks and use `useShallow` so components subscribe only to the
slices they read. Prefer reading from store hooks directly in the consuming component over
prop drilling.

## Testing

Always add tests for new or changed components, hooks, and utilities. Place test files
next to the source file (`Foo.test.tsx` beside `Foo.tsx`). Use `bun:test` — don't use Jest
or Vitest.

Write tests that cover **behavior a user or caller cares about**, not implementation
details:

- Test user-visible outcomes: what renders given certain props/state, what happens on
  click/submit, correct error/empty/loading states.
- Test hooks and utilities by their return values and side effects, not by asserting
  internal state.
- Don't test that a CSS class is present, that a sub-component rendered by name, or that
  an internal function was called — these break on any refactor without catching real bugs.
- One test per meaningful behavior. Prefer a few focused tests over many trivial ones.

## Code Style

- Keep components under ~300 lines. Extract focused sub-components with explicit prop
  interfaces so page files read as high-level orchestration, not inline implementation.
- Do not create barrel files (`index.ts` that re-exports from sibling modules). Import
  directly from the source file. Barrel files hurt bundler and runtime performance.
- ALWAYS use localized strings (`useTranslation` / `t(...)`) instead of hardcoded English
  text in user-facing components.
- Use sentence case for button labels (e.g. "Add to cart", not "Add to Cart").
- Use explicit verbs in buttons instead of icons alone (e.g. "Add new item" instead of "+
  New Item").
- ALWAYS use semantic color variables instead of direct Tailwind palette tokens. Use
  `text-foreground`, `bg-background`, `text-muted-foreground`, `text-destructive`,
  `text-primary`, etc. Never use raw palette tokens like `text-stone-800`, `bg-gray-50`,
  `text-red-600`

---

@GUIDELINES.md

Always update IDEA.md if applicable.
