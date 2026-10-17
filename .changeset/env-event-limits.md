---
"@usevantage/core": minor
---

`EVENT_LIMITS` can now be overridden via `VANTAGE_MAX_*` env vars (e.g. `VANTAGE_MAX_PROPS_STRING_LENGTH`, `VANTAGE_MAX_BODY_BYTES`), read once at import. Defaults unchanged. `createHandler({ limits })` and `validateEvent(event, limits)` override them per handler; new `EventLimits` type.
