import { describe, expect, it } from "vitest";
import { EVENT_SCHEMA_VERSION, validateEvent } from "../src/index.js";

describe("@usevantage/core barrel export", () => {
  it("re-exports the event schema API", () => {
    expect(EVENT_SCHEMA_VERSION).toBe(2);
    expect(
      validateEvent({ v: 2, type: "pageview", event_id: "11111111-1111-4111-8111-111111111111", anon_id: "anon-1", session_id: "sess-1", url: "https://example.com/", timestamp: Date.now() }).ok,
    ).toBe(true);
  });
});
