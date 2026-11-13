import assert from 'node:assert/strict';
import test from 'node:test';
import type { OperatorTextContext } from '../src/operator-text.ts';
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js';
import { confirmOperatorAction, operatorDisplay } from '../src/operator-text.ts';
import { PLAIN_THEME } from '../src/theme.ts';

type Factory = Parameters<OperatorTextContext['ui']['custom']>[0];
type FactoryArgs = Parameters<Factory>;
const keys = { matches(data: string, action: string): boolean {
  return action === 'tui.select.confirm' ? data === '\r' : action === 'tui.select.cancel' && data === '\x1b';
} } as unknown as FactoryArgs[2];

test('operator text is exactly reversible, including non-ASCII and whitespace', () => {
  const value = ' \t\n\u0000\ud800\u202eΩ😀' + ' '.repeat(500);
  const display = operatorDisplay(value);
  assert.match(display, /^[\x21-\x7e]+$/); assert.equal(JSON.parse(display), value);
});

for (const approve of [false, true]) test(`bounded operator approval requires explicit selection: ${approve}`, async () => {
  const ctx = { mode: 'tui', hasUI: true, ui: { async custom(factory: Factory) {
    let result: unknown;
    const panel = await factory({ terminal: { rows: 24 }, requestRender() {} } as unknown as FactoryArgs[0],
      PLAIN_THEME as unknown as FactoryArgs[1], keys, value => { result = value; });
    renderLayoutFrame(panel, 40, 14, () => {});
    const frame = renderLayoutFrame(panel, 40, 14, () => {}).lines;
    assert.equal(frame.length, 14); assert.match(frame[0], /Approve fixture/);
    assert.ok(frame.some(line => line.includes('[Cancel]')));
    assert.ok(frame.some(line => line.includes('confirm choice')));
    assert.equal(typeof panel.handleInput, 'function');
    panel.handleInput!('\x1b[F');
    assert.match(renderLayoutFrame(panel, 40, 14, () => {}).lines[0], /Approve fixture/);
    if (approve) panel.handleInput!('\x1b[C');
    panel.handleInput!('\r'); return result;
  } } } as unknown as OperatorTextContext;
  assert.equal(await confirmOperatorAction(ctx, 'Approve fixture', 'x'.repeat(5000), new AbortController().signal), approve);
});
