import type { ScopedEvent } from "./source.js";
import type { StoreAdapter } from "./store-adapter.js";

/**
 * Runs identically whether called inline (single process) or from a
 * worker's consume loop (scaled-out). Phase 2 is a straight write —
 * enrichment/session-stitching land here once a real requirement names
 * their shape, not before.
 */
export async function processEvent(event: ScopedEvent, storeAdapter: StoreAdapter): Promise<void> {
  await storeAdapter.write(event);
}
