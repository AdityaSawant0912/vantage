import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateEvent } from "@usevantage/core";
import { createTracker } from "../src/tracker.js";

describe("createTracker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends an initial pageview on creation, keyed via the URL", () => {
    createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://collector.example/event?key=key1");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ v: 2, type: "pageview", url: "https://example.test/landing" });
  });

  it("attaches props to a custom event when given", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    fetchMock.mockClear();

    tracker.track("purchase", { category: "checkout", value: 42 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.props).toEqual({ pv_id: expect.any(String), category: "checkout", value: 42 });
  });

  it("adds only the automatic pv_id prop when no props are given", () => {
    createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.props).toEqual({ pv_id: expect.any(String) });
  });

  it("buffers events until batchSize is reached", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 3 });
    fetchMock.mockClear();

    tracker.track("click");
    expect(fetchMock).not.toHaveBeenCalled();

    tracker.track("click-again");
    // buffer now holds 3 events (initial pageview + 2 custom) and flushes each individually
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses navigator.sendBeacon when the page becomes hidden", () => {
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });

    createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 10 });
    fetchMock.mockClear();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call sendBeacon when the buffer is already empty", () => {
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });

    createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    beacon.mockClear();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(beacon).not.toHaveBeenCalled();
  });

  function sentBodies(): Array<Record<string, unknown>> {
    return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
  }

  it("produces events that pass core's validateEvent (tracker/collector schema can't drift)", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    tracker.track("item.click", { position: 3 });
    tracker.identify("user-42");

    const bodies = sentBodies();
    expect(bodies.map((b) => b.type)).toEqual(["pageview", "custom", "identify"]);
    for (const body of bodies) expect(validateEvent(body).ok).toBe(true);
  });

  it("gives every event a unique event_id and a stable anon_id and session_id", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    tracker.track("a");
    tracker.track("b");

    const bodies = sentBodies();
    expect(new Set(bodies.map((b) => b.event_id)).size).toBe(3);
    expect(new Set(bodies.map((b) => b.anon_id)).size).toBe(1);
    expect(new Set(bodies.map((b) => b.session_id)).size).toBe(1);
  });

  it("reuses anon_id across tracker instances via localStorage", () => {
    createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });

    const [first, second] = sentBodies();
    expect(first?.anon_id).toBe(second?.anon_id);
  });

  it("falls back to in-memory ids when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    tracker.track("a");

    const [first, second] = sentBodies();
    expect(typeof first?.anon_id).toBe("string");
    expect(first?.anon_id).toBe(second?.anon_id);
  });

  it("rotates session_id after the inactivity timeout but keeps anon_id", () => {
    vi.useFakeTimers();
    try {
      const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1, sessionTimeoutMs: 1000 });
      vi.advanceTimersByTime(500);
      tracker.track("within");
      vi.advanceTimersByTime(1500);
      tracker.track("after");

      const [pageview, within, after] = sentBodies();
      expect(within?.session_id).toBe(pageview?.session_id);
      expect(after?.session_id).not.toBe(pageview?.session_id);
      expect(after?.anon_id).toBe(pageview?.anon_id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("identify sends one identify event and does not stamp user_id on later events", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    fetchMock.mockClear();
    tracker.identify("user-42");
    tracker.track("later");

    const [identify, later] = sentBodies();
    expect(identify).toMatchObject({ type: "identify", user_id: "user-42" });
    expect(later).not.toHaveProperty("user_id");
  });

  it("reset rotates both anon_id and session_id", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    tracker.reset();
    tracker.track("after-logout");

    const [before, after] = sentBodies();
    expect(after?.anon_id).not.toBe(before?.anon_id);
    expect(after?.session_id).not.toBe(before?.session_id);
  });

  it("skips the initial pageview when autoPageview is false", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1, autoPageview: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tracker.pageviewId).toBeUndefined();
  });

  it("attaches pv_id to later events and exposes it as pageviewId", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    tracker.track("click", { a: 1 });

    const [pageview, click] = sentBodies();
    expect((pageview?.props as Record<string, unknown>).pv_id).toBe(tracker.pageviewId);
    expect(click?.props).toEqual({ pv_id: tracker.pageviewId, a: 1 });

    const firstId = tracker.pageviewId;
    tracker.trackPageview("https://example.test/next");
    expect(tracker.pageviewId).not.toBe(firstId);
  });

  it("flushes immediately via sendBeacon for events tracked while hidden", () => {
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 10 });
    beacon.mockClear();
    fetchMock.mockClear();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    tracker.track("while-hidden");

    // the buffered initial pageview goes out together with the new event
    expect(beacon).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disable() drops the buffer and stops capture; enable() resumes", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 10 });
    tracker.disable();
    tracker.track("ignored");
    void tracker.flush();
    expect(fetchMock).not.toHaveBeenCalled();

    tracker.enable();
    tracker.track("kept");
    void tracker.flush();
    expect(sentBodies().map((b) => b.name)).toEqual(["kept"]);
  });

  it("flush() resolves after the requests settle, even if they fail", async () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 10 });
    fetchMock.mockRejectedValue(new Error("offline"));

    await expect(tracker.flush()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
