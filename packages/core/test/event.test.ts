import { describe, expect, it } from "vitest";
import { EVENT_SCHEMA_VERSION, validateEvent } from "../src/event.js";

const basePageview = {
  v: EVENT_SCHEMA_VERSION,
  type: "pageview",
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
});
