// Page chrome shared by the file viewer and the server-rendered directory listing:
// icons from the shared design system, local times, theme menu, disclosures, copy buttons, toasts.
// Loaded as its own module by listings and bundled into viewer.js.

const ICONS_URL = new URL('../ui/icons.js', import.meta.url).href;
const TOAST_MS = 3000;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const THEME_ICONS = { light: 'sun', dark: 'moon' };

const icons = import(ICONS_URL);

/** Replaces every `[data-icon]` placeholder below `root` with the shared inline SVG. */
export async function hydrateIcons(root) {
  const { icon } = await icons;
  for (const slot of root.querySelectorAll('span[data-icon]')) {
    const extra = [...slot.classList].filter(name => name !== 'icon');
    slot.outerHTML = icon(slot.dataset.icon, ...extra);
  }
}

/** An icon placeholder element; call hydrateIcons on its container after insertion. */
export function iconSlot(name, ...classes) {
  const slot = document.createElement('span');
  slot.className = ['icon', ...classes].join(' ');
  slot.dataset.icon = name;
  slot.setAttribute('aria-hidden', 'true');
  return slot;
}

export function toast(message) {
  const host = document.querySelector('#toasts');
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  host.replaceChildren(item);
  setTimeout(() => item.remove(), TOAST_MS);
}

export async function copyText(text, success) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard access is unavailable.');
  await navigator.clipboard.writeText(text);
  toast(success);
}

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function relative(seconds) {
  if (seconds < MINUTE) return 'just now';
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} min ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)} h ago`;
  return `${Math.floor(seconds / DAY)} d ago`;
}
/** "Nov 17, 21:14 · 16 min ago" in the browser's time zone; the tooltip keeps the full ISO time. */
function localTimes() {
  for (const time of document.querySelectorAll('time[data-local]')) {
    const value = new Date(time.dateTime);
    if (Number.isNaN(value.getTime())) throw new Error(`invalid upload time ${time.dateTime}`);
    time.textContent = `${dateFormat.format(value)} · ${relative(Math.max(0, (Date.now() - value.getTime()) / 1000))}`;
  }
}

function closeOnOutside(isOpen, close, container) {
  document.addEventListener('click', event => { if (isOpen() && !container.contains(event.target)) close(false); });
  container.addEventListener('keydown', event => { if (event.key === 'Escape' && isOpen()) { event.stopPropagation(); close(true); } });
}

function themeMenu() {
  const control = document.querySelector('[data-theme-control]');
  const root = document.documentElement;
  // theme-init.js is the only writer of the theme attributes; without it there is nothing to choose.
  if (!control || !root.dataset.themeChoice) return;
  control.hidden = false;
  const button = control.querySelector('button[aria-haspopup]');
  const menu = control.querySelector('[role=menu]');
  const items = [...menu.querySelectorAll('[data-theme-set]')];
  const sync = () => {
    for (const item of items) item.setAttribute('aria-checked', String(item.dataset.themeSet === root.dataset.themeChoice));
    const glyph = button.querySelector('[data-icon], svg');
    const next = iconSlot(THEME_ICONS[root.dataset.theme]);
    glyph.replaceWith(next);
    hydrateIcons(button);
  };
  const close = refocus => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (refocus) button.focus(); };
  button.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) (items.find(item => item.getAttribute('aria-checked') === 'true') || items[0]).focus();
  });
  for (const item of items) item.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('ui:theme-choice', { detail: item.dataset.themeSet }));
    close(true);
  });
  closeOnOutside(() => !menu.hidden, close, control);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-theme-choice'] });
  sync();
}

function disclosures() {
  for (const details of document.querySelectorAll('details.anchor')) {
    closeOnOutside(() => details.open, refocus => { details.open = false; if (refocus) details.querySelector('summary').focus(); }, details);
  }
}

function copyButtons() {
  for (const button of document.querySelectorAll('[data-copy-from]')) {
    const source = document.getElementById(button.dataset.copyFrom);
    button.hidden = false;
    button.addEventListener('click', () => copyText(source.textContent, button.dataset.copied)
      .catch(() => toast('Could not copy. Select the text and copy it instead.')));
  }
}

localTimes();
themeMenu();
disclosures();
copyButtons();
hydrateIcons(document);
