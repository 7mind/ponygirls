# TUI Visual Review

Reading render code alone misses defects that only show up when something is
drawn: comparisons that pick the wrong colour, truncation at narrow widths,
noisy transcripts. It also can't quantify contrast. Review the real
rendering, but stay honest about what a cell capture can show. The helpers
`ansi2png.py` and `fake_openai.py` are in "Appendix: helper scripts" below;
write them from there into the task's debug directory.

## 1. Drive the real TUI

Follow the `tui-testing` skill completely: private `tui-tmux` server, `env -i`,
disposable HOME/config/session dirs, a ready-indicator wait, and cleanup.
Review the user's actual configuration. For Pi, copy only the extension list
and theme from the user's `settings.json` into the fixture's
`PI_CODING_AGENT_DIR`; leave credentials out. Record version, argv and size.
- Start through the launcher a developer of this checkout uses, and prove the
  running program loaded the checkout's copy of each component under review
  (loaded path, version, or a deliberate visible change), not an installed
  one. Observed: a pane verified by its tests still showed the installed one.
- Capture at the owner's usual width (e.g. 140x40), a wide one, and 80 and 60
  columns (one review used 80, 120 and 170).
- Panes showing history, usage or quotas need rows: seed a fixture
  (section 2) or use real state (sanitised, section 3). A pane reviewed from
  code only is unreviewed for layout: two such data panes had width defects.
- Start the program more than once and compare the order of anything
  registered asynchronously (badges, status items).
- `env -i` removes `COLORTERM`. For colours that are compared, or shown
  beside generated frames, give the fixture the owner's colour depth as well
  as the theme. Observed with Pi 1.5.2 under tmux 3.8, four launches: with no
  theme set, palette indexes and `dim`, with or without `COLORTERM`; the
  theme set without `COLORTERM`, quantised to 256-colour indexes
  (`38;5;102`); only both give the theme's RGB values (`38;2;126;136;142`).

## 2. Populate state with a scripted provider (Pi)

Empty sessions don't show badges, panes or transcript renderers. Run a local
OpenAI-compatible SSE endpoint (`fake_openai.py PORT`) and register it in the
fixture `models.json` (`baseUrl: http://127.0.0.1:PORT/v1`,
`api: openai-completions`, dummy `apiKey`, one model). Check against the
installed `docs/models.md`.

Protocol: a user message `CALL <tool> <json-args>` → one streamed tool call;
a tool result → `done`; anything else → a short text reply, plus fixed usage.
- Scan **every** non-assistant/non-tool message after the last assistant/tool
  message. Extensions inject messages after the user's, so checking only
  `messages[-1]` misses the command.
- The tool calls really execute in Pi. Only call tools whose effects stay in
  the fixture (e.g. `sleep`/`echo` background tasks). Go through permission
  prompts as UI states; don't bypass them.
- Goal/continuation extensions may loop against a non-cooperative fake model;
  pause or cancel them deliberately.
- This is for setting up state, not for checking provider/streaming
  behaviour. Label it that way.

## 3. Capture and render

Per state: `capture-pane -p -e` → `NAME.ansi`, `capture-pane -p -N` →
`NAME.txt`, then `ansi2png.py NAME.ansi NAME.png` (Pillow; SGR
16/256/truecolor, bold, dim, reverse, underline; monospace TTF named by
`ANSI2PNG_FONT` and `ANSI2PNG_FONT_BOLD`). Wrap these three steps in a
`shot.sh NAME`. Save artifacts under the project's `debug/<task>/`.

In an `-e` capture a line does not restate the attributes in force: colour,
bold and dim set on one line continue on the following lines until changed
(observed with tmux 3.8: a status row with no SGR of its own, coloured by the
row above it). `ansi2png.py` carries the SGR state from line to line; any
other converter must too. Cut rows out of a capture only after conversion,
for example the host program's rows that are to surround another frame.
Failure signature: border or status rows in a neighbouring row's colour.

A capture of real state holds account names, hosts, paths, ids and figures.
Before anything else reads it, write a sanitised copy (obviously synthetic
values, same cell widths) and use only that copy in mockups, fixtures, commit
messages and notes; keep the raw one out of the repository. Observed: one
capture, sanitised late, leaked values into a mockup, test fixtures and
commit notes. Sanitising first has not been exercised.

Look at each PNG (multimodal), and also read the code. Check:
- whether colour matches meaning per state (e.g. every non-selected outcome
  shown in error red);
- separator/border consistency, chip backgrounds, selection rows;
- truncation and ellipsis at 80/60 columns (use `.txt` cell counts);
- narrowing that drops or squeezes the identity or state column while
  secondary columns stay; a cell cut mid-value beside an empty column;
- transcript weight: expanded notices pushing out the conversation;
- whether state is shown by colour alone (needs a glyph or text too).

## 4. Contrast from observed colours

Take the fg/bg pairs from the `.ansi` SGR (`38;2;r;g;b` / `48;2;…`, or the
256-colour index above 15 mapped to RGB), not from the theme source. WCAG:
linearise sRGB, `L=0.2126R+0.7152G+0.0722B`, ratio `(L1+0.05)/(L2+0.05)`. Body
text needs ≥4.5:1; ≥3:1 is acceptable only for non-essential or large UI
elements. Report the pairs with ratios, e.g. "dim on panel bg 3.1–3.4:1".
- Default fg/bg (SGR 39/49) and ANSI slots 0–15 are set by the user's
  terminal. Ask for their RGB; without it, state what the renderer assumed,
  make no contrast claim for them and derive no tint from an assumed hue.
- `dim` (SGR 2) is drawn by the terminal. The renderer's blend is a guess, so
  report dim contrast as a range or say it's approximate.
- If a palette or contrast change must also work with indexed colours, force
  that mode via the app's documented setting and confirm it from the emitted
  SGR; a successful start is not evidence of the mode. States meant to look
  distinct must not share a fill. Observed in one change: several approved
  RGB tints all encoded to xterm gray index 59 (pinned SDK, dark mode).

## 5. Mockups

Write proposals as ANSI using the **observed** theme RGBs and render them
with the same `ansi2png.py`, so current and proposed look alike. Show
"current" next to "proposed", including narrow-width variants. Say that real
implementations must use theme tokens, not the literal RGBs.

That is for a change of look. For a change of keys, focus, scrolling, or of
layout that depends on content and size, generate the frames instead of
typing them, from a small throwaway model that imports the application's own
formatting, wrapping, width and theme functions (one task, one pane; cost
and transfer are a hypothesis).
- Each sentence of the page that says "never", "always" or "no line is
  skipped" claims every size and position; the frames show a handful. Run it
  on the model over several widths and every height from the smallest usable
  one, or reword it as an intention (an alternative the source did not
  verify). Observed: "no line is skipped" was false at 40x12, a second
  such sentence at 7 of 55 scroll positions; no frame showed either.
- Styling libraries drop attributes without a terminal: force the colour
  level, for example `FORCE_COLOR=3`, and test that a bold sample differs
  from the plain one.

## Limits (state these in the report)

- The PNG is the tmux cell grid drawn with a chosen font. It is not emulator
  pixels. It doesn't show ligatures, emulator dim/bold handling, or the
  user's palette for 16-colour indexes.
- Missing-glyph boxes mean the review font lacks the glyph. Recheck in the
  target terminal before calling it an app defect.
- The renderer puts one codepoint in one cell. Wide CJK/emoji shift the later
  columns, so measure geometry from `.txt` and pane width.
- `-e` is a serialization of the screen, not the byte stream (`tui-testing`).
- A generated frame shows what the model draws, not what the product will do.
- HTML frames pass through browser fonts: put each non-ASCII grapheme in an
  inline-block cell `1ch` or `2ch` wide, as the terminal's width function
  says, or box-drawing and emoji from a fallback font shift the columns
  (checked in headless Chromium only).

## Report

For each finding: screenshot name, observed versus expected, code location,
and whether it is a defect (with a failing reproduction) or a design proposal.
Keep defects separate from taste. List the surfaces reviewed only from code,
the assumed terminal background, and the untested capabilities.

## Appendix: helper scripts

Write each file as it stands. Both passed their checks under Python 3.14;
`ansi2png.py` needs Pillow (checked with 12.3), `fake_openai.py` only the
standard library.

### `ansi2png.py`

`ANSI2PNG_FONT` and `ANSI2PNG_FONT_BOLD` must name a monospace TTF file and
its bold face; the script exits with a message when one is unset. Where
fontconfig knows the font, `fc-match -f '%{file}' 'DejaVu Sans Mono'` and
`fc-match -f '%{file}' 'DejaVu Sans Mono:bold'` print such paths. Colours of
palette slots 0-15 and the default colours are the script's own assumptions
(`BASE16`, `DEFAULT_FG`, `DEFAULT_BG`), not the user's theme; two optional
hex arguments replace the defaults.

```python
#!/usr/bin/env python3
"""Render a `tmux capture-pane -p -e` styled capture to PNG (cell grid, truecolor/256/16 SGR).
usage: ansi2png.py IN.ansi OUT.png [DEFAULT_FG_HEX DEFAULT_BG_HEX]
ANSI2PNG_FONT and ANSI2PNG_FONT_BOLD name a monospace TTF file and its bold face."""
import os, re, sys
from PIL import Image, ImageDraw, ImageFont

SIZE = 15
DEFAULT_FG = (220, 222, 228)
DEFAULT_BG = (24, 24, 30)
BASE16 = [(0,0,0),(205,49,49),(13,188,121),(229,229,16),(36,114,200),(188,63,188),(17,168,205),(229,229,229),
          (102,102,102),(241,76,76),(35,209,139),(245,245,67),(59,142,234),(214,112,214),(41,184,219),(255,255,255)]

def required_env(name):
    value = os.environ.get(name)
    if not value: sys.exit(f"{name} must be set to the path of a monospace TTF file")
    return value

def c256(n):
    if n < 16: return BASE16[n]
    if n < 232:
        n -= 16; r, g, b = n // 36, (n // 6) % 6, n % 6
        f = lambda v: 0 if v == 0 else 55 + v * 40
        return (f(r), f(g), f(b))
    v = 8 + (n - 232) * 10; return (v, v, v)

# box-drawing: (left, right, up, down)
BOX = {"─": (1, 1, 0, 0), "│": (0, 0, 1, 1), "┼": (1, 1, 1, 1), "┴": (1, 1, 1, 0), "┬": (1, 1, 0, 1), "┌": (0, 1, 0, 1),
       "┐": (1, 0, 0, 1), "└": (0, 1, 1, 0), "┘": (1, 0, 1, 0), "├": (0, 1, 1, 1), "┤": (1, 0, 1, 1)}
SGR = re.compile(r"\x1b\[([0-9;:]*)m")
OTHER = re.compile(r"\x1b(\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(\x07|\x1b\\))")

def parse(lines):
    rows = []
    st = dict(fg=None, bg=None, bold=False, rev=False, dim=False, ul=False, it=False)
    for line in lines:
        row, i = [], 0
        while i < len(line):
            m = SGR.match(line, i)
            if m:
                p = [int(x) if x else 0 for x in re.split("[;:]", m.group(1))] or [0]
                j = 0
                while j < len(p):
                    v = p[j]
                    if v == 0: st.update(fg=None, bg=None, bold=False, rev=False, dim=False, ul=False, it=False)
                    elif v == 1: st["bold"] = True
                    elif v == 2: st["dim"] = True
                    elif v == 3: st["it"] = True
                    elif v == 4: st["ul"] = True
                    elif v == 7: st["rev"] = True
                    elif v == 22: st["bold"] = st["dim"] = False
                    elif v == 23: st["it"] = False
                    elif v == 24: st["ul"] = False
                    elif v == 27: st["rev"] = False
                    elif 30 <= v <= 37: st["fg"] = BASE16[v - 30]
                    elif 90 <= v <= 97: st["fg"] = BASE16[v - 90 + 8]
                    elif 40 <= v <= 47: st["bg"] = BASE16[v - 40]
                    elif 100 <= v <= 107: st["bg"] = BASE16[v - 100 + 8]
                    elif v == 39: st["fg"] = None
                    elif v == 49: st["bg"] = None
                    elif v in (38, 48) and j + 1 < len(p):
                        key = "fg" if v == 38 else "bg"
                        if p[j + 1] == 2 and j + 4 < len(p): st[key] = tuple(p[j + 2:j + 5]); j += 4
                        elif p[j + 1] == 5 and j + 2 < len(p): st[key] = c256(p[j + 2]); j += 2
                    j += 1
                i = m.end(); continue
            m = OTHER.match(line, i)
            if m: i = m.end(); continue
            row.append((line[i], dict(st))); i += 1
        rows.append(row)
    return rows

def render(src, dst, title=None):
    text = open(src, encoding="utf-8", errors="replace").read().split("\n")
    rows = parse(text)
    font = ImageFont.truetype(required_env("ANSI2PNG_FONT"), SIZE)
    bold = ImageFont.truetype(required_env("ANSI2PNG_FONT_BOLD"), SIZE)
    cw = int(font.getlength("M")); ch = int(SIZE * 1.3)
    cols = max((len(r) for r in rows), default=1)
    img = Image.new("RGB", (cols * cw + 16, len(rows) * ch + 16), DEFAULT_BG)
    d = ImageDraw.Draw(img)
    for y, row in enumerate(rows):
        for x, (c, s) in enumerate(row):
            fg, bg = s["fg"] or DEFAULT_FG, s["bg"] or DEFAULT_BG
            if s["rev"]: fg, bg = bg, fg
            if s["dim"]: fg = tuple(int(a * 0.6 + b * 0.4) for a, b in zip(fg, bg))
            px, py = 8 + x * cw, 8 + y * ch
            if bg != DEFAULT_BG: d.rectangle([px, py, px + cw - 1, py + ch - 1], fill=bg)
            if c in BOX:
                l, r, u, dn = BOX[c]; mx, my = px + cw // 2, py + ch // 2
                if l: d.line([px, my, mx, my], fill=fg)
                if r: d.line([mx, my, px + cw - 1, my], fill=fg)
                if u: d.line([mx, py, mx, my], fill=fg)
                if dn: d.line([mx, my, mx, py + ch - 1], fill=fg)
            elif c == "█": d.rectangle([px, py, px + cw - 1, py + ch - 1], fill=fg)
            elif c == "▌": d.rectangle([px, py, px + cw // 2 - 1, py + ch - 1], fill=fg)
            elif c != " ": d.text((px, py), c, font=bold if s["bold"] else font, fill=fg)
            if s["ul"]: d.line([px, py + ch - 2, px + cw - 1, py + ch - 2], fill=fg)
    img.save(dst)

if __name__ == "__main__":
    if len(sys.argv) > 4:
        h = lambda x: tuple(int(x.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        DEFAULT_FG, DEFAULT_BG = h(sys.argv[3]), h(sys.argv[4])
    render(sys.argv[1], sys.argv[2])
```

### `fake_openai.py`

```python
"""Scripted OpenAI-compatible endpoint for UX screenshots.
User message "CALL <tool> <json>" -> one tool call; tool result -> "done"; else "ok".
usage: fake_openai.py PORT (listens on 127.0.0.1)."""
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def text_of(m):
    c = m.get("content")
    if isinstance(c, str): return c
    if isinstance(c, list): return "".join(p.get("text", "") for p in c if isinstance(p, dict))
    return ""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        msgs = body.get("messages", [])
        last = msgs[-1] if msgs else {}
        tail = []
        for m in reversed(msgs):
            if m.get("role") in ("assistant", "tool"): break
            tail.append(text_of(m))
        call = next((x[x.index("CALL "):] for x in tail if "CALL " in x), None)
        if call is not None:
            _, name, args = call.split(" ", 2)
            delta = {"role": "assistant", "tool_calls": [{"index": 0, "id": f"call_{len(msgs)}", "type": "function", "function": {"name": name, "arguments": args}}]}
            finish = "tool_calls"
        else:
            delta = {"role": "assistant", "content": "done" if last.get("role") == "tool" else "ok — scripted reply for a UX screenshot."}
            finish = "stop"
        chunks = [{"id": "c", "object": "chat.completion.chunk", "model": "scripted", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                  {"id": "c", "object": "chat.completion.chunk", "model": "scripted", "choices": [{"index": 0, "delta": {}, "finish_reason": finish}]},
                  {"id": "c", "object": "chat.completion.chunk", "model": "scripted", "choices": [], "usage": {"prompt_tokens": 1200, "completion_tokens": 40, "total_tokens": 1240}}]
        data = ("".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n").encode()
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
```
