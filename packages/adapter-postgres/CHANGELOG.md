# @usevantage/adapter-postgres

## 2.0.0

### Major Changes

- 48401cf: Event schema v2 (clean break; v1 events now fail validation with `unsupported schema version`).

  - core: `event_id`, `anon_id`, `session_id` required; new `identify` event type with `user_id`; custom `name` must be lowercase dotted segments; props limits and an 8 KB body limit (`EVENT_LIMITS`); `Handler.ingest` stamps `receivedAt` on `ScopedEvent`; `StoreAdapter.write` is now documented as idempotent by `event_id`.
  - tracker: generates the ids, adds `identify`, `reset`, `enable`/`disable`, `pageviewId`, `autoPageview` and `sessionTimeoutMs` options; `flush()` returns a promise; events tracked while the page is hidden flush immediately via `sendBeacon`.
  - adapter-memory / adapter-postgres: dedupe by `(sourceId, event_id)`; Postgres stores the new columns. Existing tables must be dropped and recreated.
  - adapter-redis: no behavior change; major bump keeps it in step with core.

### Patch Changes

- Updated dependencies [48401cf]
  - @usevantage/core@2.0.0

## 1.0.0

### Major Changes

- First 1.0.0 release: Phases 0–6 of `PLAN.md` (scaffolding, contracts, in-memory end-to-end, tracker, real adapters) are complete and tested, so this is the intentional line where the API is considered stable rather than an incidental version bump.

  Add an open `props` bag to `VantageEvent` (`EventProps`) for app-defined custom fields — category, action, label, cookies, or anything else — validated generically rather than as named schema fields.

  Add `createRoutingQueueAdapter` to `@usevantage/core`: a `QueueAdapter` that fans out to other `QueueAdapter`s by a user-supplied `resolve(event)` function, e.g. routing events to different queues by `props.category`. `Handler` is unchanged — it's just another `QueueAdapter`.

  `@usevantage/tracker`'s `track()` and `trackPageview()` gain an optional `props` parameter. `@usevantage/adapter-postgres` persists `props` via a new `props JSONB` column (existing tables need a manual `ALTER TABLE ... ADD COLUMN props JSONB`).

### Patch Changes

- Fill in missing TSDoc across all packages' public interfaces, classes, and methods, and register `@usevantage/adapter-memory` in the generated API reference — it was previously missing a `tsconfig.docs.json` and an entry in the docs site's `apiPackages` list, so its API page never generated. No runtime behavior changes.
- Updated dependencies
- Updated dependencies
  - @usevantage/core@1.0.0
