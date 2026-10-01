(() => {
  'use strict';

  /**
   * Mirrors the popup settings onto <html data-ytsc-style="…" data-ytsc-size="…">,
   * registers the bundled font with this browser's extension URL, and handles
   * the shortcuts that change settings (=/+ and - size, w window, Shift+C clean
   * verbatim, Alt/Option+C style).
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

  const { DEFAULTS, SIZES, SIZE_LABELS, WINDOWS, STYLES, STYLE_LABELS, windowLabel } = globalThis.YTSC.Settings;
  const ATTRS = {
    style: 'ytscStyle',
    size: 'ytscSize',
    clean: 'ytscClean',
    frostedWindow: 'ytscFrostedWindow',
    tiktokWindow: 'ytscTiktokWindow',
  };
  const current = { ...DEFAULTS };
  const apply = (settings) => {
    for (const [key, attr] of Object.entries(ATTRS)) {
      if (!(key in settings)) continue;
      current[key] = settings[key] ?? DEFAULTS[key];
      document.documentElement.dataset[attr] = String(current[key]);
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

  const setting = (key, value, message) => {
    apply({ [key]: value });
    store.set({ [key]: value }).catch(() => {});
    toast(message);
  };

  // Capture phase at window runs before YouTube's own handlers, so while our
  // captions are showing, these keys drive ours instead of the hidden native ones.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.repeat) return;
      // Alt/Option+C: match the physical key, since Option+C types "ç" on a Mac.
      const styleKey = e.altKey && !e.shiftKey && e.code === 'KeyC';
      if (e.altKey && !styleKey) return;
      const delta = !e.altKey && SIZE_KEYS[e.key];
      const cleanKey = !e.altKey && e.key === 'C' && e.shiftKey;
      const windowKey = !e.altKey && e.key === 'w' && !e.shiftKey;
      if (!delta && !cleanKey && !windowKey && !styleKey) return;
      if (isTyping(e.target) || !captionsShowing()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (styleKey) {
        const next = STYLES[(STYLES.indexOf(current.style) + 1) % STYLES.length];
        setting('style', next, `Style: ${STYLE_LABELS[next]}`);
        return;
      }
      if (cleanKey) {
        const on = !current.clean;
        setting('clean', on, on ? 'Clean captions: on (no um, uh, repeats)' : 'Clean captions: off');
        return;
      }
      if (windowKey) { // cycles like YouTube's own window-opacity key (wraps around)
        const w = WINDOWS[current.style] || WINDOWS.frosted;
        const next = w.levels[(w.levels.indexOf(current[w.key]) + 1) % w.levels.length];
        setting(w.key, next, `${w.label}: ${windowLabel(next)}`);
        return;
      }
      const index = Math.max(0, SIZES.indexOf(current.size));
      const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, index + delta))];
      setting('size', next, `Caption size: ${SIZE_LABELS[next]}`);
    },
    true
  );
})();
