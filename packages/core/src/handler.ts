import { validateEvent } from "./event.js";
import type { QueueAdapter } from "./queue-adapter.js";
import type { SourceId } from "./source.js";

export interface IngestRequest {
  authKey: string;
  /** Parsed JSON body — parsing itself is the caller's (transport's) job. */
  body: unknown;
}

export type IngestResult =
  | { status: 202 }
  | { status: 400; errors: string[] }
  | { status: 401 }
  | { status: 500; error: string };

export interface HandlerOptions {
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
