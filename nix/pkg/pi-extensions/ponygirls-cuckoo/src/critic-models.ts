import type { Api, Model } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { CuckooNetworkServices } from './network-services.ts';
import type { TaskModelBinding } from './task-consent.ts';
import {
  criticSdkConfigurationDigest,
  type CriticSdkBounds,
  type CriticSdkConfiguration,
} from './experiments/critic-sdk-client.ts';
import {
  reflectionTextDigest,
  type CriticModelIdentity,
} from './experiments/reflection-critic.ts';

export interface CriticSelection {
  readonly binding: TaskModelBinding;
  readonly model: CriticModelIdentity;
  readonly configuration: CriticSdkConfiguration;
}

function freezeTree(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
}

function expectedURL(
  model: Model<Api>,
  services: CuckooNetworkServices,
): string {
  if (
    typeof model.baseUrl !== 'string' ||
    model.baseUrl.length === 0 ||
    model.baseUrl.length > 4096
  ) {
    throw new Error('Critic requires a configured bounded base URL');
  }

  const base = new URL(model.baseUrl);
  if (
    base.username !== '' ||
    base.password !== '' ||
    base.search !== '' ||
    base.hash !== ''
  ) {
    throw new Error(
      'Critic base URL must not contain credentials, query or fragment',
    );
  }

  const loopback =
    services.embeddingTransportPolicy === 'owned-loopback-http' &&
    base.protocol === 'http:' &&
    ['127.0.0.1', '[::1]'].includes(base.hostname);

  if (base.protocol !== 'https:' && !loopback) {
    throw new Error(
      'Critic requires HTTPS or explicitly injected owned-loopback transport',
    );
  }

  const normalized = base.href.replace(/\/+$/, '');
  let url: string;

  if (model.api === 'openai-completions') {
    url = `${normalized}/chat/completions`;
  } else if (model.api === 'openai-responses') {
    url = `${normalized}/responses`;
  } else if (normalized.endsWith('/codex/responses')) {
    url = normalized;
  } else if (normalized.endsWith('/codex')) {
    url = `${normalized}/responses`;
  } else {
    url = `${normalized}/codex/responses`;
  }

  if (url.length > 4096) {
    throw new Error('Critic request URL exceeds its bound');
  }
  return new URL(url).href;
}

function selection(
  modelValue: Model<Api>,
  services: CuckooNetworkServices,
): CriticSelection {
  const model = structuredClone(modelValue);
  freezeTree(model);

  if (
    model.api === 'pi-virtual' ||
    ![
      'openai-completions',
      'openai-responses',
      'openai-codex-responses',
    ].includes(model.api)
  ) {
    throw new Error('Unsupported critic API');
  }

  if (
    [
      model.id,
      model.provider,
      model.name,
      model.api,
      model.baseUrl,
    ].some(value => /anthropic|claude/i.test(value))
  ) {
    throw new Error('Prohibited critic binding');
  }

  if (
    model.id.length === 0 ||
    model.id.length > 128 ||
    model.provider.length === 0 ||
    model.provider.length > 128
  ) {
    throw new Error('Critic catalog identity exceeds its bound');
  }

  if (!Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1) {
    throw new Error('Invalid critic output capacity');
  }

  if (model.reasoning) {
    if (model.api === 'openai-completions') {
      throw new Error('Reasoning completions are unsupported');
    }

    const off = model.thinkingLevelMap === undefined
      ? undefined
      : model.thinkingLevelMap.off;

    if (off !== undefined && off !== 'none' && off !== 'off') {
      throw new Error('Critic has no supported native off setting');
    }
  }

  const url = expectedURL(model, services);
  const bounds: CriticSdkBounds = Object.freeze({
    maxPayloadBytes: 100000,
    maxTransportBytes: 1000000,
    maxOutputChars: 8000,
    maxOutputBytes: 32000,
    maxOutputTokens: Math.min(2000, model.maxTokens),
    deadlineMs: 30000,
    maxEvents: 10000,
  });

  const configuration: CriticSdkConfiguration = Object.freeze({
    physicalModel: model,
    transportConfigurationDigest: reflectionTextDigest(JSON.stringify([
      'cuckoo-task-critic-sdk-v1',
      'pinned-native-registry',
      services.embeddingTransportPolicy,
      'one-exact-url/no-redirect/no-retry',
    ])),
    requestUrlDigest: reflectionTextDigest(url),
    bounds,
  });

  const configurationDigest = criticSdkConfigurationDigest(configuration);
  const identity: CriticModelIdentity = Object.freeze({
    id: model.id,
    configurationDigest,
  });

  const binding: TaskModelBinding = Object.freeze({
    id: reflectionTextDigest(JSON.stringify([model.provider, model.id])),
    label: `${model.provider}/${model.id}`,
    destination: url,
    digest: configurationDigest,
  });

  return Object.freeze({ binding, model: identity, configuration });
}

export function sameCriticBinding(
  left: TaskModelBinding,
  right: TaskModelBinding,
): boolean {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.destination === right.destination &&
    left.digest === right.digest
  );
}

export function criticSelections(
  ctx: ExtensionContext,
  services: CuckooNetworkServices,
): readonly CriticSelection[] {
  const scoped = new Set(ctx.scopedModels.map(item =>
    JSON.stringify([item.model.provider, item.model.id])));

  const result: CriticSelection[] = [];
  const seen = new Set<string>();

  for (const model of ctx.modelRegistry.getAvailable()) {
    const key = JSON.stringify([model.provider, model.id]);
    if (scoped.size !== 0 && !scoped.has(key)) continue;

    let value: CriticSelection;
    try {
      value = selection(model, services);
    } catch {
      continue;
    }

    if (seen.has(value.binding.id)) {
      throw new Error('Ambiguous critic catalog identity');
    }

    seen.add(value.binding.id);
    result.push(value);

    if (result.length > 1000) {
      throw new Error(
        'Critic catalog exceeds selection bound; configure scoped models',
      );
    }
  }

  return Object.freeze(result);
}

export function criticSelectionFor(
  ctx: ExtensionContext,
  services: CuckooNetworkServices,
  binding: TaskModelBinding,
): CriticSelection {
  const scoped = new Set(ctx.scopedModels.map(item =>
    JSON.stringify([item.model.provider, item.model.id])));

  for (const model of ctx.modelRegistry.getAvailable()) {
    const catalogKey = JSON.stringify([model.provider, model.id]);
    if (reflectionTextDigest(catalogKey) !== binding.id) continue;

    if (scoped.size !== 0 && !scoped.has(catalogKey)) {
      throw new Error('Critic model is no longer in scoped models');
    }

    const current = selection(model, services);
    if (!sameCriticBinding(current.binding, binding)) {
      throw new Error('Approved critic catalog configuration changed');
    }
    return current;
  }

  throw new Error('Approved critic model is no longer available');
}
