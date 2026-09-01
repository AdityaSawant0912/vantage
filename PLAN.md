# Vantage — Build Plan

This is a sequencing and structure plan, not an implementation spec. It's meant to hand to a Claude Code agent alongside your CLAUDE.md quality/docs-sync rules, so each phase has a clear "done" state before the next one starts.

**Scope note:** the deployed collector + dashboard app is now a separate
project, not part of this repo — see
[`COLLECTOR-DASHBOARD-PLAN.md`](./COLLECTOR-DASHBOARD-PLAN.md) for how it
consumes these packages. This repo is the library only: `packages/*`
(published independently to npm) plus `apps/docs` (their API reference,
generated from source).

---

## 1. Monorepo shape

Packages should mirror the diagram's boundary between "your library code" and "infra you deploy." That boundary is also the publish boundary — someone should be able to `npm install` only what they need.

```
vantage/
├── packages/
│   ├── core/                  # @usevantage/core — Handler, processEvent, adapter interfaces, event schema/validation
│   │                           # zero infra deps. This is the package whose public API must stay stable.
│   ├── tracker/                # client-side drop-in script (pageviews, custom events, batching/beacon)
│   ├── adapter-memory/         # in-process QueueAdapter + reference StoreAdapter — ships as the zero-infra default
│   ├── adapter-redis/          # QueueAdapter impl — separate package, only pulled in at scale
│   ├── adapter-postgres/       # StoreAdapter impl
│   └── config/                 # shared tsconfig, eslint, tsup/build config
├── apps/
│   └── docs/                     # astro + starlight, API reference generated from TSDoc
└── CLAUDE.md
```

**Why adapters are separate packages, not folders inside core:** this is likely the single biggest upgrade over Optimus — nobody installing `@usevantage/core` for a single-process deploy should pull in `ioredis` or `pg` as a dependency. Core stays dependency-light and its version number means something specific (interface stability), separate from adapter churn.

---

## 2. What "core" actually contains

Kept deliberately small — this is the surface you're committing to keep stable across every scale:

- **`Handler.ingest(req)`** — auth source key → validate event shape → `queueAdapter.push(event)` → respond. Stateless, safe to run N-wide behind a load balancer from day one.
- **`processEvent(event, storeAdapter)`** — enrichment, session stitching, writes. Runs identically whether it's called inline or from a worker loop.
- **`QueueAdapter` interface** — `push()` + a consume-side contract (adapter-owns-the-loop — locked, see §5).
- **`StoreAdapter` interface** — write surface, scoped by source. No read methods yet — the collector+dashboard project is what actually needs a read shape; see `COLLECTOR-DASHBOARD-PLAN.md` for that as a prerequisite task on this repo.
- **Event schema + validation** — shared by the tracker (what it's allowed to send) and Handler (what it accepts).
- **Source/tenant model** — how an auth key resolves to a `sourceId`, resolved once in Handler, before anything reaches an adapter.

Everything else (real queues, real databases, the deployed collector+dashboard app) is downstream of these contracts and shouldn't leak back into core's API.

---

## 3. Sequencing — each phase should be independently shippable

**Phase 0 — Scaffolding** ✅
Monorepo tooling (workspaces, shared tsconfig/eslint/build), CI skeleton, docs app wired to pull API reference from source comments. Done when `pnpm build` and `pnpm docs:dev` both work on an empty core package.

**Phase 1 — Contracts only** ✅
Event schema, `QueueAdapter`/`StoreAdapter` interfaces, source/tenant model — types and validation, no runtime wiring. All four decisions in §5 locked here.

**Phase 2 — Single-process path works end to end** ✅
`adapter-memory` implementing both interfaces + `Handler.ingest` + `processEvent` wired together in-process, proven via an integration test: POST an event in, see it land in the in-memory store.

**Phase 3 — Tracker** ✅
Client script: pageview capture, custom events, client-side batching, `sendBeacon`/fetch fallback, respects the event schema from Phase 1. Ships as both ESM and IIFE builds.

**Phase 6 — Real adapters** ✅
`adapter-redis` (QueueAdapter, real dockerized Redis), `adapter-postgres` (StoreAdapter, real dockerized Postgres), both run unchanged against the shared contract test suites from Phase 1/2 — including a tenant-isolation test (two `sourceId`s never cross-contaminate a `StoreAdapter`). This is the phase that validates the whole architecture: the interfaces didn't need to change to fit real adapters.

**Retired: collector app, dashboard, scale-out topology.** These were
originally Phases 4, 5, and 7 — a deployed collector, its read-path
dashboard, and multi-instance scale-out. They now live in a separate
project that imports these packages rather than living in this repo. See
`COLLECTOR-DASHBOARD-PLAN.md`.

**Retired: "second source" as a phase.** Originally Phase 8's point was
proving `StoreAdapter` tenant isolation under two real sources sharing one
collector fleet. The isolation guarantee itself is now validated here, in
this repo, as a permanent part of the shared `StoreAdapter` contract
suite (`packages/core/test/contracts/store-adapter.contract.ts`) — every
adapter (memory, Redis, Postgres) already proves it. Onboarding an actual
second real-world source is a config/onboarding task for the
collector+dashboard project, not library work.

---

## 4. Cross-cutting: adapter contract tests

One shared test suite against `QueueAdapter` and one against `StoreAdapter` (`packages/core/test/contracts/`), run against every implementation — memory, Redis, Postgres. This is what actually enforces "swap adapters without touching the library," rather than just hoping each adapter author reads the interface doc carefully. Any new adapter (including future community ones, if this goes that route) has a pass/fail bar instead of a code review judgment call.

---

## 5. Decisions locked in Phase 1

- **Consume-side shape**: adapter-owns-the-loop (`consume(handler)`), not caller-owned `poll()`. Every worker process, at every scale, is `queueAdapter.consume(event => processEvent(event, storeAdapter))`.
- **`push()` delivery guarantee**: propagates on failure — `push()` rejects if the event couldn't be durably enqueued, and `Handler.ingest` turns that into an error response. Fire-and-forget-with-logging was rejected because it would let `Handler`'s error handling fork depending on which adapter is wired in.
- **`sourceId` resolution**: happens once in `Handler`, from the auth key, before anything reaches an adapter. `StoreAdapter`/`QueueAdapter` implementations receive already-scoped events and are trusted to persist that scoping as-is.
- **Event schema versioning**: the schema carries a `v` field from day one (`EVENT_SCHEMA_VERSION`), since the tracker and any consumer of the collector can now be deployed and versioned independently.

---

## 6. Docs strategy (apps/docs)

This repo's docs are the adapter contract reference only — generated
from TSDoc comments via TypeDoc, tightly synced to the actual interface
types so it can't silently drift from core (`pnpm docs:build`/`docs:dev`).
The "self-host Vantage" deploy guide (collector + dashboard, no adapter
internals) belongs to the collector+dashboard project instead, since
that's the thing actually being deployed.

---

## 7. Event props & queue routing (added post-Phase 6)

`VantageEvent` gained an optional `props?: Record<string, string | number
| boolean | null>` field (`EventProps`) as its extension point for
app-defined custom fields (category, action, label, cookies, or anything
else a consumer wants). Two alternatives were considered and rejected:

- **TS module augmentation** (consumer declares
  `interface VantageEvent { category?: string }` in their own app) —
  rejected because the field would exist only in TypeScript's eyes, not at
  runtime: `validateEvent` wouldn't check it and `adapter-postgres`'s fixed
  columns wouldn't persist it. Breaks the "event schema is the single
  contract" rule in §9.
- **A generic `VantageEvent<TCustom>`** — rejected as more invasive for no
  real gain: it would thread a type parameter through `Handler`,
  `QueueAdapter`, `StoreAdapter`, and the tracker, and `validateEvent`
  still couldn't runtime-check an unknown `TCustom` shape.

`EVENT_SCHEMA_VERSION` was **not** bumped — `props` is optional and
additive, so a v1 event without it stays valid.

This also enables routing an event to a different queue by a `props`
value (e.g. `props.category`). Rather than changing `Handler` — which
still just calls `queueAdapter.push(event)` — routing is a composed
`QueueAdapter`: `createRoutingQueueAdapter` (`packages/core/src/queue-router.ts`)
fans out to other `QueueAdapter`s via a user-supplied `resolve(event)`
function, with `push()` following the same propagates-on-failure rule as
every other adapter (rejects if no match and no `default`). It lives in
`core`, not a new adapter package, since it's composed purely from the
`QueueAdapter` interface and adds no infra dependency.

---

## Resolved: what fell short with Optimus

Docs drift — Optimus's API docs were hand-maintained and updated after
the fact instead of staying in sync with the code. This repo's docs
pipeline (TypeDoc generation wired in from Phase 0) exists specifically
to make that failure mode structurally impossible: the generated pages
are build output, never hand-edited, and `pnpm docs:build` runs in CI on
every change to `packages/*`.
