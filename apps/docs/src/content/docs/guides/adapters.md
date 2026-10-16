---
title: Adapters & the interface contract
description: What QueueAdapter and StoreAdapter guarantee, how sourceId scoping works, and how to swap or write an adapter.
sidebar:
  order: 3
---

Everything in `@usevantage/core` is written against two interfaces, not a specific database or queue. The same `Handler`/`processEvent` code runs unchanged whether it's a single synchronous process or a load-balanced collector fleet — only the adapter you wire in changes.

```
tracker → Handler.ingest → QueueAdapter.push
                                   │
                     QueueAdapter.consume(handler)
                                   │
                              processEvent → StoreAdapter.write
```

## QueueAdapter

```ts
interface QueueAdapter {
  push(event: ScopedEvent): Promise<void>;
  consume(handler: (event: ScopedEvent) => Promise<void>): void;
}
```

Two things are fixed across **every** adapter, not left to implementation judgment:

- **Adapter owns the consume loop.** `consume(handler)` takes a handler and drives it — the adapter polls, blocks, or subscribes internally. There's no caller-owned `poll()`. This is why the worker side of every Vantage deployment, at any scale, is exactly:

  ```ts
  queueAdapter.consume((event) => processEvent(event, storeAdapter));
  ```

  One line, whether `queueAdapter` is `MemoryQueueAdapter` running in the same process as the HTTP server, or `RedisQueueAdapter` running in a separate worker fleet.

- **`push()` rejects on failure to durably enqueue.** Fire-and-forget-with-logging was rejected as a design because it would make `Handler.ingest`'s error handling fork depending on which adapter happens to be wired in — a caller could never tell, from the interface alone, whether a `202` actually meant "queued." Every adapter must reject the promise if the event didn't make it onto the queue; `Handler.ingest` turns a rejection into a `500`.

## StoreAdapter

```ts
interface StoreAdapter {
  write(event: ScopedEvent): Promise<void>;
}
```

`write` must be **idempotent by `event_id`** (scoped to the event's `sourceId`): queues like Redis and BullMQ can redeliver, so writing the same event twice has to be a no-op, not a duplicate row. The shared contract suite checks this. Scoping the key per source also stops one tenant from suppressing another's event by replaying its id.

Deliberately minimal — no read methods yet. A dashboard's query shape isn't part of this repo (see [PLAN.md §2](https://github.com/AdityaSawant0912/vantage/blob/main/PLAN.md)), so adding reads speculatively would force every adapter to implement queries nothing calls. `MemoryStoreAdapter.getEvents()` and `PostgresStoreAdapter.getEvents()` exist as test/inspection hooks, not contract methods — don't build against them expecting adapter parity.

## `sourceId` scoping — where tenant isolation actually lives

```ts
interface ScopedEvent extends VantageEvent {
  sourceId: SourceId;
}
```

`QueueAdapter` and `StoreAdapter` never see a raw `VantageEvent` — only `ScopedEvent`, already carrying a `sourceId`. That resolution happens exactly once, inside `Handler.ingest`, via the `resolveSourceId` function you pass to `createHandler`:

```ts
createHandler({
  queueAdapter,
  resolveSourceId: (authKey) => sources.get(authKey), // your lookup, sync or async
});
```

Adapters are trusted to persist whatever `sourceId` they're handed as-is — they must not re-derive or re-check tenant identity themselves. This is deliberate: if every adapter re-implemented scoping, tenant isolation would be an adapter-by-adapter bug surface instead of one guarantee, enforced in one place. Don't add source-lookup logic inside a custom adapter; do it in `resolveSourceId`.

## Swapping in real infra

`adapter-memory` is the zero-infra default. Nothing about `Handler` or `processEvent` changes when you swap it for real infra — only the two objects passed in.

```bash
npm install @usevantage/adapter-redis @usevantage/adapter-postgres
```

```ts
import { RedisQueueAdapter } from "@usevantage/adapter-redis";
import { PostgresStoreAdapter } from "@usevantage/adapter-postgres";

const queueAdapter = new RedisQueueAdapter({
  redis: process.env.REDIS_URL!, // connection string, or a full ioredis options object
  key: "vantage:events", // optional, defaults to "vantage:events"
});

const storeAdapter = new PostgresStoreAdapter({
  connection: process.env.DATABASE_URL!, // connection string, or a full pg PoolConfig
  table: "vantage_events", // optional, defaults to "vantage_events" — must be a plain identifier, not user input
});

queueAdapter.consume((event) => processEvent(event, storeAdapter));
```

`RedisQueueAdapter` pushes with `LPUSH` and consumes with a blocking `BRPOP` on its own connection — `BRPOP` occupies a connection for the duration of the block, so it can't share one with `push()`. `PostgresStoreAdapter` creates its table on first use (`CREATE TABLE IF NOT EXISTS`) with a `UNIQUE (source_id, event_id)` constraint and `INSERT ... ON CONFLICT DO NOTHING`; it isn't a migration tool, just enough to be usable out of the box. A table created under schema v1 is never altered — drop and recreate it when upgrading to v2. Both expose a `close()` that's outside the `QueueAdapter`/`StoreAdapter` contract, for test and shutdown cleanup only.

This split is also the reason `@usevantage/core` has zero infra dependencies: nobody self-hosting a single site pulls in `ioredis` or `pg` just by installing `core`.

## BullMQ: retries and backoff

`RedisQueueAdapter` has no retry policy — a throwing handler is logged and the event is gone. If you want retries, use `@usevantage/adapter-bullmq`:

```bash
npm install @usevantage/adapter-bullmq bullmq
```

```ts
import { Queue } from "bullmq";
import { BullMQQueueAdapter } from "@usevantage/adapter-bullmq";

const connection = { host: "127.0.0.1", port: 6379 };
const queueAdapter = new BullMQQueueAdapter({
  queue: new Queue("vantage-events", { connection }), // you own the Queue
  connection, // used for the consume-side Worker
  concurrency: 10, // optional, default 10
});

queueAdapter.consume((event) => processEvent(event, storeAdapter));
```

`push()` follows the same rule as every adapter — it rejects if the job wasn't enqueued. A handler that throws is retried up to 5 times with exponential backoff starting at 1 second; completed jobs are removed and the last 1000 failed ones are kept. The worker connection is given `maxRetriesPerRequest: null`, which BullMQ requires — if you pass an ioredis instance instead of options, set that yourself.

Delivery is **at-least-once**: a retry can run a handler twice for the same event. Jobs are keyed `sourceId|event_id`, so pushing the same event twice while it's still pending doesn't duplicate it — but that only holds while the job exists, so the `StoreAdapter` being [idempotent by `event_id`](#storeadapter) is what actually prevents duplicate rows. `close()` stops the worker; closing your `Queue` is up to you.

**Crashed workers.** If a worker process dies mid-job, BullMQ notices the expired lock and hands the job to another worker. That takes up to `lockDuration + stalledInterval` — 30s each by default, so up to a minute. Tune it with `workerOptions` (`new BullMQQueueAdapter({ ..., workerOptions: { lockDuration: 10_000, stalledInterval: 5_000 } })`); a shorter lock means more renewal traffic and a slow handler can be mistaken for a dead one. This path doesn't use up the job's 5 attempts, and because the dead worker may already have written the event, the idempotent store is what keeps it to one row. The repo's `examples/bullmq-e2e` kills a real worker in both situations (before and after the write) and checks the retry and the single row.

## Routing events to different queues by `props`

`VantageEvent.props` is an open bag (`Record<string, string | number | boolean | null>`) for whatever app-defined fields you want — `category`, `action`, `label`, `cookies`, or anything else. It's deliberately not a typed schema addition: adding a new dimension never requires a core change, and every `StoreAdapter` (including `adapter-postgres`'s `props JSONB` column) persists it as-is without needing to know its shape ahead of time.

Because `props` travels on every event, it's also the hook for sending different events to different queues — `createRoutingQueueAdapter` is a `QueueAdapter` that fans out to other `QueueAdapter`s by a resolver function you supply:

```ts
import { createRoutingQueueAdapter } from "@usevantage/core";

const queueAdapter = createRoutingQueueAdapter({
  queues: {
    checkout: checkoutQueueAdapter,
    marketing: marketingQueueAdapter,
  },
  resolve: (event) => String(event.props?.category ?? "default"),
  default: defaultQueueAdapter, // used when resolve()'s key isn't in `queues`
});

createHandler({ queueAdapter, resolveSourceId });
```

`Handler` doesn't change at all — `createRoutingQueueAdapter` returns a plain `QueueAdapter`, so it's wired in exactly where a single one would be. `push()` resolves the target queue and delegates, rejecting (per the same push()-propagates-on-failure rule every adapter follows) if there's no match and no `default`. `consume(handler)` registers the same handler on every underlying queue, so one worker loop still drains all of them.

## Writing your own adapter

If you need a queue or store that isn't Redis or Postgres, implement `QueueAdapter`/`StoreAdapter` directly — that's the whole point of the split. Two rules make an adapter correct, not just type-correct:

1. `push()` must reject if the event isn't durably enqueued — don't resolve optimistically.
2. `consume()` must own its loop — don't hand back a `poll()` for the caller to drive.

Every adapter in this repo — memory, Redis, Postgres — is proven against the same shared contract test suite in `packages/core/test/contracts/`, including a cross-tenant isolation test (two `sourceId`s writing through one adapter instance never see each other's events). Run your adapter against that suite before trusting it; if it can't pass unchanged, that's a signal your adapter (or your understanding of the contract) is wrong — not a reason to loosen the test.
