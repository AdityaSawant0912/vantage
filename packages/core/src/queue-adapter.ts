import type { ScopedEvent } from "./source.js";

/**
 * The queue boundary between Handler.ingest and processEvent. Every
 * worker process, at every scale, is exactly
 * `queueAdapter.consume(event => processEvent(event, storeAdapter))` —
 * adapters own the consume loop; they must not expose a caller-owned
 * poll() instead.
 *
 * `push()` delivery semantics are fixed across every adapter
 * (adapter-memory, adapter-redis, …): it must reject if the event could
 * not be durably enqueued. Handler.ingest is responsible for turning a
 * rejection into an error response to the client. An adapter that
 * resolves successfully despite failing to enqueue would make Handler's
 * error handling fork depending on which adapter happens to be wired in.
 */
export interface QueueAdapter {
  push(event: ScopedEvent): Promise<void>;
  consume(handler: (event: ScopedEvent) => Promise<void>): void;
}
