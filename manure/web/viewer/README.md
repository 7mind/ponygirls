# Manure offline viewer

The authenticated backend serves `dist/index.html` as an escaped template and the
fixed local assets below. No CDN, external rendering service, runtime npm, or
uploaded HTML execution is involved. Markdown uses a source-positioned mdast/hast
GFM pipeline + DOMPurify;
Mermaid uses strict mode; Graphviz runs its embedded WASM in a disposable worker;
PDF.js renders pages to canvas without annotation, scripting or action handlers.
Images (including SVG) are displayed only in browser image context. Text files are
shown as exact, line-numbered text with format-aware views (below); audio and video
use the browser's player; archives (`.zip`, `.tar`, `.gz`, …) and files that are not
text get a card that offers the original download.

The page chrome (bar, breadcrumb, meta line, theme menu, icons, toasts) belongs to the
content shell, `manure/web/unlock` (configured as `unlock_shell_dir`): `content.css`,
`chrome.js` and the shared design system `shared/ui-web` as `ui/`, served on the content
origin under `<mount>/__manure/shell/` independently of the dashboard and the viewer
(spec `docs/drafts/20261117-2130-dashboard-redesign-spec.md` §3.3). The viewer only emits
`span[data-icon]` placeholders and `manure:toast` events; without a shell directory it
still renders, without icons, toasts and the shared styles.

## Build and check

Node 24 is the pinned Nix build runtime. Dependency versions and integrity hashes
are pinned by `package-lock.json`. From this directory:

```sh
npm ci --ignore-scripts
npm test
npm run build
```

From the repository root, build the offline installed assets and run the same
focused tests in the Nix sandbox:

```sh
nix build --impure --no-link --print-out-paths --expr \
  'let f = builtins.getFlake (toString ./.); pkgs = import f.inputs.nixpkgs { system = builtins.currentSystem; }; in pkgs.callPackage ./nix/pkg/manure/viewer.nix {}'
```

The installation is `$out/share/manure/web/viewer/`. Never commit `node_modules`
or `dist`. The source directory is not directly browser-usable; build first.

## Upload timestamp

The meta line under the bar shows size · type · **uploaded** followed by the artifact's
server-recorded creation time in the browser's time zone (`Nov 17, 21:14 · 16 min ago`);
the tooltip and the `datetime` attribute keep the exact UTC ISO 8601 value. This is the
same `created_at` shown in artifact metadata, not the file modification, upload-completion
or preview-request time. All files and directory listings in an artifact share it. The
server renders the semantic `<time datetime="…">` after ordinary content authorization;
no additional browser API request is needed.

## Text files

A text file (`data-kind="text"`, or `unknown` whose content is text) is shown as its exact
text, one block per line. The line number is generated content of an empty link in the
gutter, so the text of the view, a selection and **Copy raw** are exactly the stored
text. What is added on top is decided from the file name (`src/syntax.js`):

| Files | View |
| --- | --- |
| Source code and configuration: `.py`, `.c`/`.h`, `.cpp`/`.hpp`, `.java`, `.kt`, `.scala`/`.sbt`, `.go`, `.rs`, `.js`/`.ts`, `.sh`, `.yaml`, `.toml`/`.ini`/`.conf`, `.nix`, `.sql`, `.xml`, `.proto`, `.bzl`, … and names such as `Makefile`, `Dockerfile`, `CMakeLists.txt`, `BUILD` | syntax highlighting (highlight.js grammars: its common set plus Scala, Nix, Dockerfile, Protocol Buffers, LaTeX, Haskell, CMake, Groovy, Properties, Nginx, PowerShell, Erlang, Elixir, Clojure, OCaml, Dart) |
| `.diff`, `.patch` | file headers, hunks, additions and deletions coloured by line (classified from the hunk line counts); files and `+`/`−` totals in the meta line |
| `.json`, `.ipynb`, `flake.lock`; `.jsonl`, `.ndjson` | **Formatted \| Raw**. Formatted is a two-space re-indentation that copies every number and string as written (`12345678901234567890`, `1.0`, `"\u00e9"`); JSON Lines format each line. A file that is not valid JSON shows a note with the line and column of the fault and its raw text. |
| `.csv`, `.tsv` | **Table \| Raw**. RFC 4180 quoting with either delimiter; first record as the header, numeric columns right-aligned, at most 2,000 rows and 100,000 cells (the cut is stated). An unclosed quote, text after a closing quote or more than 500 fields are reported and the raw text is shown. |
| any text without a grammar that contains ANSI escape sequences (logs) | **Rendered \| Raw**. The 16-colour palette, bold, dim, italic and underline become theme colours; 256-colour and true-colour codes select the default colour; every other escape sequence is removed. Raw keeps the escapes. |

Colours are aliases of the design-system tokens (`styles.css`), so both themes follow
`tokens.css`. Highlighting applies up to 256 KiB of text; above that the text is plain
and the meta line says so (measured in headless Chromium: a 250 KiB Python file is
rendered in about 1.3 s with highlighting against 0.8 s without).

**Line links.** A click on a line number puts `#L12` in the address, a shift-click on
another extends it to `#L12-L18` (from the line clicked before, or from the line the
opened address names); opening such an address marks the lines and scrolls to
them. Lines are the lines of the stored file: formatted JSON and the table have none and
give way to Raw when a line is addressed. Markdown's Raw view has plain numbers. The
numbers are pointer targets only (no tab stop per line); a line can always be addressed
by typing the fragment.

**Large files.** A text file over 2 MiB is fetched as its first 2 MiB (a byte range of
the raw route), cut at the last complete line, and shown with a note that names the last
line and offers the original. The file counts as larger by its declared length or, when
a proxy removed the length, when its body exceeds the limit; the size in the note comes
from the byte-range answer and is left out when the server does not state it. A view
also shows at most 50,000 lines (every line is a block with a gutter link; measured in
headless Chromium, 100,000 two-byte lines took 5 s to render, and 2 MiB of line breaks
did not finish in a minute), with the same note. Copy raw then copies the shown part.
What is derived from a part is worded as a part or withheld: a part of a JSON document
gets no formatted view and no validity statement, a part of a diff no totals. A part of
a CSV or TSV file gets a table of its leading rows, counted as "first N rows"; a record
counts only when its line break is in the part, and a quoted cell left open within the
last 64 KiB of the part is taken as split by the cut (its record is left out), while one
left open further back is reported as a fault of the file. Markdown and diagram sources
keep the hard 2 MiB limit: a cut document would render as a different document.

## Files of other types

Every file except HTML has a viewer page. A type that the server does not list is
`unknown`: the viewer shows it as a text file when its first 2 MiB contain no NUL byte
and decode as UTF-8, and otherwise shows "No preview for this file type" with the
download (not an error). A listed text type that is not UTF-8 is a preview failure.
`.mp4`, `.m4v`, `.webm`, `.mov`, `.ogv` and `.mp3`, `.wav`, `.ogg`, `.oga`, `.opus`,
`.m4a`, `.flac`, `.aac` open in the browser's native player on the stage (it seeks with
byte ranges of the raw route); resolution and duration appear in the meta line, and a
file the browser cannot play is reported with the download.

## Markdown code blocks

Fenced and indented code blocks have **Copy** above the block (shown on hover or focus,
like the table tools); it copies the code without its fence. A block is highlighted by
the first word of its info string (` ```python `, `sh`, `yaml`, `scala`, …); ` ```diff `
is coloured by line like a `.diff` file; blocks without a known language stay plain. One
document highlights at most 256 KiB of code; blocks that do not fit stay plain and the
meta line counts them (`2 code blocks not highlighted`). `<pre><code>` written as raw HTML
with markup inside is left alone.

## Markdown source

Markdown previews have a **Rendered | Raw** switch in the bar. Raw displays the
fetched UTF-8 source as inert, selectable, line-numbered text, with local highlighting
for headings, quotes, lists and fenced blocks. Switching views does not refetch or
rerender the file. **Copy raw**, beside **Download original**, copies that same source
text and confirms with a toast; clipboard failure is reported with guidance to select
the raw text manually. Directory READMEs are rendered only; their section head links to
the full viewer. Clipboard
access requires a secure browser context and permission. Download original remains
available for byte-exact downloads, including files outside the text preview limit.
Source/copy controls remain usable if Markdown rendering fails after loading.

## Markdown section links

Every Markdown heading (levels 1–6) has a keyboard-accessible `#` permalink; the
section tools appear on hover or keyboard focus and reserve no space. Click it or copy its link address to share that section. Unique
sanitized authored heading IDs are preserved. Otherwise, generated IDs use
lowercase heading text with punctuation removed and whitespace replaced by
hyphens, preserving Unicode letters and numbers. Empty slugs use `section`;
duplicate or already-reserved IDs receive numeric suffixes (`-1`, `-2`, …).
Fragment URLs scroll after Markdown loads and diagram rendering completes;
fragment changes and browser back/forward navigation work without reloading.
The same behavior applies to directory README previews.

Every section has a **Copy** button at its heading's top-right corner. It copies
the original Markdown from that heading through the next heading of equal or
higher rank, including subsections. Sections inside lists, blockquotes or HTML
containers stop at their container boundary. Original syntax, container prefixes,
Unicode and line endings are retained; content is not reconstructed from HTML.

Every table has top-right **#** and **Copy** controls (shown on hover or focus). Copy includes only the table's original source (HTML source for an
HTML table). Table links use `table-1`, `table-2`, … in document order, with the
same collision suffix rules as headings. Unique authored table IDs are retained.
Existing section IDs are allocated first and remain unchanged. Direct links and
history navigation reveal the table controls as well as its content. Generated
IDs are deterministic for a given document; inserting/reordering tables can change
their numbers. Clipboard success appears on the clicked button and is announced;
failure uses the same Show raw guidance as Copy raw.

## Directory browsing

Directories without `index.html`/`index.htm` show an escaped, manifest-backed
immediate-child listing: a table of Name, Type, Size and Open/Download, a breadcrumb,
and a "Download all (CLI)" disclosure with the `manure fetch` command. The backend renders
the page under a CSP that admits only the content shell (`/__manure/shell/`); without a
shell directory the listing is a bare, unstyled table. If an immediate regular `readme.md` file exists (case-insensitive)
and viewers are enabled, the page also loads the viewer and renders it beneath the table
under the viewer CSP; the same Markdown metadata, local renderer and safety rules apply. Selection prefers
`README.md`, then `readme.md`, then lexicographic order for other case variants. No iframe or
additional renderer is used. Static-site index paths and ordinary file URLs
remain byte-exact. Disabling viewers preserves listing/raw navigation without
a README preview.

## Backend integration

Replace these placeholders with **HTML attribute escaped** strings (including
quotes, ampersands and angle brackets):

- `__MANURE_CREATED_AT__`: artifact creation timestamp in UTC, used as both the visible upload time and its `datetime` value
- `__MANURE_PATH__`: original artifact-relative path, not URL-encoded
- `__MANURE_RAW_URL__`: same-origin `/<mount>/__manure/raw/<encoded path>`
- `__MANURE_DOWNLOAD_URL__`: original attachment download URL
- `__MANURE_KIND__`: `markdown`, `image`, `pdf`, `mermaid`, `graphviz`, `text`, `video`, `audio`, `archive`, `unknown`
- `__MANURE_ASSET_BASE__`: reserved local asset route, without trailing slash
- `__MANURE_SHELL_BASE__`: the content shell route (`<mount>/__manure/shell`); the template's
  `<!--manure-shell-->…<!--/manure-shell-->` block is dropped when no shell directory is configured
- `__MANURE_ROOT_URL__`: the artifact root (`<mount>/`), for the brand link and breadcrumb
- `__MANURE_ARTIFACT_NAME__`, `__MANURE_SIZE__`, `__MANURE_TYPE__`: breadcrumb root and meta line

The four metadata values live on `meta#manure-viewer` in `data-path`,
`data-raw-url`, `data-download-url`, `data-kind`. No inline JS is needed.
Relative Markdown links/images resolve against the original document location,
not its reserved viewer/raw location. HTTP(S) anchor links may navigate to other
origins when explicitly followed; rendering them does not fetch the destination.
Links retain `rel="noopener noreferrer"`. Relative same-origin links and all
automatically loaded resources remain confined to the artifact. In path mode,
explicit absolute, protocol-relative or root-relative anchors may also navigate
to canonical `/view/<32-lowercase-hex-artifact-id>` entry/content paths, including
bare entry URLs, trailing slashes, fragments and nested content. The `/view/`
prefix matches the backend's fixed `Config.contentMount` contract; subdomain mode
uses separate origins instead. Same-origin management/reserved routes, arbitrary
sibling paths and relative escapes are removed before live DOM creation. Sibling
artifact images remain blocked; allowing an anchor never fetches its destination.
External resource URLs and non-HTTP(S) links (including `mailto:`) are removed.
Anchor URLs with userinfo or ASCII control characters and malformed
URLs are removed without aborting the document.
Markdown cannot introduce active embeds or inline styles. Rendered diagrams are sanitized and displayed as blob images,
never injected into the active document as SVG. Diagram config frontmatter and
legacy directives are rejected, rather than overriding strict renderer settings.

Allowlist exactly these outputs (no directory listing or arbitrary path serving):

| File | Content-Type |
| --- | --- |
| `index.html` | `text/html; charset=utf-8` (template only) |
| `viewer.js` | `text/javascript; charset=utf-8` |
| `graphviz-worker.js` | `text/javascript; charset=utf-8` |
| `pdf.worker.min.mjs` | `text/javascript; charset=utf-8` |
| `pdf.renderer.min.mjs` | `text/javascript; charset=utf-8` |
| `styles.css` | `text/css; charset=utf-8` |

`viewer.js` is approximately 6.1 MB; allow at least 8 MiB per bundled asset.
Graphviz's WASM is embedded in its worker, so no `.wasm` route is required.
Suggested CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self';
connect-src 'self' blob:; worker-src 'self'; object-src 'none'; frame-src 'none';
base-uri 'none'; form-action 'none'`. SVG styles generated by Mermaid need inline
style support; `media-src` is for the audio and video players. The raw route must
answer single byte ranges (large text previews and media seeking use them) and
should serve text types as `text/plain` and media with their media types.
Always apply authorization and `X-Content-Type-Options: nosniff` on raw/renderer-asset routes.
The exception is `/__manure/viewer/favicon.svg`: the server embeds the generic
Manure SVG and serves it without artifact credentials, including on locked pages.
Its URL is prefixed by the artifact mount in path mode. It is not a viewer build
output or an uploaded file, so uploaded site favicons and raw bytes are unchanged.

## Bounds and failure behavior

- Markdown and diagram sources: 2 MiB, checked both by declared length and streaming
  bytes; fetch 30 s. Text files: the first 2 MiB (whole lines) of a larger file and at
  most 50,000 lines, under the same 30 s deadline for both requests.
- Highlighting: 256 KiB per text file and per Markdown document, on the main thread.
  Formatted JSON: 256 nesting levels and 8 MiB of formatted text, otherwise raw text
  with a note. Tables: 2,000 rows, 100,000 cells, 500 columns.
- Diagrams: 50,000 characters, Mermaid 500 edges, at most 32 fenced diagrams per
  Markdown document; Graphviz worker killed after 10 s, each rendered SVG capped
  at 8 MiB. No new diagram rendering starts after the document's 30 s rendering
  budget (one in-flight render may finish beyond that). Mermaid rendering
  executes on the main thread (bounded input/edges, no hard interrupt).
- PDF: 32 MiB buffered with the same fetch deadline; at most 1,000 pages,
  one canvas at a time, at most 12 million pixels, 15 s parse/render deadlines.
  PDF WASM/JIT and document font injection are disabled; no external font/CMap
  asset URLs are configured. Some unusual fonts/images may not preview faithfully.
- Image: native browser decode; − / % / + zoom and Fit | Actual size; a zoomed image
  scrolls the page (no inner scroll box).
- Invalid/oversized/unsupported content produces an explicit visible alert;
  failed diagrams do not silently fall back to raw source. The original download
  link stays available, regardless of renderer success.

Focused Node tests cover safety contracts and the text-format modules (line model, diff
classification, JSON formatting, delimited records, ANSI sequences, grammar resolution;
Blackbox/Atomic) and the production
PDF page-operation closure (Whitebox/Atomic regression tests), all Behavioral/Active.
After building, run `CHROMIUM_BIN=/path/to/chromium npm run test:browser` for the
real-browser regressions, including sibling hyperlinks without automatic sibling
requests, sanitized Mermaid labels under the production CSP without
permitting foreignObject, and the text, table, log, media and unknown-type views
against a file server that answers byte ranges (`test/text-formats.browser.mjs`). Authentication, complete
browser journeys and PDF fidelity remain parent-project acceptance checks.
