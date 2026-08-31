import { randomUUID } from "node:crypto";
import { runQueueAdapterContractTests } from "../../core/test/contracts/queue-adapter.contract.js";
import { RedisQueueAdapter } from "../src/queue.js";

const redisUrl = process.env.VANTAGE_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";

// Real Redis persists across test runs, unlike adapter-memory's in-process
// state — each adapter gets its own list key so tests never see each
// other's leftover events. Requires `docker compose up -d redis` locally.
runQueueAdapterContractTests(() => new RedisQueueAdapter({ redis: redisUrl, key: `vantage:test:${randomUUID()}` }));
