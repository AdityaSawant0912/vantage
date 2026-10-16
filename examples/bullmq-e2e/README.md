# bullmq-e2e

End-to-end check for `@usevantage/adapter-bullmq`: `Handler.ingest` → BullMQ → worker process → Postgres, with a worker killed mid-job.

```bash
docker compose up -d redis postgres
pnpm build
pnpm --filter @usevantage/example-bullmq-e2e test
```

For each of two scenarios it:

1. forks worker 1 (`worker.ts`), which hangs on its first job and never acks it;
2. ingests 3 events through the real `Handler`;
3. `SIGKILL`s worker 1 while that job is in flight;
4. forks worker 2, which must reclaim the dead worker's job and finish the rest;
5. asserts the killed job was processed again by worker 2, Postgres has each event exactly once, and the queue is empty.

| Scenario | Worker 1 hangs | What it proves |
| --- | --- | --- |
| `before` | before writing | only the retry can land the row |
| `after` | after writing | the retry re-writes it and `ON CONFLICT DO NOTHING` keeps one row |

The workers use `lockDuration: 2000` / `stalledInterval: 1000` (via `workerOptions`) so recovery takes seconds instead of BullMQ's 30s defaults; the whole run is about 15s. It exits non-zero on any failure, and `pnpm test` at the repo root runs it, so CI covers it.

Override connections with `VANTAGE_TEST_REDIS_URL` and `VANTAGE_TEST_POSTGRES_URL`. Each run uses a uniquely named queue and table and cleans both up.
