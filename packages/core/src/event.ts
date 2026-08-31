/**
 * Bumped on any breaking change to the event shape. Lets a tracker and
 * collector deployed independently detect a mismatch instead of silently
 * misparsing each other's payloads.
 */
export const EVENT_SCHEMA_VERSION = 1;

export type EventType = "pageview" | "custom";

export interface VantageEvent {
  v: typeof EVENT_SCHEMA_VERSION;
  type: EventType;
  /** Required when type is "custom"; ignored for "pageview". */
  name?: string;
  url: string;
  referrer?: string | null;
  /** Client-supplied epoch ms. */
  timestamp: number;
}

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
  if (e.type !== "pageview" && e.type !== "custom") {
    errors.push('type must be "pageview" or "custom"');
  }
  if (e.type === "custom" && (typeof e.name !== "string" || e.name.length === 0)) {
    errors.push('name is required when type is "custom"');
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

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, event: e as unknown as VantageEvent };
}
