import assert from 'node:assert/strict';
import type { ThemePreference, ThemeSnapshot } from '../src/theme.ts';
export interface ThemeDriver {
  snapshot(): Promise<ThemeSnapshot>;
  choose(preference: ThemePreference): Promise<void>;
  system(dark: boolean): Promise<void>;
  saved(): Promise<string | null>;
  external(preference: string | null): Promise<void>;
}
export async function themeBehaviorContract(driver: ThemeDriver): Promise<void> {
  assert.deepEqual(await driver.snapshot(), { preference: 'system', resolved: 'light', persistence: 'available' });
  await driver.choose('dark'); assert.equal(await driver.saved(), 'dark');
  await driver.system(true); await driver.system(false); assert.deepEqual(await driver.snapshot(), { preference: 'dark', resolved: 'dark', persistence: 'available' });
  await driver.choose('system'); assert.equal(await driver.saved(), 'system'); assert.equal((await driver.snapshot()).resolved, 'light');
  await driver.system(true); assert.equal((await driver.snapshot()).resolved, 'dark'); await driver.system(false); assert.equal((await driver.snapshot()).resolved, 'light');
  await driver.external('light'); assert.deepEqual(await driver.snapshot(), { preference: 'light', resolved: 'light', persistence: 'available' });
  await driver.system(true); assert.equal((await driver.snapshot()).resolved, 'light');
  await driver.external(null); assert.deepEqual(await driver.snapshot(), { preference: 'system', resolved: 'dark', persistence: 'available' });
  await driver.external('invalid'); assert.deepEqual(await driver.snapshot(), { preference: 'system', resolved: 'dark', persistence: 'invalid' }); assert.equal(await driver.saved(), 'invalid');
  await driver.choose('light'); assert.deepEqual(await driver.snapshot(), { preference: 'light', resolved: 'light', persistence: 'available' }); assert.equal(await driver.saved(), 'light');
}
