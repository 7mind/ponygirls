import { ScrollView, VStack, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";

export interface PanelParts {
  header: string[];
  body: string[];
  footer: string[];
}

class PanelScrollView extends ScrollView {
  private readonly resized: () => void;
  private laidOut = false;

  constructor(body: Component, resized: () => void) {
    super(body, { scrollbar: "hidden", overscroll: "contain" });
    this.resized = resized;
  }

  override updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
    const changed = !this.laidOut || this.viewportHeight !== viewportHeight;
    this.laidOut = true;
    super.updateLayout(contentHeight, viewportHeight, requestRender);
    if (changed) {
      this.resized();
      requestRender();
    }
  }
}

/** Fixed pane chrome around a body sized by Pi's layout, not by the terminal. */
export class PanelLayout extends VStack {
  readonly bodyScroll: ScrollView;
  private readonly renderSections: (width: number) => PanelParts;
  private allocated = false;
  private chromeRows = 0;
  private measuring = false;
  private frame: { width: number; parts: PanelParts } | null = null;

  constructor(renderSections: (width: number) => PanelParts) {
    super();
    this.renderSections = renderSections;
    const section = (name: keyof PanelParts): Component => ({
      render: (width) => {
        // Header measurement starts one coherent snapshot for all three sections.
        if (name === "header" || this.frame === null || this.frame.width !== width) {
          this.frame = { width, parts: this.parts(width) };
        }
        return this.frame.parts[name];
      },
      invalidate() {},
    });
    this.bodyScroll = new PanelScrollView(section("body"), () => { this.allocated = true; });
    this.addChild(section("header"), { shrink: 0 });
    this.addChild(this.bodyScroll, { grow: 1, shrink: 1, minSize: 0 });
    this.addChild(section("footer"), { shrink: 0 });
  }

  get hasAllocatedHeight(): boolean { return this.allocated; }

  /** Intrinsic sizing uses natural height; callbacks must not clamp navigation to that preview. */
  get isMeasuring(): boolean { return this.measuring; }

  bodyHeight(fallback: number): number {
    return this.allocated && !this.measuring ? this.bodyScroll.viewportHeight : fallback;
  }

  height(fallback: number): number {
    return this.allocated && !this.measuring ? this.bodyScroll.viewportHeight + this.chromeRows : fallback;
  }

  private parts(width: number): PanelParts {
    const parts = this.renderSections(width);
    this.chromeRows = parts.header.length + parts.footer.length;
    return parts;
  }

  override handleMouse(event: TuiMouseEvent): ReturnType<VStack["handleMouse"]> {
    if (event.type !== "wheel" || !event.wheelDelta) return super.handleMouse(event);
    this.bodyScroll.scrollBy(event.wheelDelta);
    return { handled: true, render: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
  }

  override render(width: number): string[] {
    // Pi measures render() before allocating the structural children. Reporting
    // the previous clipped body here would prevent a grow:0 editor from regrowing.
    this.measuring = this.allocated;
    try {
      const { header, body, footer } = this.renderSections(width);
      return [...header, ...body, ...footer];
    } finally { this.measuring = false; }
  }
}
