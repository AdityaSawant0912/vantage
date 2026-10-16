---
title: Identity & sessions
description: anon_id, session_id, event_id, identify() and reset() — how Vantage links events to visitors and users.
sidebar:
  order: 3
---

Schema v2 promotes the ids every consumer needs out of `props` into core fields. The tracker generates all of them.

| Field | Lives | Rotates |
| --- | --- | --- |
| `anon_id` | `localStorage` (in-memory fallback if storage throws) | On `tracker.reset()` |
| `session_id` | `localStorage` | After `sessionTimeoutMs` (default 30 min) of inactivity, or on `reset()` |
| `event_id` | One UUID per event | Always — it is the idempotency key |
| `pv_id` | A `props` entry, not a core field | On every `trackPageview` |

## Linking a visitor to a user

```ts
tracker.identify("user-42");
```

`identify` sends a single event of `type: "identify"` carrying `user_id` (opaque, up to 256 characters). It does **not** stamp `user_id` onto later events — the collector joins by `session_id` / `anon_id`. Call it once at sign-in, not on every page.

On logout call `tracker.reset()`: it rotates both `anon_id` and `session_id`, so the next person on the same browser isn't linked to the previous user.

## Idempotency

`event_id` lets every layer tolerate redelivery. Stores must treat a repeated `event_id` (per source) as a no-op — see the [`StoreAdapter` contract](/guides/adapters/#storeadapter). `MemoryStoreAdapter` and `PostgresStoreAdapter` both do.

## Server time

`Handler.ingest` stamps `receivedAt` (epoch ms) on every `ScopedEvent`. `timestamp` stays client-supplied and can be wrong or forged; use `receivedAt` when you need a time you can trust.

## Limits

Handler rejects with `400` when `props` has more than 32 keys, a key over 64 characters, a string value over 512 characters, or when the whole body exceeds 8 KB. The same numbers are exported as `EVENT_LIMITS` from `@usevantage/core`. Handler measures the parsed body; cap the raw request size in your transport too.
