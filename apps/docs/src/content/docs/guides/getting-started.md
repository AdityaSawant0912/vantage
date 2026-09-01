---
title: Getting Started
description: Install Vantage, wire up a zero-infra collector, and send your first event.
sidebar:
  order: 1
---

Vantage is three things wired together through two small interfaces:

- **`@usevantage/core`** — `createHandler` (ingest + validate + enqueue) and `processEvent` (write to storage). Zero infra dependencies.
- **A `QueueAdapter` + `StoreAdapter` pair** — how events actually get queued and stored. `@usevantage/adapter-memory` is the zero-infra default; `@usevantage/adapter-redis` and `@usevantage/adapter-postgres` are drop-in replacements for real infra.
- **`@usevantage/tracker`** — the client-side script that sends events to whatever you build with the above.

This page builds the smallest possible working setup: one process, in-memory queue and store, a plain Node HTTP server, and the tracker posting to it.

## 1. Install

```bash
npm install @usevantage/core @usevantage/adapter-memory
```

## 2. Wire up a handler

`createHandler` needs a `QueueAdapter` and a function that resolves an auth key to a `sourceId`. Resolving the key is your job — it's how Vantage knows which tenant an event belongs to, and it must happen before anything reaches an adapter (see [Adapters & the interface contract](/guides/adapters/)).

```ts
// server.ts
import { createServer } from "node:http";
import { createHandler, processEvent } from "@usevantage/core";
import { MemoryQueueAdapter, MemoryStoreAdapter } from "@usevantage/adapter-memory";

const queueAdapter = new MemoryQueueAdapter();
const storeAdapter = new MemoryStoreAdapter();

// A real deployment looks this up in a database. For a single site, a
// static map from auth key to sourceId is enough.
const sources = new Map([["dev-key-123", "my-site"]]);

const handler = createHandler({
  queueAdapter,
  resolveSourceId: (authKey) => sources.get(authKey),
});

// Adapter owns the consume loop — this one line is the entire worker,
// at every scale (see the QueueAdapter contract in the adapters guide).
queueAdapter.consume((event) => processEvent(event, storeAdapter));

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/api/event")) {
    res.writeHead(404).end();
    return;
  }

  const authKey = new URL(req.url, "http://localhost").searchParams.get("key") ?? "";
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

  const result = await handler.ingest({ authKey, body });
  res.writeHead(result.status).end(result.status === 202 ? undefined : JSON.stringify(result));
});

server.listen(3000, () => console.log("collector listening on :3000"));
```

Run it:

```bash
npx tsx server.ts
```

## 3. Send a test event

The tracker posts events in the shape `VantageEvent` defines — `v`, `type`, `url`, `timestamp` are required. Try it with `curl` before wiring up the real tracker script:

```bash
curl -X POST "http://localhost:3000/api/event?key=dev-key-123" \
  -H "Content-Type: application/json" \
  -d '{"v":1,"type":"pageview","url":"https://example.com/","timestamp":1730000000000}'
```

A `202` back means it was validated, scoped to `my-site`, and handed to `processEvent`, which wrote it into `MemoryStoreAdapter`. Inspect it:

```ts
console.log(storeAdapter.getEvents("my-site"));
```

`getEvents` is a test/inspection hook on `MemoryStoreAdapter`, not part of the `StoreAdapter` contract itself — every adapter is free to expose its own read helpers, since read paths aren't standardized yet (see [PLAN.md §2](https://github.com/AdityaSawant0912/vantage/blob/main/PLAN.md)).

## 4. Add the tracker

```bash
npm install @usevantage/tracker
```

```html
<script type="module">
  import { createTracker } from "@usevantage/tracker";

  const tracker = createTracker({
    endpoint: "http://localhost:3000/api/event",
    authKey: "dev-key-123",
  });

  // A pageview fires automatically on creation. Fire your own events:
  tracker.track("signup_clicked");
</script>
```

No bundler? Use the prebuilt IIFE build — it exposes a `Vantage` global:

```html
<script src="https://unpkg.com/@usevantage/tracker/dist/index.global.js"></script>
<script>
  const tracker = Vantage.createTracker({
    endpoint: "https://your-collector.example.com/api/event",
    authKey: "dev-key-123",
  });
</script>
```

## Next steps

- [Tracker guide](/guides/tracker/) — batching, custom events, beacon delivery, all options.
- [Adapters & the interface contract](/guides/adapters/) — what `QueueAdapter`/`StoreAdapter` guarantee, and how to swap in Redis/Postgres.
- [Best practices](/guides/best-practices/) — auth keys, error handling, scaling this past one process.
- [API reference](/api/core/) — generated from source, always current.
