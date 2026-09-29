(() => {
  'use strict';

  /**
   * Mirrors the popup settings onto <html data-ytsc-style="…" data-ytsc-size="…">,
   * registers the bundled font with this browser's extension URL, and handles
   * the caption-size shortcuts (=/+ and -), which need storage to persist.
   * (`c` stays YouTube's: the overlay follows the player's CC toggle.)
   * Runs in the ISOLATED world (the only place with the extension APIs); the
   * page-world overlay needs no code for this, styles.css keys off the attributes.
   * Single responsibility: extension settings/resources -> DOM.
   */
  const api = globalThis.browser ?? globalThis.chrome;
  const store = api.storage.sync ?? api.storage.local; // Safari may lack sync

  const font = document.createElement('style');
  font.id = 'ytsc-font';
  font.textContent = `@font-face {
    font-family: "YTSC Inter";
    src: url("${api.runtime.getURL('fonts/InterVariable.woff2')}") format("woff2");
    font-weight: 100 900;
    font-display: swap;
  }`;
  document.documentElement.appendChild(font);

  const DEFAULTS = { style: 'frosted', size: 'medium' };
  const ATTRS = { style: 'ytscStyle', size: 'ytscSize' };
  const current = { ...DEFAULTS };
  const apply = (settings) => {
    for (const [key, attr] of Object.entries(ATTRS)) {
      if (!(key in settings)) continue;
      current[key] = settings[key] || DEFAULTS[key];
      document.documentElement.dataset[attr] = current[key];
    }
  };

  apply(DEFAULTS);
  // Promise form works in both Chrome (MV3) and Safari.
  store.get(DEFAULTS).then(apply, () => {});
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    const changed = {};
    for (const key of Object.keys(ATTRS)) if (changes[key]) changed[key] = changes[key].newValue;
    apply(changed);
  });

  // ---- Keyboard shortcuts (mirror YouTube's caption keys) ----

  const SIZES = ['xsmall', 'small', 'medium', 'large', 'xlarge'];
  const SIZE_LABELS = { xsmall: 'Extra small', small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'Extra large' };
  const SIZE_KEYS = { '=': 1, '+': 1, '-': -1 };

  const isTyping = (el) =>
    el instanceof Element &&
    (el.isContentEditable || Boolean(el.closest('input, textarea, select, [contenteditable]')));

  const captionsShowing = () => {
    if (!document.getElementById('ytsc-overlay')) return false;
    const cc = document.querySelector('.ytp-subtitles-button');
    return !cc || cc.getAttribute('aria-pressed') !== 'false';
  };

  let toastTimer = 0;
  const toast = (text) => {
    const player = document.getElementById('ytsc-overlay')?.parentElement;
    if (!player) return;
    let el = document.getElementById('ytsc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ytsc-toast';
      player.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('ytsc-toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('ytsc-toast-visible'), 1200);
  };

  // Capture phase at window runs before YouTube's own handlers, so while our
  // captions are showing, size keys resize ours instead of the hidden native ones.
  window.addEventListener(
    'keydown',
    (e) => {
      const delta = SIZE_KEYS[e.key];
      if (!delta || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTyping(e.target) || !captionsShowing()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const index = Math.max(0, SIZES.indexOf(current.size));
      const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, index + delta))];
      apply({ size: next });
      store.set({ size: next }).catch(() => {});
      toast(`Caption size: ${SIZE_LABELS[next]}`);
    },
    true
  );
})();
