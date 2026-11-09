// Day or night before the first paint, by the same rule as web-app/src/app/layout.tsx: the choice this device remembers, else day; never the system setting.
try {
  document.documentElement.dataset.theme = localStorage.getItem('pms-theme') === 'dark' ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}
document.documentElement.dataset.desktop = '';
