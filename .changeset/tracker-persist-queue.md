---
"@usevantage/tracker": minor
---

Add `persistQueue` option (default `false`): keep unsent events in localStorage (newest 200) and resend them on the next page load. Events are removed on a 2xx/4xx response or an accepted `sendBeacon`, and kept on network errors and 5xx. `disable()` clears the persisted queue.
