import type { ScopedEvent, SourceId, StoreAdapter } from "@usevantage/core";

/**
 * In-process store. `getEvents` is a test/inspection hook, not part of
 * the StoreAdapter contract — real read paths land in Phase 5 once the
 * dashboard's query shape is known.
 */
export class MemoryStoreAdapter implements StoreAdapter {
  private events: ScopedEvent[] = [];

  async write(event: ScopedEvent): Promise<void> {
    this.events.push(event);
  }

  getEvents(sourceId?: SourceId): ScopedEvent[] {
    return sourceId ? this.events.filter((e) => e.sourceId === sourceId) : [...this.events];
  }
}
