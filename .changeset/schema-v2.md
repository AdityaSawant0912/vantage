---
"@usevantage/core": major
"@usevantage/tracker": major
"@usevantage/adapter-memory": major
"@usevantage/adapter-postgres": major
"@usevantage/adapter-redis": major
---

Event schema v2 (clean break; v1 events now fail validation with `unsupported schema version`).

- core: `event_id`, `anon_id`, `session_id` required; new `identify` event type with `user_id`; custom `name` must be lowercase dotted segments; props limits and an 8 KB body limit (`EVENT_LIMITS`); `Handler.ingest` stamps `receivedAt` on `ScopedEvent`; `StoreAdapter.write` is now documented as idempotent by `event_id`.
- tracker: generates the ids, adds `identify`, `reset`, `enable`/`disable`, `pageviewId`, `autoPageview` and `sessionTimeoutMs` options; `flush()` returns a promise; events tracked while the page is hidden flush immediately via `sendBeacon`.
- adapter-memory / adapter-postgres: dedupe by `(sourceId, event_id)`; Postgres stores the new columns. Existing tables must be dropped and recreated.
- adapter-redis: no behavior change; major bump keeps it in step with core.
