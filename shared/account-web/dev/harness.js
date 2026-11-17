// Controlled-route harness: builds a host-like page (masthead + main + account outlet, or the signed-out
// auth mount), installs the fake transport as window.fetch and then loads the production /account.js.
//   /?scenario=<name>&app=chronicle|haystack|manure&theme=light|dark&steps=0
// Sets <html data-harness-ready> once the scenario's state is on screen. Development and test scaffolding only.
import { baseFixture, createFakeAccountServer } from './fake-server.js';
import { SCENARIOS } from './scenarios.js';

const APPS = { chronicle: ['Chronicle', ['Archive', 'Search', 'Activity', 'Access', 'MCP']], haystack: ['Haystack', ['Browse', 'Inbox', 'Upstream', 'Skill drafts', 'Archive']], manure: ['Manure', ['Artifacts', 'Upload', 'CLI']] };
const MAX_FRAMES = 600;

const params = new URLSearchParams(window.location.search);
const scenarioName = params.get('scenario') ?? 'settings-tokens';
const scenario = SCENARIOS.get(scenarioName);
if (scenario === undefined) throw new Error(`Unknown harness scenario: ${scenarioName}`);
const app = params.get('app') ?? 'chronicle';
if (!(app in APPS)) throw new Error(`Unknown harness app: ${app}`);
const theme = params.get('theme') ?? 'light';
document.documentElement.dataset.app = app;
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.themeChoice = theme;

function element(tag, attributes, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
function masthead(signedIn) {
  const [name, nav] = APPS[app];
  const header = element('header', { class: 'masthead' }, element('a', { class: 'brand', href: '#' }, element('span', { class: 'brand-mark', 'aria-hidden': 'true' }, name.charAt(0)), name.toLowerCase()));
  if (signedIn) {
    header.append(element('nav', { class: 'nav', 'aria-label': 'Main navigation' }, ...nav.map(label => element('a', { href: `#/${label.toLowerCase().replace(/\s+/g, '-')}` }, label))));
  }
  const end = element('div', { class: 'masthead-end' }, element('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Theme' }, '◐'));
  if (signedIn) end.append(element('button', { class: 'user-button', type: 'button', 'data-account-settings': '' }, element('span', { class: 'avatar' }, 'a'), 'alice'));
  header.append(end);
  return header;
}

const fixture = baseFixture(app);
scenario.fixture(fixture);
const fake = createFakeAccountServer(fixture, call => { if (typeof window.__accountCall === 'function') window.__accountCall(call); });
window.__accountFake = fake;
window.fetch = fake.fetch;

if (window.location.hash === '' && scenario.hash !== '') window.history.replaceState(null, '', scenario.hash);
document.body.append(masthead(scenario.signedIn));
if (scenario.signedIn) {
  document.body.append(
    element('main', { id: 'main', class: 'page', 'data-host-main': '' }, element('h1', { class: 'page-title' }, 'Host view'), element('p', { class: 'muted' }, 'The dashboard renders its own views here.')),
    element('div', { 'data-account-outlet': '', 'data-account-user-id': fixture.user.id, hidden: '' }));
} else {
  document.body.append(element('main', { id: 'main', 'data-account-auth': '' }));
}

// Tiny DOM driver for scenario steps: waits a bounded number of animation frames, never a fixed time.
async function until(find, what) {
  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    const found = find();
    if (found !== null && found !== undefined) return found;
    await new Promise(resolve => window.requestAnimationFrame(resolve));
  }
  throw new Error(`Harness step timed out waiting for ${what}`);
}
const visible = node => node.getClientRects().length > 0;
const textOf = node => node.textContent.replace(/\s+/g, ' ').trim();
// Matches the aria-label, the exact text, or the text followed by a count ("Pending approval 2").
const named = text => [...document.querySelectorAll('button, a, [role="menuitem"]')].find(node => visible(node) && !node.disabled
  && (node.getAttribute('aria-label') === text || textOf(node) === text || (textOf(node).startsWith(`${text} `) && /^\d+$/.test(textOf(node).slice(text.length + 1)))));
const labelled = text => {
  const label = [...document.querySelectorAll('label')].find(node => visible(node) && node.textContent.replace(/\s+/g, ' ').trim().startsWith(text));
  if (label === undefined) return null;
  return label.htmlFor === '' ? label.querySelector('input') : document.getElementById(label.htmlFor);
};
const driver = {
  wait: selector => until(() => document.querySelector(selector), selector),
  async click(text) {
    const target = await until(() => named(text) ?? (labelled(text) ?? null), text);
    target.click();
  },
  async fill(label, value) {
    const target = await until(() => { const control = labelled(label); return control !== null && !control.disabled ? control : null; }, label);
    target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
};

await import('/account.js');
if (params.get('steps') !== '0') {
  await scenario.steps(driver);
  if (scenario.ready !== undefined) await driver.wait(scenario.ready);
}
document.documentElement.dataset.harnessReady = 'true';
