interface PaginationProps {
  label: string;
  itemLabel: string;
  count: number;
  current: number;
  disabled: boolean;
  select: (index: number) => void;
}
export function Pagination({ label, itemLabel, count, current, disabled, select }: PaginationProps) {
  const pages = Array.from({ length: count }, (_, index) => index).filter(index => index === 0 || index === count - 1 || Math.abs(index - current) <= 2);
  return <nav className="numbered-pages" aria-label={label}>{pages.map((index, position) => <span key={index}>{position > 0 && index > pages[position - 1]! + 1 && <span className="page-gap" aria-hidden="true">…</span>}<button type="button" className="small-button" aria-label={`${itemLabel} ${index + 1}`} aria-current={index === current ? 'page' : undefined} disabled={disabled || index === current} onClick={() => select(index)}>{index + 1}</button></span>)}</nav>;
}
