---
title: Best Practices
description: Auth keys, error handling, scaling past one process, and testing custom adapters.
sidebar:
  order: 4
---

## Resolving auth keys → `sourceId`

`resolveSourceId` is the one place tenant scoping happens (see [Adapters & the interface contract](/guides/adapters/#sourceid-scoping--where-tenant-isolation-actually-lives)). A few things follow from that:

- **Don't trust the client-supplied key as the `sourceId` directly.** Look it up. A static `Map` is fine for one site; a database lookup is fine for many. Either way, an unrecognized key must resolve to `null`/`undefined` so `Handler.ingest` returns `401` — don't fall back to a default source.
- **`resolveSourceId` can be async.** Use it for a real database lookup without wrapping `createHandler` in extra plumbing.
- **Rotate keys by changing what `resolveSourceId` accepts**, not by changing the tracker's validation. Key rotation is a collector-side concern; the schema doesn't know about auth at all.

### Don't log auth keys {#dont-log-auth-keys}

The tracker sends the auth key as a URL query param (`?key=...`), not a header — see [why in the tracker guide](/guides/tracker/#how-delivery-actually-works). If your collector or any reverse proxy in front of it logs full request URLs, that leaks keys into logs. Strip or redact the `key` param before logging, or log method + path only.

## Handling `IngestResult`

`Handler.ingest` returns one of four shapes — don't just check `status === 202` and ignore the rest:

```ts
type IngestResult =
  | { status: 202 }
  | { status: 400; errors: string[] }
  | { status: 401 }
  | { status: 500; error: string };
```

- **`400`** — the event failed `validateEvent`. `errors` is a list of every rule that failed, not just the first — useful to surface directly during tracker development, but don't leak them to arbitrary internet traffic in production if you're worried about probing.
- **`401`** — `resolveSourceId` returned nothing. Don't retry client-side; it means the key is wrong or revoked.
- **`500`** — `queueAdapter.push()` rejected. This is the fixed cross-adapter failure mode (see [push() delivery semantics](/guides/adapters/#queueadapter)) — treat it as "the event did not make it onto the queue," full stop, regardless of which adapter is wired in.

## Scaling past one process

The architecture is built so this is a config change, not a rewrite:

| Scale | Ingest process | Worker process | Adapters |
| --- | --- | --- | --- |
| Single site | One process does both | Same process, same event loop | `adapter-memory` |
| Load-balanced collector | N stateless HTTP processes calling `handler.ingest` | Separate process(es) running `queueAdapter.consume(...)` | `adapter-redis` + `adapter-postgres` |

`Handler.ingest` is stateless specifically so the ingest side can run N-wide behind a load balancer from day one — nothing about it assumes it's the same process that drains the queue. When you outgrow `adapter-memory`, swap in `RedisQueueAdapter`/`PostgresStoreAdapter` and split ingest from consume into separate deployables; `Handler` and `processEvent` don't change. (The deployed collector + dashboard topology itself is a separate project — see the note in [`PLAN.md`](https://github.com/AdityaSawant0912/vantage/blob/main/PLAN.md) if you're building that out.)

## Testing a custom adapter

If you write your own `QueueAdapter`/`StoreAdapter`, run it against `packages/core/test/contracts/` before trusting it in production — this is the suite every shipped adapter (memory, Redis, Postgres) already passes unchanged, including cross-tenant isolation. A hand-rolled adapter that skips this is the most likely place for a subtle tenant-isolation bug to hide, since nothing else in `core` re-checks scoping downstream.

## Keep the event schema as the single contract

`VantageEvent` and `EVENT_SCHEMA_VERSION` are shared, unmodified, between the tracker and `Handler.ingest`'s validation. If you're sending events from something other than `@usevantage/tracker` — a server-to-server integration, a different client SDK — validate against the same shape rather than hand-rolling a payload that happens to work today. A schema drift between sender and collector fails as a `400`, but only if the sender is honest about `v`; don't skip setting it.

## Don't reach for infra you don't need yet

`adapter-memory` is a complete, correct `QueueAdapter`/`StoreAdapter` pair — not a stub. If you're running one site, it's the right default, not a placeholder to graduate out of on day one. Reach for `adapter-redis`/`adapter-postgres` when you actually have a reason (multi-process scaling, durability across restarts), not preemptively.
