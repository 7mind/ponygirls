export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorTheme = 'light' | 'dark';
export type ThemePersistence = 'available' | 'unavailable' | 'invalid';
export interface ThemeSnapshot { readonly preference: ThemePreference; readonly resolved: ColorTheme; readonly persistence: ThemePersistence }
export interface ThemePreferenceStore { read(): string | null; write(preference: ThemePreference): void; subscribe(changed: () => void): () => void }
export interface SystemTheme { isDark(): boolean; subscribe(changed: () => void): () => void }
export interface ThemeTarget { apply(theme: ThemeSnapshot): void }
export const THEME_STORAGE_KEY = 'chronicle.theme.preference';
export function themePreference(value: string | null): ThemePreference | null { return value === null || value === 'system' ? 'system' : value === 'light' || value === 'dark' ? value : null; }
export function resolvedTheme(preference: ThemePreference, dark: boolean): ColorTheme { return preference === 'system' ? dark ? 'dark' : 'light' : preference; }

export class ThemeController {
  private value: ThemeSnapshot;
  private unsaved = false;
  private listeners = new Set<() => void>();
  constructor(private readonly store: ThemePreferenceStore, private readonly system: SystemTheme, private readonly target: ThemeTarget) {
    const saved = this.saved(); this.value = { ...saved, resolved: resolvedTheme(saved.preference, system.isDark()) }; target.apply(this.value);
  }
  getSnapshot = (): ThemeSnapshot => this.value;
  subscribe = (changed: () => void): (() => void) => { this.listeners.add(changed); return () => { this.listeners.delete(changed); }; };
  start(): () => void {
    const storage = this.store.subscribe(() => this.storageChanged());
    const media = this.system.subscribe(() => { if (this.value.preference === 'system') this.update(this.value.preference, this.value.persistence); });
    if (this.unsaved) this.update(this.value.preference, this.value.persistence); else this.storageChanged();
    return () => { storage(); media(); };
  }
  setPreference(preference: ThemePreference): void {
    try { this.store.write(preference); this.unsaved = false; } catch { this.unsaved = true; }
    this.update(preference, this.unsaved ? 'unavailable' : 'available');
  }
  private storageChanged(): void {
    const saved = this.saved();
    if (saved.persistence === 'unavailable') { this.update(this.value.preference, saved.persistence); return; }
    this.unsaved = false; this.update(saved.preference, saved.persistence);
  }
  private saved(): { preference: ThemePreference; persistence: ThemePersistence } {
    try { const preference = themePreference(this.store.read()); return preference === null ? { preference: 'system', persistence: 'invalid' } : { preference, persistence: 'available' }; }
    catch { return { preference: 'system', persistence: 'unavailable' }; }
  }
  private update(preference: ThemePreference, persistence: ThemePersistence): void {
    const resolved = resolvedTheme(preference, this.system.isDark());
    if (preference === this.value.preference && resolved === this.value.resolved && persistence === this.value.persistence) return;
    this.value = { preference, resolved, persistence }; this.target.apply(this.value); for (const listener of this.listeners) listener();
  }
}

export function browserTheme(window: Window, document: Document): ThemeController {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const store: ThemePreferenceStore = {
    read: () => window.localStorage.getItem(THEME_STORAGE_KEY),
    write: preference => window.localStorage.setItem(THEME_STORAGE_KEY, preference),
    subscribe: changed => { const listener = (event: StorageEvent) => { if (event.key === THEME_STORAGE_KEY || event.key === null) changed(); }; window.addEventListener('storage', listener); return () => window.removeEventListener('storage', listener); },
  };
  const system: SystemTheme = { isDark: () => media.matches, subscribe: changed => { media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); } };
  const target: ThemeTarget = { apply: theme => {
    const root = document.documentElement; root.dataset.theme = theme.resolved; root.dataset.themePreference = theme.preference; root.dataset.themePersistence = theme.persistence; root.style.colorScheme = theme.resolved; root.style.removeProperty('background-color');
    const color = window.getComputedStyle(root).getPropertyValue('--canvas').trim(), meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta !== null && color.length > 0) meta.content = color;
  } };
  return new ThemeController(store, system, target);
}
