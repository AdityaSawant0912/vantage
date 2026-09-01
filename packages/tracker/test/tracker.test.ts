import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "../src/tracker.js";

describe("createTracker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
    expect(body).toMatchObject({ v: 1, type: "pageview", url: "https://example.test/landing" });
  });

  it("attaches props to a custom event when given", () => {
    const tracker = createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });
    fetchMock.mockClear();

    tracker.track("purchase", { category: "checkout", value: 42 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.props).toEqual({ category: "checkout", value: 42 });
  });

  it("omits props entirely when not given", () => {
    createTracker({ endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("props");
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
});
