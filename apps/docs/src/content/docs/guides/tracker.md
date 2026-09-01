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

## Tracking events

```ts
tracker.trackPageview(); // uses window.location.href
tracker.trackPageview("https://example.com/other-page"); // explicit URL

tracker.track("signup_clicked");
tracker.track("checkout_completed");

tracker.flush(); // force-send whatever's buffered, don't wait for the interval
```

`createTracker` fires a pageview automatically on creation — you don't need to call `trackPageview()` yourself on page load. Call it again yourself for SPA route changes, where there's no full page load to trigger it naturally.

## How delivery actually works

"Batching" here is client-side buffering and flush *timing*, not a bulk wire format. Each event still validates and posts individually — `VantageEvent` only describes one event, not an array. What batching gets you is fewer network requests: events pile up in memory and go out together when `batchSize` or `flushIntervalMs` is hit, not on every single call to `track()`.

The auth key travels as a URL query param (`?key=...`) rather than a header, because `navigator.sendBeacon` — used for the tab-close flush — can't set custom headers, and both transports need to authenticate the same way. If your collector sits behind something that strips query strings or logs full URLs (careful with the latter — see [Best practices](/guides/best-practices/#dont-log-auth-keys)), account for that.

Two delivery paths:

- **Normal flush** (interval elapsed, or `batchSize` reached, or `flush()` called): `fetch` with `keepalive: true`.
- **Tab hidden** (`visibilitychange` → `hidden`, e.g. closing or backgrounding the tab): `navigator.sendBeacon`, which survives page unload in a way a normal `fetch` might not.

Delivery is best-effort. A failed `fetch` is swallowed, not retried — the tracker doesn't buffer to `localStorage` and retry on the next page load. If you're seeing meaningful event loss in the field, that's the first place to extend, not a sign something's broken.

## Custom events need a name

```ts
tracker.track("signup_clicked"); // fine
tracker.track(""); // rejected by validateEvent — Handler.ingest returns 400
```

`type: "custom"` requires a non-empty `name`; `type: "pageview"` doesn't use `name` at all. Both share the same `VantageEvent` shape validated by `@usevantage/core`'s `validateEvent` — see [`api/core/functions/validateEvent`](/api/core/functions/validateEvent/) for the full rule set.

## Schema version

Every event the tracker sends carries `v: 1` (`EVENT_SCHEMA_VERSION`). If you upgrade `@usevantage/tracker` and `@usevantage/core` independently — likely, since the tracker ships to browsers on your own release cadence while the collector deploys separately — a version mismatch fails validation loudly (`400`, "unsupported schema version") instead of silently misparsing. Keep both packages' major versions in step across a schema bump.
