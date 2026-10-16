import type { ScopedEvent, SourceId, StoreAdapter } from "@usevantage/core";

/**
 * In-process store. `getEvents` is a test/inspection hook, not part of
 * the StoreAdapter contract — real read paths land in Phase 5 once the
 * dashboard's query shape is known.
 */
export class MemoryStoreAdapter implements StoreAdapter {
  private events: ScopedEvent[] = [];
  private seen = new Set<string>();

  /** Appends the event unless this source has already stored its `event_id` (idempotent). */
  async write(event: ScopedEvent): Promise<void> {
    const key = `${event.sourceId}:${event.event_id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.events.push(event);
  }

  /** Returns all stored events, or only those for `sourceId` if given. */
  getEvents(sourceId?: SourceId): ScopedEvent[] {
    return sourceId ? this.events.filter((e) => e.sourceId === sourceId) : [...this.events];
  }
}
