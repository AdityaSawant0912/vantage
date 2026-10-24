# @usevantage/tracker

## 5.0.0

### Minor Changes

- 5ba365e: Single-source setups no longer need an auth key. `createHandler({ sourceId })` (or the `VANTAGE_SOURCE_ID` env var) scopes every event to one source and ignores the key; `resolveSourceId` stays the multi-source path, and `createHandler` now throws at startup if neither is configured or both options are passed. `IngestRequest.authKey` and the tracker's `authKey` option are now optional (the tracker omits `?key=` when unset).

### Patch Changes

- Updated dependencies [5ba365e]
  - @usevantage/core@2.3.0

## 4.0.0

### Minor Changes

- 0aef1a8: `user_id` is now optional on every event type (validated when present; still required on `identify`). After `tracker.identify(userId)` the tracker persists the id and stamps it on all later events until `tracker.reset()`. The schema version is unchanged.

### Patch Changes

- Updated dependencies [0aef1a8]
  - @usevantage/core@2.2.0

## 3.0.0

### Patch Changes

- Updated dependencies [8ee6b7f]
  - @usevantage/core@2.1.0

## 2.2.0

### Minor Changes

- ad8d409: Add `persistQueue` option (default `false`): keep unsent events in localStorage (newest 200) and resend them on the next page load. Events are removed on a 2xx/4xx response or an accepted `sendBeacon`, and kept on network errors and 5xx. `disable()` clears the persisted queue.

## 2.1.0

### Minor Changes

- 692521a: Add optional modules as subpath exports (not part of the IIFE build):

  - `@usevantage/tracker/visibility`: `createVisibilityObserver`, `createActivityClock`, `isSupported` — per-element visible time on one shared IntersectionObserver, paused while the page is hidden, the window is blurred or the user is idle.
  - `@usevantage/tracker/items`: `createItemTracker` emits `item.impression`, `item.click` and `page.leave` with raw measurements.

  The core tracker gains `onBeforePageview(listener)`, called just before `pageviewId` changes.

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
