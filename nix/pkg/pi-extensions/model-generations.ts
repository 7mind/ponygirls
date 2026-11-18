/** Pi's catalogue does not expose generation metadata. Compare only recognizable ID series. */
export interface ModelIdentity {
  provider: string;
  id: string;
}

interface Release {
  series: string;
  version: number[];
}

// Group 1 is the series, group 2 the generation, and group 3 (if present) its
// tier or serving variant. A Sol never retires an Astra; a chat route never
// retires a batch route. Versions are numbers, not decimals or strings.
const DOTTED_VERSION = "(\\d{1,2}(?:\\.\\d{1,2}){0,2})";
const VARIANT = "([-:].+)?";
const SERIES = [
  new RegExp(`^(gpt|gemini|grok|glm|llama|muse-(?:spark|ember|wonder))-${DOTTED_VERSION}${VARIANT}$`),
  new RegExp(`^(mimo-v|deepseek-v|kimi-k|minimax-m|qwen|o)${DOTTED_VERSION}${VARIANT}$`),
  /^(claude-(?:opus|sonnet|haiku|fable))-(\d{1,2}(?:[.-]\d{1,2})?)([-:].+)?$/,
];
const LEGACY_CLAUDE = /^claude-(\d{1,2}(?:[.-]\d{1,2})?)-(opus|sonnet|haiku)([-:].+)?$/;
const BEDROCK_NAMESPACE = /^(?:(?:[a-z]{2,4}|global)\.)?(?:anthropic|openai|xai|zai|moonshotai|minimax)\./;
const SNAPSHOT = /(?:[-@]20\d{6}|-20\d{2}-\d{2}-\d{2})(?=$|[-:])/;

function release({ provider, id }: ModelIdentity): Release | undefined {
  const lower = id.toLowerCase();
  // Keep the upstream namespace on gateways and the region on Bedrock.
  const namespace = provider === "amazon-bedrock"
    ? BEDROCK_NAMESPACE.exec(lower)?.[0] ?? ""
    : lower.slice(0, lower.lastIndexOf("/") + 1);
  const model = lower.slice(namespace.length);
  if (/(?:^|[-:])latest(?:$|[-:])/.test(model)) return undefined;
  let leaf = model.replace(SNAPSHOT, "");
  if (provider === "amazon-bedrock") leaf = leaf.replace(/-v1(?::0)?$/, "");
  if (provider === "kimi-coding" && /^k\d/.test(leaf)) leaf = `kimi-${leaf}`;
  if (leaf.startsWith("deepseek-v")) leaf = leaf.replace(/-\d{4}(?=$|[-:]batch$)/, "");
  // 4.20 names a separate Grok release series, not minor 20 of the 4.x line.
  if (/^grok-4\.20(?:$|[-:])/.test(leaf)) return undefined;

  for (const rule of SERIES) {
    const match = rule.exec(leaf);
    if (match) return versioned(match[1]!, match[2]!, match[3] ?? "");
  }
  const legacy = LEGACY_CLAUDE.exec(leaf);
  return legacy ? versioned(`claude-${legacy[2]}`, legacy[1]!, legacy[3] ?? "") : undefined;

  function versioned(series: string, version: string, variant: string): Release {
    return { series: `${provider}\0${namespace}${series}${variant}`, version: version.split(/[.-]/).map(Number) };
  }
}

function compareVersion(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); ++i) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Find a strictly newer, comparable model in this catalogue. Ties, aliases and unknown IDs are not retired. */
export function newerModelIn<T extends ModelIdentity>(catalogue: readonly T[]): (model: ModelIdentity) => T | undefined {
  const newest = new Map<string, { model: T; version: number[] }>();
  for (const model of catalogue) {
    const candidate = release(model);
    if (!candidate) continue;
    const previous = newest.get(candidate.series);
    if (!previous || compareVersion(candidate.version, previous.version) > 0) {
      newest.set(candidate.series, { model, version: candidate.version });
    }
  }
  return (model) => {
    const selected = release(model);
    if (!selected) return undefined;
    const latest = newest.get(selected.series);
    return latest && compareVersion(latest.version, selected.version) > 0 ? latest.model : undefined;
  };
}

/** Preserve catalogue order and original model metadata. */
export function latestModelGenerations<T extends ModelIdentity>(catalogue: readonly T[]): T[] {
  const newer = newerModelIn(catalogue);
  return catalogue.filter((model) => newer(model) === undefined);
}
