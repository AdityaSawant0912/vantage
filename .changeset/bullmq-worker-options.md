---
"@usevantage/adapter-bullmq": minor
---

Add `workerOptions` to `BullMQQueueAdapter`: extra BullMQ Worker settings such as `lockDuration` and `stalledInterval`, which control how fast a crashed worker's job is reclaimed.
