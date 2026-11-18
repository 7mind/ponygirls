# shared/ui-web — dashboard design system

One design system for the Chronicle, Haystack and Manure dashboards (redesign spec
`docs/drafts/20261117-2130-dashboard-redesign-spec.md`, §1, §2, §7.1). No framework, no build step.

| File | Role |
|---|---|
| `tokens.css` | every colour, type size, space, size, radius, shadow and layer (`--*` custom properties), light and dark; the self-hosted Inter `@font-face` |
| `components.css` | shared components (§2.2 of the spec): shell, layout, buttons, fields, chips, tabs, query bar, tables, list states, cards, menus, dialogs, toasts, notices, auth pages |
| `theme-init.js` | blocking classic script: sets `<html data-theme data-theme-choice data-theme-persistence>`; contract in its header comment |
| `icons.js` | ES module: `icon(name, ...classes)` → inline SVG string, `ICON_NAMES`, `iconSprite()` → SVG sprite document |
| `fonts/` | `InterVariable.woff2` (Inter 4.1, upright variable, 352 240 bytes) and its SIL OFL 1.1 `LICENSE.txt` |
| `tests/census.mjs` | static conformance check (below) |

## Rules (spec §1, §2)

- One vertical scroller per view: the document (model A); only the Chronicle session page splits into panes (model B). No `max-height` lists, no `overflow` wrappers around tables, no inner horizontal scrollers.
- One list idiom: cursor-driven infinite loading with a counter and an explicit end marker; no numbered pages, no "Load more".
- Every colour, font size, spacing, radius and shadow comes from `tokens.css`. Nothing below `--text-xs` (12 px). Controls are `--control-h` (32 px); in-row actions at least `--control-h-sm` (28 px).
- Status is a dot + label or a chip, never colour alone. Errors are persistent inline notices; success is a toast; destructive actions use the in-app dialog — never `window.confirm`/`alert`.
- No inline `style=""` attributes or `<style>` elements (Manure CSP `style-src 'self'`): dynamic geometry goes through the CSSOM (`element.style.setProperty`).
- `<html data-app="chronicle|haystack|manure">` selects the accent ramp; nothing else is app-specific in this package.

What may **not** be added: colour literals outside `tokens.css`; font sizes, spacing, radii or shadows outside the token scale; sizes below 12 px; app-specific rules (they belong in the app's own view CSS); mockup helpers; new tokens without a light **and** dark value (the census enforces this).

## Cascade layer

Both stylesheets put their rules in the cascade layer `ui`. Unlayered host stylesheets (the app view CSS,
`account.css`) therefore always win over the shared rules, independent of selector specificity — the
app view CSS can override a component
without specificity tricks. Measured against the reference mockups (all 231 renders of the
redesign's reference mockups, which are not kept in the repository, original files vs. the same files in `@layer ui`), layering
changes exactly two declarations, both towards the value the per-app stylesheet states:
Haystack `.field-name` inside a card head (14 → 13 px) and Manure `.detail-progress` margin (12 → 8 px).

## Consumption

Order in every host: `tokens.css`, `components.css`, app view CSS, `account.css`.

- **Chronicle, Haystack**: the `sharedAssets` Vite plugin (`*/web/vite.config.ts`) serves the files in
  development and emits them in the build under `/ui/` (`/ui/tokens.css`, `/ui/components.css`,
  `/ui/theme-init.js`, `/ui/icons.svg` — generated from `iconSprite()` —, `/ui/fonts/InterVariable.woff2`,
  `/ui/fonts/LICENSE.txt`). Nix passes this directory as `UI_WEB_ROOT` (`nix/pkg/ui-web.nix`).
  React code references icons as `<svg className="icon"><use href="/ui/icons.svg#name"/></svg>`.
- **Manure**: `manure/web/dashboard/ui` is a symlink to this directory for development and tests; the
  package (`nix/pkg/manure/package.nix`) replaces it with a verbatim copy. The server allowlists
  `ui/tokens.css`, `ui/components.css`, `ui/theme-init.js`, `ui/icons.js`, `ui/fonts/InterVariable.woff2`
  (`manure/backend/src/main/scala/manure/Http.scala`). Vanilla code imports `./ui/icons.js`.
- The servers treat `/ui/*` as fixed-name entry points (no validators, `no-store`), like `account.js`.

### Activation state

The hosts link `tokens.css` and `components.css` as ordinary stylesheets; the shells and views of all three
apps are built on them. All three hosts run `/ui/theme-init.js`.
In Chronicle it is the only writer of the theme attributes: `src/theme.ts` keeps the existing control
and storage key (`chronicle.theme.preference`), changes the choice through the `ui:theme-choice` event
and fails fast if the attributes disagree with its state; `public/theme-init.js` only adds Chronicle's
prepaint canvas colour and `theme-color` from the resolved `data-theme`.

## Theme

`theme-init.js` stores the choice in `localStorage["<app>.theme.preference"]` (`system`, `light`, `dark`).
A host's theme menu dispatches `document.dispatchEvent(new CustomEvent('ui:theme-choice', { detail: 'dark' }))`
and reads the state back from the `<html>` attributes.

## Font

`fonts/InterVariable.woff2` and `fonts/LICENSE.txt` are byte copies of `web/InterVariable.woff2` and
`LICENSE.txt` from the Inter 4.1 release archive as fetched by the pinned nixpkgs `inter` package
(`inter.src`, `Inter-4.1.zip`, fixed-output hash `sha256-5vdKKvHAeZi6igrfpbOdhZlDX2/5+UvzlnCQV6DdqoQ=`);
the nixpkgs package itself ships only TTF files. SHA-256 of the WOFF2:
`693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`. Only the upright face is bundled;
italics are synthesised by the browser (the italic face would add 388 KB).

## Conformance census

```sh
node shared/ui-web/tests/census.mjs                       # components.css
node shared/ui-web/tests/census.mjs path/to/view.css …    # any app stylesheet
```

Checks `tokens.css` (every colour token has a dark value unless it is deliberately theme-invariant —
`--qr-fg`, `--qr-bg`; every app accent override exists in both themes; every reference resolves) and every
given file: every `var(--x)` is defined; no colour literal (hex, colour functions, named colours);
`font-size` is a type-scale token; margin/padding/gap use length tokens (`0`, `auto`, `1px` hairlines
excepted); `border-radius` uses radius tokens (`0`, `50%` excepted); `box-shadow` uses shadow/ring tokens
or a flat ring `[inset] 0 0 0 <w> var(--colour)`. Widths and heights are not checked. Exit status 1 lists
one violation per line.
