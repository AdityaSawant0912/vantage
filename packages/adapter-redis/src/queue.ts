import Redis, { type RedisOptions } from "ioredis";
import type { QueueAdapter, ScopedEvent } from "usevantage";

export interface RedisQueueAdapterOptions {
  /** A connection string (e.g. "redis://127.0.0.1:6379") or ioredis options. */
  redis: string | RedisOptions;
  /** Redis list key used as the queue. Default "vantage:events". */
  key?: string;
}

/**
 * A Redis LIST as a FIFO queue: push() is LPUSH, the consume loop is a
 * blocking BRPOP on its own connection (BRPOP occupies the connection
 * for the duration of the block, so it can't share one with push()).
 * push() rejects if LPUSH fails, matching the fixed push() semantics
 * from PLAN.md §5 — same as adapter-memory.
 */
export class RedisQueueAdapter implements QueueAdapter {
  private readonly key: string;
  private readonly pushClient: Redis;
  private consumeClient: Redis | null = null;
  private handler: ((event: ScopedEvent) => Promise<void>) | null = null;
  private stopped = false;
  private loopPromise: Promise<void> | null = null;

  constructor(options: RedisQueueAdapterOptions) {
    this.key = options.key ?? "vantage:events";
    this.pushClient = typeof options.redis === "string" ? new Redis(options.redis) : new Redis(options.redis);
  }

  async push(event: ScopedEvent): Promise<void> {
    await this.pushClient.lpush(this.key, JSON.stringify(event));
  }

  consume(handler: (event: ScopedEvent) => Promise<void>): void {
    this.handler = handler;
    this.consumeClient = this.pushClient.duplicate();
    this.loopPromise = this.loop();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let result: [string, string] | null;
      try {
        // 1s poll timeout so `stopped` gets rechecked instead of blocking forever.
        result = await this.consumeClient?.brpop(this.key, 1) ?? null;
      } catch (err) {
        if (this.stopped) return;
        console.error("RedisQueueAdapter: BRPOP failed", err);
        continue;
      }
      if (!result) continue;

      const [, raw] = result;
      const event = JSON.parse(raw) as ScopedEvent;
      try {
        await this.handler?.(event);
      } catch (err) {
        // ponytail: log and continue; retry/DLQ policy is a future
        // enhancement, not required by the shared contract tests.
        console.error("RedisQueueAdapter: consumer threw", err);
      }
    }
  }

  /** Not part of QueueAdapter — closes both connections for test/shutdown cleanup. */
  async close(): Promise<void> {
    this.stopped = true;
    await this.loopPromise;
    await this.pushClient.quit();
    await this.consumeClient?.quit();
  }
}
