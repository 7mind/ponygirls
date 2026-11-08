import { completeArgument, type ArgumentChoice, type CompletionItem } from '@ponygirls/pi-ui';

const choice = (token: string, description: string, continues: boolean): ArgumentChoice => ({ token, label: token, description, continues });
const toggles = [choice('on', 'Enable checkpoints', false), choice('off', 'Disable checkpoints', false)];

/** Numeric policy values are user input, not a preset to silently insert. */
export function completeCuckooArguments(prefix: string): CompletionItem[] | null {
  return completeArgument(prefix, previous => {
    // Policy/history handlers are case-sensitive (unlike toggle handlers).
    if (previous.length === 0) return [...toggles,
      choice('inherit', 'Use global enablement', false), choice('default', 'Change global defaults', true),
      choice('status', 'Show status', false), choice('history', 'Show saved answers across branches', false), choice('reports', 'Show current reports', false),
      choice('policy', 'Set growth policy', true), choice('threshold', 'Set relative growth percentage (legacy alias)', true)];
    if (previous.length === 1 && previous[0]!.toLowerCase() === 'default') return [...toggles,
      ...(previous[0] === 'default' ? [choice('policy', 'Set global growth policy', true), choice('threshold', 'Set global relative growth percentage', true)] : [])];
    const global = previous[0] === 'default';
    const words = global ? previous.slice(1) : previous;
    if (words.length !== 1) return null;
    if (words[0] === 'policy') return [choice('relative', 'Percentage of baseline tokens; enter PERCENT next', true),
      choice('window', 'Percentage of context-window capacity; enter PERCENT next', true),
      choice('tokens', 'Additional token count; enter COUNT next', true),
      ...(!global ? [choice('inherit', 'Use global growth policy', false)] : [])];
    if (!global && words[0] === 'threshold') return [choice('inherit', 'Use global growth policy', false)];
    return null;
  });
}
