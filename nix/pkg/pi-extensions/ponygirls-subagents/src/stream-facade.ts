/**
 * Transparent return-stream facade for provider streams.
 *
 * Wraps one real AssistantMessageEventStream with a SINGLE-OWNED eager pump:
 * the facade drives exactly one underlying iterator and relays every event
 * to any number of facade consumers in original order. Iterator EOF without
 * a terminal (done/error) event, a throwing iterator factory, a throwing or
 * rejecting next(), and throwing property access on the iteration result or
 * event all reject every facade result() with an explicit owned error
 * instead of pending forever or publishing success over a failed iteration;
 * a valid provider result concurrent with an iteration failure is withheld
 * from result() (joined failure) while its Usage stays independently
 * accountable through the ORIGINAL stream. An already-rejected ORIGINAL
 * result is preserved and joined with a concurrent EOF instead of erased by
 * it; normal and error streams resolve with the identical provider message
 * object.
 *
 * Consumer rules preserved: at most one underlying iterator ever exists (no
 * competing consumption); facade iterators are pure replays, so closing one
 * early never delegates to (or cancels) the provider stream. AbortSignal
 * stops the pump (replay then ends at the buffered prefix) while result()
 * keeps awaiting the raw provider result, so an aborted provider that still
 * reports its terminal response is fully observed.
 *
 * Public mutation contract: push()/end() stay fully supported with genuine
 * SDK semantics instead of read-only rejection. One stable completion state
 * (localDone/endIndex) is settled eagerly by the FIRST terminal from either
 * side — a pump-relayed provider terminal or a pushed terminal/end(message)
 * — independently of when result() is called, so post-terminal pushes drop
 * with SDK parity in both directions. Pushed events join the single ordered
 * replay sequence and settle the local gate with the identical message
 * object; the first terminal among pushed events, end(), and the
 * coordinated provider outcome settles result(). Pushed events are never
 * forwarded into the provider stream, so consumer-side pushes cannot rewrite
 * provider accounting: the owned pump keeps observing the true provider
 * outcome either way, and provider settlement itself is observed eagerly so
 * a result-without-event completion still precedes later local pushes in
 * terminal order. Once the coordinated provider outcome settles it is never
 * rewritten by later pushes (SDK post-done parity). Timing stays owned by the stream that created the
 * message (the facade never re-times pushed messages).
 */
import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export interface FacadeRequestIdentity {
  readonly taskRunId: unknown;
  readonly generation: unknown;
}

function describeIds(ids: FacadeRequestIdentity): string {
  return `taskRunId=${String(ids.taskRunId)} generation=${String(ids.generation)}`;
}

function isTerminalEvent(event: AssistantMessageEvent): event is Extract<AssistantMessageEvent, { type: "done" } | { type: "error" }> {
  return event.type === "done" || event.type === "error";
}

/**
 * Messages completed through the facade's own public push()/end() surface
 * (never provider-pushed). The worker's usage accounting consults this so a
 * consumer-side local completion is never billed as provider usage, while
 * the genuine provider outcome stays accountable through the ORIGINAL.
 */
const locallyCompletedMessages = new WeakSet<object>();

export function isFacadeLocalCompletion(message: unknown): boolean {
  return typeof message === "object" && message !== null && locallyCompletedMessages.has(message);
}

/**
 * Optional exposed-ORIGINAL result-state witness (env-gated filename,
 * inert unless set): logs first entry and first settlement of every adapted
 * (exposed) stream result ({taskRunId, generation, seq, event}) into a
 * per-agentDir JSONL. The adapted stream is theTransport-level object the
 * SDK loop and guard consume — for runtime-wrapped providers this is the
 * OUTER stream, whose result the forwarding loop enters eagerly and settles
 * only after inner iteration finishes. Per-invocation sequence numbers
 * order adaptations; while a delayed invocation blocks progress, no later
 * adaptation can exist, so the last line of a generation identifies its
 * stream deterministically (no timing inference). Malformed configuration
 * fails loudly at first use.
 */
let exposedWitnessSeq = 0;

function appendExposedWitness(ids: FacadeRequestIdentity, seq: number, event: string): void {
  const name: unknown = process.env["PI_SUBAGENTS_EXPOSED_RESULT_WITNESS"];
  if (name === undefined || name === "") return;
  if (typeof name !== "string" || name.includes("\0")) {
    throw new Error(`INVALID: PI_SUBAGENTS_EXPOSED_RESULT_WITNESS must be a filename (got ${String(name)})`);
  }
  const agentDir: unknown = process.env["PI_SUBAGENTS_AGENT_DIR"];
  if (typeof agentDir !== "string" || agentDir.length === 0 || agentDir.includes("\0")) {
    throw new Error(`INVALID: PI_SUBAGENTS_AGENT_DIR must be set for the exposed-result witness (got ${String(agentDir)})`);
  }
  if (name.includes("/") || name === "" || name === "." || name === "..") {
    throw new Error(`INVALID: exposed-result witness name must be a bare filename (got ${String(name)})`);
  }
  appendFileSync(join(agentDir, name), JSON.stringify({ taskRunId: ids.taskRunId, generation: ids.generation, seq, event }) + "\n");
}

/** Minimal structural shape the facade adapts: a terminal result plus async
 * iteration. Satisfied by the pinned SDK stream and by test doubles that
 * exercise the loud-failure paths. */
export interface ProviderStreamShape {
  result(): Promise<AssistantMessage>;
  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>;
}

export function adaptStream(
  source: ProviderStreamShape,
  options: { signal?: AbortSignal },
  ids: FacadeRequestIdentity,
): AssistantMessageEventStream {
  if (typeof source !== "object" || source === null) {
    throw new Error(`MODEL_UNAVAILABLE: provider stream is missing (${describeIds(ids)})`);
  }
  if (typeof source.result !== "function") {
    throw new Error(`MODEL_UNAVAILABLE: provider stream has no supported result() (${describeIds(ids)})`);
  }
  if (typeof source[Symbol.asyncIterator] !== "function") {
    throw new Error(`MODEL_UNAVAILABLE: provider stream is not async-iterable (${describeIds(ids)})`);
  }
  const signal: AbortSignal | undefined = options.signal;
  const buffer: AssistantMessageEvent[] = [];
  const waiters: Array<(outcome: { done: true } | { done: false }) => void> = [];
  let pumpDone = false;
  let terminalSeen = false;
  // Local public-completion state (genuine SDK push/end semantics): the
  // first pushed terminal event or end(message) freezes the replay tail and
  // settles the local gate with the identical message object. Never
  // forwarded into the provider stream.
  let localDone = false;
  let endIndex: number | null = null;
  // The coordinated provider outcome, once settled, is never rewritten by
  // later local pushes: push()/end(message) after provider settlement keep
  // SDK post-done parity (dropped for result purposes) while end() still
  // freezes the replay tail for iterators.
  let providerSettled = false;
  let resolveLocal: (message: AssistantMessage) => void = () => {};
  const localGate = new Promise<AssistantMessage>((resolve) => {
    resolveLocal = resolve;
  });
  // Eager provider-settlement observation (stable terminal order without
  // waiting for result() calls): a source result that settles — with or
  // without a terminal event — marks providerSettled at once, so later
  // local push/end cannot override an already-settled provider outcome
  // (SDK post-done parity for result-without-event completions). Observing
  // the shared result promise never competes with the single owned pump
  // iterator. Sync-throw containment keeps this observation inert. The
  // entered/settled witness (when enabled) observes this exact exposed
  // result — the object the SDK loop and guard consume.
  const exposedSeq = exposedWitnessSeq++;
  void Promise.resolve()
    .then(() => {
      const pending = source.result();
      appendExposedWitness(ids, exposedSeq, "exposed-entered");
      return pending;
    })
    .then(
      () => {
        providerSettled = true;
        appendExposedWitness(ids, exposedSeq, "exposed-settled-ok");
      },
      () => {
        providerSettled = true;
        // A known ORIGINAL rejection ends replay persistently, right here
        // at adapt time (not only inside lazy result coordination):
        // pure-iteration consumers that never call result() must still
        // drain-then-terminate instead of hanging on a lost wake.
        replayEndedOnRejection = true;
        // Wake existing waiters too (deferred so in-flight relays drain
        // first): a consumer already waiting cannot revisit the new flag
        // until woken (missed-wakeup hang).
        terminateReplaySoon();
        appendExposedWitness(ids, exposedSeq, "exposed-settled-err");
      },
    );
  // Synchronous pump-failure state (read directly by result coordination):
  // already-manifested failures stay deterministic across later result()
  // calls (no async gate observation races). failPump also nudges pending
  // coordination; every call site additionally wakes (replay + notify).
  let pumpFailedError: Error | null = null;
  // Clean EOF without any terminal event and without failure (a legitimate
  // ORIGINAL end(message) ends iteration eventlessly while its result
  // resolves validly). Distinct from pump failure: coordination resolves a
  // valid result here but still rejects a bare EOF with no message.
  let cleanEofWithoutTerminal = false;
  const failPump = (error: Error): void => {
    pumpFailedError = error;
    notifyCoordinated?.();
  };
  let abortReject: (error: Error) => void = () => {};
  const abortGate = new Promise<never>((_resolve, reject) => {
    abortReject = reject;
  });
  abortGate.catch(() => {});
  const abortError = (): Error => new Error(`STREAM_ABORTED (${describeIds(ids)}): run aborted while provider stream unsettled`);
  if (signal !== undefined) {
    if (signal.aborted === true) abortReject(abortError());
    else signal.addEventListener("abort", () => abortReject(abortError()), { once: true });
  }
  const wake = (outcome: { done: true } | { done: false }): void => {
    // Pump transitions drive pending coordination: clean finishes resolve
    // valid results, failures join them, abort-stops resolve valid ones.
    // Relay wakes are no-ops for coordination (state not terminal).
    notifyCoordinated?.();
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(outcome);
    }
  };
  const finishPump = (withoutTerminal: boolean): void => {
    if (pumpDone) return;
    pumpDone = true;
    if (withoutTerminal) {
      // Clean EOF without a terminal event is NOT itself a failure: a
      // legitimate ORIGINAL end(message) ends iteration with no events
      // while its result resolves validly. Record the condition; result
      // coordination decides (resolve on a valid result, reject bare EOF).
      cleanEofWithoutTerminal = true;
    }
    wake({ done: true });
  };
  const pump = (async (): Promise<void> => {
    // Iterator-factory failure is a PUBLIC current-owned failure, not a
    // stderr-only event: reject the EOF gate so result() settles publicly
    // without any external interrupt. The stderr line stays as diagnostics;
    // the terminal comes from the gate, never from stderr alone.
    let iterator: AsyncIterator<AssistantMessageEvent>;
    try {
      iterator = source[Symbol.asyncIterator]();
    } catch (factoryError: unknown) {
      const detail = factoryError instanceof Error ? factoryError.message : String(factoryError);
      process.stderr.write(`STREAM_PUMP_FAILED (${describeIds(ids)}): ${detail}\n`);
      pumpDone = true;
      failPump(new Error(`STREAM_ITERATION_FAILED (${describeIds(ids)}): ${detail}`));
      wake({ done: true });
      return;
    }
    type Raced =
      | { kind: "next"; item: IteratorResult<AssistantMessageEvent, unknown> }
      | { kind: "iteratorError"; error: unknown }
      | { kind: "aborted" };
    for (;;) {
      // The next() CALL itself is contained: a synchronous throw (or a
      // non-promise return) becomes an iteratorError instead of an
      // unwitnessed pump rejection. Deferring the call into the promise
      // chain keeps sync and async next failures on one owned path.
      const raced: Raced = await Promise.race([
        Promise.resolve()
          .then(() => iterator.next())
          .then(
            (item) => ({ kind: "next", item }) as Raced,
            (error: unknown) => ({ kind: "iteratorError", error }) as Raced,
          ),
        abortGate.then(
          () => ({ kind: "aborted" }) as Raced,
          () => ({ kind: "aborted" }) as Raced,
        ),
      ]);
      if (raced.kind === "aborted") {
        pumpDone = true;
        wake({ done: true });
        return;
      }
      if (raced.kind === "iteratorError") {
        const detail = raced.error instanceof Error ? raced.error.message : String(raced.error);
        pumpDone = true;
        failPump(new Error(`STREAM_ITERATION_FAILED (${describeIds(ids)}): ${detail}`));
        wake({ done: true });
        return;
      }
      // Full containment of iteration-result and event processing: a
      // throwing IteratorResult.done/value getter or a throwing event.type
      // getter becomes a public iteration failure (gate + wake + stderr
      // diagnostic) instead of an unwitnessed pump rejection that hangs
      // result() on a pending source or silently drops the fault on a
      // resolved one.
      try {
        const item = raced.item;
        if (item.done === true) {
          finishPump(!terminalSeen);
          return;
        }
        const event: AssistantMessageEvent = item.value;
        const terminal = isTerminalEvent(event);
        if (terminal) terminalSeen = true;
        buffer.push(event);
        // A pump-relayed provider terminal completes the facade eagerly
        // (first-terminal-wins against later local pushes, independently of
        // result() timing); values stay source-authoritative through the
        // coordinated result path.
        if (terminal && !localDone) {
          localDone = true;
          endIndex = buffer.length;
        }
        wake({ done: false });
      } catch (processError: unknown) {
        const detail = processError instanceof Error ? processError.message : String(processError);
        process.stderr.write(`STREAM_PUMP_FAILED (${describeIds(ids)}): ${detail}\n`);
        pumpDone = true;
        failPump(new Error(`STREAM_ITERATION_FAILED (${describeIds(ids)}): ${detail}`));
        wake({ done: true });
        return;
      }
    }
  })();
  void pump.then(
    () => {},
    (pumpError: unknown) => {
      const detail = pumpError instanceof Error ? pumpError.message : String(pumpError);
      process.stderr.write(`STREAM_PUMP_FAILED (${describeIds(ids)}): ${detail}\n`);
    },
  );
  const replay = async function* (): AsyncGenerator<AssistantMessageEvent, void, void> {
    let index = 0;
    for (;;) {
      // The replay tail freezes at the first local terminal (endIndex),
      // mirroring the SDK dropping post-done pushes; provider events pumped
      // afterwards stay observed by the pump/result path, never by iterators.
      while (index < buffer.length && (endIndex === null || index < endIndex)) {
        const event: AssistantMessageEvent | undefined = buffer[index];
        if (event === undefined) break;
        index += 1;
        yield event;
      }
      if (endIndex !== null && index >= endIndex) return;
      if (pumpDone) return;
      // Persistent ended state from an observed source rejection: terminate
      // even when the wake fired with no waiter (late start) or while a
      // buffered event was being processed (paused consumer).
      if (replayEndedOnRejection) return;
      const outcome: { done: true } | { done: false } = await new Promise((resolve) => {
        waiters.push(resolve);
      });
      if (outcome.done === true && index >= buffer.length) return;
    }
  };
  const facade = {
    push: (event: AssistantMessageEvent): void => {
      // Transparent SDK parity: a post-done push is dropped; otherwise the
      // event joins the single ordered replay sequence and a terminal event
      // settles the local gate with the identical message object. The
      // provider stream is never touched. Locally completed messages join
      // the accounting-exclusion set so worker usage never bills them.
      if (localDone || providerSettled) return;
      buffer.push(event);
      if (isTerminalEvent(event)) {
        localDone = true;
        endIndex = buffer.length;
        const completed = event.type === "done" ? event.message : event.error;
        locallyCompletedMessages.add(completed);
        resolveLocal(completed);
      }
      wake({ done: false });
    },
    end: (result?: AssistantMessage): void => {
      // Transparent SDK parity: mark done and drain the frozen tail; a
      // supplied message settles the local gate. end() without a message
      // leaves result() to the coordinated provider outcome instead of
      // pending forever. The provider stream is never touched. A supplied
      // message joins the accounting-exclusion set (consumer mutation, not
      // provider usage).
      if (!localDone) {
        localDone = true;
        endIndex = buffer.length;
      }
      if (result !== undefined) {
        locallyCompletedMessages.add(result);
        if (!providerSettled) resolveLocal(result);
      }
      wake({ done: false });
    },
  };
  // Persistent replay-ended state for known source failure: a rejection
  // observed with no waiter present loses its wake (empty waiters array),
  // and a rejection landing while a consumer processes a buffered event
  // likewise fires into the void. Replay consults this before every wait,
  // so late-start and paused consumers still drain-then-terminate
  // independently of pump ownership or wake timing.
  let replayEndedOnRejection = false;
  // Terminate replay on the next macrotask (never synchronously with the
  // rejection observation): in-flight pump relays are pure microtask
  // chains and always drain before any macrotask fires, so relayed events
  // are yielded before termination (drain-then-end); a synchronous wake
  // would win the race and orphan them. One macrotask of latency is
  // negligible and never hangs (the timer always fires).
  const terminateReplaySoon = (): void => {
    setTimeout(() => wake({ done: true }), 0);
  };
  // Memoized coordinated outcome: ONE stable public completion per facade.
  // Every result() call shares the same coordinated promise, so repeated
  // calls can never disagree (success-then-failure across calls is
  // structurally impossible). Built lazily on the first result() call.
  //
  // Coordination settles only on provider+pump agreement, never on a bare
  // scheduling bound for SUCCESS: a valid source result ahead of an
  // unfinished pump WAITS for the owned pump (clean finish resolves,
  // failure withholds with a joined rejection). A rejected source gets one
  // bound for a racing pump failure to join (combined causes), then fails
  // publicly on its own cause without waiting for an unfinished pump
  // (replay drains, then terminates at rejection observation). An aborted
  // or wedged pump still resolves an already-valid result via pumpDone,
  // and abort never resurrects a settled outcome. A pump failure with a
  // silent source gets one scheduling bound for a tardy producer, then
  // rejects the pump failure (never an indefinite wait). Pump transitions
  // trigger pending coordination through wake().
  let coordinatedMemo: Promise<AssistantMessage> | null = null;
  // Pump-side trigger for the memoized coordination (invoked from wake(),
  // which runs on every pump transition: relay (no-op), clean finish,
  // failure, and abort-stop).
  let notifyCoordinated: (() => void) | null = null;
  const buildCoordinated = (): Promise<AssistantMessage> => {
    // A synchronous result() throw is contained to a public rejection:
    // the SDK always receives a promise, never a sync throw.
    let src: Promise<AssistantMessage>;
    try {
      src = source.result();
    } catch (resultError: unknown) {
      src = Promise.reject(resultError);
    }
    // The ORIGINAL producer outcome is authoritative; pump failures join
    // it. A valid provider result concurrent with an iteration failure is
    // WITHHELD (joined rejection naming the iteration failure): success
    // must never publish over a failed iteration, on any call. A pending
    // producer after a pump failure gets one scheduling bound. The local
    // push/end gate races this coordinated outcome with plain
    // first-settled-wins SDK semantics: a pushed terminal or end(message)
    // settles result() even when the provider never does, while an
    // already-settled provider outcome is never rewritten.
    const coordinated = new Promise<AssistantMessage>((resolve, reject) => {
      let settled = false;
      let srcDone = false;
      let srcOk = false;
      let srcValue: AssistantMessage | undefined;
      let srcError: unknown;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const clearTimer = (): void => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };
      const armBound = (): void => {
        if (timer !== null) return;
        timer = setTimeout(() => {
          timer = null;
          if (settled) return;
          settled = true;
          providerSettled = true;
          // Only armed while the pump already failed and the source stays
          // silent, or while a known source outcome awaits a racing pump
          // transition: reject the pump failure, or the known source
          // outcome when the pump stays unfinished past the bound (never
          // an indefinite wait; a later pump failure cannot rewrite the
          // memoized outcome).
          const failure = pumpFailedError;
          if (failure !== null && !srcDone) reject(failure);
          else if (srcDone && !srcOk) reject(srcError);
          else if (failure !== null) reject(failure);
          else if (!srcDone && cleanEofWithoutTerminal) {
            reject(new Error(`STREAM_ENDED_WITHOUT_MESSAGE (${describeIds(ids)}): provider iteration ended with no done/error event`));
          } else reject(new Error(`STREAM_INTERNAL_UNSETTLED (${describeIds(ids)}): coordination bound without pump failure`));
        }, 0);
      };
      const settle = (): void => {
        if (settled) return;
        if (pumpFailedError !== null) {
          if (srcDone) {
            settled = true;
            providerSettled = true;
            clearTimer();
            if (srcOk) {
              // Iteration failed while the provider result stands valid:
              // withhold the result and fail publicly with the iteration
              // cause preserved. Usage stays accountable through the
              // ORIGINAL stream, independently of this withheld outcome.
              reject(
                new Error(
                  `STREAM_RESULT_WITHHELD_AFTER_ITERATION_FAILURE (${describeIds(ids)}): ${pumpFailedError.message}; provider result was valid but unpublished`,
                ),
              );
            } else {
              const d1 = srcError instanceof Error ? srcError.message : String(srcError);
              reject(new Error(`${d1}; ${pumpFailedError.message}`));
            }
          } else {
            armBound();
          }
          return;
        }
        if (srcDone && srcOk) {
          if (pumpDone) {
            settled = true;
            providerSettled = true;
            clearTimer();
            resolve(srcValue as AssistantMessage);
          }
          // Else wait for the owned pump (triggered via wake-notify): no
          // bound-success is ever published over an unfinished iteration.
          return;
        }
        if (srcDone && !srcOk) {
          if (pumpDone) {
            settled = true;
            providerSettled = true;
            clearTimer();
            if (cleanEofWithoutTerminal) {
              // Rejected ORIGINAL with a concurrent eventless EOF: preserve
              // both (neither erased), matching the long-standing joined
              // contract. A clean finish WITH a terminal event rejects
              // alone (no EOF failure happened).
              const d1 = srcError instanceof Error ? srcError.message : String(srcError);
              reject(new Error(`${d1}; STREAM_ENDED_WITHOUT_MESSAGE (${describeIds(ids)}): provider iteration ended with no done/error event`));
            } else {
              reject(srcError);
            }
            return;
          }
          // Known ORIGINAL rejection with an unfinished pump: one
          // scheduling bound for a racing pump failure to join
          // (combined causes), then public failure on the ORIGINAL cause
          // alone — independent of an indefinitely pending next(), no
          // abort required. Replay already terminated at rejection
          // observation above; repeated calls share this outcome.
          armBound();
          return;
        }
        // Source pending, pump unfinished and unfaulted: wait for both
        // (source callbacks and wake-notify trigger settle). The single
        // exception is a clean EOF with no terminal and no result on the
        // way: a bare ORIGINAL end() leaves result() pending forever, so
        // one bound rejects it explicitly (a tardy valid result still wins
        // if it lands first).
        if (!srcDone && pumpDone && cleanEofWithoutTerminal) {
          armBound();
        }
      };
      src.then(
        (message) => {
          srcDone = true;
          srcOk = true;
          srcValue = message;
          settle();
        },
        (error: unknown) => {
          srcDone = true;
          srcOk = false;
          srcError = error;
          // Terminate replay promptly for live waiters (deferred so
          // in-flight relays drain first; the persistent ended flag
          // covers pure-iteration consumers that never call result()).
          terminateReplaySoon();
          settle();
        },
      );
      notifyCoordinated = settle;
      settle();
    });
    return coordinated;
  };
  // result()/iteration join the literal post-hoc so the coordination
  // machinery above stays in adapt scope (not inside the literal).
  Object.assign(facade, {
    result: (): Promise<AssistantMessage> => {
      if (coordinatedMemo === null) coordinatedMemo = buildCoordinated();
      return Promise.race([localGate, coordinatedMemo]);
    },
    [Symbol.asyncIterator]: replay,
  });
  // Identity change is explicit and justified: the facade satisfies the full
  // public behavioral contract the SDK loop consumes (result + async
  // iteration with identical event order/content, plus supported push/end
  // with genuine SDK semantics); SDK-private internals are never touched,
  // and the provider stream is never mutated by consumer-side pushes.
  return facade as unknown as AssistantMessageEventStream;
}
