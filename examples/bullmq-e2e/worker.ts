// One worker process, exactly as the docs describe it:
//   queueAdapter.consume((event) => processEvent(event, storeAdapter))
// plus a failure-injection hook so run.ts can kill it mid-job.
import { Queue } from "bullmq";
import { processEvent } from "@usevantage/core";
import { BullMQQueueAdapter } from "@usevantage/adapter-bullmq";
import { PostgresStoreAdapter } from "@usevantage/adapter-postgres";

/** Messages this process sends its parent over the fork IPC channel. */
export type WorkerMessage =
  | { type: "ready" }
  | { type: "processed"; eventId: string }
  | { type: "hanging"; eventId: string };

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`worker: missing env ${name}`);
  return value;
}

function send(message: WorkerMessage): void {
  process.send?.(message);
}

const connection = { host: env("REDIS_HOST"), port: Number(env("REDIS_PORT")) };
// "before": hang before writing the first event. "after": write it, then hang.
// Unset: process normally. Either way the process never acks, and run.ts SIGKILLs it.
const hangMode = process.env.HANG_MODE as "before" | "after" | undefined;

const queue = new Queue(env("QUEUE_NAME"), { connection });
const store = new PostgresStoreAdapter({ connection: env("DATABASE_URL"), table: env("TABLE") });
const adapter = new BullMQQueueAdapter({
  queue,
  connection,
  concurrency: 1, // one job at a time, so exactly one job is in flight when the kill lands
  // Short lock + stalled check so a dead worker's job is reclaimed in seconds, not BullMQ's 30s defaults.
  workerOptions: { lockDuration: 2000, stalledInterval: 1000 },
});

let hung = false;
adapter.consume(async (event) => {
  const hang = hangMode !== undefined && !hung;
  if (hang) hung = true;

  if (!(hang && hangMode === "before")) await processEvent(event, store);

  if (!hang) {
    send({ type: "processed", eventId: event.event_id });
    return;
  }
  send({ type: "hanging", eventId: event.event_id });
  await new Promise<never>(() => undefined); // never settles: this job stays active until the process is killed
});

send({ type: "ready" });
