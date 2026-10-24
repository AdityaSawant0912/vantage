import { resolveLimits, validateEvent, type EventLimits } from "./event.js";
import type { QueueAdapter } from "./queue-adapter.js";
import type { SourceId } from "./source.js";

/** UTF-8 byte length without TextEncoder/Buffer, which core's lib config doesn't include. */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

// Core's lib config has no Node types; declare only what the env fallback touches (absent in browsers).
declare const process: { env?: Record<string, string | undefined> } | undefined;

/**
 * Picks the resolver `ingest` uses: `resolveSourceId` (multi-source, key required),
 * else a fixed sourceId from `options.sourceId` or `VANTAGE_SOURCE_ID` (single-source,
 * key ignored). Throws on missing or ambiguous config so a misdeployed collector
 * fails at startup, not with a 401 on every event.
 */
function resolveSourceResolver(options: HandlerOptions): (authKey: string) => SourceId | null | undefined | Promise<SourceId | null | undefined> {
  if (options.resolveSourceId) {
    if (options.sourceId) throw new Error("createHandler: pass either resolveSourceId or sourceId, not both");
    return options.resolveSourceId;
  }
  const fixed = options.sourceId ?? (typeof process !== "undefined" ? process.env?.VANTAGE_SOURCE_ID : undefined);
  if (!fixed) throw new Error("createHandler: set resolveSourceId, sourceId, or the VANTAGE_SOURCE_ID env var");
  return () => fixed;
}

/** Input to {@link createHandler}'s `ingest`, transport-agnostic. */
export interface IngestRequest {
  /** Caller-supplied credential, resolved to a sourceId via `HandlerOptions.resolveSourceId`. Ignored in single-source mode (`HandlerOptions.sourceId`). */
  authKey?: string;
  /** Parsed JSON body — parsing itself is the caller's (transport's) job. */
  body: unknown;
}

/**
 * Outcome of `ingest`: 202 once enqueued, 400 on schema errors, 401 for an
 * unresolvable auth key (never in single-source mode), 500 if the queue adapter rejected the push.
 */
export type IngestResult =
  | { status: 202 }
  | { status: 400; errors: string[] }
  | { status: 401 }
  | { status: 500; error: string };

export interface HandlerOptions {
  /** Where validated, scoped events are enqueued. */
  queueAdapter: QueueAdapter;
  /** Resolves an auth key to a sourceId, or null/undefined if the key is unknown. Runs before anything reaches an adapter — this is the one place tenant scoping happens. Multi-source setups; single-source setups can use `sourceId` instead. */
  resolveSourceId?: (authKey: string) => SourceId | null | undefined | Promise<SourceId | null | undefined>;
  /**
   * Single-source mode: every event is scoped to this sourceId and no auth key is
   * checked. Falls back to the `VANTAGE_SOURCE_ID` env var when omitted. Passing
   * both this and `resolveSourceId` throws; an env-supplied id alongside
   * `resolveSourceId` is ignored.
   */
  sourceId?: SourceId;
  /** Per-handler overrides of {@link EVENT_LIMITS} (which env vars already adjust globally). */
  limits?: Partial<EventLimits>;
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
  const limits = resolveLimits(options.limits);
  const resolveSource = resolveSourceResolver(options);
  return {
    async ingest(request) {
      const sourceId = await resolveSource(request.authKey ?? "");
      if (!sourceId) return { status: 401 };

      // Measured on the parsed body; a raw-bytes cap before JSON.parse is the transport's job.
      const bodyBytes = utf8ByteLength(JSON.stringify(request.body) ?? "");
      if (bodyBytes > limits.maxBodyBytes) {
        return { status: 400, errors: [`body exceeds ${limits.maxBodyBytes} bytes`] };
      }

      const result = validateEvent(request.body, limits);
      if (!result.ok) return { status: 400, errors: result.errors };

      try {
        await options.queueAdapter.push({ ...result.event, sourceId, receivedAt: Date.now() });
        return { status: 202 };
      } catch (err) {
        return { status: 500, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
