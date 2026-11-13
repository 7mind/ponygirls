import { randomUUID } from 'node:crypto';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createBuiltinCheckerRegistry } from './src/memory-checks.ts';
import { createMemoryTool } from './src/memory-tools.ts';
import { MemoryScopeEpoch, nativeMemoryRuntime } from './src/memory-runtime.ts';
import { stateOnBranch } from './src/state.ts';

export function registerAuditMemory(pi: ExtensionAPI): void {
  const epoch = new MemoryScopeEpoch(randomUUID());
  pi.registerTool(createMemoryTool({
    pi,
    runtime: nativeMemoryRuntime(),
    registry: createBuiltinCheckerRegistry(),
    isInquiryActive: ctx => {
      const state = stateOnBranch(ctx.sessionManager.getBranch());
      return state !== null && state.pending !== null;
    },
    scopeKey: ctx => epoch.key(ctx.sessionManager.getSessionId()),
  }));
  pi.on('session_start', () => epoch.advance());
  pi.on('session_tree', () => epoch.advance());
  pi.on('session_shutdown', () => epoch.advance());
}

export default registerAuditMemory;
