# Collector + Dashboard — Build Plan (separate project)

This describes a new, separate repo/project — not part of `vantage`. It
consumes the published `vantage` packages (`@usevantage/core`, `@usevantage/tracker`,
`@usevantage/adapter-memory`, `@usevantage/adapter-redis`, `@usevantage/adapter-postgres`)
as npm dependencies, rather than containing any of that library code
itself. One webapp does both jobs: ingest (the "collector") and the
read-path UI (the "dashboard") — a single deployable process, not two.

---

## 0. Prerequisite: `StoreAdapter` has no read method yet

This is the one thing that has to happen in the **vantage repo**, not
here, before the dashboard can show real data.

`StoreAdapter` (as published) is write-only by design — Phase 1 deferred
read methods until a real read shape was known, to avoid forcing every
adapter to implement queries nothing called yet. That query shape is
this project. Before building dashboard views, go back to vantage and:

1. Add a minimal read method to `StoreAdapter`, e.g.:
   ```ts
   interface StoreAdapter {
     write(event: ScopedEvent): Promise<void>;
     query(sourceId: SourceId, options: QueryOptions): Promise<ScopedEvent[]>;
   }
   ```
   Shape `QueryOptions` around what the dashboard actually needs first
   (time range at minimum — `since`/`until` — before adding grouping/
   aggregation params), not around every chart imaginable.
2. Implement it in `adapter-memory`, `adapter-postgres` (straightforward
   — it already has `getEvents` as a test-only method; formalize it),
   and `adapter-redis` (N/A — adapter-redis is QueueAdapter-only, no
   change needed there).
3. Extend the shared `StoreAdapter` contract test suite with read-path
   assertions, so future adapters (and this one) can't silently break it.
4. Version-bump (`pnpm changeset` → `pnpm changeset version`) and
   republish per `PUBLISHING.md`-style commands.

Do **not** work around this by having this project query
adapter-postgres's Postgres database directly with raw SQL — that
reintroduces per-adapter dashboard code and defeats the reason
`StoreAdapter` exists as an abstraction in the first place.

---

## 1. Stack

**Next.js (App Router), TypeScript.** One process serves both the
ingest API route and the dashboard pages — matches "one webapp," and
API routes + server-rendered pages in a single framework means no
second server, no CORS setup between collector and dashboard, one
Dockerfile, one deploy.

---

## 2. Project structure

```
collector-dashboard/
├── app/
│   ├── api/
│   │   └── ingest/route.ts     # POST — wraps @usevantage/core's createHandler
│   ├── (dashboard)/
│   │   ├── page.tsx             # overview: pageviews over time
│   │   ├── pages/page.tsx       # top pages
│   │   └── referrers/page.tsx   # top referrers
│   └── layout.tsx
├── lib/
│   ├── adapters.ts              # picks queue/store adapter from env
│   ├── handler.ts               # singleton createHandler() + consume() wiring
│   └── auth.ts                  # resolveSourceId (static env var, see §4)
├── public/
│   └── tracker.js               # copied from @usevantage/tracker's dist/index.global.js at build time
├── Dockerfile
└── docker-compose.yml           # redis + postgres, for prod-parity local dev
```

---

## 3. Ingest route + the consume-loop lifecycle gotcha

`app/api/ingest/route.ts`:

```ts
import { createHandler } from "@usevantage/core";
import { getQueueAdapter, getStoreAdapter } from "@/lib/adapters";
import { resolveSourceId } from "@/lib/auth";
import { processEvent } from "@usevantage/core";

const queueAdapter = getQueueAdapter();
const storeAdapter = getStoreAdapter();
queueAdapter.consume((event) => processEvent(event, storeAdapter));

const handler = createHandler({ queueAdapter, resolveSourceId });

export async function POST(req: Request) {
  const url = new URL(req.url);
  const authKey = url.searchParams.get("key") ?? "";
  const body = await req.json().catch(() => null);
  const result = await handler.ingest({ authKey, body });
  return new Response(null, { status: result.status });
}
```

**Gotcha:** this module-level `queueAdapter.consume(...)` must run
exactly once per process. Next.js dev mode's module hot-reloading can
re-execute route modules; guard with a `globalThis`-cached singleton
(the same pattern used for a dev-mode Prisma client) so a `next dev`
edit doesn't register a second consumer and double-process events.
Verify this specifically before trusting local dev counts.

---

## 4. Auth key / source config (matches the Phase 4 default already chosen)

Static env vars for the first source — no source-management UI yet:

```
VANTAGE_SOURCE_KEY=<random-generated-key>
VANTAGE_SOURCE_ID=my-first-site
```

`lib/auth.ts`:
```ts
export function resolveSourceId(authKey: string): string | null {
  return authKey === process.env.VANTAGE_SOURCE_KEY ? (process.env.VANTAGE_SOURCE_ID ?? null) : null;
}
```

Multiple sources later (real "second source" onboarding) means this
function reading from a small sources table instead of env vars — a
config/data change, not an architecture change, per PLAN.md §3's
"retired: second source" note.

---

## 5. Adapter selection

`lib/adapters.ts` picks based on env, so dev needs zero infra and prod
uses the real ones:

```ts
import { MemoryQueueAdapter, MemoryStoreAdapter } from "@usevantage/adapter-memory";
import { RedisQueueAdapter } from "@usevantage/adapter-redis";
import { PostgresStoreAdapter } from "@usevantage/adapter-postgres";

export function getQueueAdapter() {
  return process.env.REDIS_URL
    ? new RedisQueueAdapter({ redis: process.env.REDIS_URL })
    : new MemoryQueueAdapter();
}

export function getStoreAdapter() {
  return process.env.DATABASE_URL
    ? new PostgresStoreAdapter({ connection: process.env.DATABASE_URL })
    : new MemoryStoreAdapter();
}
```

`MemoryQueueAdapter`/`MemoryStoreAdapter` in production would lose all
data on restart and can't be shared across instances — fine for local
dev, not for the real deploy. Don't let this default silently ship to
prod; check both env vars are set as part of deploy verification.

---

## 6. Tracker embedding

Copy `@usevantage/tracker`'s IIFE build into `public/` at build time (a
`postinstall` or prebuild script copying
`node_modules/@usevantage/tracker/dist/index.global.js` → `public/tracker.js`)
so a site owner embeds it as:

```html
<script src="https://your-collector.example/tracker.js"></script>
<script>
  Vantage.createTracker({ endpoint: "https://your-collector.example/api/ingest", authKey: "..." });
</script>
```

---

## 7. Dashboard views (blocked on §0)

Once `StoreAdapter.query()` exists: an overview page (pageviews per
day, via `query(sourceId, { since, until })` grouped client- or
server-side), top pages (group by `url`), top referrers (group by
`referrer`). Start with these three — PLAN.md's own bias against
building speculative surface applies here too: don't add funnels,
real-time views, or export before these three are real and correct.

---

## 8. Build order

1. Land the `StoreAdapter.query()` prerequisite in vantage (§0), publish.
2. Scaffold the Next.js app, wire the ingest route against
   `adapter-memory` only — prove POST → 202 → event queryable, locally,
   no Docker.
3. Add the singleton/hot-reload guard from §3, verify with a manual
   dev-mode edit that events aren't double-counted.
4. Swap in `adapter-redis`/`adapter-postgres` behind env vars, verify
   against `docker-compose up`.
5. Static auth (§4), tracker embedding (§6).
6. Dashboard pages (§7) — overview, top pages, top referrers, in that
   order.
7. Dockerfile + deploy to wherever this ends up hosted; issue a real
   `VANTAGE_SOURCE_KEY` for one real site, confirm live traffic lands in
   the dashboard.

Steps 2–3 don't need Docker or the prerequisite in §0 — you can start
there today against the packages already published.
