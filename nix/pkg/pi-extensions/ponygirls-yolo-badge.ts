import type { ExtensionAPI, ThemeStyle } from "@earendil-works/pi-coding-agent";

const LABEL = "YOLO";
const PADDED_LABEL = ` ${LABEL} `;
// Keep the warning amber and readable even if the active theme has no warning color.
const PALETTE = {
  fg: { kind: "rgb", r: 24, g: 24, b: 30 },
  bg: { kind: "rgb", r: 205, g: 154, b: 34 },
  bold: true,
} satisfies ThemeStyle;

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || process.env.SMIND_SANDBOXED === "1") return;

    ctx.ui.setWidget("ponygirls-yolo-badge", (_tui, theme) => {
      const renderBadge = (width: number): string => {
        if (width <= 0) return "";
        const label = width >= PADDED_LABEL.length ? PADDED_LABEL : width >= LABEL.length ? LABEL : "!";
        return theme.style(label, PALETTE);
      };
      return { render: (width) => [renderBadge(width)], renderCompact: renderBadge, invalidate() {} };
    }, { placement: "borderTopLeft" });
  });
}
