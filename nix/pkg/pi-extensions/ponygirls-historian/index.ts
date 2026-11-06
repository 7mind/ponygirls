import { join } from 'node:path';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { CustomViewToggle, StatusView } from '@ponygirls/pi-ui';
import { parseToggleCommand, sessionEnabledData } from '@ponygirls/pi-settings';
import { HistorianController } from './src/controller.ts';
import { completeHistorianArguments } from './src/complete.ts';
import { styleHistorianJournal, styleHistorianStatus } from './src/presentation.ts';
import { CONSENT_TYPE, ENABLED_TYPE, FOCUS_TYPE, MODEL_TYPE, PreferenceStore, parseModel } from './src/preferences.ts';

export default function (pi: ExtensionAPI): void {
  const preferences = new PreferenceStore(join(getAgentDir(), 'historian.json'));
  let controller: HistorianController | null = null;
  let pane = new CustomViewToggle();
  let context: ExtensionContext | null = null;
  const publish = () => {
    if (context === null || controller === null) return;
    const label = controller.badge();
    if (label === null) { context.ui.setWidget('historian', undefined); return; }
    const ctx = context;
    ctx.ui.setWidget('historian', (_tui, theme) => ({
      render: width => [truncateToWidth(theme.fg(label.includes('!') ? 'warning' : 'accent', ` ${label} `), width)],
      renderCompact: width => truncateToWidth(' H ', width), invalidate() {},
      handleMouse: event => {
        if (event.type !== 'click' || event.button !== 'left' || ctx.mode !== 'tui') return undefined;
        void show(ctx, false); return { handled: true };
      },
    }), { placement: 'borderBottomLeft' });
  };
  async function show(ctx: ExtensionContext, journal: boolean): Promise<void> {
    if (controller === null) { ctx.ui.notify('Historian is unavailable for this session', 'error'); return; }
    const value = journal ? controller.journal() : controller.status();
    if (ctx.mode !== 'tui' || !ctx.hasUI) { ctx.ui.notify(value, 'info'); return; }
    await pane.toggle(ctx.ui, (tui, theme, keys, done) => new StatusView({ title: journal ? 'Historian project journal' : 'Historian status',
      text: () => journal ? styleHistorianJournal(value, theme) : styleHistorianStatus(value, theme), theme, keys, rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close: done }));
  }
  pi.registerCommand('historian', {
    description: 'Project journals (on approves configured-provider disclosure): on|off|inherit|default on|default off|status|journal; [default] model PROVIDER MODEL THINKING; [default] focus TEXT; [default] model inherit; focus inherit',
    getArgumentCompletions: prefix => completeHistorianArguments(prefix, context === null ? [] : context.modelRegistry.getAvailable()),
    handler: async (args, ctx) => {
      try {
        if (controller === null) throw new Error('Historian session initialization failed; inspect extension errors');
        const trimmed = args.trim();
        if (trimmed === 'journal') { await show(ctx, true); return; }
        const toggle = parseToggleCommand(trimmed);
        if (toggle?.kind === 'status') { await show(ctx, false); return; }
        const sessionId = ctx.sessionManager.getSessionId();
        if (toggle !== null) {
          const config = controller.effective();
          if (toggle.enabled === true && config.model === null) throw new Error('Configure /historian model PROVIDER MODEL THINKING first');
          if (toggle.kind === 'session') {
            if (toggle.enabled === true) pi.appendEntry(CONSENT_TYPE, { version: 1, sessionId, model: config.model });
            pi.appendEntry(ENABLED_TYPE, sessionEnabledData(sessionId, toggle.enabled));
          } else {
            preferences.update(defaults => {
              if (toggle.enabled && defaults.model === null) throw new Error('Configure /historian default model PROVIDER MODEL THINKING first');
              return { enabled: toggle.enabled, approvedModel: toggle.enabled ? defaults.model : defaults.approvedModel };
            });
          }
        } else {
          const words = trimmed.split(/\s+/); const global = words[0] === 'default';
          if (global) words.shift();
          const setting = words.shift(); const value = words.join(' ');
          if (setting === 'model') {
            const inherit = value === 'inherit';
            if (!inherit && words.length !== 3) throw new Error('Model syntax: [default] model PROVIDER MODEL THINKING, or [default] model inherit');
            const model = inherit ? null : parseModel({ provider: words[0], id: words[1], thinking: words[2] });
            if (global) preferences.update(() => ({ model }));
            else pi.appendEntry(MODEL_TYPE, { version: 1, sessionId, model });
          } else if (setting === 'focus') {
            if (!value || value.length > 4000) throw new Error('Focus must contain 1–4000 characters');
            if (global) preferences.update(() => ({ focus: value }));
            else pi.appendEntry(FOCUS_TYPE, { version: 1, sessionId, focus: value === 'inherit' ? null : value });
          } else throw new Error('Usage: /historian on|off|inherit|default on|default off|status|journal|[default] model PROVIDER MODEL THINKING|[default] focus TEXT');
        }
        await controller.settingsChanged(); publish(); ctx.ui.notify(controller.status(), 'info');
      } catch (error) { ctx.ui.notify(`Historian: ${String(error)}`, 'error'); }
    },
  });
  pi.on('session_start', async (_event, ctx) => {
    context = ctx; pane = new CustomViewToggle();
    controller = new HistorianController(pi, preferences, ctx, publish);
    await controller.reconcile(); publish();
  });
  pi.on('turn_end', () => controller?.schedule(0));
  pi.on('agent_settled', () => controller?.schedule(0));
  pi.on('session_tree', () => controller?.schedule(0));
  pi.on('session_shutdown', async () => {
    pane.dispose(); context?.ui.setWidget('historian', undefined);
    await controller?.dispose(); controller = null; context = null;
  });
}
