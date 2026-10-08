export type IconName = "stack" | "grid" | "inbox" | "branch" | "spark" | "archive" | "search" | "arrow" | "logout";
const PATHS: Record<IconName, string> = {
  stack: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  grid: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  inbox: "m4 4-3 12v4h22v-4L20 4H4Zm-3 12h7l2 3h4l2-3h7",
  branch: "M6 7v10m12-10v3a7 7 0 0 1-7 7H9M9 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 20a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  archive: "M3 3h18v5H3V3Zm2 5v13h14V8M9 12h6",
  search: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm5 12 6 6",
  arrow: "M19 12H5m6-6-6 6 6 6",
  logout: "M9 3H3v18h6m7-15 6 6-6 6m-9-6h15",
};
export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>;
}
