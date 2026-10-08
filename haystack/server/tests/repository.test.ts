// Dummy leg of the abstract repository contract suite (fast, always runs).
import { defineRepositoryContractSuite } from "./suites/repository.js";
import { InMemoryItemRepository } from "../src/storage/memory.js";

defineRepositoryContractSuite(() => new InMemoryItemRepository(), "dummy");
