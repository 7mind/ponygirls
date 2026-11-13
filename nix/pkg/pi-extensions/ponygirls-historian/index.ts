import { join } from 'node:path';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { truncateToWidth } from '@earendil-works/pi-tui';
import { CustomViewToggle, StatusView } from '@ponygirls/pi-ui';
import { parseToggleCommand } from '@ponygirls/pi-settings';
import { HistorianController } from './src/controller.ts';
import { completeHistorianArguments } from './src/complete.ts';
import { styleHistorianJournal, styleHistorianStatus } from './src/presentation.ts';
import { createHistorianDisclosureConfirmation, createHistorianSettingsController, newHistorianSettingsView } from './src/settings-view.ts';
import { PreferenceStore, parseModel } from './src/preferences.ts';
import type { ProjectChange } from './src/project-config.ts';

export default function (pi: ExtensionAPI): void {
  const preferences = new PreferenceStore(join(getAgentDir(), 'historian.json'));
  let controller: HistorianController | null = null;
  let pane = new CustomViewToggle();
  let context: ExtensionContext | null = null;
  let settingsView = newHistorianSettingsView();
  let directProjectApproval: AbortController | null = null;
  let generation = 0;
  const cancelDirectApproval = () => {
    const pending = directProjectApproval; directProjectApproval = null; pending?.abort();
  };
  const currentOwner = (selected: HistorianController, ctx: ExtensionContext): (() => boolean) => {
    const owner = ctx.sessionManager.getSessionId(), cwd = ctx.cwd, revision = generation;
    return () => {
      try { return generation === revision && controller === selected && context !== null &&
        context.cwd === cwd && ctx.cwd === cwd && context.sessionManager.getSessionId() === owner && ctx.sessionManager.getSessionId() === owner; }
      catch { return false; }
    };
  };
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
    settingsView.dispose(); settingsView = newHistorianSettingsView(); cancelDirectApproval();
    const value = journal ? controller.journal() : controller.status();
    if (ctx.mode !== 'tui' || !ctx.hasUI) { ctx.ui.notify(value, 'info'); return; }
    await pane.toggle(ctx.ui, (tui, theme, keys, done) => new StatusView({ title: journal ? 'Historian project journal' : 'Historian status',
      text: () => journal ? styleHistorianJournal(value, theme) : styleHistorianStatus(value, theme), theme, keys, rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close: done }));
  }
  async function showSettings(ctx: ExtensionContext): Promise<void> {
    const selected = controller;
    if (selected === null) throw new Error('Historian session initialization failed');
    const current = currentOwner(selected, ctx);
    cancelDirectApproval(); pane.dispose(); pane = new CustomViewToggle();
    await settingsView.show(ctx, () => createHistorianSettingsController({
      current, read: () => selected.settingsSnapshot(),
      apply: (scope, changes, signal, target, confirm) => selected.applyScopedSettings(scope, changes, signal, target, confirm),
      applied: () => publish(),
    }, ctx), { title: 'Historian settings' });
  }
  async function retire(): Promise<void> {
    const selected = controller, previous = context;
    controller = null; context = null;
    settingsView.dispose(); pane.dispose(); cancelDirectApproval();
    try { previous?.ui.setWidget('historian', undefined); }
    finally { await selected?.dispose(); }
  }
  pi.registerCommand('historian', {
    description: 'Project journals (on approves configured-provider disclosure): settings|project on|on|off|inherit|default on|default off|status|journal; [default] model PROVIDER MODEL THINKING; [default] focus TEXT; [default] model inherit; focus inherit',
    getArgumentCompletions: prefix => completeHistorianArguments(prefix, context === null ? [] : context.modelRegistry.getAvailable()),
    handler: async (args, ctx) => {
      const enteredGeneration = generation;
      try {
        if (controller === null) throw new Error('Historian session initialization failed; inspect extension errors');
        const trimmed = args.trim();
        if (trimmed === 'settings') { await showSettings(ctx); return; }
        if (trimmed === 'project on') {
          const selected = controller;
          if (directProjectApproval !== null) throw new Error('Historian project approval is already open');
          settingsView.dispose(); settingsView = newHistorianSettingsView(); pane.dispose(); pane = new CustomViewToggle();
          const operation = new AbortController(); directProjectApproval = operation;
          const signal = ctx.signal === undefined ? operation.signal : AbortSignal.any([operation.signal, ctx.signal]);
          const current = currentOwner(selected, ctx);
          try {
            const snapshot = selected.settingsSnapshot();
            await selected.applyScopedSettings('project', [{ key: 'enabled', op: 'set', value: true }], signal,
              snapshot.targets.project, createHistorianDisclosureConfirmation(ctx, current));
            if (current()) { publish(); ctx.ui.notify(selected.status(), 'info'); }
          } finally { if (directProjectApproval === operation) directProjectApproval = null; }
          return;
        }
        if (trimmed === 'journal') { await show(ctx, true); return; }
        const toggle = parseToggleCommand(trimmed);
        if (toggle?.kind === 'status') { await show(ctx, false); return; }
        const selected = controller, current = currentOwner(selected, ctx);
        let scope: 'global' | 'session';
        let changes: readonly ProjectChange[];
        if (toggle !== null) {
          scope = toggle.kind === 'session' ? 'session' : 'global';
          changes = [toggle.enabled === null ? { key: 'enabled', op: 'inherit' } : { key: 'enabled', op: 'set', value: toggle.enabled }];
        } else {
          const words = trimmed.split(/\s+/); const global = words[0] === 'default';
          scope = global ? 'global' : 'session';
          if (global) words.shift();
          const setting = words.shift(); const value = words.join(' ');
          if (setting === 'model') {
            const inherit = value === 'inherit';
            if (!inherit && words.length !== 3) throw new Error('Model syntax: [default] model PROVIDER MODEL THINKING, or [default] model inherit');
            changes = [inherit ? { key: 'model', op: 'inherit' } : { key: 'model', op: 'set', value: parseModel({ provider: words[0], id: words[1], thinking: words[2] }) }];
          } else if (setting === 'focus') {
            if (!value || value.length > 4000) throw new Error('Focus must contain 1–4000 characters');
            changes = [!global && value === 'inherit' ? { key: 'focus', op: 'inherit' } : { key: 'focus', op: 'set', value }];
          } else throw new Error('Usage: /historian on|off|inherit|default on|default off|status|journal|[default] model PROVIDER MODEL THINKING|[default] focus TEXT');
        }
        const snapshot = selected.settingsSnapshot();
        if (!current()) throw new Error('Historian settings context is stale');
        // Only explicit legacy ON commands provide approval without another dialog.
        await selected.applyScopedSettings(scope, changes, ctx.signal ?? new AbortController().signal, snapshot.targets[scope], async () => true);
        if (current()) { publish(); ctx.ui.notify(selected.status(), 'info'); }
      } catch (error) { if (generation === enteredGeneration) ctx.ui.notify(`Historian: ${String(error)}`, 'error'); }
    },
  });
  pi.on('session_start', async (_event, ctx) => {
    const revision = ++generation;
    await retire();
    if (revision !== generation) return;
    settingsView = newHistorianSettingsView();
    context = ctx; pane = new CustomViewToggle();
    controller = new HistorianController(pi, preferences, ctx, publish);
    await controller.reconcile(); publish();
  });
  pi.on('turn_end', () => controller?.schedule(0));
  pi.on('agent_settled', () => controller?.schedule(0));
  pi.on('session_tree', () => controller?.schedule(0));
  pi.on('session_shutdown', async () => { generation++; await retire(); });
}
