# @usevantage/adapter-bullmq

## 3.0.0

### Patch Changes

- Updated dependencies [8ee6b7f]
  - @usevantage/core@2.1.0

## 2.1.0

### Minor Changes

- 706727e: Add `workerOptions` to `BullMQQueueAdapter`: extra BullMQ Worker settings such as `lockDuration` and `stalledInterval`, which control how fast a crashed worker's job is reclaimed.

## 2.0.0

### Major Changes

- dae32a4: New `BullMQQueueAdapter`: `push` adds a job keyed `sourceId|event_id` (rejects on failure), `consume` runs a BullMQ Worker (concurrency 10; 5 attempts, exponential backoff from 1s; completed jobs removed, last 1000 failed kept).

### Patch Changes

- Updated dependencies [48401cf]
  - @usevantage/core@2.0.0
