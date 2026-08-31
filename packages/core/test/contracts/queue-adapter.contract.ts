import { describe, expect, it, vi } from "vitest";
import type { QueueAdapter } from "../../src/queue-adapter.js";
import type { ScopedEvent } from "../../src/source.js";

const sampleEvent: ScopedEvent = {
  v: 1,
  type: "pageview",
  url: "https://example.com/",
  timestamp: Date.now(),
  sourceId: "test-source",
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

      await adapter.push({ ...sampleEvent, url: "https://example.com/a" });
      await adapter.push({ ...sampleEvent, url: "https://example.com/b" });

      await vi.waitFor(() => {
        expect(received).toHaveLength(2);
      });
    });
  });
}
