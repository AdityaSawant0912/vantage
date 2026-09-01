import { validateEvent } from "./event.js";
import type { QueueAdapter } from "./queue-adapter.js";
import type { SourceId } from "./source.js";

/** Input to {@link createHandler}'s `ingest`, transport-agnostic. */
export interface IngestRequest {
  /** Caller-supplied credential, resolved to a sourceId via `HandlerOptions.resolveSourceId`. */
  authKey: string;
  /** Parsed JSON body — parsing itself is the caller's (transport's) job. */
  body: unknown;
}

/**
 * Outcome of `ingest`: 202 once enqueued, 400 on schema errors, 401 for an
 * unresolvable auth key, 500 if the queue adapter rejected the push.
 */
export type IngestResult =
  | { status: 202 }
  | { status: 400; errors: string[] }
  | { status: 401 }
  | { status: 500; error: string };

export interface HandlerOptions {
  /** Where validated, scoped events are enqueued. */
  queueAdapter: QueueAdapter;
  /** Resolves an auth key to a sourceId, or null/undefined if the key is unknown. Runs before anything reaches an adapter — this is the one place tenant scoping happens. */
  resolveSourceId: (authKey: string) => SourceId | null | undefined | Promise<SourceId | null | undefined>;
}

/**
 * `Handler.ingest` is the sole entry point from transport into core:
 * resolve the auth key to a sourceId, validate the event shape, enqueue
 * it scoped to that source. Stateless — safe to run N-wide behind a load
 * balancer from day one, with no dependency on which QueueAdapter is
 * wired in.
 *
 * @param options - Queue adapter and auth-key resolver to wire up.
 * @returns An object exposing `ingest(request)`.
 */
export function createHandler(options: HandlerOptions): { ingest(request: IngestRequest): Promise<IngestResult> } {
  return {
    async ingest(request) {
      const sourceId = await options.resolveSourceId(request.authKey);
      if (!sourceId) return { status: 401 };

      const result = validateEvent(request.body);
      if (!result.ok) return { status: 400, errors: result.errors };

      try {
        await options.queueAdapter.push({ ...result.event, sourceId });
        return { status: 202 };
      } catch (err) {
        return { status: 500, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
