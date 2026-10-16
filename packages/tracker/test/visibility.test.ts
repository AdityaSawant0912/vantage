import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createActivityClock,
  createVisibilityObserver,
  isSupported,
  type EndReason,
  type VisibilityMeasurement,
} from "../src/visibility.js";
import { MockIntersectionObserver, mockIO, setVisibility } from "./helpers/mock-io.js";

describe("visibility module", () => {
  let ended: Array<{ m: VisibilityMeasurement; reason: EndReason }>;
  let destroyers: Array<() => void>;

  function create(idleMs?: number) {
    const vis = createVisibilityObserver({
      idleMs,
      onEnd: (m, reason) => ended.push({ m, reason }),
      deps: { IntersectionObserver: mockIO },
    });
    destroyers.push(vis.destroy);
    return vis;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    MockIntersectionObserver.instances = [];
    ended = [];
    destroyers = [];
  });

  afterEach(() => {
    for (const destroy of destroyers) destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("measures visible time only while the element intersects", () => {
    const vis = create();
    const el = document.createElement("div");
    const stop = vis.observe(el, { key: "post:1" });

    MockIntersectionObserver.last.fire(el, true);
    vi.advanceTimersByTime(1000);
    MockIntersectionObserver.last.fire(el, false);
    vi.advanceTimersByTime(5000);
    stop();

    expect(ended).toHaveLength(1);
    expect(ended[0]?.reason).toBe("stopped");
    expect(ended[0]?.m).toMatchObject({ el, key: "post:1", visibleMs: 1000, firstSeenAt: 1_700_000_000_000 });
  });

  it("accumulates scroll-backs into one measurement and keeps the max visible percentage", () => {
    const vis = create();
    const el = document.createElement("div");
    const stop = vis.observe(el, { key: "k" });
    const io = MockIntersectionObserver.last;

    io.fire(el, true, 0.25);
    vi.advanceTimersByTime(1000);
    io.fire(el, true, 0.75);
    io.fire(el, false, 0);
    vi.advanceTimersByTime(2000);
    io.fire(el, true, 0.5);
    vi.advanceTimersByTime(500);
    stop();

    expect(ended[0]?.m.visibleMs).toBe(1500);
    expect(ended[0]?.m.maxVisiblePct).toBe(75);
  });

  it("pauses while the window is blurred and resumes on focus", () => {
    const vis = create();
    const el = document.createElement("div");
    const stop = vis.observe(el, { key: "k" });
    MockIntersectionObserver.last.fire(el, true);

    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(1000);
    stop();

    expect(ended[0]?.m.visibleMs).toBe(2000);
  });

  it("stops counting after idleMs without input, and resumes on the next input", () => {
    const vis = create(2000);
    const el = document.createElement("div");
    const stop = vis.observe(el, { key: "k" });
    MockIntersectionObserver.last.fire(el, true);

    vi.advanceTimersByTime(5000); // only the first 2000ms count
    window.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(1000);
    stop();

    expect(ended[0]?.m.visibleMs).toBe(3000);
  });

  it("ends open measurements when the page hides, and starts a fresh one when it returns", () => {
    const vis = create();
    const el = document.createElement("div");
    const stop = vis.observe(el, { key: "k" });
    MockIntersectionObserver.last.fire(el, true);

    vi.advanceTimersByTime(1000);
    setVisibility("hidden");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ reason: "hidden", m: { visibleMs: 1000 } });

    vi.advanceTimersByTime(60_000); // hidden time must not count
    setVisibility("visible");
    vi.advanceTimersByTime(500);
    stop();

    expect(ended).toHaveLength(2);
    expect(ended[1]?.m.visibleMs).toBe(500);
    expect(ended[1]?.m.firstSeenAt).toBeGreaterThan(ended[0]?.m.firstSeenAt ?? 0);
  });

  it("endAll ends every open measurement and keeps on-screen elements measured afresh", () => {
    const vis = create();
    const a = document.createElement("div");
    const b = document.createElement("div");
    const stopA = vis.observe(a, { key: "a" });
    vis.observe(b, { key: "b" });
    MockIntersectionObserver.last.fire(a, true);
    MockIntersectionObserver.last.fire(b, true);

    vi.advanceTimersByTime(1000);
    vis.endAll("manual");
    expect(ended.map((e) => [e.m.key, e.reason])).toEqual([["a", "manual"], ["b", "manual"]]);

    vi.advanceTimersByTime(300);
    stopA();
    expect(ended[2]?.m).toMatchObject({ key: "a", visibleMs: 300 });
  });

  it("never fires onEnd for an element that was never seen", () => {
    const vis = create();
    const el = document.createElement("div");
    vis.observe(el, { key: "k" })();
    expect(ended).toHaveLength(0);
  });

  it("uses one shared IntersectionObserver with the default thresholds", () => {
    const vis = create();
    vis.observe(document.createElement("div"), { key: "a" });
    vis.observe(document.createElement("div"), { key: "b" });

    expect(MockIntersectionObserver.instances).toHaveLength(1);
    expect(MockIntersectionObserver.last.init?.threshold).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(MockIntersectionObserver.last.targets.size).toBe(2);
  });

  it("is a no-op where IntersectionObserver is missing", () => {
    expect(isSupported()).toBe(false); // jsdom has none
    const onEnd = vi.fn();
    const vis = createVisibilityObserver({ onEnd });
    const stop = vis.observe(document.createElement("div"), { key: "k" });
    stop();
    vis.endAll();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe("createActivityClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("counts active time only while visible, focused, and recently active", () => {
    const clock = createActivityClock({ idleMs: 1000 });
    vi.advanceTimersByTime(600);
    expect(clock.isActive()).toBe(true);
    expect(clock.activeMs()).toBe(600);

    vi.advanceTimersByTime(2000); // idle after 1000
    expect(clock.isActive()).toBe(false);
    expect(clock.activeMs()).toBe(1000);

    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(400);
    expect(clock.isActive()).toBe(true);
    expect(clock.activeMs()).toBe(1400);

    setVisibility("hidden");
    vi.advanceTimersByTime(5000);
    expect(clock.isActive()).toBe(false);
    expect(clock.activeMs()).toBe(1400);
    clock.dispose();
  });

  it("stops listening after dispose", () => {
    const clock = createActivityClock({ idleMs: 100 });
    clock.dispose();
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("keydown")); // would restart accrual if still listening
    vi.advanceTimersByTime(50);
    expect(clock.activeMs()).toBe(100);
  });
});
