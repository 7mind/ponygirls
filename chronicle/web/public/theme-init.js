(() => {
  const root = document.documentElement;
  let preference = 'system', persistence = 'available';
  try {
    const saved = window.localStorage.getItem('chronicle.theme.preference');
    if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved;
    else if (saved !== null) persistence = 'invalid';
  } catch { persistence = 'unavailable'; }
  const theme = preference === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : preference;
  const canvas = theme === 'dark' ? '#111713' : '#f4f3ee';
  root.dataset.theme = theme; root.dataset.themePreference = preference; root.dataset.themePersistence = persistence;
  root.style.colorScheme = theme; root.style.backgroundColor = canvas;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta !== null) meta.content = canvas;
})();
