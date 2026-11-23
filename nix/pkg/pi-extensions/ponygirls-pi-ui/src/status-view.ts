import { Text } from "@earendil-works/pi-tui";
import { frameTitle, keyHints } from "./frame.ts";
import { HINT } from "./keys.ts";
import type { PanelParts } from "./panel-layout.ts";
import { ReadOnlyBodyPager, type BodyPagerHost } from "./read-only-body-pager.ts";
import type { UiTheme } from "./theme.ts";

export interface StatusViewOptions extends BodyPagerHost {
  title: string;
  text: string | ((width: number) => string);
  theme: UiTheme;
}

/** Read-only snapshot with bounded, wrapped content and keyboard/wheel scrolling. */
export class StatusView extends ReadOnlyBodyPager<StatusViewOptions> {
  private readonly text = new Text("", 0, 0);
  private contentWidth: number | null = null;

  override invalidate(): void { this.contentWidth = null; this.text.invalidate(); }

  protected override renderParts(width: number): PanelParts {
    const { theme, title, text } = this.options;
    if (this.contentWidth !== width) {
      this.text.setText(typeof text === "string" ? text : text(width));
      this.contentWidth = width;
    }
    return {
      header: [frameTitle(theme, width, { title }, "none").line],
      body: this.text.render(width),
      footer: keyHints(theme, width, [HINT.scroll, HINT.page, HINT.close]).lines,
    };
  }
}
