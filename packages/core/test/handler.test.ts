import { describe, expect, it, vi } from "vitest";
import { createHandler } from "../src/handler.js";
import type { QueueAdapter } from "../src/queue-adapter.js";
import type { ScopedEvent } from "../src/source.js";

function stubQueue(push: QueueAdapter["push"] = vi.fn().mockResolvedValue(undefined)): QueueAdapter {
  return { push, consume: vi.fn() };
}

const validBody = { v: 1, type: "pageview", url: "https://example.com/", timestamp: Date.now() };

describe("createHandler().ingest", () => {
  it("returns 401 for an unresolvable auth key", async () => {
    const handler = createHandler({ queueAdapter: stubQueue(), resolveSourceId: () => null });
    const result = await handler.ingest({ authKey: "bad", body: validBody });
    expect(result).toEqual({ status: 401 });
  });

  it("returns 400 for an invalid event body", async () => {
    const handler = createHandler({ queueAdapter: stubQueue(), resolveSourceId: () => "source-1" });
    const result = await handler.ingest({ authKey: "key", body: { v: 1 } });
    expect(result.status).toBe(400);
  });

  it("pushes a scoped event and returns 202 on success", async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ queueAdapter: stubQueue(push), resolveSourceId: () => "source-1" });
    const result = await handler.ingest({ authKey: "key", body: validBody });
    expect(result).toEqual({ status: 202 });
    const pushed = push.mock.calls[0]?.[0] as ScopedEvent;
    expect(pushed.sourceId).toBe("source-1");
    expect(pushed.url).toBe(validBody.url);
  });

  it("returns 500 if the queue adapter rejects", async () => {
    const push = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const handler = createHandler({ queueAdapter: stubQueue(push), resolveSourceId: () => "source-1" });
    const result = await handler.ingest({ authKey: "key", body: validBody });
    expect(result).toEqual({ status: 500, error: "queue unavailable" });
  });

  it("supports an async resolveSourceId", async () => {
    const handler = createHandler({
      queueAdapter: stubQueue(),
      resolveSourceId: async (authKey) => (authKey === "key" ? "source-1" : null),
    });
    const result = await handler.ingest({ authKey: "key", body: validBody });
    expect(result).toEqual({ status: 202 });
  });
});
