# Field presentation

`document.fields` remains arbitrary, lossless JSON. This convention changes
presentation only; it does not introduce a new storage schema or execute
stored content. Existing records require no migration.

The detail view displays each top-level property separately. Plain strings
remain literal text, including line breaks; numbers display their exact
decimal text without conversion to JavaScript floating point. Booleans and
null have distinct labels. Objects and arrays display indented JSON with
syntax colours. A scalar or array at the root appears as one value. Empty
objects have no fields. History and comparison views use the same renderer.
The complete original JSON remains available under **Raw JSON**.

## Editing

Records with recognized typed nodes open in **Typed content** mode. Each
Markdown, code, or text node has a content textarea and an optional live
preview using the same inert renderer as the detail view. Code nodes include
a language selector; an existing unlisted language remains intact. Use
**Raw JSON** to add fields, change node types, set an unlisted language, or
edit ordinary fields and metadata. Root typed nodes are editable too.

Switching modes preserves the draft. Typed edits retain unrelated properties
and exact numeric tokens, including large integers and precise decimals.
Raw JSON is validated on each change: an inline alert contains the parser's
error and position, the textarea is marked invalid, and saving or retrying a
conflicted save is disabled until the JSON is valid. Invalid text is retained
so it can be corrected. Cancel discards the draft; save creates an attributed
revision with the existing CAS checks.

The browser and server share the domain JSON codec. Native JSON parsing
preserves prototype-named keys such as `__proto__`, while source-context
revival materializes every numeric token as a `LosslessNumber`. Runtimes
must support `JSON.parse` reviver source context; missing support is an
explicit error, never a conversion through rounded numbers. The pinned
lossless-json validator and serializer remain in use.

## Typed nodes

Use these exact shapes directly under `fields`:

```json
{
  "skill_name": "verify-release",
  "skill": {
    "type": "md",
    "content": "---\nname: verify-release\ndescription: Verify a release artifact\n---\n# Verify a release\n\n```bash\nsha256sum artifact.tar.gz\n```\n"
  },
  "snippet": {
    "type": "code",
    "language": "nix",
    "content": "{ pkgs }: { packages = [ pkgs.git ]; }"
  },
  "transcript": {
    "type": "text",
    "content": "Literal preformatted text; **no Markdown interpretation**."
  }
}
```

- `md`: render Markdown headings, lists, links, tables, and fenced code.
  Leading YAML frontmatter is highlighted separately. Preserve the complete
  source in `content`, including frontmatter and trailing newlines; it is
  available under **Markdown source**.
- `code`: `language` is required and nonempty. Use lowercase identifiers,
  such as `bash`, `nix`, `scala`, `typescript`, `javascript`, `python`, `json`,
  or `yaml`. The UI includes Lowlight's common languages plus Nix and Scala;
  registered aliases such as `ts`, `js`, and `sh` also work. Unknown languages
  display the complete literal code with an unsupported-language notice.
- `text`: literal preformatted text, with no Markdown interpretation.

A typed node contains exactly the keys shown. Put names, triggers,
filenames, provenance, rationale, and other metadata in sibling properties.
Unknown types, malformed typed nodes, and nodes with additional keys display
complete JSON with a notice rather than hiding data. Recognition applies to
top-level field values, or a typed node used as the whole `fields` value;
typed-looking objects nested inside ordinary objects remain JSON.
At the root, an unrecognized object remains a collection of top-level fields.

## Agent storage rules

Save a proposed complete SKILL.md in `fields.skill` using the `md` shape.
Store its name in `fields.skill_name`, triggers in `fields.triggers`, and
rationale/evidence in sibling fields. Include a language on code fences in
Markdown; use the `code` shape for standalone snippets. Plain strings are
never guessed to be Markdown or code. Leave numeric facts as JSON numbers.
Verify the persisted content through `get`, following the existing CAS,
privacy, and accounting rules. A skill draft remains inert until a separate
explicit installation action.

## Rendering boundary

Markdown uses [react-markdown](https://github.com/remarkjs/react-markdown)
with GFM support and HTML disabled. Code uses
[Lowlight](https://github.com/wooorm/lowlight) syntax trees rendered as React
text and spans, without inserting HTML. No code is executed. Unsafe link
protocols are removed; links open with `noopener noreferrer`. Images are
represented by text and an explicit link, with no automatic image request.
Colours follow the application's system light/dark theme.
