import { addMetadataFilter, validateMetadataExpression } from '../expression.ts';

// The collector restriction of a job expression (spec §3.1 V2): a collector's "Jobs" link applies `collector:"<id>"` to the
// job expression, conjoined by the shortcut row's rule (`(<rest>) AND collector:"<id>"`), and the shortcut row shows it as a
// removable chip. Only those two shapes are recognised; any other placement stays plain expression text.
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const ALONE = new RegExp(`^collector:(${QUOTED})$`, 's'), CONJOINED = new RegExp(`^\\((.*)\\) AND collector:(${QUOTED})$`, 's');
export interface CollectorFilter { readonly collector: string; readonly rest: string }
export function collectorFilter(expression: string): CollectorFilter | null {
  const trimmed = expression.trim(), alone = ALONE.exec(trimmed);
  if (alone !== null) return { collector: JSON.parse(alone[1]!) as string, rest: '' };
  const conjoined = CONJOINED.exec(trimmed);
  return conjoined === null || !wellFormed(conjoined[1]!) ? null : { collector: JSON.parse(conjoined[2]!) as string, rest: conjoined[1]! };
}
// `(a) OR (b) AND collector:"x"` matches the pattern with a rest of `a) OR (b`, which is not one group.
function wellFormed(rest: string): boolean {
  try { validateMetadataExpression(rest); return true; } catch { return false; }
}
export function withCollector(expression: string, collector: string): string { return addMetadataFilter(expression, 'collector', collector); }
