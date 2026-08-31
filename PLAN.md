# Vantage — Build Plan

This is a sequencing and structure plan, not an implementation spec. It's meant to hand to a Claude Code agent alongside your CLAUDE.md quality/docs-sync rules, so each phase has a clear "done" state before the next one starts.

---

## 1. Monorepo shape

Packages should mirror the diagram's boundary between "your library code" and "infra you deploy." That boundary is also the publish boundary — someone should be able to `npm install` only what they need.

```
vantage/
├── packages/
│   ├── core/                  # usevantage — Handler, processEvent, adapter interfaces, event schema/validation
│   │                           # zero infra deps. This is the package whose public API must stay stable.
│   ├── tracker/                # client-side drop-in script (pageviews, custom events, batching/beacon)
│   ├── adapter-memory/         # in-process QueueAdapter + reference StoreAdapter (sqlite or in-memory) — ships as the zero-infra default
│   ├── adapter-redis/          # QueueAdapter impl — separate package, only pulled in at scale
│   ├── adapter-postgres/       # StoreAdapter impl
│   └── config/                 # shared tsconfig, eslint, tsup/build config
├── apps/
│   ├── collector/               # deployed service — imports core + whichever adapters are wired in
│   ├── dashboard/                # read path, per-source scoped
│   └── docs/                     # existing astro app
└── CLAUDE.md
```

**Why adapters are separate packages, not folders inside core:** this is likely the single biggest upgrade over Optimus — nobody installing `usevantage` for a single-process deploy should pull in `ioredis` or `pg` as a dependency. Core stays dependency-light and its version number means something specific (interface stability), separate from adapter churn.

---

## 2. What "core" actually contains

Kept deliberately small — this is the surface you're committing to keep stable across every scale:

- **`Handler.ingest(req)`** — auth source key → validate event shape → `queueAdapter.push(event)` → respond. Stateless, safe to run N-wide behind a load balancer from day one.
- **`processEvent(event, storeAdapter)`** — enrichment, session stitching, writes. Runs identically whether it's called inline or from a worker loop.
- **`QueueAdapter` interface** — `push()` + a consume-side contract (loop-owning vs poll-owning is a decision to lock in Phase 1, see §5).
- **`StoreAdapter` interface** — read/write surface, scoped by source.
- **Event schema + validation** — shared by tracker (what it's allowed to send) and Handler (what it accepts). This is the contract that keeps client, collector, and dashboard from drifting independently.
- **Source/tenant model** — how an auth key resolves to a `sourceId`, and whether isolation is enforced inside `StoreAdapter` or left to the caller. Decide this in core, not per-adapter, or Safety Knights' data isolation becomes an adapter-specific bug surface.

Everything else (real queues, real databases, dashboards, deploy topology) is downstream of these contracts and shouldn't leak back into core's API.

---

## 3. Sequencing — each phase should be independently shippable

**Phase 0 — Scaffolding**
Monorepo tooling (workspaces, shared tsconfig/eslint/build), CI skeleton, docs app wired to pull API reference from source comments. No library code yet. Done when `pnpm build` and `pnpm docs:dev` both work on an empty core package.

**Phase 1 — Contracts only**
Event schema, `QueueAdapter`/`StoreAdapter` interfaces, source/tenant model — types and validation, no runtime wiring. This is the phase where the loop-owning-vs-poll-owning decision and the error-propagation contract (does `push()` guarantee delivery or just enqueue-attempt?) get made, because every adapter downstream has to honor them. Done when the interfaces are documented and reviewed, before any adapter implements them.

**Phase 2 — Single-process path works end to end**
`adapter-memory` implementing both interfaces + `Handler.ingest` + `processEvent` wired together in-process. No deployed app yet — this is provable with a test harness: POST an event in, see it land in the in-memory store. Done when this path has a passing contract test suite (see §4).

**Phase 3 — Tracker**
Client script: pageview capture, custom events, batching, `sendBeacon`/fetch fallback, respects the event schema from Phase 1. Can be developed against a local collector using Phase 2's in-memory path. Done when a real page can send real events into the local pipeline.

**Phase 4 — Collector app, deployed**
`apps/collector` wraps core in sync mode, deployed as a single instance. Source auth keys issued, first real source (one of your personal sites) sending live traffic. This is the first point where "self-hosted analytics" is actually true end to end. Done when it's collecting real production traffic for one source.

**Phase 5 — Dashboard**
Read path against `StoreAdapter`, scoped per source. Done when you can see your own site's traffic in it.

**Phase 6 — Real adapters**
`adapter-redis`, `adapter-postgres`, built against the same contract test suite from Phase 2 — run unchanged against the new adapters to prove they honor the interface. This is the phase that validates the whole architecture: if these need Handler/processEvent code changes, the interfaces from Phase 1 were wrong.

**Phase 7 — Scale-out topology**
Multiple collector instances behind a load balancer, worker pool consuming from the real queue. This is a deployment/ops phase, not a library phase — nothing in core should need to change here. Document it as infra config, matching the diagram.

**Phase 8 — Second source (Safety Knights)**
The real test of tenant isolation: two sources, one collector fleet, one set of adapters. If `StoreAdapter` isolation was designed right in Phase 1, this is a config/onboarding task, not new code.

---

## 4. Cross-cutting: adapter contract tests

Write one shared test suite against `QueueAdapter` and one against `StoreAdapter` (in Phase 1/2), and run it against every implementation — memory, Redis, Postgres. This is what actually enforces "swap adapters without touching the library," rather than just hoping each adapter author reads the interface doc carefully. Any new adapter (including future community ones, if this goes that route) has a pass/fail bar instead of a code review judgment call.

---

## 5. Decisions to lock before Phase 2, because they're expensive to change after adapters exist

- Consume-side shape: adapter-owns-the-loop (`consume(handler)`) vs caller-owns-the-loop (`poll()`). Recommend adapter-owns — keeps the worker process a one-liner at every scale.
- `push()` delivery guarantee: does it throw/propagate on failure, or fire-and-forget with adapter-level retry/logging? This has to be the same semantic across memory and Redis adapters or Handler's error handling forks by adapter.
- Where `sourceId` resolution happens (Handler, before it ever reaches an adapter) and whether `StoreAdapter` is required to enforce scoping or just trusted to receive scoped calls.
- Event schema versioning — if the tracker and collector can be deployed independently, does the schema need a version field from day one, or is same-repo-same-release enough for now?

---

## 6. Docs strategy (apps/docs)

Two audiences, don't merge them:
- **"Self-host Vantage" guide** — for someone deploying the collector + dashboard, doesn't need adapter internals.
- **Adapter contract reference** — for anyone (including future-you) implementing a new `QueueAdapter`/`StoreAdapter`, generated from or tightly synced to the actual interface types so it can't silently drift from core.

Worth deciding whether API reference is hand-written or generated from TSDoc comments in core — generation costs setup now but removes an entire class of "docs said X, code does Y" bugs later, which is presumably part of what "better than Optimus" is pointing at.

---

## Open question

What specifically fell short with Optimus — was it adapter/dependency bloat, docs drift, versioning pain, something else? Worth naming explicitly so this plan targets the right thing rather than my guess at it.