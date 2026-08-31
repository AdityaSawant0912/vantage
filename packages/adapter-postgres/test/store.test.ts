import { randomUUID } from "node:crypto";
import { runStoreAdapterContractTests } from "../../core/test/contracts/store-adapter.contract.js";
import { PostgresStoreAdapter } from "../src/store.js";

const connection = process.env.VANTAGE_TEST_POSTGRES_URL ?? "postgres://vantage:vantage@127.0.0.1:5432/vantage";

// Real Postgres persists across test runs, unlike adapter-memory's
// in-process state — each adapter gets its own table so tests never see
// each other's leftover rows. Requires `docker compose up -d postgres`.
runStoreAdapterContractTests(
  () => new PostgresStoreAdapter({ connection, table: `vantage_test_${randomUUID().replace(/-/g, "_")}` }),
  { readEventsForSource: (adapter, sourceId) => adapter.getEvents(sourceId) },
);
