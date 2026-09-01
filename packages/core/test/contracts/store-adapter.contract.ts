import { describe, expect, it } from "vitest";
import type { StoreAdapter } from "../../src/store-adapter.js";
import type { ScopedEvent, SourceId } from "../../src/source.js";

function eventFor(sourceId: SourceId, url: string, props?: ScopedEvent["props"]): ScopedEvent {
  return { v: 1, type: "pageview", url, timestamp: Date.now(), sourceId, ...(props ? { props } : {}) };
}

/**
 * Shared contract every StoreAdapter implementation must pass unchanged.
 * `readEventsForSource` is a test-only inspection hook (StoreAdapter
 * itself has no read method yet — Phase 5 defines the dashboard's query
 * shape) that lets this suite prove real isolation: adding a formal read
 * method to the interface now would force every adapter to implement
 * queries nothing calls yet.
 *
 * Call from an adapter package's own test file, e.g.:
 *
 *   runStoreAdapterContractTests(() => new MemoryStoreAdapter(), {
 *     readEventsForSource: (adapter, sourceId) => adapter.getEvents(sourceId),
 *   });
 */
export function runStoreAdapterContractTests<A extends StoreAdapter>(
  createAdapter: () => A,
  options: { readEventsForSource: (adapter: A, sourceId: SourceId) => Promise<ScopedEvent[]> | ScopedEvent[] },
): void {
  describe("StoreAdapter contract", () => {
    it("writes a scoped event without throwing", async () => {
      const adapter = createAdapter();
      await expect(adapter.write(eventFor("test-source", "https://example.com/"))).resolves.toBeUndefined();
    });

    it("isolates writes by sourceId — one source's events never appear under another's", async () => {
      const adapter = createAdapter();
      await adapter.write(eventFor("source-a", "https://a.example/"));
      await adapter.write(eventFor("source-b", "https://b.example/"));

      const aEvents = await options.readEventsForSource(adapter, "source-a");
      const bEvents = await options.readEventsForSource(adapter, "source-b");

      expect(aEvents).toHaveLength(1);
      expect(aEvents[0]?.url).toBe("https://a.example/");
      expect(bEvents).toHaveLength(1);
      expect(bEvents[0]?.url).toBe("https://b.example/");
    });

    it("persists props unchanged", async () => {
      const adapter = createAdapter();
      const props = { category: "checkout", value: 42, converted: true, note: null };
      await adapter.write(eventFor("test-source", "https://example.com/", props));

      const events = await options.readEventsForSource(adapter, "test-source");
      expect(events).toHaveLength(1);
      expect(events[0]?.props).toEqual(props);
    });
  });
}
