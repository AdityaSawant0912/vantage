import type { QueueAdapter } from "./queue-adapter.js";
import type { ScopedEvent } from "./source.js";

export interface RoutingQueueAdapterOptions {
  /** Named target queues; `resolve`'s return value selects one of these keys. */
  queues: Record<string, QueueAdapter>;
  /** Picks which queue an event goes to, e.g. by `event.props.category`. */
  resolve: (event: ScopedEvent) => string;
  /** Used when `resolve`'s return value isn't a key in `queues`. */
  default?: QueueAdapter;
}

/**
 * A QueueAdapter that fans out to other QueueAdapters by a user-supplied
 * resolver — e.g. routing events to different queues by `props.category`.
 * Handler is unchanged by this: it's just another QueueAdapter, wired in
 * wherever a single one is expected.
 */
export function createRoutingQueueAdapter(options: RoutingQueueAdapterOptions): QueueAdapter {
  const targets = new Set(Object.values(options.queues));
  if (options.default) targets.add(options.default);

  function resolveTarget(event: ScopedEvent): QueueAdapter | undefined {
    return options.queues[options.resolve(event)] ?? options.default;
  }

  return {
    /** Resolves the target queue and delegates; rejects if none matched and no default is set. */
    async push(event: ScopedEvent): Promise<void> {
      const target = resolveTarget(event);
      if (!target) {
        throw new Error(`createRoutingQueueAdapter: no queue for resolved key and no default set`);
      }
      await target.push(event);
    },

    /** Registers the same handler on every underlying queue so all of them drain into it. */
    consume(handler: (event: ScopedEvent) => Promise<void>): void {
      for (const target of targets) target.consume(handler);
    },
  };
}
