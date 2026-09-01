import { Pool, type PoolConfig } from "pg";
import type { ScopedEvent, SourceId, StoreAdapter } from "@usevantage/core";

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface PostgresStoreAdapterOptions {
  /** A connection string or a full `pg` PoolConfig. */
  connection: string | PoolConfig;
  /** Table name. Default "vantage_events". Must be a plain identifier — not user input. */
  table?: string;
}

/**
 * Creates its table on first use (CREATE TABLE IF NOT EXISTS) — a real
 * migration tool is a self-hoster's concern, not this adapter's; this is
 * just enough to make the package usable out of the box.
 */
export class PostgresStoreAdapter implements StoreAdapter {
  private readonly pool: Pool;
  private readonly table: string;
  private readonly ready: Promise<void>;

  /** Validates the table name and opens the pool; the table is created lazily on first write. */
  constructor(options: PostgresStoreAdapterOptions) {
    const table = options.table ?? "vantage_events";
    if (!VALID_TABLE_NAME.test(table)) {
      throw new Error(`invalid table name: ${table}`);
    }
    this.table = table;
    this.pool = typeof options.connection === "string" ? new Pool({ connectionString: options.connection }) : new Pool(options.connection);
    this.ready = this.migrate();
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id BIGSERIAL PRIMARY KEY,
        source_id TEXT NOT NULL,
        v INTEGER NOT NULL,
        type TEXT NOT NULL,
        name TEXT,
        url TEXT NOT NULL,
        referrer TEXT,
        timestamp BIGINT NOT NULL
      )
    `);
  }

  /** Waits for the table to exist, then inserts one row for the event. */
  async write(event: ScopedEvent): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO ${this.table} (source_id, v, type, name, url, referrer, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event.sourceId, event.v, event.type, event.name ?? null, event.url, event.referrer ?? null, event.timestamp],
    );
  }

  /** Test/inspection hook, not part of StoreAdapter — mirrors adapter-memory's getEvents. */
  async getEvents(sourceId: SourceId): Promise<ScopedEvent[]> {
    await this.ready;
    const result = await this.pool.query<{
      source_id: string;
      v: number;
      type: "pageview" | "custom";
      name: string | null;
      url: string;
      referrer: string | null;
      timestamp: string;
    }>(
      `SELECT source_id, v, type, name, url, referrer, timestamp FROM ${this.table} WHERE source_id = $1 ORDER BY id ASC`,
      [sourceId],
    );
    return result.rows.map((row) => ({
      v: row.v as 1,
      type: row.type,
      name: row.name ?? undefined,
      url: row.url,
      referrer: row.referrer,
      timestamp: Number(row.timestamp),
      sourceId: row.source_id,
    }));
  }

  /** Not part of StoreAdapter — closes the connection pool for test/shutdown cleanup. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
