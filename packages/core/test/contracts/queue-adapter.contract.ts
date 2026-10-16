import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { QueueAdapter } from "../../src/queue-adapter.js";
import type { ScopedEvent } from "../../src/source.js";

const sampleEvent: ScopedEvent = {
  v: 2,
  type: "pageview",
  event_id: "11111111-1111-4111-8111-111111111111",
  anon_id: "anon-1",
  session_id: "sess-1",
  url: "https://example.com/",
  timestamp: Date.now(),
  sourceId: "test-source",
  receivedAt: Date.now(),
};

/**
 * Shared contract every QueueAdapter implementation must pass unchanged.
 * Call from an adapter package's own test file, e.g.:
 *
 *   runQueueAdapterContractTests(() => new MemoryQueueAdapter());
 *
 * If an adapter can't pass this without a change here, the adapter is
 * wrong, this contract is wrong, or core leaked an assumption — don't
 * loosen this file to make an adapter pass.
 */
export function runQueueAdapterContractTests(createAdapter: () => QueueAdapter): void {
  describe("QueueAdapter contract", () => {
    it("delivers a pushed event to a consumer", async () => {
      const adapter = createAdapter();
      const received: ScopedEvent[] = [];
      adapter.consume((event) => {
        received.push(event);
        return Promise.resolve();
      });

      await adapter.push(sampleEvent);

      await vi.waitFor(() => {
        expect(received).toHaveLength(1);
      });
      expect(received[0]).toEqual(sampleEvent);
    });

    it("delivers multiple pushed events", async () => {
      const adapter = createAdapter();
      const received: ScopedEvent[] = [];
      adapter.consume((event) => {
        received.push(event);
        return Promise.resolve();
      });

      await adapter.push({ ...sampleEvent, event_id: randomUUID(), url: "https://example.com/a" });
      await adapter.push({ ...sampleEvent, event_id: randomUUID(), url: "https://example.com/b" });

      await vi.waitFor(() => {
        expect(received).toHaveLength(2);
      });
    });
  });
}
