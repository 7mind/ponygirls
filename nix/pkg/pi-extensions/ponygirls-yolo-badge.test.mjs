import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import extension from "./ponygirls-yolo-badge.ts";

const sdk = process.env.PI_SDK_ROOT;
assert.ok(sdk, "Set PI_SDK_ROOT to the pinned pi-monorepo directory");
const { Theme } = await import(pathToFileURL(join(sdk, "dist/index.js")));
const neutralTheme = new Theme(
  { warning: "", muted: "", text: "", thinkingXhigh: "" },
  { selectedBg: "" },
  "truecolor",
);

// Behavioral-Active / Blackbox-Group: drive the extension's widget contract with Pi's theme.
test("only the yolo marker 1 suppresses the badge in the TUI; other modes never show it", () => {
  const original = process.env.SMIND_SANDBOXED;
  try {
    for (const marker of [undefined, "", "0", "1"]) {
      if (marker === undefined) delete process.env.SMIND_SANDBOXED;
      else process.env.SMIND_SANDBOXED = marker;

      for (const mode of ["tui", "rpc", "json", "print"]) {
        const widgets = [];
        const ui = { setWidget: (_key, factory, options) => widgets.push({ factory, ...options }) };
        extension({ on: (event, handler) => {
          assert.equal(event, "session_start");
          handler({ type: event, reason: "startup" }, { mode, ui });
        } });

        const visible = mode === "tui" && marker !== "1";
        assert.equal(widgets.length, Number(visible), `${mode}, marker ${JSON.stringify(marker)}`);
        if (!visible) continue;
        const [widget] = widgets;
        assert.equal(widget.placement, "borderTopLeft");
        const badge = widget.factory({}, neutralTheme);
        const [line, ...rest] = badge.render(60);
        assert.deepEqual(rest, []);
        assert.equal(stripVTControlCharacters(line), " YOLO ");
        // Regression: a valid theme with no warning color must still show an amber fill.
        assert.match(line, /\x1b\[48;2;205;154;34m/);
        assert.equal(stripVTControlCharacters(badge.renderCompact(4)), "YOLO");
        // Regression: if a scroll indicator leaves fewer than 4 cells, keep a warning.
        assert.equal(stripVTControlCharacters(badge.renderCompact(3)), "!");
        assert.equal(stripVTControlCharacters(badge.renderCompact(1)), "!");
        assert.equal(badge.renderCompact(0), "");
      }
    }
  } finally {
    if (original === undefined) delete process.env.SMIND_SANDBOXED;
    else process.env.SMIND_SANDBOXED = original;
  }
});
