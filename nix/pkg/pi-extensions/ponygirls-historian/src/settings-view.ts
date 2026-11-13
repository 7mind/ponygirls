import type {
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
  ScopedSettingsController,
  scopedBooleanField,
  type ScopedSettingChange,
  type ScopedSettingFields,
  type ScopedSettingsScope,
  type ScopedSettingsSnapshot,
} from '@ponygirls/pi-settings';
import {
  ScopedSettingsView,
  confirmOperatorAction,
} from '@ponygirls/pi-ui';
import { text } from './model.ts';
import { modelKey, parseModel } from './preferences.ts';
import type {
  ConfirmDisclosure,
} from './project-settings.ts';
import {
  HISTORIAN_SETTINGS_ORDER,
  type HistorianSettingsSnapshot,
  type HistorianValues,
} from './scoped-values.ts';
import type { WorkerModel } from './worker.ts';

export interface HistorianSettingsCallbacks {
  current(): boolean;

  read(): HistorianSettingsSnapshot;

  apply(
    scope: ScopedSettingsScope,
    changes: readonly ScopedSettingChange<HistorianValues>[],
    signal: AbortSignal,
    expectedTarget: string,
    confirm: ConfirmDisclosure,
  ): Promise<void>;

  applied(
    snapshot: ScopedSettingsSnapshot<HistorianValues>,
    scope: ScopedSettingsScope,
  ): void;
}

function modelText(model: WorkerModel | null): string {
  return model === null
    ? 'unconfigured'
    : `${model.provider}/${model.id} (${model.thinking})`;
}

function requireCurrent(
  current: () => boolean,
  signal: AbortSignal,
): void {
  signal.throwIfAborted();
  if (!current()) {
    throw new Error('Historian settings context is stale');
  }
  signal.throwIfAborted();
}

export function createHistorianDisclosureConfirmation(
  ctx: ExtensionContext,
  current: () => boolean,
): ConfirmDisclosure {
  return async (prompt, signal) => {
    requireCurrent(current, signal);
    if (ctx.mode !== 'tui' || !ctx.hasUI) {
      throw new Error(
        'Historian disclosure confirmation requires interactive TUI mode',
      );
    }
    const accepted = await confirmOperatorAction(ctx, 'Historian disclosure approval', prompt, signal);
    requireCurrent(current, signal);
    return accepted;
  };
}

export function createHistorianSettingsController(
  callbacks: HistorianSettingsCallbacks,
  ctx: ExtensionContext,
): ScopedSettingsController<HistorianValues> {
  let latest = callbacks.read();
  const confirm = createHistorianDisclosureConfirmation(
    ctx,
    () => callbacks.current(),
  );

  const fields: ScopedSettingFields<HistorianValues> = {
    enabled: {
      ...scopedBooleanField(
        'Historian capture',
        'Requested capture intent. Apply is not disclosure approval.',
      ),
      get description(): string {
        return [
          'Requested capture intent. Apply is not disclosure approval.',
          'Project ON additionally needs a live runtime-local grant.',
          'For unchanged requested project ON, close this dialog and run /historian project on.',
          `Configured journal root (read-only): ${latest.configuredJournalRoot}.`,
          'Managed journal-root changes require controller reload and do not migrate journals.',
        ].join(' ');
      },
    },

    model: {
      kind: 'value',
      label: 'Worker model',
      get description(): string {
        const managed = latest.managed.model ?? null;
        return [
          'Edit one complete PROVIDER MODEL THINKING value.',
          'Changing selection does not approve disclosure.',
          `Managed model (read-only): ${modelText(managed)}.`,
          'Use Inherit to remove this scope’s override.',
        ].join(' ');
      },
      decode(value: unknown): WorkerModel | null {
        return value === null ? null : parseModel(value);
      },
      equals(left, right): boolean {
        return modelKey(left) === modelKey(right);
      },
      format: modelText,
      async edit(request) {
        requireCurrent(
          () => callbacks.current(),
          request.signal,
        );

        const placeholder = request.value === null
          ? 'PROVIDER MODEL THINKING'
          : [
              request.value.provider,
              request.value.id,
              request.value.thinking,
            ].join(' ');

        const input = await ctx.ui.input(
          'Historian model: PROVIDER MODEL THINKING',
          placeholder,
          { signal: request.signal },
        );

        if (
          input === undefined ||
          request.signal.aborted
        ) {
          return { kind: 'cancel' };
        }
        requireCurrent(
          () => callbacks.current(),
          request.signal,
        );

        const words = input.trim().split(/\s+/);
        if (words.length !== 3) {
          throw new Error(
            'Enter PROVIDER MODEL THINKING; use Inherit to reset',
          );
        }

        return {
          kind: 'set',
          value: parseModel({
            provider: words[0],
            id: words[1],
            thinking: words[2],
          }),
        };
      },
    },

    focus: {
      kind: 'value',
      label: 'Journal focus',
      description:
        'Complete 1–4000 character objective focus. Editing only stages it; Inherit removes this scope’s override.',
      decode(value: unknown): string {
        return text(value, 'focus', 4000);
      },
      equals(left, right): boolean {
        return left === right;
      },
      format(value): string {
        return value;
      },
      async edit(request) {
        requireCurrent(
          () => callbacks.current(),
          request.signal,
        );

        const input = await ctx.ui.input(
          'Historian focus: 1–4000 characters',
          request.value,
          { signal: request.signal },
        );

        if (
          input === undefined ||
          request.signal.aborted
        ) {
          return { kind: 'cancel' };
        }
        requireCurrent(
          () => callbacks.current(),
          request.signal,
        );

        return {
          kind: 'set',
          value: text(input, 'focus', 4000),
        };
      },
    },
  };

  return new ScopedSettingsController<HistorianValues>({
    fields,
    order: HISTORIAN_SETTINGS_ORDER,

    inactive(_key, effective): string {
      if (!effective.enabled) {
        return 'Preview OFF: no new capture requested.';
      }
      if (effective.model === null) {
        return 'Preview ON is inactive until a model is configured.';
      }

      const runtime = !latest.runtimeRequested
        ? 'OFF'
        : latest.runtimeApproved
          ? 'approved'
          : 'approval required';

      return [
        'Preview is configuration intent, not authorization.',
        `Current runtime: ${runtime} (${latest.runtimeSource}).`,
      ].join(' ');
    },

    adapter: {
      read() {
        if (!callbacks.current()) {
          throw new Error(
            'Historian settings context is stale',
          );
        }
        latest = callbacks.read();
        return latest;
      },

      async apply(scope, changes, signal): Promise<void> {
        requireCurrent(
          () => callbacks.current(),
          signal,
        );
        const expectedTarget = latest.targets[scope];
        const fresh = callbacks.read();

        if (fresh.targets[scope] !== expectedTarget) {
          throw new Error(
            `Historian ${scope} settings target changed`,
          );
        }
        if (
          scope === 'project' &&
          !fresh.projectTrusted
        ) {
          throw new Error(
            'Historian project settings require trust',
          );
        }

        requireCurrent(
          () => callbacks.current(),
          signal,
        );

        // Shared ScopedSettingsView has already closed its pane.
        // Domain code previews the whole batch and owns approval.
        await callbacks.apply(
          scope,
          changes,
          signal,
          expectedTarget,
          confirm,
        );
      },

      applied(snapshot, scope): void {
        if (callbacks.current()) {
          callbacks.applied(snapshot, scope);
        }
      },
    },
  });
}

export function newHistorianSettingsView(): ScopedSettingsView {
  return new ScopedSettingsView();
}
