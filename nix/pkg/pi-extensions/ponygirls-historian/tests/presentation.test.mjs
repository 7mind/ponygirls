import assert from 'node:assert/strict';
import test from 'node:test';
import { styleHistorianStatus, styleHistorianJournal } from '../src/presentation.ts';

const theme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: text => `<bold>${text}</bold>` };
test('status separates groups and gives errors, coverage and enabled state distinct semantics', () => {
  const text = 'Historian ON (session)\nProject: /project\nActivity: idle\nError: provider timeout\nMarkdown projection error: none\nCoverage: not capturing';
  const styled = styleHistorianStatus(text, theme);
  assert.match(styled, /<success>Historian ON/);
  assert.match(styled, /\n\n<accent>Project:/);
  assert.match(styled, /<error>provider timeout/);
  assert.match(styled, /<muted>none/);
  assert.match(styled, /<warning>not capturing/);
  assert.match(styleHistorianStatus('Historian OFF (default)', theme), /<muted>Historian OFF/);
  assert.match(styleHistorianStatus('Historian ERROR: invalid preferences', theme), /<error>Historian ERROR/);
});
test('journal styling preserves every evidence and qualification line', () => {
  const text = '# Historian project journal\n\n## Experiment — ongoing\nEpisode e, revision 2\n### objective (reported)\nA claim\n- Evidence ref: session s, entry x, SHA-256 digest\n  - Coverage: truncated';
  const styled = styleHistorianJournal(text, theme);
  assert.equal(styled.replace(/<\/?\w+>/g, ''), text);
  assert.match(styled, /<accent>### objective \(reported\)/);
  assert.match(styled, /<muted>- Evidence/);
  assert.match(styled, /<warning>  - Coverage:/);
});
