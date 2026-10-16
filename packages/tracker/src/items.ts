import type { EventProps } from "@usevantage/core";
import type { Tracker } from "./tracker.js";
import { createActivityClock, createVisibilityObserver, type EndReason, type VisibilityMeasurement, type VisibilityObserverOptions } from "./visibility.js";

/** Describes a tracked element; every field becomes a flat prop on its events. */
export interface ItemMeta {
  itemType: string;
  itemId: string;
  placement?: string;
  feed?: string;
  position?: number;
}

export interface ItemTrackerOptions {
  /** Inactivity after which visible time stops accruing. Default 30000. */
  idleMs?: number;
  /** Injection points for tests; passed through to the visibility observer. */
  deps?: VisibilityObserverOptions["deps"];
}

export interface ItemTracker {
  /** Measures `el`; emits `item.impression` when the returned `stop()` is called, the page view changes, or the page hides. */
  observe(el: Element, meta: ItemMeta): () => void;
  /**
   * Delegated click tracking under `root`: any click inside an element with
   * `data-vantage-type` and `data-vantage-id` emits `item.click` (with
   * `data-vantage-action` as `action`, if present). Returns an unsubscribe function.
   */
  trackClicks(root: Element | Document): () => void;
  /** Ends every open measurement, emits `page.leave`, and flushes — for router changes the tracker can't see. */
  endPage(): void;
  /** Ends and removes everything this tracker set up. */
  destroy(): void;
}

/** Why a `page.leave` was emitted. */
type ExitKind = "navigation" | "hidden" | "manual";

function scrollPct(): number {
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight;
  if (!scrollable) return 0;
  return Math.min(100, Math.round(((window.scrollY + window.innerHeight) / scrollable) * 100));
}

function compact(props: Record<string, string | number | boolean | undefined>): EventProps {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as EventProps;
}

/**
 * Item impressions, clicks and page-leave events on top of the visibility
 * module. Sends raw measurements only — deciding what counts as "viewable"
 * is the consumer's job, not the client's. Framework wrappers (an Angular
 * `[skTrackItem]` directive, say) are recipes in the docs, not shipped here.
 *
 * @param tracker - The tracker events are sent through.
 * @param options - Idle cutoff and test `deps`.
 */
export function createItemTracker(tracker: Tracker, options: ItemTrackerOptions = {}): ItemTracker {
  const clock = options.deps?.clock ?? createActivityClock({ idleMs: options.idleMs, now: options.deps?.now });
  const metas = new Map<Element, ItemMeta>();
  let pageActiveStart = clock.activeMs();
  let maxScroll = scrollPct();

  function flush(): void {
    // A hidden page was already flushed via sendBeacon by the tracker itself.
    if (document.visibilityState !== "hidden") void tracker.flush();
  }

  function emitImpression(m: VisibilityMeasurement, reason: EndReason): void {
    const meta = metas.get(m.el);
    if (!meta) return;
    tracker.track(
      "item.impression",
      compact({
        item_type: meta.itemType,
        item_id: meta.itemId,
        placement: meta.placement,
        feed: meta.feed,
        position: meta.position,
        first_seen_at: m.firstSeenAt,
        visible_ms: Math.round(m.visibleMs),
        max_visible_pct: Math.round(m.maxVisiblePct),
        end_reason: reason,
      }),
    );
  }

  const vis = createVisibilityObserver({
    thresholds: [0, 0.25, 0.5, 0.75, 1],
    idleMs: options.idleMs,
    onEnd: emitImpression,
    deps: { ...options.deps, clock },
  });

  function leavePage(kind: ExitKind): void {
    vis.endAll(kind === "hidden" ? "hidden" : "manual");
    maxScroll = Math.max(maxScroll, scrollPct());
    const activeNow = clock.activeMs();
    tracker.track("page.leave", {
      active_ms: Math.round(activeNow - pageActiveStart),
      max_scroll_pct: maxScroll,
      exit_kind: kind,
    });
    pageActiveStart = activeNow;
    maxScroll = scrollPct();
    flush();
  }

  const onScroll = (): void => {
    maxScroll = Math.max(maxScroll, scrollPct());
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") leavePage("hidden");
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  // Runs before the tracker swaps pv_id, so these events carry the page view they belong to.
  const offBeforePageview = tracker.onBeforePageview(() => leavePage("navigation"));

  return {
    observe(el, meta) {
      metas.set(el, meta);
      const stopVis = vis.observe(el, { key: `${meta.itemType}:${meta.itemId}` });
      return () => {
        stopVis(); // fires onEnd synchronously, which still needs the meta
        metas.delete(el);
        flush();
      };
    },
    trackClicks(root) {
      const onClick = (event: Event): void => {
        const target = event.target instanceof Element ? event.target.closest("[data-vantage-type]") : null;
        if (!target || !root.contains(target)) return;
        const itemType = target.getAttribute("data-vantage-type");
        const itemId = target.getAttribute("data-vantage-id");
        if (!itemType || !itemId) return;
        tracker.track("item.click", compact({ item_type: itemType, item_id: itemId, action: target.getAttribute("data-vantage-action") ?? undefined }));
      };
      root.addEventListener("click", onClick);
      return () => root.removeEventListener("click", onClick);
    },
    endPage: () => leavePage("manual"),
    destroy() {
      offBeforePageview();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      vis.destroy();
      if (!options.deps?.clock) clock.dispose();
      metas.clear();
    },
  };
}
