import { runStoreAdapterContractTests } from "../../core/test/contracts/store-adapter.contract.js";
import { MemoryStoreAdapter } from "../src/store.js";

runStoreAdapterContractTests(() => new MemoryStoreAdapter());
