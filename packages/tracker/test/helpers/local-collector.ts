import http from "node:http";
import { createHandler, processEvent } from "@usevantage/core";
import { MemoryQueueAdapter, MemoryStoreAdapter } from "@usevantage/adapter-memory";

export interface LocalCollector {
  url: string;
  store: MemoryStoreAdapter;
  close(): Promise<void>;
}

/**
 * The smallest possible stand-in for apps/collector (Phase 4, not built
 * yet): a bare node:http server that extracts an auth key from the query
 * string and hands off to the real Handler.ingest + processEvent +
 * adapter-memory path. Exists only so the tracker's real fetch/beacon
 * calls have a real local pipeline to land in.
 */
export async function startLocalCollector(): Promise<LocalCollector> {
  const store = new MemoryStoreAdapter();
  const queue = new MemoryQueueAdapter();
  queue.consume((event) => processEvent(event, store));

  const handler = createHandler({
    queueAdapter: queue,
    resolveSourceId: (authKey) => (authKey === "test-key" ? "source-1" : null),
  });

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const authKey = new URL(req.url ?? "/", "http://localhost").searchParams.get("key") ?? "";
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: unknown;
        try {
          body = raw.length > 0 ? JSON.parse(raw) : {};
        } catch {
          res.writeHead(400).end();
          return;
        }
        const result = await handler.ingest({ authKey, body });
        res.writeHead(result.status).end();
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    store,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
