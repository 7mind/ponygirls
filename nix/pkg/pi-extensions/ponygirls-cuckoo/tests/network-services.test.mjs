import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeEncoderProfiles, encoderBinding, encoderIdentity, FileEncoderProfiles, nativeNetworkServices } from '../src/network-services.ts';

const profile = Object.freeze({ id: 'owned-encoder', label: 'Synthetic profile', url: 'https://synthetic.invalid/v1/embeddings', model: 'synthetic-embeddings', version: 'configured-version', dimensions: 4, normalization: 'unit', credentialEnv: 'SYNTHETIC_EMBEDDING_CREDENTIAL' });

test('global encoder profile parsing is strict and stores references, never inline credentials', () => {
  const decoded = decodeEncoderProfiles({ version: 1, encoders: [profile] });
  assert.deepEqual(decoded, [profile]); assert.ok(Object.isFrozen(decoded)); assert.ok(Object.isFrozen(decoded[0]));
  for (const patch of [
    { url: 'http://127.0.0.1/v1/embeddings' }, { url: 'https://user:pass@synthetic.invalid/v1/embeddings' },
    { url: 'https://synthetic.invalid/v1/embeddings#fragment' }, { dimensions: 0 }, { normalization: 'guessed' },
    { credentialEnv: 'secret-key-literal' }, { credentialEnv: '!command' }, { credential: 'inline' }, { extra: true },
  ]) assert.throws(() => decodeEncoderProfiles({ version: 1, encoders: [{ ...profile, ...patch }] }));
  assert.throws(() => decodeEncoderProfiles({ version: 2, encoders: [profile] }));
  assert.throws(() => decodeEncoderProfiles({ version: 1, encoders: [profile, profile] }));
  assert.throws(() => decodeEncoderProfiles({ version: 1, encoders: [profile], approvals: [] }));
});

test('encoder binding and identity change with every material profile or transport setting', () => {
  const identity = encoderIdentity(profile, 'https'), binding = encoderBinding(profile, 'https');
  assert.equal(binding.id, profile.id); assert.equal(binding.destination, profile.url); assert.equal(Object.isFrozen(identity), true);
  assert.match(identity.implementationDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(binding.digest, /^sha256-utf16le:[a-f0-9]{64}$/);
  assert.deepEqual(encoderIdentity({ ...profile }, 'https'), identity);
  for (const changed of [
    { ...profile, label: 'Changed label' }, { ...profile, url: 'https://synthetic.invalid/other' },
    { ...profile, model: 'other-model' }, { ...profile, version: 'new-version' },
    { ...profile, dimensions: 8 }, { ...profile, normalization: 'raw' },
    { ...profile, credentialEnv: 'OTHER_SYNTHETIC_CREDENTIAL' },
  ]) assert.notEqual(encoderBinding(changed, 'https').digest, binding.digest);
  assert.notEqual(encoderBinding(profile, 'owned-loopback-http').digest, binding.digest);
});

test('missing profiles are explicitly unconfigured; malformed existing files are not defaults', t => {
  const root = mkdtempSync(join(tmpdir(), 'cuckoo-network-profiles-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new FileEncoderProfiles(join(root, 'cuckoo-encoders.json'));
  assert.deepEqual(store.read(), []);
  writeFileSync(store.path, JSON.stringify({ version: 1, encoders: [profile] }));
  assert.deepEqual(store.read(), [profile]);
  writeFileSync(store.path, 'not JSON'); assert.throws(() => store.read(), /Invalid Cuckoo encoder profiles/);
  const services = nativeNetworkServices(root);
  assert.equal(services.encoderProfiles.path, store.path);
  assert.equal(services.embeddingTransportPolicy, 'https');
  assert.equal(services.fetch, globalThis.fetch);
});
