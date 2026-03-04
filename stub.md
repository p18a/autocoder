# Auth token endpoint has no authentication
In `src/server/index.ts`, the `/api/token` endpoint returns the WebSocket auth token without any authentication. Add a security mechanism so that only the legitimate frontend client can obtain the token. Consider embedding the token in the served HTML page instead of exposing it via an unauthenticated API endpoint, or use a one-time-use token exchange pattern.
---
# WebSocket token passed in URL query string
In `src/client/stores/connection.ts`, the WebSocket auth token is passed as a URL query parameter (`?token=...`). Move the token to the first WebSocket message after connection (a handshake message), or use the `Sec-WebSocket-Protocol` header to pass it during the upgrade request, so it doesn't appear in URLs.
---
# No commandId on client-sent messages
Add `commandId` generation to all client-sent WebSocket messages. In the stores (`tasks.ts`, `sessions.ts`, `config.ts`), generate a unique `commandId` (e.g., `crypto.randomUUID()`) for every `send()` call. Track pending commands so ack/error responses can be correlated.
---
# Connection store has no error state
Add an `error: string | null` field to the `ConnectionState` interface in `src/client/stores/connection.ts`. Set it on token fetch failure, WebSocket parse errors, and clear it on successful connection. Display this error state in the root layout or via a persistent banner so users know when connection is failing.
---
# Type assertions in database row mappers
Refactor the database row mappers in `src/server/db.ts` to eliminate `as` type assertions. Use Zod schemas from `src/shared/schema.ts` to validate and parse database rows, or type the prepared statements with Bun's SQLite generic parameter and use proper runtime type checking.
---
# No React ErrorBoundary
Add a React ErrorBoundary component to `src/client/routes/__root.tsx` wrapping the `<Outlet />`. Create a simple fallback UI that shows the error message and a "Reload" button.
---
# Debounce timer in ControlsCard leaks on unmount
In `src/client/components/ProjectDetail.tsx`, add a cleanup effect to the `ControlsCard` component that clears `debounceRef.current` on unmount. Add a `useEffect` with a cleanup function.
