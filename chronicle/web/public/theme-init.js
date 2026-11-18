// Chronicle prepaint colours. Runs after /ui/theme-init.js, which alone writes the theme attributes.
(() => {
  const root = document.documentElement, theme = root.dataset.theme;
  if (theme !== 'light' && theme !== 'dark') throw new Error('theme-init.js: /ui/theme-init.js must run first');
  const canvas = theme === 'dark' ? '#242c37' : '#f1f5f9';
  root.style.colorScheme = theme; root.style.backgroundColor = canvas;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta !== null) meta.content = canvas;
})();
