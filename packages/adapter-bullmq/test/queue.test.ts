import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ScopedEvent } from "@usevantage/core";
import { runQueueAdapterContractTests } from "../../core/test/contracts/queue-adapter.contract.js";
import { BullMQQueueAdapter } from "../src/queue.js";

const redisUrl = new URL(process.env.VANTAGE_TEST_REDIS_URL ?? "redis://127.0.0.1:6379");
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };

// Real Redis persists across runs — each adapter gets its own queue name so
// tests never see each other's jobs. Requires `docker compose up -d redis`.
const opened: Array<{ adapter: BullMQQueueAdapter; queue: Queue }> = [];
function create(): { adapter: BullMQQueueAdapter; queue: Queue } {
  const queue = new Queue(`vantage-test-${randomUUID()}`, { connection });
  const adapter = new BullMQQueueAdapter({ queue, connection });
  opened.push({ adapter, queue });
  return { adapter, queue };
}

afterAll(async () => {
  for (const { adapter, queue } of opened) {
    await adapter.close();
    // the "rejects push" test closes its queue early; cleanup must tolerate that
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }
});

runQueueAdapterContractTests(() => create().adapter);

function event(): ScopedEvent {
  return {
    v: 2,
    type: "pageview",
    event_id: randomUUID(),
    anon_id: "anon-1",
    session_id: "sess-1",
    url: "https://example.com/",
    timestamp: Date.now(),
    sourceId: "test-source",
    receivedAt: Date.now(),
  };
}

describe("BullMQQueueAdapter", () => {
  it("retries a handler that throws until it succeeds", async () => {
    const { adapter } = create();
    let calls = 0;
    adapter.consume(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
    });

    await adapter.push(event());

    await vi.waitFor(() => expect(calls).toBe(2), { timeout: 10_000 });
  });

  it("does not duplicate a job when the same event is pushed twice while pending", async () => {
    const { adapter, queue } = create();
    const e = event();

    await adapter.push(e);
    await adapter.push({ ...e });

    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("rejects push when the queue cannot enqueue", async () => {
    const { adapter, queue } = create();
    await queue.close();

    await expect(adapter.push(event())).rejects.toThrow();
  });
});
