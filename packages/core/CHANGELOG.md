# @usevantage/core

## 1.0.0

### Major Changes

- First 1.0.0 release: Phases 0–6 of `PLAN.md` (scaffolding, contracts, in-memory end-to-end, tracker, real adapters) are complete and tested, so this is the intentional line where the API is considered stable rather than an incidental version bump.

  Add an open `props` bag to `VantageEvent` (`EventProps`) for app-defined custom fields — category, action, label, cookies, or anything else — validated generically rather than as named schema fields.

  Add `createRoutingQueueAdapter` to `@usevantage/core`: a `QueueAdapter` that fans out to other `QueueAdapter`s by a user-supplied `resolve(event)` function, e.g. routing events to different queues by `props.category`. `Handler` is unchanged — it's just another `QueueAdapter`.

  `@usevantage/tracker`'s `track()` and `trackPageview()` gain an optional `props` parameter. `@usevantage/adapter-postgres` persists `props` via a new `props JSONB` column (existing tables need a manual `ALTER TABLE ... ADD COLUMN props JSONB`).

### Patch Changes

- Fill in missing TSDoc across all packages' public interfaces, classes, and methods, and register `@usevantage/adapter-memory` in the generated API reference — it was previously missing a `tsconfig.docs.json` and an entry in the docs site's `apiPackages` list, so its API page never generated. No runtime behavior changes.
