---
"@usevantage/tracker": minor
---

Add optional modules as subpath exports (not part of the IIFE build):

- `@usevantage/tracker/visibility`: `createVisibilityObserver`, `createActivityClock`, `isSupported` — per-element visible time on one shared IntersectionObserver, paused while the page is hidden, the window is blurred or the user is idle.
- `@usevantage/tracker/items`: `createItemTracker` emits `item.impression`, `item.click` and `page.leave` with raw measurements.

The core tracker gains `onBeforePageview(listener)`, called just before `pageviewId` changes.
