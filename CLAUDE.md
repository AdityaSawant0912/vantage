# CLAUDE.md

Instructions for Claude Code (and any other agent) working in this repository.
Read this before writing any code. The full design spec lives in
[`PLAN.md`](./PLAN.md) — this file is the operational complement to it: how to
work, not what to build. If the two ever conflict, `PLAN.md` wins on *what*,
this file wins on *how*.

## What this repo is

Vantage — a self-hosted web analytics library and collector. A pure,
infra-free core (`@usevantage/core`) that validates and processes events behind
pluggable `QueueAdapter`/`StoreAdapter` interfaces, a client-side tracker
script, and separately-published adapter packages for real infra (Redis,
Postgres, etc). Monorepo, multiple packages, published independently. The
same `Handler`/`processEvent` code runs unchanged whether it's a single
synchronous process or a load-balanced collector fleet with a real queue and
worker pool — only the wired-in adapter changes.

## Before you start

1. Read `PLAN.md` in full, especially §9 (Decisions Log) and §11 (Phased
   Build Plan). Do not skim it.
2. Check which phase the repo is currently in (look at what exists under
   `packages/`). Do not start work on a later phase's package if an earlier
   phase isn't done and tested — the phases are ordered for a reason: later
   packages (real adapters, dashboard, scale-out topology) depend on the
   contracts from earlier phases being correct.
3. If this is a fresh checkout with nothing scaffolded yet, start at Phase 0.

## Hard constraints — do not silently deviate from these

These are copied from `PLAN.md §9` because they're easy to accidentally
violate mid-implementation. If you think one of these is wrong, **say so and
stop** — don't quietly work around it.

- The `core` package (`@usevantage/core`) has **zero infra dependencies**. If you
  find yourself importing `ioredis`, `pg`, or any transport/storage client
  inside `packages/core`, stop — that logic belongs in an adapter package
  instead. This is the whole point of the split: self-hosting a single site
  should never pull in Redis as a dependency.
- Adapters are **separate, independently-published packages**
  (`adapter-memory`, `adapter-redis`, `adapter-postgres`, …), not folders or
  optional exports inside `core`. `core`'s version means "interface
  stability"; adapter packages can churn independently.
- `QueueAdapter` is **adapter-owns-the-loop**: `consume(handler)`, not a
  caller-owned `poll()`. Every worker process, at every scale, is `queueAdapter
  .consume(event => processEvent(event, storeAdapter))` — one line. Don't
  introduce a polling variant "for flexibility."
- `push()` delivery semantics are **fixed across all adapters**: [fill in
  from `PLAN.md §9` once decided — fire-and-forget-with-logging vs
  propagate-on-failure]. Whichever it is, `adapter-memory` and `adapter-redis`
  must behave identically here, or `Handler.ingest`'s error handling forks by
  which adapter happens to be wired in.
- **`sourceId` resolution happens in `Handler`**, from the auth key, before
  anything reaches an adapter. `StoreAdapter` implementations receive
  already-scoped calls — don't push tenant-resolution logic into individual
  adapters, or Safety Knights-style multi-tenant isolation becomes an
  adapter-by-adapter bug surface instead of a single guarantee.
- The **event schema is the single contract** shared by the tracker package
  and `Handler.ingest`'s validation — don't let either side accept or emit
  shapes the other doesn't know about. If the schema needs a version field
  for independent tracker/collector deploys, that's a `PLAN.md §10` open
  question — don't add one silently, and don't skip it silently either.
- Any new or changed `QueueAdapter`/`StoreAdapter` implementation **must pass
  the shared adapter contract test suite** (`packages/core/test/contracts/`)
  unchanged. If an adapter can't pass it without a contract test change,
  that's a signal the adapter is wrong, the contract is wrong, or `core`
  leaked an assumption — stop and flag which one, don't loosen the test to
  make it pass.

## Working process

- **Work phase by phase**, in the order given in `PLAN.md §3`
  (scaffolding → contracts → in-memory end-to-end → tracker → real
  adapters). Don't build the Redis adapter before the in-memory path has
  real contract-test coverage. The deployed collector, dashboard, and
  scale-out topology are a separate project now — see
  `COLLECTOR-DASHBOARD-PLAN.md` — not phases of this repo.
- **Write tests alongside each phase, not after.** The event validation and
  source-scoping logic especially are easy to get subtly wrong — write
  cross-tenant isolation tests before considering `StoreAdapter` done, not
  after Safety Knights is live.
- For anything listed in `PLAN.md §10` (Open Questions), pick a reasonable
  default, implement it, and call out the choice explicitly in your summary
  to the user — don't block on it, but don't bury the decision either.
- Keep `core` functions small and independently testable — auth/key
  resolution, event validation, `Handler.ingest`, and `processEvent` should
  all be separately unit-testable, not fused into one function.
- Use TypeScript strict mode in every package.
- When a phase is complete, summarize: what was built, what tests cover it
  (especially which contract-test suites now pass), and any open-question
  defaults you picked.

## Repo conventions

- Package manager: pnpm workspaces (or Turborepo if the user has set that up
  — check for `turbo.json` / `pnpm-workspace.yaml` before assuming).
- One package per unit (`packages/core`, `packages/tracker`,
  `packages/adapter-memory`, `packages/adapter-redis`,
  `packages/adapter-postgres`, …), each independently versioned/publishable.
- Example apps / reference deployments live under `examples/` (e.g. a
  minimal single-process collector, a scaled-out collector+worker setup),
  and should be kept runnable — they double as integration tests and as
  documentation.
- Prefer explicit types over inferred `any`/`unknown` leaking across package
  boundaries — this library's value proposition includes a stable,
  type-safe adapter contract, don't undermine it internally.

## Docs stay in sync with the library

- Any change to a published package (`packages/*`) — new export, changed
  signature, changed behavior, new option, new adapter — **must** update the
  matching reference doc under `apps/docs/src/content/docs/api/` in the same
  PR/commit set. Don't land a library change and leave docs to a follow-up.
- Every merge to `main` publishes the library packages and the docs site
  **together**, as one release unit — not library-then-docs-later or
  docs-only pushes that drift from what's actually published.
- If you change `packages/core` (or any adapter) and the corresponding
  `apps/docs/.../api/*.md` page isn't touched in the same change, stop and
  either update it or flag explicitly to the user why it doesn't need
  updating.
- Keep two docs audiences separate rather than merged: a "self-host Vantage"
  guide (deploying collector + dashboard, no adapter internals) and an
  adapter contract reference (for implementing a new `QueueAdapter`/
  `StoreAdapter`, kept tightly synced to the actual interface types so it
  can't silently drift from `core`).

## Commands

```bash
# install
pnpm install

# run all tests
pnpm test

# run adapter contract tests only (must pass for any new/changed adapter)
pnpm --filter "./packages/adapter-*" test

# run tests for a single package
pnpm --filter @usevantage/core test

# typecheck everything
pnpm typecheck

# lint
pnpm lint

# build all packages
pnpm build
```

## When you're unsure

- Ambiguity about *what* to build → check `PLAN.md` first.
- Ambiguity about *how* to structure the work → this file.
- Still unsure, or the two docs seem to conflict → stop and ask the user
  rather than guessing on a decision that's expensive to unwind later
  (adapter interface shape, delivery-guarantee semantics, tenant-scoping
  boundary especially).