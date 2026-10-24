---
"@usevantage/tracker": minor
---

Page views are now chained and events ordered client-side. Every event inside a page view carries a `seq` prop (0 on the pageview, then 1, 2, … in the order the visitor triggered them), and every pageview carries `prev_pv_id`, the previous page view's `pv_id`. `prev_pv_id` is kept in `localStorage` so it survives reloads and full-page navigation, is absent on a visitor's first page view, and is cleared by `reset()`.

Non-pageview events now carry the `url` of their page view instead of `window.location` at call time, so `page.leave` and flushed item impressions no longer report the next page's URL after an SPA route change.
