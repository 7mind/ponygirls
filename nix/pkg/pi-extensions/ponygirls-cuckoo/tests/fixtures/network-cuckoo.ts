import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { registerCuckoo } from '../../index.ts';
import { FilePreferenceStore } from '../../src/preferences.ts';
import { nativeNetworkServices, type EncoderProfile } from '../../src/network-services.ts';

export default function (pi: ExtensionAPI): void {
  if (process.env.PI_CUCKOO_OWNED_NETWORK_TEST !== 'synthetic-owned-test') throw new Error('Owned synthetic test fixture only');
  const supplied = process.env.PI_CUCKOO_TEST_ENCODER_URL;
  if (supplied === undefined) throw new Error('Owned encoder URL required');
  const url = new URL(supplied);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Fixture encoder must be owned loopback HTTP');
  const profile: EncoderProfile = Object.freeze({ id: 'owned-http-encoder', label: 'Owned synthetic encoder', url: url.href,
    model: 'owned-http-embeddings', version: '1', dimensions: 2, normalization: 'unit', credentialEnv: 'FIXTURE_ONLY' });
  const agentDir = getAgentDir();
  const services = nativeNetworkServices(agentDir);
  registerCuckoo(pi, new FilePreferenceStore(join(agentDir, 'cuckoo.json')), {
    ...services,
    embeddingTransportPolicy: 'owned-loopback-http',
    encoderProfiles: { path: 'injected:owned-fixture', read: () => [profile] },
    credential: name => { if (name !== 'FIXTURE_ONLY') throw new Error('Unexpected fixture credential'); return 'synthetic-fixture-only'; },
    fetch(input, init) {
      const request = new Request(input, init); const target = new URL(request.url);
      if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw new Error('Fixture refuses non-owned-network traffic');
      return globalThis.fetch(request);
    },
  });
}
