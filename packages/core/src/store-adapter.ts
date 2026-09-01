import type { ScopedEvent } from "./source.js";

/**
 * Write surface for processed events, scoped by source. Adapters receive
 * only already-scoped events (sourceId resolved by Handler, see
 * ScopedEvent) and are trusted to persist that scoping as-is. Read
 * methods for the dashboard's per-source query path are added in Phase 5
 * once that read shape is known — adding them speculatively now would
 * force every adapter to implement queries nothing calls yet.
 */
export interface StoreAdapter {
  /** Persists one already-scoped event. */
  write(event: ScopedEvent): Promise<void>;
}
