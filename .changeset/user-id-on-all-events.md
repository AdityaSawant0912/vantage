---
"@usevantage/core": minor
"@usevantage/tracker": minor
---

`user_id` is now optional on every event type (validated when present; still required on `identify`). After `tracker.identify(userId)` the tracker persists the id and stamps it on all later events until `tracker.reset()`. The schema version is unchanged.
