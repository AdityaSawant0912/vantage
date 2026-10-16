import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "../src/tracker.js";

const opts = { endpoint: "https://collector.example/event", authKey: "key1", batchSize: 1, autoPageview: false, persistQueue: true } as const;

function stored(): Array<{ event_id: string; name?: string }> {
  return JSON.parse(window.localStorage.getItem("vantage_queue") ?? "[]") as Array<{ event_id: string; name?: string }>;
}

/** Lets the fire-and-forget fetch promise chains settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("persistQueue", () => {
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

  it("writes nothing to localStorage by default", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const tracker = createTracker({ ...opts, persistQueue: false });
    tracker.track("a");
    await settle();

    expect(window.localStorage.getItem("vantage_queue")).toBeNull();
  });

  it("removes an event once the collector accepts it", async () => {
    const tracker = createTracker(opts);
    tracker.track("a");
    await settle();

    expect(stored()).toEqual([]);
  });

  it("keeps events that failed (network error, 5xx) and drops 4xx", async () => {
    const tracker = createTracker(opts);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    tracker.track("network");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    tracker.track("server-error");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    tracker.track("rejected");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    tracker.track("unauthorized");
    await settle();

    expect(stored().map((e) => e.name)).toEqual(["network", "server-error"]);
  });

  it("resends leftover events with the same event_id on the next load, then clears them", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    createTracker(opts).track("lost");
    await settle();
    const [leftover] = stored();
    expect(leftover?.name).toBe("lost");

    // next page load, collector reachable again
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    createTracker(opts);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as { event_id: string; name: string };
    expect(body).toMatchObject({ event_id: leftover?.event_id, name: "lost" });
    expect(stored()).toEqual([]);
  });

  it("keeps only the newest 200 events, dropping the oldest", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const tracker = createTracker(opts);
    for (let i = 0; i < 205; i++) tracker.track(`e${i}`);
    await settle();

    const names = stored().map((e) => e.name);
    expect(names).toHaveLength(200);
    expect(names[0]).toBe("e5");
    expect(names.at(-1)).toBe("e204");
  });

  it("drops a beacon-sent event when the browser queued it, keeps it when the browser refused", () => {
    const beacon = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const tracker = createTracker(opts);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });

    tracker.track("queued");
    tracker.track("refused");

    expect(stored().map((e) => e.name)).toEqual(["refused"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disable() clears the persisted queue so withdrawn consent can't be sent later", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const tracker = createTracker(opts);
    tracker.track("a");
    await settle();
    expect(stored()).toHaveLength(1);

    tracker.disable();

    expect(stored()).toEqual([]);
  });

  it("ignores a corrupt stored queue", async () => {
    window.localStorage.setItem("vantage_queue", "{not json");
    expect(() => createTracker(opts)).not.toThrow();
    window.localStorage.setItem("vantage_queue", JSON.stringify({ not: "an array" }));
    expect(() => createTracker(opts)).not.toThrow();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
