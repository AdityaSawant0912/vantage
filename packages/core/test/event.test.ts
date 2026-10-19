import { describe, expect, it, vi } from "vitest";
import { EVENT_LIMITS, EVENT_SCHEMA_VERSION, validateEvent } from "../src/event.js";

const basePageview = {
  v: EVENT_SCHEMA_VERSION,
  type: "pageview",
  event_id: "11111111-1111-4111-8111-111111111111",
  anon_id: "anon-1",
  session_id: "sess-1",
  url: "https://example.com/",
  timestamp: Date.now(),
};

describe("validateEvent", () => {
  it("accepts a valid pageview event", () => {
    const result = validateEvent(basePageview);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid custom event with a name", () => {
    const result = validateEvent({ ...basePageview, type: "custom", name: "signup" });
    expect(result.ok).toBe(true);
  });

  it("rejects a custom event missing a name", () => {
    const result = validateEvent({ ...basePageview, type: "custom" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('name is required when type is "custom"');
  });

  it("rejects an unsupported schema version", () => {
    const result = validateEvent({ ...basePageview, v: 99 });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object input", () => {
    const result = validateEvent("not an event");
    expect(result.ok).toBe(false);
  });

  it("rejects a missing url", () => {
    const { url: _url, ...rest } = basePageview;
    const result = validateEvent(rest);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-finite timestamp", () => {
    const result = validateEvent({ ...basePageview, timestamp: Number.NaN });
    expect(result.ok).toBe(false);
  });

  it("accepts a null referrer", () => {
    const result = validateEvent({ ...basePageview, referrer: null });
    expect(result.ok).toBe(true);
  });

  it("accepts props with string, number, boolean, and null values", () => {
    const result = validateEvent({ ...basePageview, props: { category: "checkout", value: 42, converted: true, note: null } });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object props", () => {
    const result = validateEvent({ ...basePageview, props: "checkout" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("props must be an object");
  });

  it("rejects an array as props", () => {
    const result = validateEvent({ ...basePageview, props: ["checkout"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("props must be an object");
  });

  it("rejects a props value that isn't a string, number, boolean, or null", () => {
    const result = validateEvent({ ...basePageview, props: { nested: { a: 1 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("props.nested must be a string, number, boolean, or null");
  });

  it("rejects a v1 event with the unsupported-version error", () => {
    const result = validateEvent({ ...basePageview, v: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("unsupported schema version");
  });

  it("rejects a missing or malformed event_id", () => {
    const { event_id: _id, ...rest } = basePageview;
    expect(validateEvent(rest).ok).toBe(false);
    expect(validateEvent({ ...basePageview, event_id: "not-a-uuid" }).ok).toBe(false);
  });

  it.each(["anon_id", "session_id"])("rejects a missing, empty, or over-long %s", (key) => {
    expect(validateEvent({ ...basePageview, [key]: undefined }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, [key]: "" }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, [key]: "x".repeat(EVENT_LIMITS.maxIdLength + 1) }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, [key]: "x".repeat(EVENT_LIMITS.maxIdLength) }).ok).toBe(true);
  });

  it("accepts an identify event with a user_id", () => {
    expect(validateEvent({ ...basePageview, type: "identify", user_id: "user-42" }).ok).toBe(true);
  });

  it("rejects an identify event with a missing, empty, or over-long user_id", () => {
    expect(validateEvent({ ...basePageview, type: "identify" }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, type: "identify", user_id: "" }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, type: "identify", user_id: "u".repeat(EVENT_LIMITS.maxUserIdLength + 1) }).ok).toBe(false);
  });

  it("accepts an optional user_id on non-identify events, validated when present", () => {
    expect(validateEvent(basePageview).ok).toBe(true);
    expect(validateEvent({ ...basePageview, user_id: "user-42" }).ok).toBe(true);
    expect(validateEvent({ ...basePageview, user_id: "" }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, user_id: "u".repeat(EVENT_LIMITS.maxUserIdLength + 1) }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, user_id: 42 }).ok).toBe(false);
  });

  it("accepts dotted lowercase custom names and rejects others", () => {
    const custom = { ...basePageview, type: "custom" };
    expect(validateEvent({ ...custom, name: "item.impression" }).ok).toBe(true);
    expect(validateEvent({ ...custom, name: "Item.Impression" }).ok).toBe(false);
    expect(validateEvent({ ...custom, name: "item..impression" }).ok).toBe(false);
    expect(validateEvent({ ...custom, name: "a".repeat(EVENT_LIMITS.maxNameLength + 1) }).ok).toBe(false);
  });

  it("enforces props key count, key length, and string value length", () => {
    const tooMany = Object.fromEntries(Array.from({ length: EVENT_LIMITS.maxPropsKeys + 1 }, (_, i) => [`k${i}`, i]));
    expect(validateEvent({ ...basePageview, props: tooMany }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, props: { ["k".repeat(EVENT_LIMITS.maxPropsKeyLength + 1)]: 1 } }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, props: { s: "x".repeat(EVENT_LIMITS.maxPropsStringLength + 1) } }).ok).toBe(false);
    expect(validateEvent({ ...basePageview, props: { s: "x".repeat(EVENT_LIMITS.maxPropsStringLength) } }).ok).toBe(true);
  });
});

describe("EVENT_LIMITS env overrides", () => {
  it("applies valid env values and ignores invalid ones", async () => {
    vi.stubEnv("VANTAGE_MAX_PROPS_STRING_LENGTH", "2000");
    vi.stubEnv("VANTAGE_MAX_NAME_LENGTH", "nope");
    vi.resetModules();
    const mod = await import("../src/event.js");
    expect(mod.EVENT_LIMITS.maxPropsStringLength).toBe(2000);
    expect(mod.EVENT_LIMITS.maxNameLength).toBe(64);
    expect(mod.validateEvent({ ...basePageview, props: { s: "x".repeat(2000) } }).ok).toBe(true);
    vi.unstubAllEnvs();
  });
});
