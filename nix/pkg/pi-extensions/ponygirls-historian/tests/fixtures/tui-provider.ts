import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';

export default function (pi: ExtensionAPI): void {
  pi.registerProvider('historian-fixture', {
    api: 'openai-completions', apiKey: 'synthetic-fixture-only', baseUrl: 'http://fixture.invalid',
    models: ['main', 'journal'].map(id => ({ id, name: `Fixture ${id}`, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 8192 })),
    streamSimple(model, context, options) {
      let text = 'Synthetic assistant response; no external provider contacted.';
      if (model.id === 'journal') {
        const user = context.messages.find(message => message.role === 'user');
        if (user === undefined || user.role !== 'user') throw new Error('Missing synthetic journal input');
        const body = typeof user.content === 'string' ? user.content : user.content.map(block => block.type === 'text' ? block.text : '').join('');
        const payload = JSON.parse(body) as { evidence: Array<{ ref: string; text: string }> };
        const selected = payload.evidence.find(evidence => evidence.text.includes('UI_EXPERIMENT'));
        text = JSON.stringify({ proposals: selected === undefined ? [] : [{ episodeId: null, expectedRevision: 0, title: 'UI experiment', kind: 'experiment', status: 'ongoing',
          claims: [{ section: 'objective', basis: 'reported', text: 'Synthetic UI evidence', evidence: [selected.ref] }] }] });
      }
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const aborted = options !== undefined && options.signal !== undefined && options.signal.aborted;
        const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text }], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: aborted ? 'aborted' : 'stop', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        if (aborted) { message.errorMessage = 'Synthetic request cancelled'; stream.push({ type: 'error', reason: 'aborted', error: message }); }
        else stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
      });
      return stream;
    },
  });
}
