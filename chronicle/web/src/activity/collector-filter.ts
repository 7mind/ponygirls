import { addMetadataFilter, validateMetadataExpression } from '../expression.ts';

// The collector restriction of a job expression (spec §3.1 V2): a collector's "Jobs" link applies `collector:"<id>"` to the
// job expression, conjoined by the shortcut row's rule (`(<rest>) AND collector:"<id>"`), and the shortcut row shows it as a
// removable chip. Only those two shapes are recognised; any other placement stays plain expression text.
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const ALONE = new RegExp(`^collector:(${QUOTED})$`, 's'), CONJOINED = new RegExp(`^\\((.*)\\) AND collector:(${QUOTED})$`, 's');
export interface CollectorFilter { readonly collector: string; readonly rest: string }
// Runs while rendering the submitted expression: malformed input yields no chip, and the query read reports the error inline.
export function collectorFilter(expression: string): CollectorFilter | null {
  const trimmed = expression.trim(), alone = ALONE.exec(trimmed);
  if (alone !== null) { const collector = quotedValue(alone[1]!); return collector === null ? null : { collector, rest: '' }; }
  const conjoined = CONJOINED.exec(trimmed);
  if (conjoined === null || !wellFormed(conjoined[1]!)) return null;
  const collector = quotedValue(conjoined[2]!);
  return collector === null ? null : { collector, rest: conjoined[1]! };
}
// The value of a quoted literal, or null when its escapes are not the ones the shortcut row writes (JSON string escapes).
function quotedValue(literal: string): string | null {
  try { return JSON.parse(literal) as string; } catch { return null; }
}
// `(a) OR (b) AND collector:"x"` matches the pattern with a rest of `a) OR (b`, which is not one group.
function wellFormed(rest: string): boolean {
  try { validateMetadataExpression(rest); return true; } catch { return false; }
}
export function withCollector(expression: string, collector: string): string { return addMetadataFilter(expression, 'collector', collector); }
