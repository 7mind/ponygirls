# Manure offline viewer

The authenticated backend serves `dist/index.html` as an escaped template and the
fixed local assets below. No CDN, external rendering service, runtime npm, or
uploaded HTML execution is involved. Markdown uses a source-positioned mdast/hast
GFM pipeline + DOMPurify;
Mermaid uses strict mode; Graphviz runs its embedded WASM in a disposable worker;
PDF.js renders pages to canvas without annotation, scripting or action handlers.
Images (including SVG) are displayed only in browser image context. Source and other
text files (`.py`, `.json`, `.csv`, `.log`, …) are shown as exact, line-numbered text;
archives (`.zip`, `.tar`, `.gz`, …) get a card that offers the original download.

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
- `__MANURE_KIND__`: `markdown`, `image`, `pdf`, `mermaid`, `graphviz`, `text`, `archive`
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

`viewer.js` is approximately 5.9 MB; allow at least 8 MiB per bundled asset.
Graphviz's WASM is embedded in its worker, so no `.wasm` route is required.
Suggested CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'
blob:; worker-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none';
form-action 'none'`. SVG styles generated by Mermaid need inline style support.
Always apply authorization and `X-Content-Type-Options: nosniff` on raw/renderer-asset routes.
The exception is `/__manure/viewer/favicon.svg`: the server embeds the generic
Manure SVG and serves it without artifact credentials, including on locked pages.
Its URL is prefixed by the artifact mount in path mode. It is not a viewer build
output or an uploaded file, so uploaded site favicons and raw bytes are unchanged.

## Bounds and failure behavior

- Text: 2 MiB, checked both by declared length and streaming bytes; fetch 30 s.
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

Focused Node tests cover safety contracts (Blackbox/Atomic) and the production
PDF page-operation closure (Whitebox/Atomic regression tests), all Behavioral/Active.
After building, run `CHROMIUM_BIN=/path/to/chromium npm run test:browser` for the
real-browser regressions, including sibling hyperlinks without automatic sibling
requests and sanitized Mermaid labels under the production CSP without
permitting foreignObject. Authentication, complete
browser journeys and PDF fidelity remain parent-project acceptance checks.
