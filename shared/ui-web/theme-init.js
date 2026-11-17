/* theme-init.js — blocking theme bootstrap; load as a classic <script> in <head> before the stylesheets.
 * Requires <html data-app="chronicle|haystack|manure"> in the markup. Always sets
 *   <html data-theme="light|dark" data-theme-choice="system|light|dark" data-theme-persistence="available|unavailable|invalid">
 * from localStorage["<app>.theme.preference"] (missing → system; unreadable → system + unavailable;
 * unknown value → system + invalid) and keeps data-theme in step with the OS while the choice is system.
 * Hosts change the choice with document.dispatchEvent(new CustomEvent('ui:theme-choice', { detail: 'dark' })):
 * it is applied at once and persisted when storage is writable (otherwise persistence becomes unavailable
 * and the choice lasts for this page). Other tabs follow through the storage event.
 * This script must be the only writer of these attributes.
 */
(() => {
  'use strict';
  const APPS = ['chronicle', 'haystack', 'manure'];
  const CHOICES = ['system', 'light', 'dark'];
  const CHOICE_EVENT = 'ui:theme-choice';
  const root = document.documentElement;
  const app = root.dataset.app;
  if (!APPS.includes(app)) throw new Error(`theme-init.js: <html data-app> must be one of ${APPS.join(', ')}, got ${String(app)}`);
  const key = `${app}.theme.preference`;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const read = () => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved === null) return { choice: 'system', persistence: 'available' };
      return CHOICES.includes(saved) ? { choice: saved, persistence: 'available' } : { choice: 'system', persistence: 'invalid' };
    } catch {
      return { choice: 'system', persistence: 'unavailable' };
    }
  };
  let state = read();
  const apply = () => {
    root.dataset.themeChoice = state.choice;
    root.dataset.themePersistence = state.persistence;
    root.dataset.theme = state.choice === 'system' ? (media.matches ? 'dark' : 'light') : state.choice;
  };
  apply();
  media.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    state = read();
    apply();
  });
  document.addEventListener(CHOICE_EVENT, event => {
    const choice = event.detail;
    if (!CHOICES.includes(choice)) throw new Error(`theme-init.js: ${CHOICE_EVENT} detail must be one of ${CHOICES.join(', ')}, got ${String(choice)}`);
    try {
      window.localStorage.setItem(key, choice);
      state = { choice, persistence: 'available' };
    } catch {
      state = { choice, persistence: 'unavailable' };
    }
    apply();
  });
})();
