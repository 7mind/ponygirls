/**
 * ponygirls-tools-explorer — /tools: every tool the session has registered
 * (built-in, extension, package and MCP tools; declared to the model or not)
 * with its state, its source, an estimate of what its definition costs in
 * context, its description and its parameter schema. `l` and `u` load a tool
 * into pi's active set and unload it. Outside the terminal UI the command
 * answers with a text summary. It registers no tool and adds nothing to the
 * prompt.
 *
 * Wire-up: listed in nix/hm/pi.nix `programs.pi.settings.extensions`.
 */
import { homedir } from "node:os";
import { highlightCode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CustomViewToggle } from "@ponygirls/pi-ui";
import { buildCatalog } from "./src/catalog.ts";
import { REFRESH_MS, ToolsPane } from "./src/pane.ts";
import { PiToolRegistry } from "./src/pi-registry.ts";
import { summaryReport, toolsReport } from "./src/report.ts";

const COMMAND = "tools";
const JSON_LANGUAGE = "json";

/** Where the text answer goes when the session has no UI to notify. */
export type ProcessOutput = (text: string) => void;

export function toolsExplorer(write: ProcessOutput): (pi: ExtensionAPI) => void {
  return (pi) => {
    // pi runs this factory again for every session and reload, so the view is one session's.
    const view = new CustomViewToggle();
    pi.on("session_shutdown", () => { view.dispose(); });

    pi.registerCommand(COMMAND, {
      description: "Explore tools: state, source, token cost, schema",
      handler: async (args, ctx) => {
        const registry = new PiToolRegistry(pi, ctx);
        const filter = args.trim();
        if (ctx.mode !== "tui" || !ctx.hasUI) {
          const catalog = buildCatalog(registry.snapshot());
          const text = filter === "" ? summaryReport(catalog) : toolsReport(catalog, filter);
          // pi delivers notifications to RPC clients and drops them in print and JSON runs.
          if (ctx.hasUI) ctx.ui.notify(text, "info");
          else write(`${text}\n`);
          return;
        }
        await view.open(ctx.ui, (tui, theme, keys, done) => new ToolsPane({
          registry,
          theme,
          keys,
          rows: () => tui.terminal.rows,
          requestRender: () => tui.requestRender(),
          close: done,
          highlightJson: (json) => highlightCode(json, JSON_LANGUAGE),
          home: homedir(),
          refreshEveryMs: REFRESH_MS,
          filter,
        }));
      },
    });
  };
}

// In print and JSON runs pi keeps stdout for the model's answer and sends this to stderr.
export default toolsExplorer((text) => { process.stdout.write(text); });
