const MINUTE_MS = 60_000, HOUR_MS = 60 * MINUTE_MS, DAY_MS = 24 * HOUR_MS;
/** `Nov 17, 21:08` in the browser's zone (another year shows the date with its year) and a relative age (spec §5 rule 9). */
export function when(value: string, now: number): { absolute: string; relative: string } | null {
  const date = new Date(value), time = date.getTime();
  if (Number.isNaN(time)) return null;
  const age = now - time;
  const absolute = date.getFullYear() === new Date(now).getFullYear() ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const relative = age < 0 ? 'in the future' : age < MINUTE_MS ? 'just now' : age < HOUR_MS ? `${Math.round(age / MINUTE_MS)} min ago` : age < DAY_MS ? `${Math.round(age / HOUR_MS)} h ago` : `${Math.round(age / DAY_MS)} d ago`;
  return { absolute, relative };
}
/** A server timestamp: absolute time and its relative age (on a second line, after it, or not at all); the ISO value is the tooltip. */
export function When({ value, now, relative, missing }: { value: string | undefined; now: number; relative: 'below' | 'inline' | 'none'; missing: string }) {
  if (value === undefined) return <span className="muted">{missing}</span>;
  const shown = when(value, now);
  if (shown === null) return <time dateTime={value}>{value}</time>;
  return <><time dateTime={value} title={value}>{shown.absolute}</time>{relative === 'below' ? <span className="when-rel">{shown.relative}</span> : relative === 'inline' ? <span className="muted"> · {shown.relative}</span> : null}</>;
}
/** Wall-clock time of a snapshot (`21:29:56`), in the browser's zone. */
export function clockTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}
