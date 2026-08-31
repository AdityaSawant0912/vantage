import { describe, expect, it } from "vitest";
import { EVENT_SCHEMA_VERSION, validateEvent } from "../src/index.js";

describe("@usevantage/core barrel export", () => {
  it("re-exports the event schema API", () => {
    expect(EVENT_SCHEMA_VERSION).toBe(1);
    expect(
      validateEvent({ v: 1, type: "pageview", url: "https://example.com/", timestamp: Date.now() }).ok,
    ).toBe(true);
  });
});
