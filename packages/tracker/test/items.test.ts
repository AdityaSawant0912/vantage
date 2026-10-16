import { validateEvent } from "@usevantage/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createItemTracker, type ItemTracker } from "../src/items.js";
import { createTracker, type Tracker } from "../src/tracker.js";
import { MockIntersectionObserver, mockIO, setVisibility } from "./helpers/mock-io.js";

type Sent = Record<string, unknown> & { name?: string; props?: Record<string, unknown> };

describe("createItemTracker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let tracker: Tracker;
  let items: ItemTracker;

  function sent(): Sent[] {
    return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as Sent);
  }
  function names(): Array<string | undefined> {
    return sent().map((e) => e.name ?? (e.type as string));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    window.localStorage.clear();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    MockIntersectionObserver.instances = [];

    tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "k", batchSize: 1, autoPageview: false });
    items = createItemTracker(tracker, { deps: { IntersectionObserver: mockIO } });
  });

  afterEach(() => {
    items.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits a flat item.impression with raw measurements when stop() is called", () => {
    const el = document.createElement("div");
    const stop = items.observe(el, { itemType: "post", itemId: "665f", placement: "feed", feed: "news", position: 7 });
    MockIntersectionObserver.last.fire(el, true, 0.6);
    vi.advanceTimersByTime(2500);
    stop();

    const [impression] = sent();
    expect(impression).toMatchObject({ type: "custom", name: "item.impression" });
    expect(impression?.props).toEqual({
      item_type: "post",
      item_id: "665f",
      placement: "feed",
      feed: "news",
      position: 7,
      first_seen_at: 1_700_000_000_000,
      visible_ms: 2500,
      max_visible_pct: 60,
      end_reason: "stopped",
    });
  });

  it("omits optional item fields that weren't given and emits nothing for an unseen element", () => {
    const seen = document.createElement("div");
    const unseen = document.createElement("div");
    const stopSeen = items.observe(seen, { itemType: "post", itemId: "1" });
    const stopUnseen = items.observe(unseen, { itemType: "post", itemId: "2" });
    MockIntersectionObserver.last.fire(seen, true);
    vi.advanceTimersByTime(100);
    stopSeen();
    stopUnseen();

    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.props).not.toHaveProperty("placement");
  });

  it("emits impressions then page.leave when the page hides, with active_ms and max_scroll_pct", () => {
    const el = document.createElement("div");
    items.observe(el, { itemType: "post", itemId: "1" });
    MockIntersectionObserver.last.fire(el, true);

    vi.advanceTimersByTime(4000);
    Object.defineProperty(window, "scrollY", { value: 232, configurable: true }); // (232 + 768) / 2000 = 50%
    window.dispatchEvent(new Event("scroll"));
    setVisibility("hidden");

    expect(names()).toEqual(["item.impression", "page.leave"]);
    expect(sent()[0]?.props).toMatchObject({ visible_ms: 4000, end_reason: "hidden" });
    expect(sent()[1]?.props).toMatchObject({ active_ms: 4000, max_scroll_pct: 50, exit_kind: "hidden" });
  });

  it("stamps events from before a navigation with the old pv_id, then starts the next page clean", () => {
    tracker.trackPageview("https://example.test/a");
    const firstPv = tracker.pageviewId;
    const el = document.createElement("div");
    items.observe(el, { itemType: "post", itemId: "1" });
    MockIntersectionObserver.last.fire(el, true);
    vi.advanceTimersByTime(1000);
    fetchMock.mockClear();

    tracker.trackPageview("https://example.test/b");

    expect(names()).toEqual(["item.impression", "page.leave", "pageview"]);
    expect(sent()[0]?.props).toMatchObject({ pv_id: firstPv, end_reason: "manual" });
    expect(sent()[1]?.props).toMatchObject({ pv_id: firstPv, exit_kind: "navigation", active_ms: 1000 });
    expect(sent()[2]?.props?.pv_id).toBe(tracker.pageviewId);
    expect(tracker.pageviewId).not.toBe(firstPv);
  });

  it("endPage() emits page.leave for routers the tracker can't see", () => {
    items.endPage();
    expect(sent()[0]).toMatchObject({ name: "page.leave", props: { exit_kind: "manual" } });
  });

  it("emits item.click from data attributes via one delegated listener", () => {
    document.body.innerHTML = `
      <div id="root">
        <a data-vantage-type="post" data-vantage-id="9" data-vantage-action="share"><span id="inner">go</span></a>
        <a data-vantage-type="post"><span id="no-id">x</span></a>
      </div>
      <p id="outside" data-vantage-type="post" data-vantage-id="7">outside</p>`;
    const root = document.getElementById("root") as HTMLElement;
    const off = items.trackClicks(root);

    document.getElementById("inner")?.click();
    document.getElementById("no-id")?.click();
    document.getElementById("outside")?.click();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ name: "item.click", props: { item_type: "post", item_id: "9", action: "share" } });

    off();
    document.getElementById("inner")?.click();
    expect(sent()).toHaveLength(1);
  });

  it("only emits events core's validateEvent accepts", () => {
    const el = document.createElement("div");
    const stop = items.observe(el, { itemType: "post", itemId: "1", position: 1 });
    MockIntersectionObserver.last.fire(el, true);
    vi.advanceTimersByTime(10);
    stop();
    items.endPage();

    expect(sent().length).toBeGreaterThanOrEqual(2);
    for (const event of sent()) expect(validateEvent(event).ok).toBe(true);
  });

  it("flushes after an impression so it doesn't wait for the batch", () => {
    const bigBatch = createTracker({ endpoint: "https://collector.example/event", authKey: "k", batchSize: 50, autoPageview: false });
    const batched = createItemTracker(bigBatch, { deps: { IntersectionObserver: mockIO } });
    const el = document.createElement("div");
    const stop = batched.observe(el, { itemType: "post", itemId: "1" });
    MockIntersectionObserver.last.fire(el, true);
    vi.advanceTimersByTime(10);
    fetchMock.mockClear();

    stop();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    batched.destroy();
  });

  it("stops emitting after destroy()", () => {
    items.destroy();
    setVisibility("hidden");
    tracker.trackPageview();
    expect(names()).toEqual(["pageview"]);
  });
});
