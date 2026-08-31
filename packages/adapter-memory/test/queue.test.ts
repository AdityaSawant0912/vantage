import { runQueueAdapterContractTests } from "../../core/test/contracts/queue-adapter.contract.js";
import { MemoryQueueAdapter } from "../src/queue.js";

runQueueAdapterContractTests(() => new MemoryQueueAdapter());
