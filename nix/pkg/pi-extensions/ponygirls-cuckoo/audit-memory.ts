import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function auditMemoryMigrationNotice(pi: ExtensionAPI): void {
  pi.on('session_start', (_event, ctx) => {
    ctx.ui.notify('Cuckoo audit memory is now configured by /cuckoo settings. Remove the separate audit-memory.ts entry and load the Cuckoo directory or index.ts; this legacy entry enables no tools.', 'warning');
  });
}
