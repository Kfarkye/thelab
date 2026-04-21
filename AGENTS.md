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

---

## 🌐 URL HUB ARCHITECTURE — The Core Paradigm

### ⛔ HARD RULES (Architecture Violation = Rejection)

7. **NEVER build database-query tools that bypass the URL Hub.** All entity resolution (candidates, templates, facilities, jobs) MUST go through `access_hub`. Do NOT create tools like `get_candidate_by_name`, `search_candidates`, `find_template` — the Hub handles all resolution.
8. **NEVER pre-load entity lists into the system prompt or context.** The AI discovers entities on-demand via the Hub. Do NOT inject candidate names, template IDs, or facility lists into prompts.
9. **NEVER hardcode entity IDs in tool calls.** The AI MUST resolve IDs via `access_hub` first, then pass discovered IDs to execution tools.
10. **ALL resolved resources MUST return canonical URLs.** Every candidate returns a Nova URL. Every facility returns a facility URL. The URL is the product — the data is secondary.

### What is the URL Hub?

The Lab is a **Headless Operating System** where the AI is the System Router. The AI navigates a RESTful Knowledge Graph via one tool (`access_hub`). It does NOT query databases directly.

**Five consumers of every Hub URL:**

| # | Consumer | What it needs from the URL |
|---|---|---|
| 1 | **LLM** (chat route) | JSON identity block for grounding |
| 2 | **Browser Agent** (Google) | Clickable Nova/external URL to navigate |
| 3 | **Human** (recruiter/user) | Rendered link in UI |
| 4 | **Public** (sports/external) | SEO-accessible, shareable data |
| 5 | **Other Bots** (scrapers/APIs) | Machine-readable structured data |

For AyaOps: consumers 1–3 (private data).  
For Sports: all 5 (public surface).

### The Tool: `access_hub`

There is ONE discovery tool. It resolves any entity in the system.

```typescript
access_hub: {
  name: "access_hub",
  description: "Access the Data Hub to resolve any entity — candidates, templates, facilities, jobs. Returns identity block + canonical URLs + available actions.",
  parameters: z.object({
    path: z.string().describe("Hub path, e.g. 'candidates/Fontaine' or 'templates/initial-outreach'")
  })
}
```

**Path format:** `{entity}/{identifier}` — the identifier can be a name, ID, or search term.

**Server-side normalization handles:**
- `candidate/fontaine` → `candidates/fontaine` (plural normalization)
- `Fontaine` vs `fontaine` (case normalization)
- UUID vs name vs Nova ID (polymorphic resolution)

### The Response: Identity Block + HATEOAS Links

Every `access_hub` call returns:

```json
{
  "type": "candidate",
  "id": "uuid-889",
  "summary": "Fontaine Joseph | RN | Status: Submitted | Chicago, IL",
  "novaUrl": "https://nova.ayahealthcare.com/#/recruiting/candidates/503755/new-profile/about",
  "data": { /* full structured fields */ },
  "links": {
    "self": "/api/hub/candidates/uuid-889",
    "notes": "/api/hub/candidates/uuid-889/notes",
    "actions": {
      "email": "Use prepare_email_draft with candidate_id=uuid-889",
      "submit": "Use submit_candidate with candidate_id=uuid-889"
    }
  }
}
```

**The `links.actions` field tells the AI what execution tools to use and what parameters to pass.** Discovery is URL-based. Execution uses typed tools for safety.

### The Flow: How the AI Operates

```
User: "Send the intro to Fontaine"

Step 1 — DISCOVER:
  AI calls: access_hub({ path: "candidates/Fontaine" })
  Hub returns: { id: "uuid-889", novaUrl: "...", links: { actions: { email: "prepare_email_draft with candidate_id=uuid-889" } } }

Step 2 — DISCOVER:
  AI calls: access_hub({ path: "templates/initial-outreach" })
  Hub returns: { id: "initial_outreach", ... }

Step 3 — EXECUTE:
  AI calls: prepare_email_draft({ candidate_id: "uuid-889", template_id: "initial_outreach" })
  Result: Draft rendered, UI shows it.
```

### File Locations (URL Hub)

```
src/lib/resolver/
├── index.ts                  ← Core resolve(entity, identifier) router
├── candidate-resolver.ts     ← Spanner fuzzy match + identity block builder
├── template-resolver.ts      ← Template catalog search
├── facility-resolver.ts      ← Facility resolution
└── links.ts                  ← HATEOAS link generator

src/app/api/hub/
└── route.ts                  ← POST endpoint backing access_hub tool
```

### Why URLs?

The Google Browser Agent (commercial) navigates by clicking links. It treats The Lab and Nova as one continuous surface. When the Hub returns a Nova URL, the browser agent clicks it and reads the live page. **The URL is the bridge between your app and every external system.** This is not a database wrapper — it is the operating system's address space.

---

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
- **Hub API: `src/app/api/hub/route.ts`**
- **Resolver: `src/lib/resolver/index.ts`**
- **Template Catalog: `src/lib/ayaops/template-catalog.ts`**

## Full Context

Read `HANDOFF.md` for complete architecture, uncommitted changes, DDL status, and prioritized task list.

