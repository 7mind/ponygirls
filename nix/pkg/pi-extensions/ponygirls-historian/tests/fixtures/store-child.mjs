import { join } from 'node:path';
import { acquireSessionLock, JournalStore } from '../../src/store.ts';
import { evidenceFromEntry } from '../../src/evidence.ts';
const [mode, directory, owner] = process.argv.slice(2);
if (process.send === undefined) throw new Error('IPC required');
try {
  if (mode === 'lock') {
    const release = acquireSessionLock(directory, owner);
    process.on('message', () => { release(); process.disconnect(); });
    process.send({ ready: true });
  } else if (mode === 'commit') {
    const store = new JournalStore(join(directory, 'journal.sqlite'), '/synthetic-project');
    const evidence = evidenceFromEntry(owner, owner, { type: 'message', id: 'entry', parentId: null, timestamp: '2026-11-06T13:00:00Z', message: { role: 'user', content: `Run ${owner}`, timestamp: 1 } });
    store.capture(owner, true, [], [evidence], []);
    process.on('message', () => {
      store.commit(store.batch(owner), [{ episodeId: null, expectedRevision: 0, title: owner, kind: 'experiment', status: 'ongoing',
        claims: [{ section: 'objective', basis: 'reported', text: `Run ${owner}`, evidence: [evidence.ref] }] }],
      { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v1', usage: null });
      store.publishMarkdown(); store.close(); process.send({ committed: true }, () => process.disconnect());
    });
    process.send({ ready: true });
  } else throw new Error('Unknown fixture mode');
} catch (error) {
  process.send({ error: error.message }, () => { process.exitCode = 1; process.disconnect(); });
}
