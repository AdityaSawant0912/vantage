import type { VantageEvent } from "@usevantage/core";

export interface TrackerOptions {
  /** Collector ingest URL, e.g. "https://analytics.example.com/api/event". */
  endpoint: string;
  /** Sent as a URL query param on every request (see below for why). */
  authKey: string;
  /** Buffered events before an automatic flush. Default 10. */
  batchSize?: number;
  /** Max time between flushes, ms. Default 5000. */
  flushIntervalMs?: number;
}

export interface Tracker {
  /** Records a pageview for `url` (default: current page). */
  trackPageview(url?: string): void;
  /** Records a custom event with the given name. */
  track(name: string): void;
  /** Sends any buffered events immediately, bypassing batchSize/flushIntervalMs. */
  flush(): void;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * "Batching" here means client-side buffering and flush timing, not a
 * bulk wire format — the event schema (@usevantage/core's VantageEvent)
 * validates one event per request, so each flushed event is still POSTed
 * individually. The auth key travels as a URL query param rather than a
 * header because navigator.sendBeacon can't set custom headers, and both
 * transports need to authenticate the same way.
 *
 * @param options - Endpoint, auth key, and batching config.
 * @returns A {@link Tracker} that has already fired an initial pageview.
 */
export function createTracker(options: TrackerOptions): Tracker {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const ingestUrl = `${options.endpoint}?key=${encodeURIComponent(options.authKey)}`;
  let buffer: VantageEvent[] = [];

  function enqueue(event: VantageEvent): void {
    buffer.push(event);
    if (buffer.length >= batchSize) flush(false);
  }

  function trackPageview(url: string = window.location.href): void {
    enqueue({
      v: 1,
      type: "pageview",
      url,
      referrer: document.referrer || null,
      timestamp: Date.now(),
    });
  }

  function track(name: string): void {
    enqueue({
      v: 1,
      type: "custom",
      name,
      url: window.location.href,
      timestamp: Date.now(),
    });
  }

  function send(event: VantageEvent, useBeacon: boolean): void {
    const body = JSON.stringify(event);
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ingestUrl, body);
      return;
    }
    fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // ponytail: delivery from the browser is best-effort, not retried
      // client-side. Add retry/localStorage buffering if field drop rate
      // turns out to matter.
    });
  }

  function flush(useBeacon: boolean): void {
    if (buffer.length === 0) return;
    const events = buffer;
    buffer = [];
    for (const event of events) send(event, useBeacon);
  }

  setInterval(() => flush(false), flushIntervalMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });

  trackPageview();

  return { trackPageview, track, flush: () => flush(false) };
}
