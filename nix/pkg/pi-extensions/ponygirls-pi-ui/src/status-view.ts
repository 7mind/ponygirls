import { Key, matchesKey, ScrollView, Text, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { frameTitle, keyHints } from "./frame.ts";
import { PanelLayout, type PanelParts } from "./panel-layout.ts";
import type { UiTheme } from "./theme.ts";

export interface StatusViewOptions {
  title: string;
  text: string | ((width: number) => string);
  theme: UiTheme;
  keys: { matches(data: string, action: "tui.select.cancel"): boolean };
  rows(): number;
  requestRender(): void;
  close(): void;
}

/** Read-only snapshot with bounded, wrapped content and keyboard/wheel scrolling. */
export class StatusView extends PanelLayout {
  private readonly options: StatusViewOptions;
  private readonly regularScroll: ScrollView;
  private readonly text: Text;
  private contentWidth: number | null = null;

  constructor(options: StatusViewOptions) {
    super((width) => this.renderParts(width));
    this.options = options;
    this.text = new Text("", 0, 0);
    this.regularScroll = new ScrollView(this.text, { overscroll: "contain" });
  }

  override invalidate(): void { this.contentWidth = null; this.text.invalidate(); }

  private get scroll(): ScrollView { return this.hasAllocatedHeight ? this.bodyScroll : this.regularScroll; }

  private renderParts(width: number): PanelParts {
    const { theme, title, text } = this.options;
    if (this.contentWidth !== width) {
      this.text.setText(typeof text === "string" ? text : text(width));
      this.contentWidth = width;
    }
    return {
      header: [frameTitle(theme, width, { title }, "none").line],
      body: this.text.render(width),
      footer: keyHints(theme, width, [{ key: "↑↓ PgUp PgDn", action: "scroll" }, { key: "esc/q", action: "close" }]).lines,
    };
  }

  override render(width: number): string[] {
    const { header, body, footer } = this.renderParts(width);
    const height = Math.min(body.length, Math.max(1, this.options.rows() - header.length - footer.length));
    // Flat rendering is also used for intrinsic measurement; never mutate the allocated body viewport here.
    this.regularScroll.updateLayout(body.length, height, this.options.requestRender);
    const start = Math.min(this.scroll.scrollTop, Math.max(0, body.length - height));
    return [...header, ...body.slice(start, start + height), ...footer];
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

  handleMouse(event: TuiMouseEvent): ReturnType<PanelLayout["handleMouse"]> {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scroll.scrollBy(event.wheelDelta);
    return { handled: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
  }
}
