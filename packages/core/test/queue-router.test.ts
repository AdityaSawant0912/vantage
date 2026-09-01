import { describe, expect, it, vi } from "vitest";
import { createRoutingQueueAdapter } from "../src/queue-router.js";
import { runQueueAdapterContractTests } from "./contracts/queue-adapter.contract.js";
import type { QueueAdapter } from "../src/queue-adapter.js";
import type { ScopedEvent } from "../src/source.js";

// ponytail: a minimal in-process double rather than importing
// adapter-memory's MemoryQueueAdapter, which would make core depend on a
// package that itself depends on core.
class FakeQueueAdapter implements QueueAdapter {
  private queue: ScopedEvent[] = [];
  private handler: ((event: ScopedEvent) => Promise<void>) | null = null;

  async push(event: ScopedEvent): Promise<void> {
    this.queue.push(event);
    this.drain();
  }

  consume(handler: (event: ScopedEvent) => Promise<void>): void {
    this.handler = handler;
    this.drain();
  }

  private drain(): void {
    if (!this.handler) return;
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (event) void this.handler(event);
    }
  }
}

function eventWithProps(props: ScopedEvent["props"]): ScopedEvent {
  return { v: 1, type: "pageview", url: "https://example.com/", timestamp: Date.now(), sourceId: "test-source", props };
}

describe("createRoutingQueueAdapter", () => {
  it("routes to the queue matching resolve()'s return value", async () => {
    const queueX = new FakeQueueAdapter();
    const queueY = new FakeQueueAdapter();
    const receivedX: ScopedEvent[] = [];
    const receivedY: ScopedEvent[] = [];
    queueX.consume((event) => {
      receivedX.push(event);
      return Promise.resolve();
    });
    queueY.consume((event) => {
      receivedY.push(event);
      return Promise.resolve();
    });

    const router = createRoutingQueueAdapter({
      queues: { x: queueX, y: queueY },
      resolve: (event) => (event.props?.category === "x" ? "x" : "y"),
    });

    await router.push(eventWithProps({ category: "x" }));
    await router.push(eventWithProps({ category: "y" }));

    expect(receivedX).toHaveLength(1);
    expect(receivedY).toHaveLength(1);
  });

  it("falls back to default when resolve()'s key isn't in queues", async () => {
    const fallback = new FakeQueueAdapter();
    const received: ScopedEvent[] = [];
    fallback.consume((event) => {
      received.push(event);
      return Promise.resolve();
    });

    const router = createRoutingQueueAdapter({
      queues: {},
      resolve: () => "unmapped-key",
      default: fallback,
    });

    await router.push(eventWithProps({}));

    expect(received).toHaveLength(1);
  });

  it("rejects push() when resolve()'s key isn't in queues and there's no default", async () => {
    const router = createRoutingQueueAdapter({
      queues: {},
      resolve: () => "unmapped-key",
    });

    await expect(router.push(eventWithProps({}))).rejects.toThrow();
  });

  it("a single consume() handler receives events from every underlying queue", async () => {
    const queueX = new FakeQueueAdapter();
    const queueY = new FakeQueueAdapter();
    const router = createRoutingQueueAdapter({
      queues: { x: queueX, y: queueY },
      resolve: (event) => String(event.props?.category ?? "y"),
    });

    const received: ScopedEvent[] = [];
    router.consume((event) => {
      received.push(event);
      return Promise.resolve();
    });

    await router.push(eventWithProps({ category: "x" }));
    await router.push(eventWithProps({ category: "y" }));

    await vi.waitFor(() => {
      expect(received).toHaveLength(2);
    });
  });
});

// Proves the router is itself a conformant QueueAdapter — a plain
// pass-through to a single default queue must behave identically to that
// queue alone.
runQueueAdapterContractTests(() =>
  createRoutingQueueAdapter({
    queues: {},
    resolve: () => "unmatched",
    default: new FakeQueueAdapter(),
  }),
);
