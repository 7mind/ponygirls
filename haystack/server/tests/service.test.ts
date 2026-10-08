// BG: service scenarios — authorship, validation boundary, replay,
// history, archive visibility. Driven through ItemService over the dummy;
// Step 3 reruns the same scenarios against PG.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ItemService, BadEnvelope, InvalidDocument, ConflictFault, NotFoundFault } from "../src/application/service.js";
import { ManualClock } from "../src/application/clock.js";
import { InMemoryItemRepository } from "../src/storage/memory.js";
import type { Principal } from "../src/domain/document.js";
import { ReplayConflictFault } from "../src/storage/repository.js";
import { InvalidId } from "../src/domain/qid.js";
import { DOC, freshRequestId, ALICE, BOT } from "./suites/repository.js";

const docWith = (fields: string, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "t",
    description: "d",
    fields: JSON.parse(fields) as unknown,
    type: "fact",
    status: "actual",
    importance: "low",
    "human-attention": "cleared",
    links: [],
    ...overrides,
  });

function setup() {
  const clock = new ManualClock();
  const service = new ItemService(new InMemoryItemRepository(), clock);
  return { service, clock };
}


import { defineServiceSuite, put } from "./suites/service.js";

defineServiceSuite((clock) => new ItemService(new InMemoryItemRepository(), clock), "dummy");
