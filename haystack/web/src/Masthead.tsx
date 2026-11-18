import { useEffect, useRef, useSyncExternalStore } from "react";
import { PRESET_ORDER, PRESETS, type Preset } from "./browse-state";
import { ConnectionIndicator } from "./Live";
import { focusMenu, menuKeys, useOverlay } from "./overlay";

// Shared design-system icons (shared/ui-web/icons.js), referenced from the emitted sprite.
export function UiIcon({ name, small }: { name: string; small?: boolean }) {
  return <svg className={small === true ? "icon icon-sm" : "icon"} aria-hidden="true"><use href={`/ui/icons.svg#${name}`} /></svg>;
}

function Brand() {
  return <a className="brand" href="#/browse"><span className="brand-mark"><UiIcon name="layers" /></span><span className="brand-name">haystack</span></a>;
}

type ThemeChoice = "system" | "light" | "dark";
const THEME_CHOICES: ReadonlyArray<{ choice: ThemeChoice; label: string; icon: string }> = [
  { choice: "system", label: "System", icon: "monitor" }, { choice: "light", label: "Light", icon: "sun" }, { choice: "dark", label: "Dark", icon: "moon" },
];
interface Theme { choice: ThemeChoice; resolved: "light" | "dark" }
// theme-init.js is the only writer of these attributes (shared/ui-web/README.md, "Theme").
// Server rendering (markup checks) has no document: the system choice, resolved light.
const SERVER_THEME = "system:light";
function readTheme(): string { const root = document.documentElement; return `${root.dataset.themeChoice ?? ""}:${root.dataset.theme ?? ""}`; }
function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-choice"] });
  return () => observer.disconnect();
}
function parseTheme(value: string): Theme {
  const [choice, resolved] = value.split(":");
  if (!THEME_CHOICES.some((entry) => entry.choice === choice) || (resolved !== "light" && resolved !== "dark"))
    throw new Error(`theme-init.js must set <html data-theme-choice data-theme>, got ${value}`);
  return { choice: choice as ThemeChoice, resolved };
}

function ThemeMenu() {
  const theme = parseTheme(useSyncExternalStore(subscribeTheme, readTheme, () => SERVER_THEME));
  const overlay = useOverlay();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (overlay.open) focusMenu(menu.current); }, [overlay.open]);
  const choose = (choice: ThemeChoice) => {
    document.dispatchEvent(new CustomEvent("ui:theme-choice", { detail: choice }));
    overlay.close(true);
  };
  return <div className="anchor" ref={overlay.anchor}>
    <button type="button" ref={overlay.trigger} className="btn btn-ghost btn-icon" aria-label="Theme" title="Theme" aria-haspopup="menu" aria-expanded={overlay.open}
      onClick={overlay.toggle}><UiIcon name={theme.resolved === "dark" ? "moon" : "sun"} /></button>
    {overlay.open && <div className="menu" role="menu" aria-label="Theme" ref={menu} onKeyDown={menuKeys}>
      {THEME_CHOICES.map((entry) => <button key={entry.choice} type="button" className="menu-item" role="menuitemradio" aria-checked={theme.choice === entry.choice}
        tabIndex={-1} onClick={() => choose(entry.choice)}><UiIcon name={entry.icon} />{entry.label}</button>)}
    </div>}
  </div>;
}

export interface Identity { userId: string; type: "human" | "agent"; activityProjectId: string; admin: boolean }

function UserMenu({ identity }: { identity: Identity }) {
  const overlay = useOverlay();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (overlay.open) focusMenu(menu.current); }, [overlay.open]);
  // The shared account module handles [data-account-settings] and [data-account-logout] clicks (document listener).
  // A link item is not closed on click (a disconnected link cannot navigate); the hashchange closes the menu.
  const link = { className: "menu-item", role: "menuitem", tabIndex: -1 } as const;
  const item = { ...link, onClick: () => overlay.close(false) } as const;
  return <div className="anchor" ref={overlay.anchor}>
    <button type="button" ref={overlay.trigger} className="user-button" aria-haspopup="menu" aria-expanded={overlay.open} onClick={overlay.toggle}>
      <span className="avatar" aria-hidden="true">{identity.userId.slice(0, 1)}</span><span className="user-name">{identity.userId}</span><UiIcon name="chevron-down" small />
    </button>
    {overlay.open && <div className="menu" role="menu" aria-label="Account" ref={menu} onKeyDown={menuKeys}>
      <div className="menu-label">Signed in as <strong>{identity.userId}</strong> · {identity.type} account</div>
      <div className="menu-label">Activity namespace <strong>{identity.activityProjectId}</strong></div>
      <button type="button" {...item} data-account-settings=""><UiIcon name="user" />Account settings</button>
      <button type="button" {...item} data-account-settings="tokens"><UiIcon name="key" />Access tokens</button>
      {identity.admin && <a {...link} href="#account/users"><UiIcon name="users" />Users</a>}
      <div className="menu-sep" role="separator" />
      <button type="button" {...item} data-account-logout=""><UiIcon name="arrow-right" />Sign out</button>
    </div>}
  </div>;
}

export interface NavState { active: Preset | null; inbox: { count: number; more: boolean } | null }

export function Masthead({ identity, nav }: { identity: Identity; nav: NavState }) {
  return <header className="masthead">
    <Brand />
    <nav className="nav" aria-label="Main navigation">{PRESET_ORDER.map((preset) => {
      const count = preset === "inbox" && nav.inbox !== null && nav.inbox.count > 0 ? nav.inbox : null;
      return <a key={preset} href={`#/${preset}`} aria-current={nav.active === preset ? "page" : undefined}
        aria-describedby={count === null ? undefined : "inbox-count-description"}>
        {PRESETS[preset].label}
        {count !== null && <span className="count count-attn" aria-hidden="true">{count.count}{count.more && "+"}</span>}
      </a>;
    })}</nav>
    {nav.inbox !== null && nav.inbox.count > 0 && <span id="inbox-count-description" hidden>
      {nav.inbox.count}{nav.inbox.more && " or more"} {nav.inbox.count === 1 && !nav.inbox.more ? "record needs" : "records need"} review</span>}
    <div className="masthead-end">
      <ConnectionIndicator />
      <ThemeMenu />
      <UserMenu identity={identity} />
    </div>
  </header>;
}

export function SignedOutMasthead() {
  return <header className="masthead"><Brand /><div className="masthead-end"><ThemeMenu /></div></header>;
}
