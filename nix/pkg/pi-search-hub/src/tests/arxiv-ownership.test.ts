import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPaperProviders } from "../extensions/papers/providers.js";
import { SharedRuntime } from "../extensions/engine/runtime.js";

let home: string;
let previousHome: string | undefined;
beforeEach(async () => {
  previousHome = process.env.HOME;
  home = await mkdtemp(join(tmpdir(), "arxiv-ownership-"));
  process.env.HOME = home;
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

// Regression: Behavioral-Active-Effectual-GoodCommunication; real adapter and runtime,
// owned host-local lock, controllable transport deliberately ignoring cancellation.
for (const cancellation of ["caller", "deadline"] as const) {
  it(`retains the global slot until physical arxiv fetch settlement after ${cancellation} cancellation`, async () => {
    let release!: (response: Response) => void;
    let started!: () => void;
    const fetched = new Promise<void>(resolve => { started = resolve; });
    let exaCalls = 0;
    const transport: typeof fetch = async input => {
      if (new URL(String(input)).hostname === "export.arxiv.org") {
        started();
        return new Promise<Response>(resolve => { release = resolve; });
      }
      exaCalls++;
      return Response.json({ results: [] });
    };
    const providers = createPaperProviders({ backends: { exa: { enabled: true } }, papers: { sources: { arxiv: { enabled: true } } } }, transport);
    const arxiv = providers.find(provider => provider.name === "arxiv")!;
    const exa = providers.find(provider => provider.name === "exa")!;
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 });
    const controller = new AbortController();
    const first = runtime.operation("arxiv", cancellation === "deadline" ? 200 : 2000, controller.signal, 0,
      signal => arxiv.search({ query: "attention", numResults: 1 }, signal));
    const rejected = expect(first).rejects.toMatchObject({ name: cancellation === "deadline" ? "TimeoutError" : "AbortError" });
    await fetched;
    if (cancellation === "caller") controller.abort();
    await rejected;
    const second = runtime.operation("exa", 2000, undefined, 0, signal => exa.search({ query: "attention", numResults: 1 }, signal));
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(exaCalls).toBe(0);
    } finally {
      release(new Response("<feed></feed>"));
      expect(await second).toEqual([]);
    }
    expect(exaCalls).toBe(1);
  });
}

// Waiting for the host lock owns no transport; cancellation must not wait for its owner.
it("cancels a lock waiter promptly without releasing another request's lock or fetching", async () => {
  let release!: (response: Response) => void;
  let started!: () => void;
  const fetched = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++; started();
    return new Promise<Response>(resolve => { release = resolve; });
  };
  const [provider] = createPaperProviders({ papers: { sources: { arxiv: { enabled: true } } } }, transport);
  const runtime = new SharedRuntime({ maxConcurrent: 2, perProvider: 2 });
  const first = runtime.operation("arxiv", 2000, undefined, 0, signal => provider.search({ query: "attention", numResults: 1 }, signal));
  await fetched;
  const ownerPath = join(home, ".pi/agent/paper-arxiv/lock/owner");
  const owner = await readFile(ownerPath, "utf8");
  const abort = new AbortController();
  const waiter = provider.search({ query: "learning", numResults: 1 }, abort.signal);
  const cancelled = expect(waiter).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  try {
    await cancelled;
    expect(await readFile(ownerPath, "utf8")).toBe(owner);
    expect(calls).toBe(1);
  } finally {
    release(new Response("<feed></feed>"));
    expect(await first).toEqual([]);
  }
});
