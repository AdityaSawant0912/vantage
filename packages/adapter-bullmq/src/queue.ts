import { Worker, type ConnectionOptions, type Queue } from "bullmq";
import type { QueueAdapter, ScopedEvent } from "@usevantage/core";

export interface BullMQQueueAdapterOptions {
  /** The BullMQ queue events are pushed onto. Created and owned by the caller. */
  queue: Queue;
  /**
   * Connection for the consume-side Worker. Pass plain options (the adapter
   * sets `maxRetriesPerRequest: null`, which BullMQ requires for workers) or
   * an ioredis instance you already configured that way.
   */
  connection: ConnectionOptions;
  /** Jobs processed in parallel by `consume`. Default 10. */
  concurrency?: number;
}

const JOB_NAME = "event";

/**
 * Same {@link QueueAdapter} contract as every other adapter: `push()`
 * rejects if the job wasn't enqueued, `consume()` owns the worker loop.
 * Jobs are keyed by `sourceId:event_id`, so a retried push of the same
 * event doesn't duplicate — but that only holds while the job still
 * exists (completed jobs are removed), so StoreAdapter idempotency by
 * `event_id` remains the real exactly-once-effect guarantee. A handler
 * that throws makes BullMQ retry (5 attempts, exponential backoff from
 * 1s); the last 1000 failed jobs are kept for inspection.
 */
export class BullMQQueueAdapter implements QueueAdapter {
  private readonly queue: Queue;
  private readonly connection: ConnectionOptions;
  private readonly concurrency: number;
  private worker: Worker | null = null;

  /** Stores the caller-supplied queue and worker connection; opens nothing until `consume`. */
  constructor(options: BullMQQueueAdapterOptions) {
    this.queue = options.queue;
    this.connection = options.connection;
    this.concurrency = options.concurrency ?? 10;
  }

  /** Adds the event as a job; rejects if BullMQ/Redis fails to enqueue it. */
  async push(event: ScopedEvent): Promise<void> {
    await this.queue.add(JOB_NAME, event, {
      // Custom job ids can't contain ":" in BullMQ — hence "|".
      jobId: `${event.sourceId}|${event.event_id}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  }

  /** Starts a Worker on the queue's name; a throwing handler triggers BullMQ's retry. */
  consume(handler: (event: ScopedEvent) => Promise<void>): void {
    const connection: ConnectionOptions =
      "options" in this.connection || "status" in this.connection
        ? this.connection
        : { ...(this.connection as object), maxRetriesPerRequest: null };
    this.worker = new Worker<ScopedEvent>(this.queue.name, (job) => handler(job.data), {
      connection,
      concurrency: this.concurrency,
    });
    this.worker.on("error", (err) => console.error("BullMQQueueAdapter: worker error", err));
  }

  /** Not part of QueueAdapter — closes the worker (waiting for in-flight jobs) for test/shutdown cleanup. The caller closes its own Queue. */
  async close(): Promise<void> {
    await this.worker?.close();
  }
}
