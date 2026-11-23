import { homedir } from "node:os";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CustomViewToggle } from "@ponygirls/pi-ui";
import type { ScopedSettingsAction, ScopedSettingsPort } from "@ponygirls/pi-settings";
import { ArcheologistPane } from "./src/pane.ts";
import type { PaneInventory } from "./view-contract.ts";

export async function openArcheologist(ctx: ExtensionCommandContext, settings: ScopedSettingsPort, inventory: () => PaneInventory, signal: AbortSignal): Promise<void> {
  if (ctx.mode !== "tui" || signal.aborted) return;
  const view = new CustomViewToggle();
  const dismiss = () => view.dispose();
  signal.addEventListener("abort", dismiss, { once: true });
  try {
    while (!signal.aborted && settings.active) {
      const next: { action?: ScopedSettingsAction } = {};
      await view.open(ctx.ui, (tui, theme, keys, done) => new ArcheologistPane({
        settings, inventory, theme, keys, home: homedir(), render: () => tui.requestRender(),
        close(action) { next.action = action; done(); },
      }));
      if (!next.action || signal.aborted) return;
      await next.action.run(signal);
    }
  } finally {
    dismiss();
    signal.removeEventListener("abort", dismiss);
  }
}
