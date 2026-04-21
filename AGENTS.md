<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# The Lab — Agent Operating Manual

## ⛔ HARD RULES (Violation = Build Failure)

1. **NEVER `new Spanner()`** — Use `getDb('dbname')` from `src/lib/spanner-pool.ts`. One gRPC pool per process.
2. **NEVER `process.env.X || "fallback"` for infra vars** — Use `requireEnv()` from `src/lib/env.ts`. Container must crash on missing env.
3. **ALWAYS type Spanner callbacks** — `.map((row: any) => ...)`, `.runTransactionAsync(async (tx: any) => ...)`. `strict: true` in tsconfig will reject implicit any.
4. **ALWAYS `requireAuth(req)` on mutation endpoints** — See pattern in `src/lib/middleware/auth.ts`.
5. **Use `Spanner.COMMIT_TIMESTAMP`** (static property) — NOT `Spanner.commitTimestamp()` (doesn't exist in ^8.6.0).
6. **KeySet tuples for transaction.read()** — `keys: ids.map(id => [id])`, NOT `keys: ids`.

## Build + Deploy

```bash
npm install --legacy-peer-deps   # Required due to peer dep conflicts
npm run build                    # Needs ENV GOOGLE_CLOUD_PROJECT
npm run test:ci                  # tool-policy + state-normalization + live-emit
./deploy-gemini3-chat.sh         # Local Docker → Artifact Registry → Cloud Run
```

## Spanner Databases (instance: game-data)

| Database       | Use `getDb('...')`  |
|----------------|---------------------|
| recruitingdb   | AyaOps candidates, threads, match events |
| sportsdb       | Games, pitchers, odds |
| worldcupdb     | WC fixtures, teams |
| licensingdb    | Licenses, fees, research |
| credentialdb   | Healthcare credentials |

## Test Before Committing

```bash
npx tsc --noEmit            # Must pass — no implicit any
npm run test:ci             # Must pass
npm run build               # Must succeed (sets GOOGLE_CLOUD_PROJECT in Dockerfile)
```

## Key File Locations

- Entry point: `src/app/chat/page.tsx`
- Chat API: `src/app/api/chat/route.ts`
- Summary API: `src/app/api/summary/route.ts`
- Thread Ingest: `src/app/api/threads/ingest/route.ts`
- DB tools: `src/lib/spanner/tools.ts`
- Matcher: `src/lib/ingest/matcher.ts`
- Auth: `src/lib/middleware/auth.ts`
- Env: `src/lib/env.ts`
- Pool: `src/lib/spanner-pool.ts`
- Styles: `src/app/globals.css`

## Full Context

Read `HANDOFF.md` for complete architecture, uncommitted changes, DDL status, and prioritized task list.
