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
    // CREATE TABLE IF NOT EXISTS never alters an existing table, so a table
    // created under schema v1 must be dropped and recreated (schema v2 has no
    // data migration). Idempotency is unique per (source_id, event_id), not
    // event_id alone, so one tenant can't suppress another's event by
    // replaying its id.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id BIGSERIAL PRIMARY KEY,
        source_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        v INTEGER NOT NULL,
        type TEXT NOT NULL,
        anon_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        user_id TEXT,
        name TEXT,
        url TEXT NOT NULL,
        referrer TEXT,
        timestamp BIGINT NOT NULL,
        received_at BIGINT NOT NULL,
        props JSONB,
        UNIQUE (source_id, event_id)
      )
    `);
  }

  /** Waits for the table to exist, then inserts one row; a repeated (source, event_id) is a no-op. */
  async write(event: ScopedEvent): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO ${this.table} (source_id, event_id, v, type, anon_id, session_id, user_id, name, url, referrer, timestamp, received_at, props)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (source_id, event_id) DO NOTHING`,
      [
        event.sourceId,
        event.event_id,
        event.v,
        event.type,
        event.anon_id,
        event.session_id,
        event.user_id ?? null,
        event.name ?? null,
        event.url,
        event.referrer ?? null,
        event.timestamp,
        event.receivedAt,
        event.props ?? null,
      ],
    );
  }

  /** Test/inspection hook, not part of StoreAdapter — mirrors adapter-memory's getEvents. */
  async getEvents(sourceId: SourceId): Promise<ScopedEvent[]> {
    await this.ready;
    const result = await this.pool.query<{
      source_id: string;
      event_id: string;
      v: number;
      type: ScopedEvent["type"];
      anon_id: string;
      session_id: string;
      user_id: string | null;
      name: string | null;
      url: string;
      referrer: string | null;
      timestamp: string;
      received_at: string;
      props: ScopedEvent["props"] | null;
    }>(
      `SELECT source_id, event_id, v, type, anon_id, session_id, user_id, name, url, referrer, timestamp, received_at, props FROM ${this.table} WHERE source_id = $1 ORDER BY id ASC`,
      [sourceId],
    );
    return result.rows.map((row) => ({
      v: row.v as 2,
      type: row.type,
      event_id: row.event_id,
      anon_id: row.anon_id,
      session_id: row.session_id,
      ...(row.user_id !== null ? { user_id: row.user_id } : {}),
      name: row.name ?? undefined,
      url: row.url,
      referrer: row.referrer,
      timestamp: Number(row.timestamp),
      sourceId: row.source_id,
      receivedAt: Number(row.received_at),
      ...(row.props ? { props: row.props } : {}),
    }));
  }

  /** Not part of StoreAdapter — closes the connection pool for test/shutdown cleanup. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
