const STORAGE_KEY = 'taskflow_theme';
const VALID_THEMES = ['warm-parchment', 'sage-morning', 'ember-night', 'dusk'];
const DEFAULT_THEME = 'warm-parchment';

function loadSaved() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.includes(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

let _theme = $state(loadSaved());

export const theme = {
  get value() { return _theme; }
};

export function setTheme(name) {
  if (!VALID_THEMES.includes(name)) return;
  _theme = name;
  try { localStorage.setItem(STORAGE_KEY, name); } catch {}
  document.documentElement.setAttribute('data-theme', name);
}

export function initTheme() {
  $effect(() => {
    document.documentElement.setAttribute('data-theme', _theme);
  });
}
