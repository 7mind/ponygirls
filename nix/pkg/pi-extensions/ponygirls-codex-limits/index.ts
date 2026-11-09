import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CATALOG_URL, HttpCodexCatalog } from "./catalog.ts";
import { maximumContextProvider, type MaximumContextProvider } from "./provider.ts";

export function registerCodexLimits(pi: ExtensionAPI, decorated: MaximumContextProvider): void {
  pi.registerProvider(decorated.providerId, { modelMetadata: decorated.metadata });
  let lastWarning: string | undefined;

  async function synchronize(ctx: ExtensionContext): Promise<void> {
    const selected = ctx.model;
    if (!selected || selected.provider !== decorated.providerId) return;
    const updated = ctx.modelRegistry.find(selected.provider, selected.id);
    if (updated && (updated.contextWindow !== selected.contextWindow || updated.maxTokens !== selected.maxTokens)) {
      await pi.setModel(updated);
    }
    const warning = decorated.hasLimit(selected.id) ? undefined : `${selected.id}: ${decorated.status()}`;
    if (warning !== undefined && warning !== lastWarning) {
      ctx.ui.notify("Codex limits: no discovered context limit for the selected model; Pi catalog limits retained.", "warning");
    }
    lastWarning = warning;
  }

  async function refresh(ctx: ExtensionContext): Promise<void> {
    const result = await ctx.modelRegistry.refresh({ providers: [decorated.providerId] });
    if (result.errors.has(decorated.providerId)) {
      ctx.ui.notify("Codex limits: provider catalog or limit discovery failed; available limits retained. Check connectivity/authentication and run /codex-limits refresh to retry.", "warning");
    }
    await synchronize(ctx);
  }

  async function prepare(ctx: ExtensionContext): Promise<void> {
    if (!ctx.model || ctx.model.provider !== decorated.providerId) return;
    if (decorated.needsRefresh()) await refresh(ctx);
    else await synchronize(ctx);
  }

  pi.on("session_start", async (_event, ctx) => refresh(ctx));
  pi.on("model_select", async (_event, ctx) => synchronize(ctx));
  pi.on("input", async (_event, ctx) => prepare(ctx));
  pi.on("before_agent_start", async (_event, ctx) => prepare(ctx));
  pi.registerCommand("codex-limits", {
    description: "Show Codex limit sources, or refresh discovery with /codex-limits refresh",
    handler: async (args, ctx) => {
      if (args.trim() === "refresh") await refresh(ctx);
      else if (args.trim() !== "") {
        ctx.ui.notify("Usage: /codex-limits [refresh]", "warning");
        return;
      }
      const model = ctx.model;
      const selected = model && model.provider === decorated.providerId
        ? `\nSelected: ${model.id}; context ${ctx.modelRegistry.find(model.provider, model.id)?.contextWindow ?? model.contextWindow}; output ${model.maxTokens}.`
        : "";
      ctx.ui.notify(`Codex limits: ${decorated.status()}${selected}`, "info");
    },
  });
}

export default function (pi: ExtensionAPI): void {
  const base = builtinProviders().find((provider) => provider.id === "openai-codex");
  if (!base) throw new Error("Pi's built-in Codex provider is unavailable");
  registerCodexLimits(pi, maximumContextProvider(base, new HttpCodexCatalog(CATALOG_URL, fetch)));
}
