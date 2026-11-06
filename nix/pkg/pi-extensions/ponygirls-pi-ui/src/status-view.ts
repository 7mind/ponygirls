import { Key, matchesKey, ScrollView, Text, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { frameTitle, keyHints } from "./frame.ts";
import type { UiTheme } from "./theme.ts";

export interface StatusViewOptions {
  title: string;
  text: string;
  theme: UiTheme;
  keys: { matches(data: string, action: "tui.select.cancel"): boolean };
  rows(): number;
  requestRender(): void;
  close(): void;
}

/** Space for the retained editor borders and surrounding interactive chrome. */
const RESERVED_ROWS = 4;

/** Read-only snapshot with bounded, wrapped content and keyboard/wheel scrolling. */
export class StatusView implements Component {
  private readonly options: StatusViewOptions;
  private readonly scroll: ScrollView;

  constructor(options: StatusViewOptions) {
    this.options = options;
    this.scroll = new ScrollView(new Text(options.text, 0, 0), { overscroll: "contain" });
  }

  invalidate(): void { this.scroll.invalidate(); }

  render(width: number): string[] {
    const { theme, title } = this.options;
    const hints = keyHints(theme, width, [{ key: "↑↓ PgUp PgDn", action: "scroll" }, { key: "esc/q", action: "close" }]).lines;
    const lines = this.scroll.render(width);
    const height = Math.min(lines.length, Math.max(1, this.options.rows() - RESERVED_ROWS - hints.length - 1));
    this.scroll.updateLayout(lines.length, height, this.options.requestRender);
    return [frameTitle(theme, width, { title }, "none").line,
      ...lines.slice(this.scroll.scrollTop, this.scroll.scrollTop + height), ...hints];
  }

  handleInput(data: string): void {
    if (this.options.keys.matches(data, "tui.select.cancel") || data === "q") { this.options.close(); return; }
    const page = Math.max(1, this.scroll.viewportHeight - 1);
    if (matchesKey(data, Key.up)) this.scroll.scrollBy(-1);
    else if (matchesKey(data, Key.down)) this.scroll.scrollBy(1);
    else if (matchesKey(data, Key.pageUp)) this.scroll.scrollBy(-page);
    else if (matchesKey(data, Key.pageDown)) this.scroll.scrollBy(page);
    else if (matchesKey(data, Key.home)) this.scroll.scrollToStart();
    else if (matchesKey(data, Key.end)) this.scroll.scrollToEnd();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scroll.scrollBy(event.wheelDelta);
    return { handled: true };
  }
}
