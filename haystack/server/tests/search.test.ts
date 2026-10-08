// Dummy leg of the abstract search suite (fast, always runs).
import { ItemService } from "../src/application/service.js";
import { SearchService } from "../src/application/search.js";
import { ManualClock } from "../src/application/clock.js";
import { InMemoryItemRepository } from "../src/storage/memory.js";
import { defineSearchSuite } from "./suites/search.js";

defineSearchSuite(() => {
  const clock = new ManualClock();
  const repo = new InMemoryItemRepository();
  return { items: new ItemService(repo, clock), search: new SearchService(repo), clock };
}, "dummy");
