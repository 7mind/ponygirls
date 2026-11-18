import { connectionConfig } from '../src/transport/browser.ts';
import type { ConnectionConfig } from '../src/transport/types.ts';
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
function isSetting(name: string): name is keyof ConnectionConfig { return Object.hasOwn(connectionConfig, name); }
/**
 * Connection settings of a fixture page: the production `connectionConfig`, except for the settings one page load names in its
 * query string (`harness.html?heartbeatInterval=2000`, built by `connectionTiming` in fixture.mjs). Unknown, repeated or
 * non-positive-integer settings fail the page load.
 */
export function fixtureConnectionConfig(search: string): ConnectionConfig {
  const config: ConnectionConfig = { ...connectionConfig }, named = new Set<string>();
  for (const [name, value] of new URLSearchParams(search)) {
    if (!isSetting(name)) throw new Error(`Unknown fixture connection setting '${name}'`);
    if (named.has(name)) throw new Error(`Repeated fixture connection setting '${name}'`);
    if (!POSITIVE_INTEGER.test(value)) throw new Error(`Fixture connection setting '${name}' must be a positive integer, got '${value}'`);
    named.add(name); config[name] = Number(value);
  }
  return config;
}
