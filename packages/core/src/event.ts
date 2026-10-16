/**
 * Bumped on any breaking change to the event shape. Lets a tracker and
 * collector deployed independently detect a mismatch instead of silently
 * misparsing each other's payloads.
 */
export const EVENT_SCHEMA_VERSION = 2;

/** Limits enforced by {@link validateEvent} and Handler.ingest. */
export const EVENT_LIMITS = {
  maxIdLength: 64,
  maxUserIdLength: 256,
  maxNameLength: 64,
  maxPropsKeys: 32,
  maxPropsKeyLength: 64,
  maxPropsStringLength: 512,
  maxBodyBytes: 8192,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/**
 * A pageview is a page load; a custom event is anything app-defined via
 * `name`; an identify event links the visitor's `anon_id` to a `user_id`.
 */
export type EventType = "pageview" | "custom" | "identify";

/**
 * Open extension point for app-defined fields (category, action, label,
 * cookies, or anything else) — deliberately a flat primitive bag rather
 * than a typed schema addition, so adding a new dimension never requires
 * a core change. Values used to route events (e.g. via
 * `createRoutingQueueAdapter`) must stay primitives so every StoreAdapter
 * (including adapter-postgres's JSONB column) can persist them as-is.
 */
export type EventProps = Record<string, string | number | boolean | null>;

/** The event shape shared by the tracker (what it sends) and Handler.ingest (what it accepts). */
export interface VantageEvent {
  /** Schema version this event was built against; must equal {@link EVENT_SCHEMA_VERSION}. */
  v: typeof EVENT_SCHEMA_VERSION;
  type: EventType;
  /** Idempotency key (UUID); stores must treat a repeated `event_id` as a no-op. */
  event_id: string;
  /** Per-browser visitor id, 1-64 chars. */
  anon_id: string;
  /** Rotates after inactivity, 1-64 chars. */
  session_id: string;
  /** Required (opaque, up to 256 chars) when type is "identify"; ignored otherwise. */
  user_id?: string;
  /** Required when type is "custom": lowercase dotted segments such as `item.impression`, up to 64 chars. */
  name?: string;
  /** Page URL the event was fired from. */
  url: string;
  referrer?: string | null;
  /** Client-supplied epoch ms. */
  timestamp: number;
  /** App-defined custom fields; see {@link EventProps}. */
  props?: EventProps;
}

/** Result of {@link validateEvent}: either the parsed event or the list of shape errors found. */
export type EventValidationResult =
  | { ok: true; event: VantageEvent }
  | { ok: false; errors: string[] };

/**
 * The single validator shared by the tracker (what it's allowed to send)
 * and Handler.ingest (what it accepts) — the two must never drift onto
 * different shapes.
 */
export function validateEvent(input: unknown): EventValidationResult {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["event must be an object"] };
  }
  const e = input as Record<string, unknown>;

  if (e.v !== EVENT_SCHEMA_VERSION) {
    errors.push(`unsupported schema version: expected ${EVENT_SCHEMA_VERSION}, got ${String(e.v)}`);
  }
  if (e.type !== "pageview" && e.type !== "custom" && e.type !== "identify") {
    errors.push('type must be "pageview", "custom", or "identify"');
  }
  if (typeof e.event_id !== "string" || !UUID_RE.test(e.event_id)) {
    errors.push("event_id must be a UUID string");
  }
  for (const key of ["anon_id", "session_id"] as const) {
    const value = e[key];
    if (typeof value !== "string" || value.length === 0 || value.length > EVENT_LIMITS.maxIdLength) {
      errors.push(`${key} must be a string of 1 to ${EVENT_LIMITS.maxIdLength} characters`);
    }
  }
  if (e.type === "custom") {
    if (typeof e.name !== "string" || e.name.length === 0) {
      errors.push('name is required when type is "custom"');
    } else if (e.name.length > EVENT_LIMITS.maxNameLength || !NAME_RE.test(e.name)) {
      errors.push(`name must be lowercase dotted segments (e.g. item.impression), up to ${EVENT_LIMITS.maxNameLength} characters`);
    }
  }
  if (e.type === "identify") {
    if (typeof e.user_id !== "string" || e.user_id.length === 0 || e.user_id.length > EVENT_LIMITS.maxUserIdLength) {
      errors.push(`user_id must be a string of 1 to ${EVENT_LIMITS.maxUserIdLength} characters when type is "identify"`);
    }
  }
  if (typeof e.url !== "string" || e.url.length === 0) {
    errors.push("url must be a non-empty string");
  }
  if (e.referrer !== undefined && e.referrer !== null && typeof e.referrer !== "string") {
    errors.push("referrer must be a string or null");
  }
  if (typeof e.timestamp !== "number" || !Number.isFinite(e.timestamp)) {
    errors.push("timestamp must be a finite number");
  }
  if (e.props !== undefined) {
    if (typeof e.props !== "object" || e.props === null || Array.isArray(e.props)) {
      errors.push("props must be an object");
    } else {
      const entries = Object.entries(e.props);
      if (entries.length > EVENT_LIMITS.maxPropsKeys) {
        errors.push(`props must have at most ${EVENT_LIMITS.maxPropsKeys} keys`);
      }
      for (const [key, value] of entries) {
        if (key.length > EVENT_LIMITS.maxPropsKeyLength) {
          errors.push(`props key "${key.slice(0, 16)}..." exceeds ${EVENT_LIMITS.maxPropsKeyLength} characters`);
        }
        if (typeof value === "string" && value.length > EVENT_LIMITS.maxPropsStringLength) {
          errors.push(`props.${key} exceeds ${EVENT_LIMITS.maxPropsStringLength} characters`);
        }
        if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
          errors.push(`props.${key} must be a string, number, boolean, or null`);
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, event: e as unknown as VantageEvent };
}
