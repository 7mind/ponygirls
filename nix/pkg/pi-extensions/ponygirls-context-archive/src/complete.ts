import { completeArgument, type ArgumentChoice, type CompletionItem } from "@ponygirls/pi-ui";

const choice = (token: string, description: string, continues: boolean): ArgumentChoice => ({ token, label: token, description, continues });
const toggles = [choice("on", "Enable automatic archival", false), choice("off", "Disable automatic archival", false)];

/** HIGH and LOW are user-supplied percentages, never fixed completion presets. */
export function completeArchiveArguments(prefix: string): CompletionItem[] | null {
  return completeArgument(prefix, previous => {
    const words = previous.map(word => word.toLowerCase());
    if (words.length === 0) return [...toggles, choice("inherit", "Use inherited enablement", false),
      choice("settings", "Open scoped settings", false), choice("project", "Change project overrides", true), choice("session", "Change session override", true), choice("global", "Change global override", true),
      choice("default", "Change global defaults", true), choice("thresholds", "Enter HIGH LOW percentages, or inherit", true), choice("status", "Show archive status", false)];
    if (words.length === 1 && words[0] === "default") return [...toggles, choice("thresholds", "Enter global HIGH LOW percentages", true)];
    if (words.length === 1 && ['project', 'global', 'session'].includes(words[0])) return [...toggles, choice('inherit', 'Remove this scope override', false), ...(words[0] === 'project' ? [choice('thresholds', 'Enter project HIGH LOW percentages or inherit', true)] : [])];
    if ((words.length === 1 && words[0] === "thresholds") || (words.length === 2 && words[0] === 'project' && words[1] === 'thresholds')) return [choice("inherit", "Use inherited thresholds", false)];
    return null;
  });
}
