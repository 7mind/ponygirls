/**
 * ponygirls-tokemon — provider quotas inside pi (tokemon without Claude,
 * Codex, or yolo profiles).
 *
 * - Tool `tokemon`: every provider this pi is configured for (auth.json
 *   logins and keys, API-key environment variables, models.json providers)
 *   with its plan, login, and quota windows; `include_models` adds each
 *   provider's available models. Answers are cached for a minute.
 * - Command `/tokemon`: the same data as a scrollable, auto-refreshing table.
 *
 * Wire-up: listed in nix/hm/pi.nix `programs.pi.settings.extensions`.
 */

import { homedir } from "node:os";
import { defineTool, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getTerminalColorMode, parseColor, styleText } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { providerColor } from "./src/colors.ts";
import { discoverTargets } from "./src/discovery.ts";
import { FetchHttp } from "./src/http.ts";
import { secretOf } from "./src/pi-auth.ts";
import { toolReport } from "./src/report.ts";
import { QuotaService, type ProviderAuth } from "./src/service.ts";
import { buildTable, PLAIN_TABLE_STYLE, type TableStyle } from "./src/table.ts";
import { TokemonView } from "./src/view.ts";

/** How stale an answer to the agent tool may be. */
const TOOL_MAX_AGE_MS = 60_000;
/** The pane's auto-refresh interval (tokemon's default). */
const PANE_REFRESH_MS = 300_000;
const HTTP_TIMEOUT_MS = 15_000;

/** Resolution failures (e.g. a failed OAuth refresh) propagate into the provider's row. */
function authOf(ctx: ExtensionContext): ProviderAuth {
  return {
    apiKey: async (provider) => {
      const result = await ctx.modelRegistry.getProviderAuth(provider);
      return result === undefined ? null : secretOf(result.auth);
    },
  };
}

/** Model ids with configured auth, by provider. */
function modelsOf(ctx: ExtensionContext): Map<string, string[]> {
  const byProvider = new Map<string, string[]>();
  for (const model of ctx.modelRegistry.getAvailable()) {
    const ids = byProvider.get(model.provider) ?? [];
    ids.push(model.id);
    byProvider.set(model.provider, ids);
  }
  return byProvider;
}

interface ThemeColors {
  fg(color: "dim" | "success" | "warning" | "error", text: string): string;
  bold(text: string): string;
}

function tableStyle(theme: ThemeColors): TableStyle {
  const mode = getTerminalColorMode();
  return {
    provider: (provider, text) => styleText(text, { fg: parseColor(providerColor(provider)) }, mode),
    bold: (s) => theme.bold(s),
    dim: (s) => theme.fg("dim", s),
    success: (s) => theme.fg("success", s),
    warning: (s) => theme.fg("warning", s),
    error: (s) => theme.fg("error", s),
  };
}

export default function (pi: ExtensionAPI): void {
  const service = new QuotaService({
    discover: () => discoverTargets(getAgentDir(), homedir(), process.env),
    http: new FetchHttp(HTTP_TIMEOUT_MS),
    now: () => new Date(),
  });

  pi.registerTool(
    defineTool({
      name: "tokemon",
      label: "Provider quotas",
      description:
        "List the model providers this pi is configured for (auth.json logins and keys, API-key environment variables, models.json providers) with each account's plan, login, and quota windows: used and limit with their unit, state (ok, low at 90%+, EXHAUSTED, unlimited), and reset time. Providers without a quota endpoint or whose query failed are listed with a note or error. Set include_models to also get each provider's available model ids. Answers may be up to a minute old (see fetchedAt).",
      parameters: Type.Object({
        include_models: Type.Optional(Type.Boolean({ description: "Also list each provider's available model ids (default false)" })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const report = await service.report(authOf(ctx), TOOL_MAX_AGE_MS);
          const p = params as { include_models?: boolean };
          const body = toolReport(report, new Date(), p.include_models === true ? modelsOf(ctx) : null);
          return { content: [{ type: "text", text: JSON.stringify(body) }], details: {} };
        } catch (e) {
          return { content: [{ type: "text", text: `tokemon failed: ${(e as Error).message}` }], details: {}, isError: true };
        }
      },
    }),
  );

  pi.registerCommand("tokemon", {
    description: "Provider quotas: a scrollable, auto-refreshing table",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        try {
          const report = await service.report(authOf(ctx), TOOL_MAX_AGE_MS);
          const table = buildTable(report.results, new Date(), { showInvalid: false, width: null }, PLAIN_TABLE_STYLE);
          ctx.ui.notify([...table.lines, ...(table.caption ? [table.caption] : [])].join("\n"), "info");
        } catch (e) {
          ctx.ui.notify(`/tokemon: ${(e as Error).message}`, "error");
        }
        return;
      }
      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) =>
          new TokemonView({
            report: (maxAgeMs) => service.report(authOf(ctx), maxAgeMs),
            models: () => modelsOf(ctx),
            now: () => new Date(),
            rows: () => tui.terminal.rows,
            requestRender: () => tui.requestRender(),
            close: () => done(),
            style: tableStyle(theme),
            refreshEveryMs: PANE_REFRESH_MS,
          }),
        // Full-terminal overlay: pi's fullscreen viewport otherwise takes PgUp/PgDn.
        { overlay: true, overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 } },
      );
    },
  });
}
