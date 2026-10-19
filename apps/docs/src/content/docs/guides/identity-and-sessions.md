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

`identify` sends a single event of `type: "identify"` carrying `user_id` (up to 256 characters), then stamps that `user_id` onto **every later event** — pageviews and custom events included — so consumers can attribute an event to a user without joining on `anon_id` / `session_id`. The id is persisted in `localStorage` (key `vantage_user_id`), so it survives reloads: call `identify` once at sign-in, not on every page. Events sent before `identify` carry no `user_id`; there is no retroactive stitching.

`user_id` is optional on every event type and validated (1–256 characters) whenever it is present; it is required only on `identify`. The schema version is unchanged (still 2), since a v2 event without it stays valid.

On logout call `tracker.reset()`: it rotates both `anon_id` and `session_id` and forgets the `user_id`, so the next person on the same browser isn't linked to the previous user.

## Idempotency

`event_id` lets every layer tolerate redelivery. Stores must treat a repeated `event_id` (per source) as a no-op — see the [`StoreAdapter` contract](/guides/adapters/#storeadapter). `MemoryStoreAdapter` and `PostgresStoreAdapter` both do.

## Server time

`Handler.ingest` stamps `receivedAt` (epoch ms) on every `ScopedEvent`. `timestamp` stays client-supplied and can be wrong or forged; use `receivedAt` when you need a time you can trust.

## Limits

Handler rejects with `400` when `props` has more than 32 keys, a key over 64 characters, a string value over 512 characters, or when the whole body exceeds 8 KB. The same numbers are exported as `EVENT_LIMITS` from `@usevantage/core`. Handler measures the parsed body; cap the raw request size in your transport too.

Every limit can be overridden with an env var, read once when `@usevantage/core` is imported. Invalid (non-integer or ≤ 0) values are ignored.

| Env var | Default |
| --- | --- |
| `VANTAGE_MAX_ID_LENGTH` (`anon_id`, `session_id`) | 64 |
| `VANTAGE_MAX_USER_ID_LENGTH` | 256 |
| `VANTAGE_MAX_NAME_LENGTH` | 64 |
| `VANTAGE_MAX_PROPS_KEYS` | 32 |
| `VANTAGE_MAX_PROPS_KEY_LENGTH` | 64 |
| `VANTAGE_MAX_PROPS_STRING_LENGTH` | 512 |
| `VANTAGE_MAX_BODY_BYTES` | 8192 |

To allow 2000-char prop strings, raise both `VANTAGE_MAX_PROPS_STRING_LENGTH` and `VANTAGE_MAX_BODY_BYTES`, or the 8 KB body cap rejects first.

To override for one handler only, pass `limits` (a partial of `EventLimits`) — it wins over the env vars:

```ts
createHandler({ queueAdapter, resolveSourceId, limits: { maxPropsStringLength: 2000, maxBodyBytes: 32768 } });
```

`validateEvent(event, limits?)` accepts the same partial.
