import type { VantageEvent } from "./event.js";

/** Opaque per-tenant identifier resolved from an auth key. */
export type SourceId = string;

/**
 * An event once Handler has resolved and attached its sourceId. This —
 * not the raw client-sent VantageEvent — is what QueueAdapter and
 * StoreAdapter implementations see. Resolution happens once, in Handler,
 * before anything reaches an adapter; adapters are trusted to receive
 * already-scoped calls and must not re-derive or re-check tenant
 * identity themselves, or isolation becomes an adapter-by-adapter bug
 * surface instead of a single guarantee.
 */
export interface ScopedEvent extends VantageEvent {
  sourceId: SourceId;
}
