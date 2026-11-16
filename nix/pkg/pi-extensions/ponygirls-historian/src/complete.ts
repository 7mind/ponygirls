import { completeArgument, type ArgumentChoice, type CompletionItem } from '@ponygirls/pi-ui';

export interface CompletionModel { provider: string; id: string; }
const choice = (token: string, description: string, continues: boolean): ArgumentChoice => ({ token, label: token, description, continues });

export function completeHistorianArguments(prefix: string, models: readonly CompletionModel[]): CompletionItem[] | null {
  return completeArgument(prefix, tokens => {
    if (tokens[0] === 'chronicle') return tokens.length === 1 ? [
      choice('settings', 'Configure global summary upload with separate disclosure approval', false),
      choice('configure', 'Store URL and absolute token-file path; leave upload OFF', true),
      choice('on', 'Approve new-summary upload to the configured Chronicle destination', false),
      choice('off', 'Pause Chronicle upload; retain pending summaries', false),
      choice('status', 'Show Chronicle upload configuration and delivery diagnostics', false),
      choice('retry', 'Retry stopped pending summaries without changing request identities', false),
    ] : null;
    if (tokens[0] === 'project') return tokens.length === 1 ? [choice('on', 'Confirm runtime-local project disclosure approval', false)] : null;
    const global = tokens[0] === 'default';
    const previous = global ? tokens.slice(1) : tokens;
    if (previous.length === 0) return [
      choice('on', 'Enable and approve disclosure to the configured provider', false),
      choice('off', 'Disable capture', false),
      ...(!global ? [choice('inherit', 'Use the default enabled setting', false), choice('status', 'Show configuration and diagnostics', false),
        choice('journal', 'Read the shared project journal', false), choice('default', 'Change defaults for new sessions', true),
        choice('settings', 'Open scoped settings', false), choice('project', 'Project disclosure approval', true),
        choice('chronicle', 'Opt-in summary upload, separate from capture/provider approval', true)] : []),
      choice('model', 'Choose PROVIDER MODEL THINKING, or inherit', true),
      choice('focus', 'Set free-text journal focus', true),
    ];
    if (previous[0] === 'focus') return !global && previous.length === 1 ? [choice('inherit', 'Use default focus', false)] : null;
    if (previous[0] !== 'model') return null;
    if (previous.length === 1) return [choice('inherit', 'Use inherited model configuration', false),
      ...[...new Set(models.map(model => model.provider))].sort().map(provider => choice(provider, 'Provider', true))];
    if (previous[1] === 'inherit') return null;
    if (previous.length === 2) return models.filter(model => model.provider === previous[1]).map(model => choice(model.id, 'Model', true));
    if (previous.length === 3) return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map(level => choice(level, 'Thinking level', false));
    return null;
  });
}
