// Chronicle prepaint colours (the --bg-surface token of each theme). Runs after /ui/theme-init.js, which alone writes the theme attributes.
(() => {
  const root = document.documentElement, theme = root.dataset.theme;
  if (theme !== 'light' && theme !== 'dark') throw new Error('theme-init.js: /ui/theme-init.js must run first');
  const surface = theme === 'dark' ? '#151920' : '#ffffff';
  root.style.colorScheme = theme; root.style.backgroundColor = surface;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta !== null) meta.content = surface;
})();
