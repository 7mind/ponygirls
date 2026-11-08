import { afterEach, describe, expect, it } from "vitest";
import { clearCredentialCache, resolveBackendKey, resolveConfigValue } from "../extensions/credentials.js";

// Blackbox/Good-Communication: real local shell, no external services.
describe("abortable credential commands", () => {
  afterEach(clearCredentialCache);
  it("preserves shell values, literals and empty output", async () => {
    expect(await resolveConfigValue("!printf '  key-value  '")).toBe("key-value");
    expect(await resolveConfigValue("!printf ''")).toBeUndefined();
    expect(await resolveConfigValue("literal-key")).toBe("literal-key");
    expect(await resolveConfigValue("none")).toBeUndefined();
  });
  it("uses configured command deadlines without blocking the event loop", async () => {
    let ticked = false;
    const tick = setTimeout(() => { ticked = true; }, 5);
    await expect(resolveBackendKey("exa", { backends: { exa: { apiKey: "!sleep 10; printf secret" } }, timeouts: { credentialMs: 30 } })).rejects.toThrow("timed out");
    clearTimeout(tick);
    expect(ticked).toBe(true);
  });
  it("cancels one caller without poisoning another caller or its cache", async () => {
    const reference = "!sleep 0.05; printf isolated-key";
    const controller = new AbortController();
    const cancelled = resolveConfigValue(reference, controller.signal);
    const other = resolveConfigValue(reference);
    controller.abort();
    await expect(cancelled).rejects.toThrow("cancelled");
    expect(await other).toBe("isolated-key");
    expect(await resolveConfigValue(reference)).toBe("isolated-key");
  });
  it("does not leak command text, stdout or stderr in failures", async () => {
    const reference = "!printf sensitive-stdout; printf sensitive-stderr >&2; exit 1";
    await expect(resolveConfigValue("!invalid-command-with-secret\0")).rejects.toThrow(/^Credential command failed$/);
    await expect(resolveConfigValue(reference)).rejects.toThrow(/^Credential command failed$/);
    await expect(resolveConfigValue(reference)).rejects.toThrow(/^Credential command failed$/);
  });
  it("does not cache cancelled or timed out requests", async () => {
    const reference = "!sleep 0.05; printf retry-key";
    await expect(resolveConfigValue(reference, undefined, 5)).rejects.toThrow("timed out");
    expect(await resolveConfigValue(reference, undefined, 1000)).toBe("retry-key");
  });
});
