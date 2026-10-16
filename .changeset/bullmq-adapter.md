---
"@usevantage/adapter-bullmq": major
---

New `BullMQQueueAdapter`: `push` adds a job keyed `sourceId|event_id` (rejects on failure), `consume` runs a BullMQ Worker (concurrency 10; 5 attempts, exponential backoff from 1s; completed jobs removed, last 1000 failed kept).
