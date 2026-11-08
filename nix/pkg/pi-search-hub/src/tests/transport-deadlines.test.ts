import { describe, expect, it } from "vitest";
import { timeoutSignal, clearCooldowns, markCooldown, waitForCooldown } from "../extensions/utils.js";

// BG regression: scheduler deadlines must not acquire an implicit transport cap.
describe("transport deadline ownership", () => {
  it("preserves a caller-owned signal without a hidden timeout", () => {
    const controller = new AbortController();
    expect(timeoutSignal(controller.signal)).toBe(controller.signal);
  });
  it("honors an explicit inner timeout", async () => {
    const signal = timeoutSignal(new AbortController().signal, 10)!;
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(signal.aborted).toBe(true);
  });
  it("cancels a cooldown immediately", async () => {
    clearCooldowns(); markCooldown("test");
    const controller = new AbortController();
    const pending = waitForCooldown("test", controller.signal);
    controller.abort(new Error("cancel cooldown"));
    await expect(pending).rejects.toThrow("cancel cooldown");
    clearCooldowns();
  });
});
