// End to end: Handler.ingest -> BullMQ -> worker process -> Postgres, with a worker SIGKILLed
// mid-job. Passes only if the killed job is retried by a second worker AND every event ends
// up in Postgres exactly once.
//
// Needs Redis and Postgres (`docker compose up -d redis postgres`). Run: `pnpm --filter
// @usevantage/example-bullmq-e2e test`. Override with VANTAGE_TEST_REDIS_URL / VANTAGE_TEST_POSTGRES_URL.
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import pg from "pg";
import { createHandler } from "@usevantage/core";
import { BullMQQueueAdapter } from "@usevantage/adapter-bullmq";
import { PostgresStoreAdapter } from "@usevantage/adapter-postgres";
import type { WorkerMessage } from "./worker.ts";

const redisUrl = new URL(process.env.VANTAGE_TEST_REDIS_URL ?? "redis://127.0.0.1:6379");
const databaseUrl = process.env.VANTAGE_TEST_POSTGRES_URL ?? "postgres://vantage:vantage@127.0.0.1:5432/vantage";
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };

const EVENT_COUNT = 3;
const SOURCE = "e2e-source";
const STEP_TIMEOUT_MS = 30_000;

function startWorker(env: Record<string, string>): { child: ChildProcess; messages: WorkerMessage[] } {
  const child = fork(new URL("./worker.ts", import.meta.url), { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const messages: WorkerMessage[] = [];
  child.on("message", (m) => messages.push(m as WorkerMessage));
  return { child, messages };
}

async function until(label: string, condition: () => boolean | Promise<boolean>, timeoutMs = STEP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", () => resolve())));
}

async function scenario(hangMode: "before" | "after"): Promise<void> {
  const id = randomUUID().replace(/-/g, "_");
  const queueName = `vantage-e2e-${id}`;
  const table = `vantage_e2e_${id}`;
  const workerEnv = {
    REDIS_HOST: connection.host,
    REDIS_PORT: String(connection.port),
    DATABASE_URL: databaseUrl,
    QUEUE_NAME: queueName,
    TABLE: table,
  };

  const queue = new Queue(queueName, { connection });
  const store = new PostgresStoreAdapter({ connection: databaseUrl, table });
  const handler = createHandler({
    queueAdapter: new BullMQQueueAdapter({ queue, connection }), // push side only; the workers consume
    resolveSourceId: (key) => (key === "e2e-key" ? SOURCE : null),
  });
  const workers: ChildProcess[] = [];

  try {
    // 1. First worker, told to hang on its first job.
    const w1 = startWorker({ ...workerEnv, HANG_MODE: hangMode });
    workers.push(w1.child);
    await until("worker 1 ready", () => w1.messages.some((m) => m.type === "ready"));

    // 2. Ingest through the real Handler (auth, validation, push).
    const ids: string[] = [];
    for (let i = 0; i < EVENT_COUNT; i++) {
      const eventId = randomUUID();
      ids.push(eventId);
      const result = await handler.ingest({
        authKey: "e2e-key",
        body: {
          v: 2,
          type: "custom",
          name: "e2e.event",
          event_id: eventId,
          anon_id: "anon-1",
          session_id: "sess-1",
          url: `https://example.test/${i}`,
          timestamp: Date.now(),
        },
      });
      assert.deepEqual(result, { status: 202 }, `ingest #${i}`);
    }

    // 3. Kill worker 1 while its first job is in flight (never acked).
    await until("worker 1 holding a job", () => w1.messages.some((m) => m.type === "hanging"));
    const hanging = w1.messages.find((m): m is Extract<WorkerMessage, { type: "hanging" }> => m.type === "hanging");
    assert.ok(hanging);
    w1.child.kill("SIGKILL");
    await exited(w1.child);

    // 4. Second worker must reclaim the dead worker's job and finish the rest.
    const w2 = startWorker(workerEnv);
    workers.push(w2.child);
    await until("worker 2 processed every event", () => new Set(w2.messages.flatMap((m) => (m.type === "processed" ? [m.eventId] : []))).size === EVENT_COUNT);

    // 5. Retry actually happened: the killed job was processed again, by worker 2.
    assert.ok(
      w2.messages.some((m) => m.type === "processed" && m.eventId === hanging.eventId),
      `[${hangMode}] killed job ${hanging.eventId} was not retried by the second worker`,
    );

    // 6. Exactly once in Postgres, whether or not worker 1 had already written it.
    const rows = await store.getEvents(SOURCE);
    assert.equal(rows.length, EVENT_COUNT, `[${hangMode}] expected ${EVENT_COUNT} rows, got ${rows.length}`);
    assert.deepEqual(rows.map((r) => r.event_id).sort(), [...ids].sort(), `[${hangMode}] stored event ids`);

    // 7. Nothing left behind in the queue.
    await until("queue drained", async () => {
      const counts = await queue.getJobCounts("active", "waiting", "delayed", "failed");
      return Object.values(counts).every((n) => n === 0);
    });

    console.log(`ok  [${hangMode}-write kill] ${EVENT_COUNT} events, job ${hanging.eventId.slice(0, 8)} retried, ${rows.length} rows`);
  } finally {
    for (const w of workers) w.kill("SIGKILL");
    await Promise.all(workers.map(exited));
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await store.close();
    const pool = new pg.Pool({ connectionString: databaseUrl });
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    await pool.end();
  }
}

try {
  await scenario("before"); // killed before the write: only the retry can land the row
  await scenario("after"); // killed after the write: the retry re-writes, idempotency keeps one row
  console.log("bullmq e2e passed");
} catch (err) {
  console.error("bullmq e2e FAILED:", err);
  process.exitCode = 1;
}
