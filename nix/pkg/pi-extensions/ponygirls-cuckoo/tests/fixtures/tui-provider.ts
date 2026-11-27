import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';

const RECORD = ' The record now, as JSON: ';
const CLOSING = ' This request grants no new authority.';
interface QuotedRecord { objectives: { id: string; objective: string }[]; rules: { id: string; rule: string }[] }

export default function (pi: ExtensionAPI): void {
  pi.registerProvider('cuckoo-fixture', {
    api: 'openai-completions', apiKey: 'synthetic-fixture-only', baseUrl: 'http://fixture.invalid',
    models: [{ id: 'main', name: 'Cuckoo UI fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000 }],
    streamSimple(model, context, options) {
      const last = context.messages.at(-1);
      const inquiry = last !== undefined && JSON.stringify(last).includes('Restate me your objectives');
      const assistantCount = context.messages.filter(message => message.role === 'assistant').length;
      const tokens = assistantCount === 0 ? 20000 : 23000;
      // Standing questions arrive as a JSON array inside the inquiry text; answer each by id.
      const inquiryText = last === undefined ? '' : typeof last.content === 'string' ? last.content : last.content.map(part => part.type === 'text' ? part.text : '').join('\n');
      const asked = inquiry ? /Standing questions as JSON: (\[.*?\])\. Put the answers/s.exec(inquiryText) : null;
      const answers = asked === null ? {} : { answers: (JSON.parse(asked[1]) as { id: string }[]).map(question => ({ id: question.id, answer: `Synthetic answer to ${question.id}; nothing was verified.` })) };
      // The inquiry ends with the numbered record: an entry the record holds is restated under its ID, any other is new (null).
      const record = inquiry ? JSON.parse(inquiryText.slice(inquiryText.indexOf(RECORD, inquiryText.indexOf(CLOSING)) + RECORD.length)) as QuotedRecord : { objectives: [], rules: [] };
      const objectiveId = (title: string): string | null => { const found = record.objectives.find(item => item.objective === title); return found === undefined ? null : found.id; };
      const ruleId = (rule: string): string | null => { const found = record.rules.find(item => item.rule === rule); return found === undefined ? null : found.id; };
      const text = inquiry ? JSON.stringify({ ...answers,
        objectives: [{ objective: 'Ship Cuckoo', progress: 'Synthetic checkpoint preserved', issues: ['A decoder defect needs correction', 'Waiting for access approval', 'Serial checks limit progress'], eta: 'Unknown: checks pending' },
          { objective: 'Verify UI', progress: 'Badge and report under test', issues: [], eta: 'Unknown: manual checks pending' }].map(item => ({ id: objectiveId(item.objective), ...item })),
        rules: [{ rule: 'Show mockups before implementation.', source: 'user', scope: 'This UI change' }, { rule: 'Preserve cadence behavior.', source: 'assistant', scope: 'This change only' }].map(item => ({ id: ruleId(item.rule), ...item })) }) : 'Synthetic work response. No external provider contacted.';
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
