export {
  EVENT_SCHEMA_VERSION,
  validateEvent,
  type EventType,
  type EventValidationResult,
  type VantageEvent,
} from "./event.js";
export type { ScopedEvent, SourceId } from "./source.js";
export type { QueueAdapter } from "./queue-adapter.js";
export type { StoreAdapter } from "./store-adapter.js";
