import type { QueueAdapter, ScopedEvent } from "@usevantage/core";

/**
 * In-process FIFO queue. Delivery is asynchronous (queued then drained on
 * a microtask) so behavior matches a real queue adapter's push/consume
 * split, even though nothing actually leaves the process.
 */
export class MemoryQueueAdapter implements QueueAdapter {
  private queue: ScopedEvent[] = [];
  private handler: ((event: ScopedEvent) => Promise<void>) | null = null;
  private draining = false;

  async push(event: ScopedEvent): Promise<void> {
    this.queue.push(event);
    void this.drain();
  }

  consume(handler: (event: ScopedEvent) => Promise<void>): void {
    this.handler = handler;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || !this.handler) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && this.handler) {
        const event = this.queue.shift();
        if (!event) break;
        try {
          await this.handler(event);
        } catch (err) {
          // ponytail: log and continue; retry/DLQ policy is a real queue's
          // job (adapter-redis), not the zero-infra default's.
          console.error("MemoryQueueAdapter: consumer threw", err);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
