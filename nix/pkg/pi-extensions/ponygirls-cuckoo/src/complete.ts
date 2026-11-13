import { completeArgument, type ArgumentChoice, type CompletionItem } from '@ponygirls/pi-ui';
import { FEATURES } from './features.ts';

const choice = (token: string, description: string, continues: boolean): ArgumentChoice => ({ token, label: token, description, continues });
const toggles = [choice('on', 'Enable checkpoints', false), choice('off', 'Disable checkpoints', false)];

/** Numeric policy values are user input, not a preset to silently insert. */
export function completeCuckooArguments(prefix: string): CompletionItem[] | null {
  return completeArgument(prefix, previous => {
    // Policy/history handlers are case-sensitive (unlike toggle handlers).
    if (previous.length === 0) return [...toggles, choice('inquire', 'Request a checkpoint now', true),
      choice('inherit', 'Inherit enablement', false), choice('default', 'Change global defaults', true),
      choice('project', 'Change trusted project overrides', true), choice('feature', 'Configure a feature switch', true),
      choice('transfer', 'Manage operator-approved historical packets', true),
      choice('vectors', 'Approve, revoke or inspect task encoder consent', true),
      choice('critic', 'Approve, revoke, inspect or reconcile the task critic', true),
      choice('settings', 'Open scoped feature checkboxes', false), choice('status', 'Show status', false), choice('history', 'Show saved answers across branches', false), choice('reports', 'Show current reports', false),
      choice('policy', 'Set growth policy', true), choice('threshold', 'Set relative growth percentage (legacy alias)', true)];
    if (previous.length === 1 && previous[0] === 'transfer') return ['export', 'import', 'task', 'revoke', 'clear', 'status'].map(token => choice(token, 'Operator-only transfer workflow', false));
    if (previous.length === 1 && (previous[0] === 'vectors' || previous[0] === 'critic')) return [
      ...['approve', 'revoke', 'status'].map(token => choice(token, 'Operator task disclosure workflow', false)),
      ...(previous[0] === 'critic' ? [choice('reconcile', 'Explicitly reconcile one uncertain admission', false)] : [])];
    if (previous.length === 1 && previous[0] === 'inquire') return [choice('now', 'Request a checkpoint now, even when automatic mode is off', false)];
    if (previous.length === 1 && previous[0]!.toLowerCase() === 'default') return [...toggles,
      ...(previous[0] === 'default' ? [choice('policy', 'Set global growth policy', true), choice('threshold', 'Set global relative growth percentage', true), choice('feature', 'Configure a global feature default', true)] : [])];
    const global = previous[0] === 'default';
    const project = previous[0] === 'project';
    if (project && previous.length === 1) return [...toggles, choice('inherit', 'Remove project enablement override', false),
      choice('feature', 'Configure a project feature override', true), choice('policy', 'Configure project growth policy', true)];
    const words = global || project ? previous.slice(1) : previous;
    if (words[0] === 'feature') {
      if (words.length === 1) return FEATURES.map(feature => choice(feature.id, feature.label, true));
      if (words.length === 2 && FEATURES.some(feature => feature.id === words[1])) return [
        choice('on', 'Enable this feature preference', false), choice('off', 'Disable this feature preference', false), choice('inherit', 'Remove this scope override', false)];
      return null;
    }
    if (words.length !== 1) return null;
    if (words[0] === 'policy') return [choice('relative', 'Percentage of baseline tokens; enter PERCENT next', true),
      choice('window', 'Percentage of context-window capacity; enter PERCENT next', true),
      choice('tokens', 'Additional token count; enter COUNT next', true),
      ...(!global ? [choice('inherit', 'Inherit growth policy', false)] : [])];
    if (!global && words[0] === 'threshold') return [choice('inherit', 'Inherit growth policy', false)];
    return null;
  });
}
