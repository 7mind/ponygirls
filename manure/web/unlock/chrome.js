// Page chrome of Manure's content-origin pages (file viewer, directory listing, unlock card), served
// from the content shell at <mount>/__manure/shell/chrome.js: shared icons for every `span[data-icon]`
// (also ones inserted later), local upload times, theme menu, disclosures, copy buttons and toasts.
// Pages ask for a toast with document.dispatchEvent(new CustomEvent('manure:toast', { detail: message })).

const ICONS_URL = new URL('./ui/icons.js', import.meta.url).href;
const TOAST_EVENT = 'manure:toast';
const TOAST_MS = 3000;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const THEME_ICONS = { light: 'sun', dark: 'moon' };

const { icon } = await import(ICONS_URL);

function hydrateIcons(root) {
  for (const slot of root.querySelectorAll('span[data-icon]')) {
    const extra = [...slot.classList].filter(name => name !== 'icon');
    slot.outerHTML = icon(slot.dataset.icon, ...extra);
  }
}

function toast(message) {
  const host = document.querySelector('#toasts');
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  host.replaceChildren(item);
  setTimeout(() => item.remove(), TOAST_MS);
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
    button.replaceChildren();
    button.insertAdjacentHTML('afterbegin', icon(THEME_ICONS[root.dataset.theme]));
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
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source.textContent);
        toast(button.dataset.copied);
      } catch {
        toast('Could not copy. Select the text and copy it instead.');
      }
    });
  }
}

document.addEventListener(TOAST_EVENT, event => toast(event.detail));
new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const root = node.matches('span[data-icon]') ? node.parentElement : node;
    if (root) hydrateIcons(root);
  }
}).observe(document.body, { childList: true, subtree: true });
hydrateIcons(document);
localTimes();
themeMenu();
disclosures();
copyButtons();
