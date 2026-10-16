import { describe, expect, it, vi } from "vitest";
import { processEvent } from "../src/process-event.js";
import type { StoreAdapter } from "../src/store-adapter.js";
import type { ScopedEvent } from "../src/source.js";

const event: ScopedEvent = {
  v: 2,
  type: "pageview",
  event_id: "11111111-1111-4111-8111-111111111111",
  anon_id: "anon-1",
  session_id: "sess-1",
  url: "https://example.com/",
  timestamp: Date.now(),
  sourceId: "source-1",
  receivedAt: Date.now(),
};

describe("processEvent", () => {
  it("writes the event to the store adapter", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const store: StoreAdapter = { write };
    await processEvent(event, store);
    expect(write).toHaveBeenCalledWith(event);
  });
});
