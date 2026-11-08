import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';

export default function (pi: ExtensionAPI): void {
  pi.registerProvider('cuckoo-fixture', {
    api: 'openai-completions', apiKey: 'synthetic-fixture-only', baseUrl: 'http://fixture.invalid',
    models: [{ id: 'main', name: 'Cuckoo UI fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000 }],
    streamSimple(model, context, options) {
      const last = context.messages.at(-1);
      const inquiry = last !== undefined && JSON.stringify(last).includes('Restate me your objectives');
      const assistantCount = context.messages.filter(message => message.role === 'assistant').length;
      const tokens = assistantCount === 0 ? 20000 : 23000;
      const text = inquiry ? JSON.stringify({ objectives: [{ objective: 'Ship Cuckoo', progress: 'Synthetic checkpoint preserved' }, { objective: 'Verify UI', progress: 'Badge and report under test' }] }) : 'Synthetic work response. No external provider contacted.';
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const aborted = options !== undefined && options.signal !== undefined && options.signal.aborted;
        const message: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text }], api: model.api, provider: model.provider, model: model.id,
          usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: aborted ? 'aborted' : 'stop', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message });
        if (aborted) stream.push({ type: 'error', reason: 'aborted', error: message });
        else stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
      });
      return stream;
    },
  });
}
