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
