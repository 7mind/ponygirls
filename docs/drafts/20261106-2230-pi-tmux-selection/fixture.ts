import { appendFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  const logPath = process.env.FIXTURE_LOG;
  if (!logPath) throw new Error("FIXTURE_LOG required");
  const log = (value: object) => appendFileSync(logPath, JSON.stringify(value) + "\n");
  pi.registerProvider("selection-fixture", {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-only",
    models: [{ id: "synthetic", name: "Synthetic", reasoning: false, input: ["text"],
      contextWindow: 8192, maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: () => { log({ inference: true }); throw new Error("Inference forbidden"); },
  });
  let active: { close: () => void } | undefined;
  let generation = 0;
  const toggle = async (ctx: ExtensionContext) => {
    if (active) { active.close(); return; }
    const interaction = { close: () => {} };
    active = interaction;
    try {
      await ctx.ui.custom<void>((_tui, _theme, keys, done) => {
        interaction.close = () => done();
        return {
          render: (width: number) => ["DETAILS OPEN", "Select this synthetic text", "Escape closes"].map(line => truncateToWidth(line, width)),
          handleInput: (data: string) => { if (keys.matches(data, "tui.select.cancel")) done(); },
          invalidate() {},
        };
      }, { retainEditorBorders: true });
    } finally { if (active === interaction) active = undefined; }
  };
  const register = (ctx: ExtensionContext) => {
    const owner = ++generation;
    ctx.ui.setWidget("selection-details", () => ({
      render: () => [" Details "],
      handleMouse(event) {
        log({ owner, type: event.type, button: event.button, x: event.x, y: event.y });
        if (event.type === "click" && event.button === "left") void toggle(ctx);
        return { handled: true, focus: false };
      },
      invalidate() {},
    }), { placement: "borderBottomLeft" });
    log({ registered: owner });
  };
  pi.on("session_start", (_event, ctx) => {
    const observeInput = (data: Buffer | string) => log({ raw: data.toString() });
    process.stdin.on("data", observeInput);
    pi.on("session_shutdown", () => process.stdin.off("data", observeInput));
    ctx.ui.setHeader(() => ({ render: (width: number) => [truncateToWidth("Select this synthetic text", width)], invalidate() {} }));
    ctx.ui.setFooter(() => ({ render: (width: number) => [truncateToWidth("Offline selection fixture", width)], invalidate() {} }));
    register(ctx);
  });
  pi.registerCommand("replace-badge", { description: "Replace fixture registration", handler: async (_args, ctx) => { register(ctx); } });
  pi.on("session_shutdown", () => { if (active) active.close(); log({ shutdown: true }); });
}
