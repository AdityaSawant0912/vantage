import { describe, expect, it } from "vitest";
import type { StoreAdapter } from "../../src/store-adapter.js";
import type { ScopedEvent } from "../../src/source.js";

const sampleEvent: ScopedEvent = {
  v: 1,
  type: "pageview",
  url: "https://example.com/",
  timestamp: Date.now(),
  sourceId: "test-source",
};

/**
 * Shared contract every StoreAdapter implementation must pass unchanged.
 * Call from an adapter package's own test file, e.g.:
 *
 *   runStoreAdapterContractTests(() => new MemoryStoreAdapter());
 *
 * Read-path assertions are added once Phase 5 defines the dashboard's
 * query shape — StoreAdapter has no read methods yet.
 */
export function runStoreAdapterContractTests(createAdapter: () => StoreAdapter): void {
  describe("StoreAdapter contract", () => {
    it("writes a scoped event without throwing", async () => {
      const adapter = createAdapter();
      await expect(adapter.write(sampleEvent)).resolves.toBeUndefined();
    });
  });
}
