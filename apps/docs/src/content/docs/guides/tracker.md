---
title: The Tracker
description: Client-side event capture — options, batching, delivery, custom events.
sidebar:
  order: 2
---

`@usevantage/tracker` is the script you drop into a page to send events to a Vantage collector (see [Getting Started](/guides/getting-started/) for the server side).

## Install

```ts
import { createTracker } from "@usevantage/tracker";

const tracker = createTracker({
  endpoint: "https://analytics.example.com/api/event",
  authKey: "your-auth-key",
});
```

Or drop the IIFE build straight into HTML — no bundler needed. It exposes a `Vantage` global:

```html
<script src="https://unpkg.com/@usevantage/tracker/dist/index.global.js"></script>
<script>
  const tracker = Vantage.createTracker({
    endpoint: "https://analytics.example.com/api/event",
    authKey: "your-auth-key",
  });
</script>
```

## Options

| Option            | Required | Default | Notes                                                                 |
| ------------------ | -------- | ------- | ---------------------------------------------------------------------- |
| `endpoint`         | yes      | —       | Your collector's ingest URL.                                          |
| `authKey`          | yes      | —       | Identifies the source. Sent as `?key=` on every request — see below.  |
| `batchSize`        | no       | `10`    | Events buffered client-side before an automatic flush.                |
| `flushIntervalMs`  | no       | `5000`  | Max time between flushes, regardless of buffer size.                  |
| `autoPageview`     | no       | `true`  | Fire a pageview on creation. Set `false` when a router drives pageviews (e.g. Angular). |
| `sessionTimeoutMs` | no       | `1800000` | Inactivity before `session_id` rotates. See [Identity & sessions](/guides/identity-and-sessions/). |

## Tracking events

```ts
tracker.trackPageview(); // uses window.location.href
tracker.trackPageview("https://example.com/other-page"); // explicit URL

tracker.track("signup_clicked");
tracker.track("checkout_completed");

await tracker.flush(); // force-send whatever's buffered; resolves once the requests settle
```

Custom event names must be lowercase dotted segments (`item.click`, `signup_clicked`), up to 64 characters.

`createTracker` fires a pageview automatically on creation — you don't need to call `trackPageview()` yourself on page load. For SPAs, pass `autoPageview: false` and call `trackPageview()` from your router's navigation hook, so the first view isn't counted twice and every route change is.

Every `trackPageview` starts a new page view id. It is readable as `tracker.pageviewId` and attached to later events as the `pv_id` prop.

## Identity, consent

```ts
tracker.identify("user-42"); // once, at sign-in
tracker.reset();             // at logout: new anon_id and session_id
tracker.disable();           // consent withdrawn: stop capture, drop the buffer
tracker.enable();
```

See [Identity & sessions](/guides/identity-and-sessions/) for how the ids work.

## Impressions, visible time and clicks (optional modules)

Two opt-in subpath exports sit beside the core tracker; the drop-in IIFE build does not include them.

### `@usevantage/tracker/visibility`

A low-level wrapper around `IntersectionObserver` that measures how long each element is visible. It sends no events and doesn't depend on the tracker, so you can use it on its own.

```ts
import { createVisibilityObserver } from "@usevantage/tracker/visibility";

const vis = createVisibilityObserver({
  idleMs: 30000,
  onEnd: (m, reason) => {
    // m: { el, key, firstSeenAt, visibleMs, maxVisiblePct }
    // reason: "stopped" | "hidden" | "manual"
  },
});

const stop = vis.observe(el, { key: "post:665f" });
stop(); // ends this element's measurement
vis.endAll("manual"); // ends every open measurement, e.g. on a page change
```

- One shared `IntersectionObserver` per instance (thresholds `0, 0.25, 0.5, 0.75, 1`).
- Time accrues only while the element intersects **and** the page is visible, the window is focused, and the last input (pointer, key, wheel, touch, scroll) was within `idleMs`. Scroll-backs add up within one measurement.
- A measurement ends on `stop()`, on `endAll()`, or when the page hides. After `endAll("manual")` or a hide/show cycle, an element still on screen starts a fresh measurement.
- An element that was never seen never fires `onEnd`.
- Without `IntersectionObserver`, `isSupported()` is `false`, `observe` returns a no-op `stop`, and `onEnd` never fires.
- `createActivityClock({ idleMs })` exposes the active-time clock on its own; pass one to several observers through `deps.clock` to share it. `deps` also accepts `IntersectionObserver` and `now`, which keeps tests deterministic.

### `@usevantage/tracker/items`

Builds on the visibility module and a tracker to emit three events, with no framework dependency:

```ts
import { createItemTracker } from "@usevantage/tracker/items";

const items = createItemTracker(tracker, { idleMs: 30000 });

const stop = items.observe(el, {
  itemType: "post", itemId: "665f", placement: "feed", feed: "news", position: 7,
});
items.trackClicks(document.body); // delegated: reads data-vantage-type / -id / -action
stop(); // emits this element's impression and flushes
```

| Event | When | Props |
| --- | --- | --- |
| `item.impression` | `stop()`, the page view changes, or the page hides | `item_type`, `item_id`, `placement`, `feed`, `position`, `first_seen_at`, `visible_ms`, `max_visible_pct`, `end_reason` |
| `item.click` | a click inside an element with `data-vantage-type` and `data-vantage-id` | `item_type`, `item_id`, `action` (from `data-vantage-action`) |
| `page.leave` | the page view changes or the page hides (or `items.endPage()`) | `active_ms`, `max_scroll_pct`, `exit_kind` (`navigation`, `hidden` or `manual`) |

Values are raw measurements: whether an impression counts as "viewable" is decided where you read the data, not in the browser. Each event is one flat row, one event per item, so `props` stays within its limits.

The module listens for `tracker.trackPageview()` (through `tracker.onBeforePageview`) so impressions and `page.leave` are stamped with the page view they belong to. In a SPA, call `stop()` for the old page's elements **before** `trackPageview()` — otherwise the element's measurement has already restarted for the new page and emits a near-empty impression against it. If your router changes pages without calling `trackPageview`, call `items.endPage()` yourself. `page.leave` also fires each time the tab is hidden, not only on close, so expect more than one per page view.

#### Recipe: Angular directive

Framework wrappers aren't shipped; this is the whole thing for Angular:

```ts
@Directive({ selector: "[skTrackItem]", standalone: true })
export class TrackItemDirective implements OnInit, OnDestroy {
  @Input({ required: true }) skTrackItem!: ItemMeta;
  private stop?: () => void;

  constructor(private el: ElementRef<HTMLElement>, private items: ItemTracker) {} // provide ItemTracker from createItemTracker(tracker)

  ngOnInit() { this.stop = this.items.observe(this.el.nativeElement, this.skTrackItem); }
  ngOnDestroy() { this.stop?.(); }
}
```

```html
<article [skTrackItem]="{ itemType: 'post', itemId: post.id, feed: 'news', position: i }">…</article>
```

Create the tracker with `autoPageview: false` and call `trackPageview()` from the router's `NavigationEnd`; destroyed components call `stop()` first, so the order above holds.

## Custom fields with `props`

Both methods take an optional `props` bag for app-defined fields — `category`, `action`, `label`, `cookies`, or anything else — values must be `string | number | boolean | null`:

```ts
tracker.track("checkout_completed", { category: "checkout", value: 42 });
tracker.trackPageview(undefined, { experiment: "pricing-v2" });
```

`props` is also how you drive per-event queue routing on the collector side — see [`createRoutingQueueAdapter`](/guides/adapters/#routing-events-to-different-queues-by-props).

## How delivery actually works

"Batching" here is client-side buffering and flush *timing*, not a bulk wire format. Each event still validates and posts individually — `VantageEvent` only describes one event, not an array. What batching gets you is fewer network requests: events pile up in memory and go out together when `batchSize` or `flushIntervalMs` is hit, not on every single call to `track()`.

The auth key travels as a URL query param (`?key=...`) rather than a header, because `navigator.sendBeacon` — used for the tab-close flush — can't set custom headers, and both transports need to authenticate the same way. If your collector sits behind something that strips query strings or logs full URLs (careful with the latter — see [Best practices](/guides/best-practices/#dont-log-auth-keys)), account for that.

Two delivery paths:

- **Normal flush** (interval elapsed, or `batchSize` reached, or `flush()` called): `fetch` with `keepalive: true`.
- **Tab hidden** (`visibilitychange` → `hidden`, e.g. closing or backgrounding the tab): `navigator.sendBeacon`, which survives page unload in a way a normal `fetch` might not. Events tracked while the page is already hidden skip the buffer and go out immediately the same way.

Delivery is best-effort. A failed `fetch` is swallowed, not retried — the tracker doesn't buffer to `localStorage` and retry on the next page load (every event has a unique `event_id`, so stores can safely dedupe if retries are added later). If you're seeing meaningful event loss in the field, that's the first place to extend, not a sign something's broken.

## Custom events need a name

```ts
tracker.track("signup_clicked"); // fine
tracker.track(""); // rejected by validateEvent — Handler.ingest returns 400
```

`type: "custom"` requires a valid `name` (lowercase dotted segments); `type: "pageview"` doesn't use `name` at all. Both share the same `VantageEvent` shape validated by `@usevantage/core`'s `validateEvent` — see [`api/core/functions/validateEvent`](/api/core/functions/validateEvent/) for the full rule set.

## Schema version

Every event the tracker sends carries `v: 2` (`EVENT_SCHEMA_VERSION`). If you upgrade `@usevantage/tracker` and `@usevantage/core` independently — likely, since the tracker ships to browsers on your own release cadence while the collector deploys separately — a version mismatch fails validation loudly (`400`, "unsupported schema version") instead of silently misparsing. Keep both packages' major versions in step across a schema bump.
