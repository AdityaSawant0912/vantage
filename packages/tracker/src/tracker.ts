import type { EventProps, VantageEvent } from "@usevantage/core";

export interface TrackerOptions {
  /** Collector ingest URL, e.g. "https://analytics.example.com/api/event". */
  endpoint: string;
  /** Sent as a URL query param on every request (see below for why). */
  authKey: string;
  /** Buffered events before an automatic flush. Default 10. */
  batchSize?: number;
  /** Max time between flushes, ms. Default 5000. */
  flushIntervalMs?: number;
  /** Fire a pageview when the tracker is created. Default true; set false when a router drives pageviews (e.g. Angular). */
  autoPageview?: boolean;
  /** Inactivity before `session_id` rotates, ms. Default 1800000 (30 min). */
  sessionTimeoutMs?: number;
  /**
   * Keep unsent events in localStorage (newest 200; oldest dropped) and retry them on the
   * next page load. An event leaves the queue once the collector answers 2xx or 4xx (a 4xx
   * will never succeed); network errors and 5xx keep it. Default false.
   */
  persistQueue?: boolean;
}

export interface Tracker {
  /** Records a pageview for `url` (default: current page) and starts a new `pageviewId`. `props` is app-defined, e.g. for queue routing. */
  trackPageview(url?: string, props?: EventProps): void;
  /** Records a custom event with the given name (lowercase dotted segments, e.g. "item.click"). `props` is app-defined, e.g. for queue routing. */
  track(name: string, props?: EventProps): void;
  /** Sends one `identify` event linking this visitor to `userId`, and stamps `user_id` on every later event (persisted in localStorage, so it survives reloads until `reset()`). */
  identify(userId: string): void;
  /** For logout: rotates both `session_id` and `anon_id` and forgets the `user_id`, so the next visitor isn't linked to the previous user. */
  reset(): void;
  /**
   * Registers a listener called just before each `trackPageview` replaces `pageviewId`,
   * so per-page work (e.g. flushing impressions) is still stamped with the old page view id.
   * Returns an unsubscribe function.
   */
  onBeforePageview(listener: () => void): () => void;
  /** Stops capture and drops buffered events (consent hook). */
  disable(): void;
  /** Resumes capture after {@link Tracker.disable}. */
  enable(): void;
  /** Sends any buffered events immediately, bypassing batchSize/flushIntervalMs; resolves once every request has settled. */
  flush(): Promise<void>;
  /** Id of the current page view (also attached to later events as the `pv_id` prop); undefined before the first pageview. */
  readonly pageviewId: string | undefined;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const ANON_KEY = "vantage_anon_id";
const USER_KEY = "vantage_user_id";
const SESSION_KEY = "vantage_session";
const QUEUE_KEY = "vantage_queue";
const MAX_PERSISTED = 200;

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for non-secure contexts (randomUUID is HTTPS-only): RFC 4122 v4 shape from Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** localStorage with an in-memory fallback — storage can throw (Safari private mode, blocked cookies). */
function createStorage(): { get(key: string): string | null; set(key: string, value: string): void } {
  const memory = new Map<string, string>();
  return {
    get(key) {
      try {
        return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // memory copy above is the fallback
      }
    },
  };
}

/**
 * "Batching" here means client-side buffering and flush timing, not a
 * bulk wire format — the event schema (@usevantage/core's VantageEvent)
 * validates one event per request, so each flushed event is still POSTed
 * individually. The auth key travels as a URL query param rather than a
 * header because navigator.sendBeacon can't set custom headers, and both
 * transports need to authenticate the same way.
 *
 * @param options - Endpoint, auth key, and batching/session config.
 * @returns A {@link Tracker}; it has already fired an initial pageview unless `autoPageview` is false.
 */
export function createTracker(options: TrackerOptions): Tracker {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const ingestUrl = `${options.endpoint}?key=${encodeURIComponent(options.authKey)}`;
  const storage = createStorage();
  const persist = options.persistQueue ?? false;
  let buffer: VantageEvent[] = [];
  let enabled = true;
  let pageviewId: string | undefined;
  const beforePageview = new Set<() => void>();

  let anonId = storage.get(ANON_KEY) ?? uuid();
  storage.set(ANON_KEY, anonId);

  // "" is how reset() clears it (storage has no remove); falsy means anonymous.
  let userId = storage.get(USER_KEY) || undefined;

  let session = readSession();

  function readSession(): { id: string; lastActivity: number } {
    try {
      const parsed = JSON.parse(storage.get(SESSION_KEY) ?? "null") as { id?: unknown; lastActivity?: unknown } | null;
      if (parsed && typeof parsed.id === "string" && typeof parsed.lastActivity === "number") {
        return { id: parsed.id, lastActivity: parsed.lastActivity };
      }
    } catch {
      // corrupt value — start a fresh session
    }
    return { id: uuid(), lastActivity: Date.now() };
  }

  /** Returns the live session id, rotating it first if the visitor was inactive past the timeout. */
  function touchSession(now: number): string {
    if (now - session.lastActivity > sessionTimeoutMs) session = { id: uuid(), lastActivity: now };
    session.lastActivity = now;
    storage.set(SESSION_KEY, JSON.stringify(session));
    return session.id;
  }

  function base(type: VantageEvent["type"], url: string, props?: EventProps): VantageEvent {
    const now = Date.now();
    const merged: EventProps = { ...(pageviewId ? { pv_id: pageviewId } : {}), ...props };
    return {
      v: 2,
      type,
      event_id: uuid(),
      anon_id: anonId,
      session_id: touchSession(now),
      ...(userId ? { user_id: userId } : {}),
      url,
      timestamp: now,
      ...(Object.keys(merged).length > 0 ? { props: merged } : {}),
    };
  }

  // ponytail: whole-list read-modify-write on every change (<= 200 small events), and two tabs
  // can race on it. Both are harmless: a lost entry is lost best-effort delivery, and
  // event_id makes any resend a no-op. Add per-event keys if that ever matters.
  function readQueue(): VantageEvent[] {
    try {
      const parsed: unknown = JSON.parse(storage.get(QUEUE_KEY) ?? "[]");
      return Array.isArray(parsed) ? (parsed as VantageEvent[]).filter((e) => typeof e === "object" && e !== null) : [];
    } catch {
      return [];
    }
  }

  function writeQueue(events: VantageEvent[]): void {
    storage.set(QUEUE_KEY, JSON.stringify(events.slice(-MAX_PERSISTED)));
  }

  function remember(event: VantageEvent): void {
    if (persist) writeQueue([...readQueue(), event]);
  }

  function forget(event: VantageEvent): void {
    if (persist) writeQueue(readQueue().filter((e) => e.event_id !== event.event_id));
  }

  function enqueue(event: VantageEvent): void {
    if (!enabled) return;
    remember(event);
    buffer.push(event);
    // A hidden page may be unloaded at any moment, so don't wait for the batch to fill.
    if (document.visibilityState === "hidden") void flush(true);
    else if (buffer.length >= batchSize) void flush(false);
  }

  function trackPageview(url: string = window.location.href, props?: EventProps): void {
    for (const listener of [...beforePageview]) listener();
    pageviewId = uuid();
    enqueue({ ...base("pageview", url, props), referrer: document.referrer || null });
  }

  function track(name: string, props?: EventProps): void {
    enqueue({ ...base("custom", window.location.href, props), name });
  }

  function identify(id: string): void {
    userId = id;
    storage.set(USER_KEY, id);
    enqueue(base("identify", window.location.href));
  }

  function send(event: VantageEvent, useBeacon: boolean): Promise<void> {
    const body = JSON.stringify(event);
    if (useBeacon && navigator.sendBeacon) {
      // The browser reports only whether it queued the beacon, not whether the
      // collector accepted it; `false` (over the size limit etc.) stays persisted.
      if (navigator.sendBeacon(ingestUrl, body)) forget(event);
      return Promise.resolve();
    }
    return fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).then(
      (res) => {
        // 4xx will never succeed on retry (bad key, invalid event), so don't keep it.
        if (res.status < 500) forget(event);
      },
      () => {
        // Network error: stays persisted when persistQueue is on, otherwise best-effort.
      },
    );
  }

  function flush(useBeacon: boolean): Promise<void> {
    if (buffer.length === 0) return Promise.resolve();
    const events = buffer;
    buffer = [];
    return Promise.all(events.map((event) => send(event, useBeacon))).then(() => undefined);
  }

  setInterval(() => void flush(false), flushIntervalMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });

  // Resend what an earlier page load couldn't deliver; the collector dedupes by event_id.
  if (persist) for (const event of readQueue()) void send(event, false);

  if (options.autoPageview ?? true) trackPageview();

  return {
    trackPageview,
    track,
    identify,
    reset() {
      anonId = uuid();
      storage.set(ANON_KEY, anonId);
      userId = undefined;
      storage.set(USER_KEY, "");
      session = { id: uuid(), lastActivity: Date.now() };
      storage.set(SESSION_KEY, JSON.stringify(session));
      pageviewId = undefined;
    },
    onBeforePageview(listener) {
      beforePageview.add(listener);
      return () => void beforePageview.delete(listener);
    },
    disable() {
      enabled = false;
      buffer = [];
      if (persist) writeQueue([]); // withdrawn consent: nothing may be sent later
    },
    enable() {
      enabled = true;
    },
    flush: () => flush(false),
    get pageviewId() {
      return pageviewId;
    },
  };
}
