import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { featureActivation, type FeatureId } from './features.ts';
import { CuckooPreferences, type EffectivePreferences } from './preferences.ts';
import { createBuiltinCheckerRegistry } from './memory-checks.ts';
import { createMemoryTool, type MemoryToolInput } from './memory-tools.ts';
import { MemoryScopeEpoch, nativeMemoryRuntime } from './memory-runtime.ts';
import { stateOnBranch } from './state.ts';

/** A tool Cuckoo declares to the model only while the settings allow it. */
interface FeatureTool { readonly name: string; readonly allowed: (settings: EffectivePreferences) => boolean }

export class CuckooFeatures {
  private readonly pi: ExtensionAPI;
  private readonly preferences: CuckooPreferences;
  private readonly epoch: MemoryScopeEpoch;
  private readonly ownerEpoch: MemoryScopeEpoch;
  private readonly tools: FeatureTool[] = [];
  private previousAllowed = new Set<string>();
  private configurationIdentity: string | null = null;
  private ownerSession: string | null = null;
  private alive = false;
  private abort = new AbortController();

  constructor(pi: ExtensionAPI, preferences: CuckooPreferences, nonce: string) {
    this.pi = pi; this.preferences = preferences; this.epoch = new MemoryScopeEpoch(nonce);
    this.ownerEpoch = new MemoryScopeEpoch(`${nonce}:owner`);
    this.registerTool(createMemoryTool({
      pi, runtime: nativeMemoryRuntime(), registry: createBuiltinCheckerRegistry(),
      isInquiryActive: ctx => this.inquiryActive(ctx),
      assertActionAllowed: (ctx, action) => this.requireMemoryAction(ctx, action),
      scopeKey: ctx => this.scopeKey(ctx),
      scopeSignal: ctx => this.signal(ctx),
    }), ['evidence', 'corrections', 'verifiers', 'reader']);
  }

  registerTool<Parameters extends TSchema, Details, State>(tool: ToolDefinition<Parameters, Details, State>, features: readonly FeatureId[]): void {
    if (features.length === 0) throw new Error('Invalid Cuckoo feature-tool registration');
    const required = [...features];
    this.register(tool, settings => required.some(id => featureActivation(settings.enabled, settings.features, id).activeBySettings));
  }

  /** A tool that belongs to Cuckoo itself, not to a feature: declared whenever automatic mode is on. */
  registerEnabledTool<Parameters extends TSchema, Details, State>(tool: ToolDefinition<Parameters, Details, State>): void {
    this.register(tool, settings => settings.enabled);
  }

  private register<Parameters extends TSchema, Details, State>(tool: ToolDefinition<Parameters, Details, State>, allowed: FeatureTool['allowed']): void {
    if (this.tools.some(item => item.name === tool.name)) throw new Error('Invalid Cuckoo feature-tool registration');
    this.tools.push({ name: tool.name, allowed });
    this.pi.registerTool({ ...tool, defaultActive: false });
  }

  private invalidate(): void {
    this.epoch.advance();
    this.abort.abort();
    this.abort = new AbortController();
  }

  start(ctx: ExtensionContext): void {
    this.ownerEpoch.advance();
    this.invalidate();
    this.ownerSession = ctx.sessionManager.getSessionId();
    this.alive = true;
    this.configurationIdentity = null;
    this.previousAllowed.clear();
  }

  navigate(ctx: ExtensionContext): void {
    this.requireOwner(ctx);
    this.ownerEpoch.advance();
    this.invalidate();
  }

  shutdown(): void {
    this.ownerEpoch.advance();
    this.invalidate();
    this.alive = false;
    this.ownerSession = null;
    this.select(new Set());
  }

  private requireOwner(ctx: ExtensionContext): void {
    if (!this.alive || this.ownerSession !== ctx.sessionManager.getSessionId()) throw new Error('Cuckoo feature scope is no longer active');
  }

  inquiryActive(ctx: ExtensionContext): boolean {
    const state = stateOnBranch(ctx.sessionManager.getBranch());
    return state !== null && state.pending !== null;
  }

  requireOrdinaryWork(ctx: ExtensionContext): void {
    if (this.inquiryActive(ctx)) throw new Error('Cuckoo inquiry requires JSON only; feature access is blocked');
    this.requireOwner(ctx);
  }

  refresh(ctx: ExtensionContext): EffectivePreferences {
    this.requireOwner(ctx);
    let settings: EffectivePreferences;
    try { settings = this.preferences.read(ctx).effective; }
    catch (error) { this.invalidate(); this.configurationIdentity = null; this.select(new Set()); throw error; }
    const identity = JSON.stringify([settings.enabled, settings.features]);
    if (this.configurationIdentity !== null && identity !== this.configurationIdentity) this.invalidate();
    this.configurationIdentity = identity;
    const allowed = new Set(this.tools.filter(tool => tool.allowed(settings)).map(tool => tool.name));
    this.select(allowed);
    return settings;
  }

  private select(allowed: Set<string>): void {
    const before = this.pi.getActiveTools();
    const selected = new Set(before);
    for (const tool of this.tools) {
      if (!allowed.has(tool.name)) selected.delete(tool.name);
      else if (!this.previousAllowed.has(tool.name)) selected.add(tool.name);
    }
    this.previousAllowed = allowed;
    if (selected.size !== before.length || before.some(name => !selected.has(name))) this.pi.setActiveTools([...selected]);
  }

  /** Ordinary work in a session where automatic mode is on: what a tool registered with `registerEnabledTool` needs. `unavailable` names what is refused otherwise. */
  requireEnabled(ctx: ExtensionContext, unavailable: string): EffectivePreferences {
    this.requireOrdinaryWork(ctx);
    const settings = this.refresh(ctx);
    if (!settings.enabled) throw new Error(`${unavailable}: Cuckoo automatic mode is off`);
    return settings;
  }

  requireFeature(ctx: ExtensionContext, feature: FeatureId): EffectivePreferences {
    this.requireOrdinaryWork(ctx);
    return this.requireEnabledFeature(ctx, feature);
  }

  requireEnabledFeature(ctx: ExtensionContext, feature: FeatureId): EffectivePreferences {
    const settings = this.refresh(ctx);
    const state = featureActivation(settings.enabled, settings.features, feature);
    if (!state.activeBySettings) throw new Error(`Cuckoo ${feature} unavailable: ${state.reasons.join(', ')}`);
    return settings;
  }

  private requireMemoryAction(ctx: ExtensionContext, action: MemoryToolInput['action']): void {
    this.requireOrdinaryWork(ctx);
    const settings = this.refresh(ctx);
    let required: readonly FeatureId[];
    switch (action) {
      case 'metadata': case 'list-sources': case 'source-text': required = ['evidence', 'reader']; break;
      case 'task': case 'snapshot': case 'claim': required = ['evidence']; break;
      case 'correct': required = ['corrections']; break;
      case 'check': case 'checkers': required = ['verifiers']; break;
      case 'list-records': case 'inspect': case 'snapshot-text': required = ['reader']; break;
      default: throw new Error('Unknown Cuckoo memory action');
    }
    if (!required.some(id => featureActivation(settings.enabled, settings.features, id).activeBySettings)) {
      throw new Error(`Cuckoo action ${action} is disabled; requires master ON and ${required.join(' or ')} with its dependencies`);
    }
  }

  ownerKey(ctx: ExtensionContext): string {
    this.requireOwner(ctx);
    return this.ownerEpoch.key(ctx.sessionManager.getSessionId());
  }

  scopeKey(ctx: ExtensionContext): string {
    this.requireOwner(ctx);
    return this.epoch.key(ctx.sessionManager.getSessionId());
  }

  signal(ctx: ExtensionContext): AbortSignal {
    this.requireOwner(ctx);
    return this.abort.signal;
  }
}
