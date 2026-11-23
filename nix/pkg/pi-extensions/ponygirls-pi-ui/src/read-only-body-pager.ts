import { Key, matchesKey, ScrollView, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { PanelLayout, type PanelParts } from "./panel-layout.ts";

export interface BodyPagerHost {
  keys: { matches(data: string, action: "tui.select.cancel"): boolean };
  rows(): number;
  requestRender(): void;
  close(): void;
}

export abstract class ReadOnlyBodyPager<Options extends BodyPagerHost> extends PanelLayout {
  readonly capturesViewportInput = true;
  protected readonly options: Options;
  private readonly regularScroll: ScrollView;

  constructor(options: Options) {
    super((width) => this.renderParts(width));
    this.options = options;
    this.regularScroll = new ScrollView({ render: (width) => this.renderParts(width).body, invalidate() {} }, { overscroll: "contain" });
  }

  protected abstract renderParts(width: number): PanelParts;

  protected get scroll(): ScrollView { return this.hasAllocatedHeight ? this.bodyScroll : this.regularScroll; }

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
    this.handleBodyInput(data);
  }

  protected handleBodyInput(data: string): void {
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
