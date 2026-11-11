import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

const NORMAL_TEXT_CONTRAST = 4.5;
const CONTROL_CONTRAST = 3;
const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const TOKENS = ['canvas', 'surface', 'surface-raised', 'ink', 'muted', 'accent', 'on-accent', 'focus', 'border', 'selected', 'warning', 'warning-surface', 'error', 'error-surface', 'success'] as const;
type Token = typeof TOKENS[number];
interface ContrastPair { foreground: Token; background: Token; minimum: number }
interface ContrastObservation extends ContrastPair { ratio: number }
export interface ThemeObservation { scheme: string; canvas: string; ink: string; contrasts: ContrastObservation[] }

function rgb(hex: string): [number, number, number] {
  assert.match(hex, /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
  const expanded = hex.length === 4 ? '#' + [...hex.slice(1)].map(value => value + value).join('') : hex;
  return [1, 3, 5].map(index => Number.parseInt(expanded.slice(index, index + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  return rgb(hex).map(component => {
    const value = component / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * LUMINANCE_WEIGHTS[index]!, 0);
}
export async function checkTheme(page: Page, scheme: 'light' | 'dark'): Promise<ThemeObservation> {
  const observed = await page.evaluate(tokens => {
    const root = getComputedStyle(document.documentElement);
    return { scheme: root.colorScheme, canvas: root.backgroundColor, ink: root.color, tokens: tokens.map(name => ({ name, value: root.getPropertyValue(`--${name}`).trim() })) };
  }, TOKENS);
  assert.equal(observed.scheme, scheme);
  const color = (name: Token): string => {
    const value = observed.tokens.find(token => token.name === name);
    assert(value !== undefined);
    return value.value;
  };
  assert.equal(observed.canvas, `rgb(${rgb(color('canvas')).join(', ')})`);
  assert.equal(observed.ink, `rgb(${rgb(color('ink')).join(', ')})`);
  const pairs: ContrastPair[] = [];
  for (const background of ['canvas', 'surface', 'surface-raised', 'selected', 'warning-surface', 'error-surface'] as const) {
    for (const foreground of ['ink', 'muted'] as const) pairs.push({ foreground, background, minimum: NORMAL_TEXT_CONTRAST });
  }
  for (const [foreground, background] of [['warning', 'warning-surface'], ['error', 'error-surface'], ['on-accent', 'accent'], ['accent', 'surface'], ['success', 'surface']] as const) pairs.push({ foreground, background, minimum: NORMAL_TEXT_CONTRAST });
  for (const background of ['canvas', 'surface', 'surface-raised'] as const) {
    for (const foreground of ['border', 'focus'] as const) pairs.push({ foreground, background, minimum: CONTROL_CONTRAST });
  }
  const contrasts = pairs.map(pair => {
    const a = luminance(color(pair.foreground)); const b = luminance(color(pair.background));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert(ratio >= pair.minimum, `${scheme}: ${pair.foreground}/${pair.background} contrast ${ratio} < ${pair.minimum}`);
    return { ...pair, ratio };
  });
  return { scheme: observed.scheme, canvas: observed.canvas, ink: observed.ink, contrasts };
}

export async function checkNarrowLayout(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(geometry.scroll <= geometry.viewport, `Horizontal overflow ${geometry.scroll} > ${geometry.viewport}`);
}
