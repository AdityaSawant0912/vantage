import { afterEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "../src/tracker.js";
import { startLocalCollector, type LocalCollector } from "./helpers/local-collector.js";

describe("tracker -> local collector", () => {
  let collector: LocalCollector | undefined;

  afterEach(async () => {
    await collector?.close();
    collector = undefined;
  });

  it("delivers a real pageview event through fetch into the in-memory store", async () => {
    collector = await startLocalCollector();

    createTracker({ endpoint: `${collector.url}/event`, authKey: "test-key", batchSize: 1 });

    await vi.waitFor(() => {
      expect(collector?.store.getEvents()).toHaveLength(1);
    });
    const [event] = collector.store.getEvents();
    expect(event).toMatchObject({ type: "pageview", sourceId: "source-1" });
  });

  it("does not reach the store for an unknown auth key", async () => {
    collector = await startLocalCollector();

    createTracker({ endpoint: `${collector.url}/event`, authKey: "wrong-key", batchSize: 1 });

    // give the (rejected) request a tick to resolve, then confirm nothing landed
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(collector.store.getEvents()).toHaveLength(0);
  });
});
