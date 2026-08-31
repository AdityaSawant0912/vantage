import { describe, expect, it, vi } from "vitest";
import { createHandler, processEvent } from "usevantage";
import { MemoryQueueAdapter } from "../src/queue.js";
import { MemoryStoreAdapter } from "../src/store.js";

describe("in-memory end-to-end path", () => {
  it("delivers a POSTed event into the store", async () => {
    const queueAdapter = new MemoryQueueAdapter();
    const storeAdapter = new MemoryStoreAdapter();
    queueAdapter.consume((event) => processEvent(event, storeAdapter));

    const handler = createHandler({
      queueAdapter,
      resolveSourceId: (authKey) => (authKey === "test-key" ? "source-1" : null),
    });

    const result = await handler.ingest({
      authKey: "test-key",
      body: { v: 1, type: "pageview", url: "https://example.com/", timestamp: Date.now() },
    });

    expect(result).toEqual({ status: 202 });
    await vi.waitFor(() => {
      expect(storeAdapter.getEvents()).toHaveLength(1);
    });
    expect(storeAdapter.getEvents("source-1")).toHaveLength(1);
    expect(storeAdapter.getEvents("other-source")).toHaveLength(0);
  });

  it("rejects an unknown auth key before anything reaches the queue", async () => {
    const queueAdapter = new MemoryQueueAdapter();
    const storeAdapter = new MemoryStoreAdapter();
    queueAdapter.consume((event) => processEvent(event, storeAdapter));

    const handler = createHandler({ queueAdapter, resolveSourceId: () => null });
    const result = await handler.ingest({
      authKey: "unknown",
      body: { v: 1, type: "pageview", url: "https://example.com/", timestamp: Date.now() },
    });

    expect(result).toEqual({ status: 401 });
    expect(storeAdapter.getEvents()).toHaveLength(0);
  });
});
