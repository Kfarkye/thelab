# HANDOFF.md — Codex Transfer Packet

**Repo:** `https://github.com/Kfarkye/thelab.git`
**Branch:** `codex-handoff-v50`
**HEAD SHA:** `4a5cdc2`
**Working tree:** Clean (all changes committed + pushed)
**Live URL:** https://gemini3-chat-1049576459547.us-central1.run.app
**Cloud Run revision:** `gemini3-chat-00193-gn6` (serving 100%)
**Project:** `workflowos-a0fbf` / Region: `us-central1`
**Last deploy:** 2026-04-19T22:08 UTC (local Docker build + push to Artifact Registry)

---

## Objective

"The Lab" is a multi-mode AI chat console deployed on Google Cloud Run. It serves workspace modes (Healthcare, Sports, Code, World Cup, AyaOps), each with its own system prompt, Spanner data pipeline, and tool configuration. The product is a single-page Next.js 16 app backed by Google Spanner, Vertex AI (Gemini + Claude), Redis (pub/sub + streams), and real-time sports/prediction market data.

---

## ⚠ CRITICAL RULES — Read Before Touching Anything

### 1. Environment Contract — `src/lib/env.ts`
```
requireEnv(key)  → throws at boot if missing. NEVER wrap in try/catch.
optionalEnv(key) → for non-critical config only (heartbeat intervals, etc.)
```
All infrastructure identifiers (`GOOGLE_CLOUD_PROJECT`, `SPANNER_INSTANCE`) use `requireEnv()`. The Dockerfile injects `GOOGLE_CLOUD_PROJECT=workflowos-a0fbf` at build time for Next.js static page generation. **Do NOT add fallbacks like `|| "workflowos-a0fbf"` — the container must crash if env is wrong.**

### 2. Spanner Pool — `src/lib/spanner-pool.ts`
```ts
import { getDb } from '@/lib/spanner-pool';
const db = getDb('recruitingdb');
```
**ONE Spanner client per process.** Uses `globalThis` to survive Next.js Fast Refresh. **NEVER** call `new Spanner()` directly. **NEVER** call `.close()` on a db handle. Available databases: `recruitingdb`, `sportsdb`, `worldcupdb`, `licensingdb`, `credentialdb`.

### 3. Auth Gate — `src/lib/middleware/auth.ts`
```ts
const { user, response } = await requireAuth(request);
if (response) return response;
// user.uid is verified
```
Every mutation endpoint MUST call `requireAuth()`. Firebase Admin verifies ID tokens from `Authorization: Bearer <token>` or `session=<token>` cookie.

### 4. TypeScript Strictness
`tsconfig.json` has `"strict": true`. Spanner `db.run()` returns untyped rows. **Always type callback parameters explicitly:** `.map((row: any) => ...)`, `.runTransactionAsync(async (tx: any) => ...)`. Failure to do this blocks the build.

### 5. Build + Deploy Pipeline
```bash
# LOCAL Docker build → push → Cloud Run deploy
./deploy-gemini3-chat.sh
```
The deploy script does:
1. `docker build --no-cache --platform linux/amd64` (cross-compile for Cloud Run)
2. `docker push` to Artifact Registry
3. `gcloud run deploy gemini3-chat`

`.dockerignore` excludes `node_modules/`, `.next/`, `.git/`, `scripts/`, `*.md`. The container installs its own linux/amd64 deps.

### 6. Spanner Commit Timestamps
Use `Spanner.COMMIT_TIMESTAMP` (static property, NOT a function). The old `Spanner.commitTimestamp()` method does not exist in `@google-cloud/spanner ^8.6.0`.

### 7. KeySet Tuple Shape
`transaction.read()` requires `keys` as an array of arrays (KeySet tuples):
```ts
const keySet = threadIds.map(id => [id]);
const [rows] = await transaction.read('Threads', { keys: keySet, columns: ['thread_id'] });
```

---

## Architecture

### The Canonical UI Grounding Loop (Core Paradigm)
The system has abandoned complex custom RAG pipelines in favor of a strictly simple UI-driven grounding loop:
1. **Chat Writes**: The chat interface writes payload intents to Spanner.
2. **DB Renders**: Spanner triggers Next.js to render deterministic canonical URLs visually to the DOM.
3. **Agent Reads**: Autonomous browser agents (crawlers/extractors) read the URLs via the DOM accessibility tree (`.sr-only` map).
   - *Architecture Note (Dual-Purpose Sub-routing): Image structures natively double as command proxies. By injecting `.sr-only` nodes next to image objects, the agent interprets visible evidence as executable target URLs when commanded by the user (e.g. "Run a diagnosis on the first image").*
4. **AI Grounds**: Vertex AI Website Data Store natively crawls those URLs and implicitly grounds the chat model context.
5. **Agent Completes**: The browser agent saves task outcomes/evidence back to the Chat/DB.


```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts              ← Main chat (SSE streaming, function calling loop)
│   │   ├── summary/route.ts           ← Left panel data (1164 lines — sports, WC, healthcare, AyaOps)
│   │   ├── threads/ingest/route.ts    ← Thread ingest pipeline (auth-gated, batch Spanner writes)
│   │   ├── ayaops/jobs/               ← Job board query/attach/detach
│   │   ├── candidates/[id]/           ← Candidate lookup
│   │   ├── credentials/               ← Credential CRUD
│   │   ├── live/token/                ← Gemini Live WebSocket token
│   │   ├── live-emit/stream/          ← SSE stream (Redis-backed, Lua atomic publish)
│   │   ├── sandbox/commit/            ← Sandbox write-ahead preview
│   │   ├── sports-sync/               ← Sports data sync
│   │   ├── structured/                ← Structured output endpoint
│   │   └── users/sync/                ← Firebase user sync
│   ├── chat/page.tsx                  ← Main UI (monolith — needs decomposition)
│   ├── voice/page.tsx                 ← Voice mode (Gemini Live WebSocket)
│   └── globals.css                    ← All styles (~3600 lines)
├── lib/
│   ├── env.ts                         ← Strict env contract (fail-fast boot)
│   ├── spanner-pool.ts               ← Singleton gRPC connection pool
│   ├── spanner.ts                     ← Legacy Spanner connection (credentialdb only — DEPRECATED, use spanner-pool)
│   ├── middleware/auth.ts             ← Firebase Admin token verification
│   ├── ingest/
│   │   ├── schema.ts                  ← Zod payload validation (50-thread flood control)
│   │   └── matcher.ts                 ← Multi-signal candidate matcher (phone/name/location/facility scoring)
│   ├── router/model-router.ts         ← Auto-routing: mode → model+provider
│   ├── providers/claude.ts            ← Claude Vertex AI SDK wrapper
│   ├── spanner/tools.ts              ← AyaOps DB tool declarations + executors
│   ├── redis.ts                       ← Redis client + Lua atomic publisher
│   ├── live-emit/                     ← SSE push architecture (stream manager)
│   ├── ayaops/
│   │   ├── margin-ledger.ts           ← Margin/job-board billing engine
│   │   ├── offer-ledger.ts            ← Offer lifecycle management
│   │   └── ringcentral-ledger.ts      ← Call/SMS tracking
│   ├── licensing/
│   │   ├── fee-ledger.ts              ← Licensing fee tracking
│   │   ├── research-ledger.ts         ← State licensing research engine
│   │   └── chat-question-log.ts       ← Chat question audit log
│   ├── evidence/store.ts             ← Evidence document store
│   ├── agent/handoff-store.ts        ← Agent task handoff persistence
│   ├── wc/                            ← World Cup: simulator, brackets, TFI, standings
│   ├── formatters/                    ← Candidate context formatters
│   ├── mappers/                       ← Spanner row → typed record mappers
│   ├── normalize/                     ← Data normalization utilities
│   └── types/                         ← TypeScript types (CandidateRecord, etc.)
├── live-emit-ws/                      ← Standalone WebSocket server (separate deploy)
├── components/                        ← Shared React components
├── context/AuthContext.tsx            ← Firebase auth provider
└── hooks/                             ← Custom React hooks
```

---

## Spanner Databases

All on instance `game-data` in project `workflowos-a0fbf`:

| Database       | Purpose                                          | Accessor                   |
|----------------|--------------------------------------------------|----------------------------|
| `recruitingdb` | AyaOps: candidates, assignments, facilities, threads, match events | `getDb('recruitingdb')`    |
| `credentialdb` | Healthcare credentials                           | `getDb('credentialdb')`    |
| `sportsdb`     | Games, pitchers, markets, snapshots              | `getDb('sportsdb')`        |
| `worldcupdb`   | WC fixtures, teams, groups                       | `getDb('worldcupdb')`      |
| `licensingdb`  | Licenses, fees, research ledger                  | `getDb('licensingdb')`     |

### Key Tables (recruitingdb)
- `hc_candidates` — id, nova_id, first_name, last_name, specialty, profession, compliance_risk_level
- `hc_assignments` — candidate_id, status, start_date, end_date, weekly_gross, hourly_rate, facility_id
- `hc_facilities` — name, city, state, vms_platform, beds
- `Candidates` — candidate_id, full_name, normalized_phone, location, facility_name
- `CandidatePhoneAliases` — candidate_id, normalized_phone (composite PK)
- `Threads` — thread_id, match status/score/reason, lifecycle timestamps
- `ThreadCandidateMatchEvents` — immutable audit trail of match decisions

### Pending DDL (NOT YET APPLIED)
```bash
gcloud spanner databases ddl update recruitingdb --instance=game-data --ddl-file=scripts/ddl/threads-ingest.sql
gcloud spanner databases ddl update recruitingdb --instance=game-data --ddl-file=scripts/ddl/candidates-patch.sql
```

---

## Thread Ingest Pipeline (New — This Session)

### Flow
```
POST /api/threads/ingest (auth-gated)
  → Zod validates payload (max 50 threads)
  → Concurrent match resolution (outside transaction)
  → Batch-read existing thread IDs (KeySet tuples)
  → Atomic Spanner transaction: upsert Threads + insert audit events
```

### Matcher Scoring (`lib/ingest/matcher.ts`)
| Signal            | Points | Notes                                    |
|-------------------|--------|------------------------------------------|
| Phone exact       | +60    | Primary OR alias via CandidatePhoneAliases |
| Full name exact   | +30    | Case-insensitive                         |
| Last + first prefix | +20  | Last exact + first 3 chars match         |
| Last name only    | +10    |                                          |
| Location          | +5     | Contains match                           |
| Facility          | +2     | Contains match                           |

### Thresholds
| Score    | Status      | Action              |
|----------|-------------|----------------------|
| < 70     | `unmatched` | No auto-link         |
| 70–89    | `ambiguous` | Requires human review |
| ≥ 90     | `matched`   | Auto-link            |
| Tied top | `ambiguous` | Even if ≥ 90         |

---

## External Services

| Service              | Purpose                        | Auth                          |
|----------------------|--------------------------------|-------------------------------|
| Vertex AI (Gemini)   | Chat, vision, code execution   | Service account IAM           |
| Vertex AI (Claude)   | Sonnet/Opus reasoning          | Service account IAM (us-east5)|
| Google Search        | Grounding for sports/licensing | Built into Gemini tools       |
| Google Spanner       | All structured data            | Service account IAM           |
| Firebase Auth        | User authentication            | Client API key + Admin SDK    |
| Redis                | SSE pub/sub + stream replay    | REDIS_URL env var             |
| Kalshi API           | WC prediction markets          | Public (no auth)              |
| The Odds API         | Sports betting lines           | Pre-ingested to Spanner       |

---

## Commands

```bash
# Install
npm install --legacy-peer-deps

# Dev (needs GOOGLE_APPLICATION_CREDENTIALS or gcloud auth)
npm run dev

# Type check
npx tsc --noEmit

# Lint
npx eslint src/

# Build (production — requires GOOGLE_CLOUD_PROJECT env)
npm run build

# Test suite
npm run test:ci                         # tool-policy + state-normalization + live-emit
npm run test:publisher-invariant        # Redis atomic publisher
npm run test:candidate-identity         # Candidate identity smoke test

# Deploy (local Docker → Artifact Registry → Cloud Run)
./deploy-gemini3-chat.sh

# DDL scripts
npm run margin-ledger:ddl               # Margin tables
npm run offer-ledger:ddl                # Offer tables
npm run ringcentral-ledger:ddl          # RingCentral tables
npm run fee-ledger:ddl                  # Licensing fee tables
npm run research-ledger:ddl             # Research tables
npm run agent-handoff:ddl               # Agent handoff tables

# World Cup seed scripts
node wc-seed.js
node wc-seed-group-odds.js
node wc-ingest-kalshi.js
node wc-update-flags.js
```

---

## Uncommitted Changes (Must Commit Before Codex)

These files were modified/created in this session and are NOT yet committed:

### New Files
- `.dockerignore` — prevents 273MB node_modules from entering Docker context
- `deploy-gemini3-chat.sh` — full deploy script (build → push → deploy)
- `src/lib/env.ts` — strict environment contract
- `src/lib/spanner-pool.ts` — singleton Spanner connection pool
- `src/lib/middleware/auth.ts` — Firebase admin auth gate
- `src/lib/ingest/schema.ts` — Zod payload validation
- `src/lib/ingest/matcher.ts` — multi-signal candidate matcher
- `src/app/api/threads/ingest/route.ts` — batch thread ingest route
- `scripts/ddl/threads-ingest.sql` — DDL for Threads, audit events, phone aliases
- `scripts/ddl/candidates-patch.sql` — DDL patch for matcher indexes

### Modified Files (implicit-any fixes for build)
- `src/app/api/credentials/route.ts` — `(row)` → `(row: any)`, `(tx)` → `(tx: any)`
- `src/app/api/summary/route.ts` — 15 implicit-any annotations
- `src/app/api/users/sync/route.ts` — `(tx: any)`
- `src/lib/agent/handoff-store.ts` — `(tx: any)`
- `src/lib/ayaops/margin-ledger.ts` — 9 `(row: any)` / `(tx: any)`
- `src/lib/ayaops/offer-ledger.ts` — 7 `(row: any)`
- `src/lib/ayaops/ringcentral-ledger.ts` — `(tx: any)`
- `src/lib/evidence/store.ts` — 7 annotations
- `src/lib/licensing/chat-question-log.ts` — `(tx: any)`
- `src/lib/licensing/fee-ledger.ts` — 6 `(row: any)`
- `src/lib/licensing/research-ledger.ts` — `(tx: any)`
- `src/lib/spanner/tools.ts` — 10 annotations
- `Dockerfile` — added `ENV GOOGLE_CLOUD_PROJECT=workflowos-a0fbf` for build phase

### Scratch Files (safe to delete)
- `fix-implicit-any.js`, `fix-summary-any.js`, `fix-summary-any2.js`, `clean-bad-any.js` — one-shot fix scripts
- `tsc-errors.txt` — captured build errors

---

## Known Issues

| # | Severity | Issue | Location | Fix |
|---|----------|-------|----------|-----|
| 1 | **Build-blocking** | If you `new Spanner()` anywhere, it creates a leaked gRPC pool | Any new file | Always use `getDb()` from `spanner-pool.ts` |
| 2 | **Build-blocking** | Missing `(: any)` on Spanner `.map()` callbacks blocks `npm run build` | All `*.ts` files | Add explicit types: `(row: any)`, `(tx: any)` |
| 3 | **Visual** | CSS class collision between `gx-*` and `--card-*` systems | `globals.css` ~L876 vs ~L3244 | Consolidate or remove dead `gx-*` block |
| 4 | **Data** | PitcherBaseline season filter hardcoded to `2026` | `api/summary/route.ts` | Make dynamic from current date |
| 5 | **Functional** | Claude models hit quota limits frequently | `providers/claude.ts` | Silent fallback to Gemini Flash exists |
| 6 | **Infra** | Thread ingest DDL not yet applied to Spanner | `scripts/ddl/` | Run DDL commands above |
| 7 | **Dead code** | `INSTANCE_ID` constant in `matcher.ts` L4 | `lib/ingest/matcher.ts` | Remove |
| 8 | **Legacy** | `src/lib/spanner.ts` still used by some routes | Various | Migrate all callers to `spanner-pool.ts` |

---

## Top Tasks (Priority Order)

1. **Commit + push** all uncommitted changes to clean the working tree
2. **Apply DDL** — run `threads-ingest.sql` then `candidates-patch.sql` against recruitingdb
3. **Build the manual review UI** for threads with `status: ambiguous`
4. **Migrate legacy `spanner.ts` callers** to use `spanner-pool.ts`
5. **Decompose `page.tsx`** — extract `LeftPanel`, `GameCard`, `WorldCupAccordion`, `ChatMessages`
6. **Reconcile CSS** — remove dead `gx-*` block, consolidate under card geometry system
7. **AyaOps write tools** — `update_candidate_status`, `add_compliance_note` with scoped IAM
8. **Mobile breakpoints** — sweep stale responsive rules in `globals.css`

---

## Acceptance Criteria

- [ ] `npm run build` succeeds with zero errors
- [ ] `npm run test:ci` passes all test suites
- [ ] AyaOps candidate lookup works for all DB tools
- [ ] Thread ingest endpoint returns 200 for valid payloads, 400 for invalid
- [ ] No `new Spanner()` calls outside `spanner-pool.ts`
- [ ] Cloud Logging shows structured JSON for all errors
- [ ] No console errors in browser dev tools
