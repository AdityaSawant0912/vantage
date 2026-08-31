import { describe, expect, it, vi } from "vitest";
import { processEvent } from "../src/process-event.js";
import type { StoreAdapter } from "../src/store-adapter.js";
import type { ScopedEvent } from "../src/source.js";

const event: ScopedEvent = {
  v: 1,
  type: "pageview",
  url: "https://example.com/",
  timestamp: Date.now(),
  sourceId: "source-1",
};

describe("processEvent", () => {
  it("writes the event to the store adapter", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const store: StoreAdapter = { write };
    await processEvent(event, store);
    expect(write).toHaveBeenCalledWith(event);
  });
});
