import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { themeBehaviorContract } from './theme-contract.ts';
import { ThemeController, resolvedTheme, themePreference, type ColorTheme, type SystemTheme, type ThemePreferenceStore, type ThemeTarget } from '../src/theme.ts';

class ThemeFixture {
  value: string | null = null; dark = false; readFails = false; writeFails = false; applied: ColorTheme[] = [];
  storageListeners = new Set<() => void>(); mediaListeners = new Set<() => void>();
  readonly store: ThemePreferenceStore = {
    read: () => { if (this.readFails) throw new Error('Storage denied'); return this.value; },
    write: preference => { if (this.writeFails) throw new Error('Storage quota'); this.value = preference; },
    subscribe: changed => { this.storageListeners.add(changed); return () => { this.storageListeners.delete(changed); }; },
  };
  readonly system: SystemTheme = { isDark: () => this.dark, subscribe: changed => { this.mediaListeners.add(changed); return () => { this.mediaListeners.delete(changed); }; } };
  readonly target: ThemeTarget = { apply: theme => { this.applied.push(theme.resolved); } };
  controller(): ThemeController { return new ThemeController(this.store, this.system, this.target); }
  systemChanged(dark: boolean): void { this.dark = dark; for (const listener of this.mediaListeners) listener(); }
  externalPreference(value: string | null): void { this.value = value; for (const listener of this.storageListeners) listener(); }
}

test('theme preferences validate exact non-secret values and resolve System only through the device', () => {
  for (const [raw, expected] of [[null, 'system'], ['system', 'system'], ['light', 'light'], ['dark', 'dark'], ['', null], ['DARK', null], ['{"theme":"dark"}', null]] as const) assert.equal(themePreference(raw), expected);
  for (const dark of [false, true]) { assert.equal(resolvedTheme('system', dark), dark ? 'dark' : 'light'); assert.equal(resolvedTheme('light', dark), 'light'); assert.equal(resolvedTheme('dark', dark), 'dark'); }
});
test('theme control persists manual choices, ignores device changes in manual mode, and follows System live', () => {
  const fixture = new ThemeFixture(), controller = fixture.controller(), stop = controller.start(), changes: ColorTheme[] = [];
  const unsubscribe = controller.subscribe(() => changes.push(controller.getSnapshot().resolved));
  assert.deepEqual(controller.getSnapshot(), { preference: 'system', resolved: 'light', persistence: 'available' }); assert.equal(controller.getSnapshot(), controller.getSnapshot());
  controller.setPreference('dark'); assert.equal(fixture.value, 'dark'); const manual = controller.getSnapshot(); fixture.systemChanged(true); fixture.systemChanged(false); assert.equal(controller.getSnapshot(), manual);
  controller.setPreference('system'); fixture.systemChanged(true); fixture.systemChanged(false); assert.deepEqual(changes, ['dark', 'light', 'dark', 'light']);
  unsubscribe(); stop(); assert.equal(fixture.storageListeners.size, 0); assert.equal(fixture.mediaListeners.size, 0); fixture.systemChanged(true); assert.equal(controller.getSnapshot().resolved, 'light');
});
test('shared theme behavior contract · hand-written storage/device dummy', async () => {
  const fixture = new ThemeFixture(), controller = fixture.controller(), stop = controller.start();
  try { await themeBehaviorContract({ snapshot: async () => controller.getSnapshot(), choose: async preference => controller.setPreference(preference), system: async dark => fixture.systemChanged(dark), saved: async () => fixture.value, external: async preference => fixture.externalPreference(preference) }); }
  finally { stop(); }
});
test('unavailable persistence keeps an explicit tab-local choice without hiding read or write denial', () => {
  const fixture = new ThemeFixture(); fixture.readFails = true; fixture.writeFails = true; fixture.dark = true;
  const controller = fixture.controller(), stop = controller.start(); assert.deepEqual(controller.getSnapshot(), { preference: 'system', resolved: 'dark', persistence: 'unavailable' });
  controller.setPreference('light'); fixture.systemChanged(true); assert.deepEqual(controller.getSnapshot(), { preference: 'light', resolved: 'light', persistence: 'unavailable' }); assert.equal(fixture.value, null);
  fixture.readFails = false; fixture.writeFails = false; controller.setPreference('system'); assert.equal(controller.getSnapshot().persistence, 'available'); assert.equal(fixture.value, 'system'); stop();
});
test('theme startup observes preference changes before listeners attach', () => {
  const fixture = new ThemeFixture(), controller = fixture.controller(); fixture.value = 'dark'; const stop = controller.start(); assert.equal(controller.getSnapshot().preference, 'dark'); assert.equal(controller.getSnapshot().resolved, 'dark'); stop();
});
test('supported theme listener restart retains an unsaved tab-local preference and updates System from the current device', () => {
  const fixture = new ThemeFixture(); fixture.value = 'light'; fixture.writeFails = true;
  const controller = fixture.controller(), stop = controller.start(); controller.setPreference('dark'); stop(); fixture.systemChanged(true);
  const stopAgain = controller.start(); assert.deepEqual(controller.getSnapshot(), { preference: 'dark', resolved: 'dark', persistence: 'unavailable' });
  controller.setPreference('system'); stopAgain(); fixture.systemChanged(false); const stopSystem = controller.start(); assert.deepEqual(controller.getSnapshot(), { preference: 'system', resolved: 'light', persistence: 'unavailable' });
  fixture.readFails = true; fixture.externalPreference('dark'); assert.deepEqual(controller.getSnapshot(), { preference: 'system', resolved: 'light', persistence: 'unavailable' });
  fixture.readFails = false; fixture.externalPreference('dark'); assert.deepEqual(controller.getSnapshot(), { preference: 'dark', resolved: 'dark', persistence: 'available' }); stopSystem();
});
test('external prepaint initializer agrees with the theme policy, including denied and invalid persistence', () => {
  const source = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  for (const raw of [null, 'system', 'light', 'dark', 'invalid']) for (const dark of [false, true]) for (const denied of [false, true]) {
    const fixture = new ThemeFixture(); fixture.value = raw; fixture.dark = dark; fixture.readFails = denied; const expected = fixture.controller().getSnapshot();
    const root = { dataset: {} as Record<string, string>, style: { colorScheme: '', backgroundColor: '' } }, meta = { content: '' };
    runInNewContext(source, { document: { documentElement: root, querySelector: () => meta }, window: { get localStorage() { if (denied) throw new Error('Storage denied'); return { getItem: () => raw }; }, matchMedia: () => ({ matches: dark }) } });
    assert.deepEqual(root.dataset, { theme: expected.resolved, themePreference: expected.preference, themePersistence: expected.persistence }); assert.equal(root.style.colorScheme, expected.resolved); assert.equal(root.style.backgroundColor, expected.resolved === 'dark' ? '#242c37' : '#f1f5f9'); assert.equal(meta.content, root.style.backgroundColor);
  }
});
