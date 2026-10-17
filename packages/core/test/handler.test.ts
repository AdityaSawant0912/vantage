import { describe, expect, it, vi } from "vitest";
import { createHandler } from "../src/handler.js";
import type { QueueAdapter } from "../src/queue-adapter.js";
import type { ScopedEvent } from "../src/source.js";

function stubQueue(push: QueueAdapter["push"] = vi.fn().mockResolvedValue(undefined)): QueueAdapter {
  return { push, consume: vi.fn() };
}

const validBody = { v: 2, type: "pageview", event_id: "11111111-1111-4111-8111-111111111111", anon_id: "anon-1", session_id: "sess-1", url: "https://example.com/", timestamp: Date.now() };

describe("createHandler().ingest", () => {
  it("honours per-handler limits without affecting other handlers", async () => {
    const body = { ...validBody, props: { s: "x".repeat(600) } };
    const loose = createHandler({ queueAdapter: stubQueue(), resolveSourceId: () => "s", limits: { maxPropsStringLength: 1000 } });
    const strict = createHandler({ queueAdapter: stubQueue(), resolveSourceId: () => "s" });
    expect((await loose.ingest({ authKey: "k", body })).status).toBe(202);
    expect((await strict.ingest({ authKey: "k", body })).status).toBe(400);
    const tiny = createHandler({ queueAdapter: stubQueue(), resolveSourceId: () => "s", limits: { maxBodyBytes: 50 } });
    expect((await tiny.ingest({ authKey: "k", body: validBody })).status).toBe(400);
  });

  it("returns 401 for an unresolvable auth key", async () => {
    const handler = createHandler({ queueAdapter: stubQueue(), resolveSourceId: () => null });
    const result = await handler.ingest({ authKey: "bad", body: validBody });
    expect(result).toEqual({ status: 401 });
  });

  it("returns 400 for an invalid event body", async () => {
    const handler = createHandler({ queueAdapter: stubQueue(), resolveSourceId: () => "source-1" });
    const result = await handler.ingest({ authKey: "key", body: { v: 2 } });
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

  it("stamps receivedAt with server time, not the client timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    try {
      const push = vi.fn().mockResolvedValue(undefined);
      const handler = createHandler({ queueAdapter: stubQueue(push), resolveSourceId: () => "source-1" });
      await handler.ingest({ authKey: "key", body: { ...validBody, timestamp: 42 } });
      const pushed = push.mock.calls[0]?.[0] as ScopedEvent;
      expect(pushed.receivedAt).toBe(1_700_000_000_000);
      expect(pushed.timestamp).toBe(42);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 400 for a v1 event, an empty identify user_id, and over-limit props", async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ queueAdapter: stubQueue(push), resolveSourceId: () => "source-1" });
    for (const body of [
      { ...validBody, v: 1 },
      { ...validBody, type: "identify", user_id: "" },
      { ...validBody, props: { s: "x".repeat(513) } },
    ]) {
      expect((await handler.ingest({ authKey: "key", body })).status).toBe(400);
    }
    expect(push).not.toHaveBeenCalled();
  });

  it("returns 400 when the body exceeds the byte limit, even if each prop is within limits", async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const handler = createHandler({ queueAdapter: stubQueue(push), resolveSourceId: () => "source-1" });
    const props = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`k${i}`, "x".repeat(400)]));
    const result = await handler.ingest({ authKey: "key", body: { ...validBody, props } });
    expect(result.status).toBe(400);
    expect(push).not.toHaveBeenCalled();
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
