import assert from "node:assert/strict";
import test from "node:test";
import { BackendRegistry } from "../src/backends.ts";
import { parseBackendWorker, type BackendRegistration } from "../src/backend-contract.ts";
import type { ResolvedModel } from "../src/types.ts";

export interface RegistryFixture {
  readonly registration: BackendRegistration;
  readonly selected: ResolvedModel;
  readonly unselected: ResolvedModel;
  dispose(): Promise<void>;
}

export function backendRegistryContract(name: string, create: () => Promise<RegistryFixture>): void {
  test(`BG ${name}: no claim, single claim, duplicate and owner-specific unregistration`, async () => {
    const fixture = await create();
    try {
      const registry = new BackendRegistry();
      assert.equal(registry.select(fixture.selected), null);
      const unregister = registry.register(fixture.registration);
      assert.equal(registry.select(fixture.selected), fixture.registration);
      assert.equal(registry.select(fixture.unselected), null);
      const descriptor = parseBackendWorker(fixture.registration.worker(fixture.selected));
      assert.equal(descriptor.backendId, fixture.registration.id);
      assert.throws(() => registry.register(fixture.registration), { code: "CONFLICT" });
      unregister();
      const replacement = { ...fixture.registration };
      const removeReplacement = registry.register(replacement);
      unregister();
      assert.equal(registry.select(fixture.selected), replacement);
      removeReplacement();
      assert.equal(registry.select(fixture.selected), null);
    } finally { await fixture.dispose(); }
  });

  test(`BG ${name}: multiple claims conflict and registry retirement revokes synchronously`, async () => {
    const fixture = await create();
    try {
      const registry = new BackendRegistry();
      registry.register(fixture.registration);
      const removeSecond = registry.register({ ...fixture.registration, id: `${fixture.registration.id}-conflict` });
      assert.throws(() => registry.select(fixture.selected), { code: "CONFLICT" });
      removeSecond();
      let revoked = false;
      registry.watch(fixture.registration, () => { revoked = true; });
      registry.retire();
      assert.equal(revoked, true);
      assert.equal(registry.select(fixture.selected), null);
      assert.throws(() => registry.register(fixture.registration), { code: "MODEL_UNAVAILABLE" });
    } finally { await fixture.dispose(); }
  });
}
