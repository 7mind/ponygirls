/** Keyboard-only decisions inbox. Persistence/CAS belongs to the injected store callbacks. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER, Editor, Key, Markdown, SelectList, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi,
  type Component, type Focusable, type MarkdownTheme, type TUI,
} from "@earendil-works/pi-tui";
import { fit as fitCell, frameRule, frameTitle, keyHints, listRow, type KeyHint, type UiFg } from "@ponygirls/pi-ui";
import type { Decision } from "./store.ts";

export interface DecisionsPaneCallbacks {
  tui: TUI;
  load(): Decision[];
  /** Must throw on a stale revision or failed save; the pane retains the draft. */
  resolve(decision: Decision, status: "answered" | "dismissed" | "pending", answer: string | null): void;
  close(): void;
  requestRender(): void;
}

type Draft = {
  base: Decision;
  status: "answered" | "dismissed" | "pending";
  answer: string | null;
  mode: "editor" | "options" | "confirm";
  choice: number;
};

// Stored text is untrusted. Strip terminal commands (including C1 forms and
// incomplete sequences), bidi overrides, and C0 controls, not Unicode graphemes.
const STRINGS = /(?:\x1b[\]PX^_]|[\x90\x98\x9d\x9e\x9f])[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g;
const CSI = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
function clean(text: string, styling: boolean): string {
  const stripped = text.replace(STRINGS, "");
  const parts = styling ? stripped.split(/(\x1b\[[\d;:]*m)/g) : [stripped];
  return parts.map((part, i) => styling && i % 2 ? part : part.replace(CSI, "")
    .replace(/\x1b[ -/]*[0-~]?/g, "")
    .replace(/\r\n?/g, "\n").replace(/\t/g, "    ")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")).join("");
}
const sanitize = (text: string) => clean(text, false);
const oneLine = (text: string) => sanitize(text).replace(/\n/g, " ");

const STATUS_STYLE: Readonly<Record<Decision["status"], { glyph: string; color: UiFg }>> = {
  pending: { glyph: "?", color: "warning" },
  answered: { glyph: "✓", color: "success" },
  dismissed: { glyph: "–", color: "muted" },
};
const statusLabel = (status: Decision["status"]) => `${STATUS_STYLE[status].glyph} ${status}`;
/** Widest status cell: "– dismissed". */
const STATUS_WIDTH = 11;
const COLUMN_GAP = "   ";
const SECTION_INDENT = "  ";
const MAX_LIST_ROWS = 8;
const MAX_WARNING_LINES = 2;
const MAX_HINT_LINES = 4;

const LIST_HINTS: readonly KeyHint[] = [
  { key: "↑↓", action: "select" }, { key: "⏎", action: "detail" }, { key: "⇥", action: "pending/all" },
  { key: "⇞⇟", action: "scroll detail" }, { key: "esc", action: "close" },
];
const DETAIL_HINTS: readonly KeyHint[] = [{ key: "↑↓/⇞⇟", action: "scroll" }, { key: "esc", action: "inbox" }, { key: "⇥", action: "pending/all" }];
const ACTION_HINTS: readonly KeyHint[] = [
  { key: "a/e", action: "answer" }, { key: "1–9/o", action: "options" }, { key: "d", action: "dismiss" }, { key: "u", action: "reopen" },
];
const EDITOR_HINTS: readonly KeyHint[] = [{ key: "⏎", action: "newline" }, { key: "ctrl+s", action: "save" }, { key: "esc", action: "discard" }];
const REBASE_HINTS: readonly KeyHint[] = [{ key: "ctrl+r", action: "reload latest revision, keeping draft" }];
const OPTIONS_HINTS: readonly KeyHint[] = [
  { key: "↑↓/1–9", action: "choose" }, { key: "ctrl+s", action: "save" }, { key: "e", action: "edit" }, { key: "esc", action: "discard" },
];

/** A detail section: a styled label over an indented, sanitized Markdown body. */
interface Section {
  label: string;
  body: string;
}

/**
 * Tab toggles pending/all. Arrows select; Enter expands detail; PgUp/PgDn
 * scroll detail. a/e edits, o or 1–9 selects options, d dismisses, u reopens.
 * Only Ctrl+S writes. Enter in the editor inserts a newline. Escape discards
 * an active draft, then returns to the inbox, then closes (never resolves).
 * Render reloads current records; a draft retains its original CAS revision.
 * Ctrl+R explicitly adopts the latest revision without dropping draft text.
 */
export class DecisionsPane implements Component, Focusable {
  private items: Decision[] = [];
  private selectedId: string | null;
  private all = false;
  private detail = false;
  private scroll = 0;
  private detailRows = 1;
  private detailLength = 0;
  private draft: Draft | null = null;
  private editor: Editor | null = null;
  private choices: SelectList | null = null;
  private pasteBuffer: string | null = null;
  private notice = "";
  private loadError = "";
  private hasFocus = false;
  private markdownTheme: MarkdownTheme;
  private sectionCache: { key: string; lines: string[] } | null = null;
  private theme: Theme;
  private callbacks: DecisionsPaneCallbacks;
  private projectName: string;
  private getHeight: () => number;

  constructor(theme: Theme, callbacks: DecisionsPaneCallbacks, projectName: string, initialId: string | null, getHeight: () => number) {
    this.theme = theme;
    this.callbacks = callbacks;
    this.projectName = projectName;
    this.getHeight = getHeight;
    this.selectedId = initialId;
    this.markdownTheme = {
      heading: (s) => theme.fg("mdHeading", s), link: (s) => theme.fg("mdLink", s),
      linkUrl: (s) => theme.fg("mdLinkUrl", s), code: (s) => theme.fg("mdCode", s),
      codeBlock: (s) => theme.fg("mdCodeBlock", s), codeBlockBorder: (s) => theme.fg("mdCodeBlockBorder", s),
      quote: (s) => theme.fg("mdQuote", s), quoteBorder: (s) => theme.fg("mdQuoteBorder", s),
      hr: (s) => theme.fg("mdHr", s), listBullet: (s) => theme.fg("mdListBullet", s),
      bold: (s) => theme.bold(s), italic: (s) => theme.italic(s),
      strikethrough: (s) => theme.strikethrough(s), underline: (s) => theme.underline(s),
    };
    this.refresh();
    const initial = this.items.find((d) => d.id === initialId);
    if (initial) {
      this.all = initial.status !== "pending";
      this.selectedId = initial.id;
      this.detail = true;
    } else if (initialId) this.notice = "Requested decision was not found.";
  }

  get focused(): boolean { return this.hasFocus; }
  set focused(value: boolean) {
    this.hasFocus = value;
    if (this.editor) this.editor.focused = value && this.draft?.mode === "editor";
  }

  invalidate(): void { this.sectionCache = null; this.editor?.invalidate(); }

  /** Also called on every render and key event; does not replace an active draft. */
  refresh(): void {
    const before = this.visible();
    const index = Math.max(0, before.findIndex((d) => d.id === this.selectedId));
    try {
      this.items = this.callbacks.load();
      this.loadError = "";
      const after = this.visible();
      if (!after.some((d) => d.id === this.selectedId)) {
        this.selectedId = after[Math.min(index, after.length - 1)]?.id ?? null;
        if (!this.draft) this.scroll = 0;
      }
    } catch (error) { this.loadError = `Cannot load decisions: ${String(error)}`; }
  }

  private visible(): Decision[] { return this.all ? this.items : this.items.filter((d) => d.status === "pending"); }
  private current(): Decision | undefined { return this.items.find((d) => d.id === this.selectedId); }
  private latest(): Decision | undefined { return this.items.find((d) => d.id === this.draft?.base.id); }
  private changed(): boolean { return !!this.draft && this.latest()?.revision !== this.draft.base.revision; }
  private redraw(): void { this.callbacks.requestRender(); }

  private makeChoices(rows: number): SelectList {
    const draft = this.draft!;
    const list = new SelectList(draft.base.options.map((option, i) => ({ value: String(i), label: `${i + 1}. ${oneLine(option)}` })), Math.max(1, rows), {
      selectedPrefix: (s) => this.theme.fg("accent", s), selectedText: (s) => this.theme.fg("accent", s),
      description: (s) => this.theme.fg("muted", s), scrollInfo: (s) => this.theme.fg("dim", s), noMatch: (s) => this.theme.fg("dim", s),
    });
    list.setSelectedIndex(draft.choice);
    list.onSelectionChange = (item) => {
      draft.choice = Number(item.value);
      draft.answer = draft.base.options[draft.choice]!;
      this.scroll = 0;
    };
    // Enter merely selects; it is deliberately NOT a persistence action.
    list.onSelect = () => { this.notice = "Option selected. Ctrl+S saves; e edits it."; };
    return list;
  }

  private start(mode: Draft["mode"], status: Draft["status"], choice: number): void {
    const decision = this.current();
    if (!decision) return;
    this.notice = "";
    this.scroll = 0;
    this.draft = { base: { ...decision, options: [...decision.options] }, mode, status, choice, answer: status === "answered" ? decision.answer ?? "" : null };
    if (mode === "options") {
      if (!decision.options.length) { this.draft = null; this.notice = "No options; press a to write an answer."; return; }
      this.draft.answer = decision.options[choice]!;
      this.choices = this.makeChoices(5);
    } else if (mode === "editor") this.edit();
  }

  private edit(): void {
    if (!this.draft) return;
    this.draft.mode = "editor";
    this.editor = new Editor(this.callbacks.tui, {
      borderColor: (s) => this.theme.fg("borderMuted", s),
      selectList: {
        selectedPrefix: (s) => this.theme.fg("accent", s), selectedText: (s) => this.theme.fg("accent", s),
        description: (s) => this.theme.fg("muted", s), scrollInfo: (s) => this.theme.fg("dim", s), noMatch: (s) => this.theme.fg("dim", s),
      },
    });
    this.editor.disableSubmit = true;
    this.editor.setText(sanitize(this.draft.answer ?? ""));
    this.editor.focused = this.hasFocus;
  }

  private save(): void {
    const draft = this.draft;
    if (!draft) return;
    if (draft.mode === "editor") draft.answer = sanitize(this.editor!.getExpandedText());
    if (draft.status === "answered" && !draft.answer?.trim()) { this.notice = "An answer cannot be empty."; return; }
    if (this.loadError) { this.notice = "Cannot save while loading decisions fails; your draft is retained."; return; }
    try {
      this.callbacks.resolve(draft.base, draft.status, draft.answer);
      this.detail = false;
      this.draft = null;
      this.editor = null;
      this.choices = null;
      this.scroll = 0;
      this.notice = draft.status === "pending" ? "Reopened." : draft.status === "dismissed" ? "Dismissed." : "Answer saved.";
      this.refresh();
    } catch (error) { this.notice = `Save failed; draft retained: ${String(error)}`; }
  }

  private editorInput(data: string): void {
    const begin = "\x1b[200~", end = "\x1b[201~";
    if (this.pasteBuffer !== null || data.includes(begin)) {
      const start = data.indexOf(begin);
      if (this.pasteBuffer === null) {
        if (start > 0) this.editor!.handleInput(data.slice(0, start));
        this.pasteBuffer = data.slice(start + begin.length);
      } else this.pasteBuffer += data;
      const stop = this.pasteBuffer.indexOf(end);
      if (stop < 0) return;
      const text = this.pasteBuffer;
      this.pasteBuffer = null;
      this.editor!.handleInput(begin + sanitize(text.slice(0, stop)) + end);
      if (text.length > stop + end.length) this.editorInput(text.slice(stop + end.length));
    } else this.editor!.handleInput(matchesKey(data, Key.enter) ? "\n" : data);
    const text = this.editor!.getExpandedText();
    const safe = sanitize(text);
    if (safe !== text) this.editor!.setText(safe);
  }

  handleInput(data: string): void {
    this.refresh();
    // Paste bytes are text, not pane shortcuts, even across input packets.
    if (this.draft?.mode === "editor" && (this.pasteBuffer !== null || data.includes("\x1b[200~"))) {
      this.editorInput(data); this.redraw(); return;
    }
    const cancel = matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c");
    if (this.draft) {
      if (cancel) {
        this.draft = null; this.editor = null; this.choices = null; this.notice = "Draft discarded."; this.scroll = 0;
      } else if (matchesKey(data, "ctrl+s")) this.save();
      else if (matchesKey(data, "ctrl+r")) {
        const latest = this.latest();
        if (latest) {
          this.draft.base = { ...latest, options: [...latest.options] };
          // Keep the exact staged text, even if the options changed externally.
          if (this.draft.mode === "options") this.edit();
          this.notice = "Latest revision loaded; draft kept. Review before Ctrl+S.";
        } else this.notice = "Decision no longer exists; draft kept.";
      } else if (this.draft.mode === "editor") this.editorInput(data);
      else if (this.draft.mode === "options") {
        if (data === "e" || data === "a") this.edit();
        else if (/^[1-9]$/.test(data) && Number(data) <= this.draft.base.options.length) {
          this.draft.choice = Number(data) - 1;
          this.draft.answer = this.draft.base.options[this.draft.choice]!;
          this.choices!.setSelectedIndex(this.draft.choice);
        }
        else this.choices!.handleInput(data);
      }
      this.redraw();
      return;
    }
    if (cancel || data === "q") {
      if (this.detail) { this.detail = false; this.scroll = 0; }
      else { this.callbacks.close(); return; }
    } else if (matchesKey(data, Key.tab)) {
      this.all = !this.all; this.refresh(); this.scroll = 0;
    } else if (data === "r") this.notice = "Refreshed.";
    else if (matchesKey(data, Key.enter)) { this.detail = true; this.scroll = 0; }
    else if (data === "a" || data === "e") this.start("editor", "answered", 0);
    else if (data === "o") this.start("options", "answered", 0);
    else if (/^[1-9]$/.test(data) && Number(data) <= (this.current()?.options.length ?? 0)) this.start("options", "answered", Number(data) - 1);
    else if (data === "d" && this.current()?.status !== "dismissed") this.start("confirm", "dismissed", 0);
    else if (data === "u" && this.current()?.status !== "pending") this.start("confirm", "pending", 0);
    else {
      const up = matchesKey(data, Key.up) || data === "k";
      const down = matchesKey(data, Key.down) || data === "j";
      const pgUp = matchesKey(data, Key.pageUp), pgDown = matchesKey(data, Key.pageDown);
      if (pgUp || pgDown || (this.detail && (up || down))) {
        this.scroll = Math.max(0, Math.min(Math.max(0, this.detailLength - this.detailRows), this.scroll + (up || pgUp ? -1 : 1) * (pgUp || pgDown ? this.detailRows : 1)));
      } else if (up || down) {
        const items = this.visible();
        const index = items.findIndex((d) => d.id === this.selectedId);
        this.selectedId = items[Math.max(0, Math.min(items.length - 1, index + (up ? -1 : 1)))]?.id ?? null;
        this.scroll = 0;
      } else if (matchesKey(data, Key.home)) this.scroll = 0;
      else if (matchesKey(data, Key.end)) this.scroll = Math.max(0, this.detailLength - this.detailRows);
    }
    this.redraw();
  }

  /** Section labels are styled here; only bodies go through Markdown, so no literal headings. */
  private sections(sections: readonly Section[], width: number): string[] {
    const key = JSON.stringify([width, sections]);
    if (this.sectionCache?.key === key) return this.sectionCache.lines;
    const bodyWidth = Math.max(1, width - SECTION_INDENT.length);
    const lines = sections.flatMap((section) => [
      this.theme.bold(this.theme.fg("accent", oneLine(section.label))),
      // Markdown may generate hyperlinks or decode entities: only generated SGR
      // styling is allowed through; never replay OSC, DCS, or cursor commands.
      ...new Markdown(sanitize(section.body), 0, 0, this.markdownTheme).render(bodyWidth).map((line) => SECTION_INDENT + clean(line, true)),
    ]);
    this.sectionCache = { key, lines };
    return lines;
  }

  private detailSections(d: Decision): Section[] {
    return [
      { label: "Question", body: d.question },
      d.context ? { label: "Context", body: d.context } : null,
      d.options.length ? { label: "Options", body: d.options.map((s, i) => `${i + 1}. ${s}`).join("\n") } : null,
      d.recommendation ? { label: "Recommendation", body: d.recommendation } : null,
      d.answer !== null ? { label: "Saved answer", body: d.answer } : null,
    ].filter((section): section is Section => section !== null);
  }

  /** Glyph and status word in the status colour, padded to `width` columns. */
  private statusCell(status: Decision["status"], width: number): string {
    return this.theme.fg(STATUS_STYLE[status].color, fitCell(statusLabel(status), width));
  }

  /** Short dim id, glyph+colour status, question; secondary text is muted inside the selection band. */
  private row(item: Decision, selected: boolean, idWidth: number): string {
    const id = this.theme.fg(selected ? "muted" : "dim", fitCell(oneLine(item.id), idWidth));
    return [id, this.statusCell(item.status, STATUS_WIDTH), this.theme.fg("text", oneLine(item.question))].join(COLUMN_GAP);
  }

  private viewport(lines: string[], rows: number): string[] {
    this.detailRows = Math.max(1, rows);
    this.detailLength = lines.length;
    this.scroll = Math.max(0, Math.min(this.scroll, lines.length - this.detailRows));
    return lines.slice(this.scroll, this.scroll + rows);
  }

  render(width: number): string[] {
    this.refresh();
    const w = Math.max(0, Math.floor(width)), height = Math.max(0, Math.floor(this.getHeight()));
    if (!w || !height) return [];
    const fit = (s: string) => truncateToWidth(s, w, "…");
    const dim = (s: string) => this.theme.fg("dim", s);
    const draft = this.draft, d = draft?.base ?? this.current();
    const warning = [this.loadError, this.notice, this.changed() ? "Changed elsewhere; draft kept. Ctrl+R adopts latest revision." : ""].filter(Boolean).join(" ");
    const hints: (readonly KeyHint[])[] = draft?.mode === "editor" ? [EDITOR_HINTS, REBASE_HINTS]
      : draft?.mode === "options" ? [OPTIONS_HINTS]
      : draft ? [[{ key: "ctrl+s", action: `confirm ${draft.status === "pending" ? "reopen" : "dismiss"}` }, { key: "esc", action: "cancel" }]]
      : [this.detail ? DETAIL_HINTS : LIST_HINTS, ACTION_HINTS];
    const foot = [
      ...warning ? wrapTextWithAnsi(this.theme.fg("warning", oneLine(warning)), w).slice(0, MAX_WARNING_LINES) : [],
      ...hints.flatMap((group) => keyHints(this.theme, w, group).lines).slice(0, MAX_HINT_LINES),
    ].slice(0, Math.max(0, height - (draft?.mode === "editor" ? 3 : 1) - 1));
    const bottom = foot.length ? [frameRule(this.theme, w), ...foot] : [];
    const pending = this.items.filter((item) => item.status === "pending").length;
    const out = [frameTitle(this.theme, w, {
      title: "Decisions",
      tabs: { labels: [`pending ${pending}`, "all"], active: this.all ? 1 : 0 },
      right: dim(oneLine(this.projectName)),
    }, "none").line];
    let rows = Math.max(0, height - bottom.length - 1);
    if (rows && !draft && !this.detail) {
      const list = this.visible();
      const count = Math.min(Math.max(1, Math.floor(rows / 3)), MAX_LIST_ROWS, Math.max(1, list.length));
      const index = Math.max(0, list.findIndex((item) => item.id === this.selectedId));
      const from = Math.max(0, Math.min(index - Math.floor(count / 2), list.length - count));
      const shown = list.slice(from, from + count);
      const idWidth = Math.max(0, ...shown.map((item) => visibleWidth(oneLine(item.id))));
      const listLines = shown.map((item) => {
        const selected = item.id === this.selectedId;
        return listRow(this.theme, w, this.row(item, selected, idWidth), selected);
      });
      out.push(...(listLines.length ? listLines : [dim("No pending decisions. Tab shows history.")]));
      rows -= listLines.length || 1;
      if (d && rows > 1) { out.push(frameRule(this.theme, w)); rows--; }
    }
    if (!d && rows > 0 && this.detail) out.push(dim("No pending decisions. Tab shows history."));
    if (d && rows > 0) {
      if (draft || this.detail) { out.push(`${dim(oneLine(d.id))}${COLUMN_GAP}${this.statusCell(d.status, visibleWidth(statusLabel(d.status)))}`); rows--; }
      if (draft?.mode === "editor") {
        const lines = this.editor!.render(w);
        // The builtin editor has a five-line minimum. Crop around its cursor
        // at short heights, retaining the IME marker instead of a fixed prefix.
        const cursor = lines.findIndex((s) => s.includes(CURSOR_MARKER));
        const start = Math.max(0, Math.min(Math.max(0, cursor - Math.floor(rows / 2)), lines.length - rows));
        out.push(...lines.slice(start, start + rows));
      } else if (draft?.mode === "options") {
        const count = Math.min(d.options.length + 1, Math.max(1, Math.floor(rows / 2)));
        this.choices = this.makeChoices(Math.max(1, count - 1));
        const choices = this.choices.render(w).slice(0, count);
        out.push(...choices);
        out.push(...this.viewport(this.sections([{ label: "Selected option", body: draft.answer ?? "" }], w), Math.max(0, rows - choices.length)));
      } else {
        const sections = draft ? [{
          label: draft.status === "pending" ? "Reopen this decision?" : "Dismiss this decision?",
          body: `${d.question}\n\nThis changes its status; it does not answer the question.`,
        }] : this.detailSections(d);
        out.push(...this.viewport(this.sections(sections, w), rows));
      }
    }
    return [...out.slice(0, height - bottom.length), ...bottom].map(fit);
  }
}
