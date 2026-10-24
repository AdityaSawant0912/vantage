---
"@usevantage/core": minor
"@usevantage/tracker": minor
---

Single-source setups no longer need an auth key. `createHandler({ sourceId })` (or the `VANTAGE_SOURCE_ID` env var) scopes every event to one source and ignores the key; `resolveSourceId` stays the multi-source path, and `createHandler` now throws at startup if neither is configured or both options are passed. `IngestRequest.authKey` and the tracker's `authKey` option are now optional (the tracker omits `?key=` when unset).
