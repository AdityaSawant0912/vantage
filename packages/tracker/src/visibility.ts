/**
 * Visible-time measurement for DOM elements, built on IntersectionObserver.
 * Sends no events and doesn't depend on the tracker — `@usevantage/tracker/items`
 * builds on it, and apps can use it directly.
 */

/** Why a measurement ended: `stop()` on the element, the page hiding, or an explicit `endAll()`. */
export type EndReason = "stopped" | "hidden" | "manual";

/** One element's measurement, handed to `onEnd`. */
export interface VisibilityMeasurement {
  el: Element;
  /** Caller-supplied identity for the element, from `observe`. */
  key: string;
  /** Epoch ms when the element first became visible in this measurement. */
  firstSeenAt: number;
  /** Time the element was intersecting while the user was active (page visible, window focused, recent input). */
  visibleMs: number;
  /** Highest intersection ratio seen, as a percentage (0-100). */
  maxVisiblePct: number;
}

/** Tracks how long the user has actively been on the page. */
export interface ActivityClock {
  /** True while the page is visible, the window focused, and the last input was within `idleMs`. */
  isActive(): boolean;
  /** Total active milliseconds so far; monotonic. */
  activeMs(): number;
  /** Removes the clock's event listeners. */
  dispose(): void;
}

export interface ActivityClockOptions {
  /** Inactivity after which the user stops counting as active. Default 30000. */
  idleMs?: number;
  /** Time source, for tests. Default `Date.now`. */
  now?: () => number;
}

export interface VisibilityObserverOptions {
  /** Intersection thresholds. Default `[0, 0.25, 0.5, 0.75, 1]`. */
  thresholds?: number[];
  /** Idle cutoff for the built-in activity clock. Default 30000. Ignored if `deps.clock` is given. */
  idleMs?: number;
  /** Called when an element's measurement ends. Never called for an element that was never seen. */
  onEnd: (measurement: VisibilityMeasurement, reason: EndReason) => void;
  /** Injection points so tests are deterministic. */
  deps?: {
    IntersectionObserver?: typeof IntersectionObserver;
    /** Share one clock across several observers (and with `page.leave`'s `active_ms`). */
    clock?: ActivityClock;
    now?: () => number;
  };
}

export interface VisibilityObserver {
  /** Starts measuring `el`; returns `stop()`, which ends its measurement with reason "stopped". */
  observe(el: Element, options: { key: string }): () => void;
  /** Ends every open measurement. Elements stay observed and start a fresh measurement if still on screen. */
  endAll(reason?: EndReason): void;
  /** Ends everything with reason "manual", disconnects the observer and removes listeners. */
  destroy(): void;
}

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
const DEFAULT_IDLE_MS = 30000;
const DEFAULT_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

/** Whether the current environment has IntersectionObserver; when false, `observe` is a no-op. */
export function isSupported(): boolean {
  return typeof IntersectionObserver !== "undefined";
}

/**
 * Counts active time: only while the page is visible, the window is
 * focused, and the last input (pointer, key, wheel, touch, scroll) was
 * within `idleMs`. Computed lazily from timestamps — no timers.
 */
export function createActivityClock(options: ActivityClockOptions = {}): ActivityClock {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const now = options.now ?? Date.now;

  let focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  const eligible = (): boolean => document.visibilityState !== "hidden" && focused;

  let accumulated = 0;
  let lastInput = now();
  let segmentStart: number | null = eligible() ? lastInput : null;

  /** Folds the open segment into `accumulated` up to `t`, capped where the idle window expired. */
  function settle(t: number): void {
    if (segmentStart === null) return;
    const end = Math.min(t, lastInput + idleMs);
    if (end > segmentStart) accumulated += end - segmentStart;
    segmentStart = t;
  }

  function onInput(): void {
    const t = now();
    settle(t);
    lastInput = t;
    if (segmentStart === null && eligible()) segmentStart = t;
  }

  function recheck(): void {
    const t = now();
    settle(t);
    const wasRunning = segmentStart !== null;
    segmentStart = eligible() ? t : null;
    // Coming back to the page counts as activity.
    if (!wasRunning && segmentStart !== null) lastInput = t;
  }

  const onFocus = (): void => {
    focused = true;
    recheck();
  };
  const onBlur = (): void => {
    focused = false;
    recheck();
  };

  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true, capture: true });
  document.addEventListener("visibilitychange", recheck);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);

  return {
    isActive: () => eligible() && now() - lastInput <= idleMs,
    activeMs() {
      settle(now());
      return accumulated;
    },
    dispose() {
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    },
  };
}

interface ElementState {
  key: string;
  intersecting: boolean;
  /** Latest intersection ratio (0-1). */
  ratio: number;
  /** True once the element has been seen in the current measurement. */
  started: boolean;
  firstSeenAt: number;
  visibleMs: number;
  maxVisiblePct: number;
  /** Clock reading when the current intersecting stretch began; null when not accruing. */
  mark: number | null;
}

/**
 * One shared IntersectionObserver per instance. An element's visible time
 * is the activity-clock time that passed while it was intersecting, so
 * scroll-backs accumulate and blur/hide/idle pause accrual automatically.
 *
 * @param options - Thresholds, idle cutoff, `onEnd` callback, and test `deps`.
 * @returns A {@link VisibilityObserver}. Where IntersectionObserver is missing, `observe` returns a no-op and `onEnd` never fires.
 */
export function createVisibilityObserver(options: VisibilityObserverOptions): VisibilityObserver {
  const IO = options.deps?.IntersectionObserver ?? (isSupported() ? IntersectionObserver : undefined);
  if (!IO) return { observe: () => () => undefined, endAll: () => undefined, destroy: () => undefined };

  const now = options.deps?.now ?? Date.now;
  const ownsClock = !options.deps?.clock;
  const clock = options.deps?.clock ?? createActivityClock({ idleMs: options.idleMs, now });
  const states = new Map<Element, ElementState>();
  const isHidden = (): boolean => document.visibilityState === "hidden";

  function close(s: ElementState): void {
    if (s.mark === null) return;
    s.visibleMs += clock.activeMs() - s.mark;
    s.mark = null;
  }

  function begin(s: ElementState): void {
    if (!s.intersecting || isHidden()) return;
    if (!s.started) {
      s.started = true;
      s.firstSeenAt = now();
      s.visibleMs = 0;
      s.maxVisiblePct = s.ratio * 100;
    }
    if (s.mark === null) s.mark = clock.activeMs();
  }

  function finish(el: Element, s: ElementState, reason: EndReason): void {
    close(s);
    if (!s.started) return;
    const measurement: VisibilityMeasurement = {
      el,
      key: s.key,
      firstSeenAt: s.firstSeenAt,
      visibleMs: s.visibleMs,
      maxVisiblePct: s.maxVisiblePct,
    };
    s.started = false;
    s.visibleMs = 0;
    s.maxVisiblePct = 0;
    options.onEnd(measurement, reason);
  }

  const observer = new IO(
    (entries) => {
      for (const entry of entries) {
        const s = states.get(entry.target);
        if (!s) continue;
        const pct = entry.intersectionRatio * 100;
        s.ratio = entry.intersectionRatio;
        s.intersecting = entry.isIntersecting;
        if (s.intersecting) {
          if (s.started) s.maxVisiblePct = Math.max(s.maxVisiblePct, pct);
          begin(s);
        } else {
          close(s);
        }
      }
    },
    { threshold: options.thresholds ?? DEFAULT_THRESHOLDS },
  );

  function endAll(reason: EndReason = "manual"): void {
    for (const [el, s] of [...states]) {
      finish(el, s, reason);
      // Still on screen after a manual end: start a fresh measurement right away.
      if (reason === "manual" && states.has(el)) begin(s);
    }
  }

  function onVisibilityChange(): void {
    if (isHidden()) endAll("hidden");
    else for (const s of states.values()) begin(s);
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    observe(el, { key }) {
      if (states.has(el)) return () => undefined;
      states.set(el, { key, intersecting: false, ratio: 0, started: false, firstSeenAt: 0, visibleMs: 0, maxVisiblePct: 0, mark: null });
      observer.observe(el);
      return () => {
        const s = states.get(el);
        if (!s) return;
        observer.unobserve(el);
        finish(el, s, "stopped");
        states.delete(el);
      };
    },
    endAll,
    destroy() {
      endAll("manual");
      states.clear();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (ownsClock) clock.dispose();
    },
  };
}
