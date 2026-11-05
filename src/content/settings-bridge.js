(() => {
  'use strict';

  /**
   * Mirrors popup settings and the learned caption language onto <html>, remembers
   * the latest manual language choice locally, registers the bundled font, and handles
   * the shortcuts that change settings (=/+ and - size, w window, h word
   * highlight, Shift+C clean verbatim, Alt/Option+C style).
   * (`c` stays YouTube's: the overlay follows the player's CC toggle. Shift+L
   * is handled by main.js, which owns caption tracks and the player API.)
   * Runs in the ISOLATED world (the only place with the extension APIs); the
   * page-world overlay needs no code for this, styles.css keys off the attributes.
   * Single responsibility: extension-owned state/resources -> DOM.
   */
  const api = globalThis.browser ?? globalThis.chrome;
  const store = api.storage.sync ?? api.storage.local; // Safari may lack sync
  const preferenceStore = api.storage.local; // behavior never leaves this browser
  const LANGUAGE_HISTORY = 'captionLanguageHistory';
  const Preference = globalThis.YTSC.CaptionLanguagePreference;
  let languageHistory = [];

  const applyLearnedLanguage = () => {
    const learned = Preference.preferred(languageHistory);
    if (learned) document.documentElement.dataset.ytscLearnedLanguage = learned;
    else delete document.documentElement.dataset.ytscLearnedLanguage;
  };

  let historyReady = preferenceStore.get({ [LANGUAGE_HISTORY]: [] })
    .then((raw) => {
      languageHistory = Preference.clean(raw?.[LANGUAGE_HISTORY]);
      applyLearnedLanguage();
    })
    .catch(() => {});

  // The page world dispatches on document: that node is shared across worlds,
  // and a JSON string crosses where a detail object does not (notably Firefox).
  // No video ID is included.
  document.addEventListener('ytsc:manual-caption-language', (e) => {
    let language = '';
    try { language = JSON.parse(e.detail).language; } catch { return; }
    historyReady = historyReady.then(async () => {
      languageHistory = Preference.record(languageHistory, language);
      applyLearnedLanguage();
      await preferenceStore.set({ [LANGUAGE_HISTORY]: languageHistory });
    }).catch(() => {});
  });

  const font = document.createElement('style');
  font.id = 'ytsc-font';
  font.textContent = `@font-face {
    font-family: "YTSC Inter";
    src: url("${api.runtime.getURL('fonts/InterVariable.woff2')}") format("woff2");
    font-weight: 100 900;
    font-display: swap;
  }`;
  document.documentElement.appendChild(font);

  // styles.css is also listed in the manifest, but Safari sometimes stops applying
  // manifest CSS (until a full restart) while the scripts keep running: the overlay
  // then renders unstyled, behind the video. A page stylesheet doesn't depend on that.
  // Safari can load it through a <link> to safari-web-extension://. Chrome cannot:
  // a <link href="chrome-extension://…"> is a page subresource in same-origin mode,
  // so the frame refuses it ("Unsafe attempt to load URL chrome-extension://…/styles.css
  // from frame with URL https://www.youtube.com/…. Domains, protocols and ports must
  // match."). Fetch from this isolated world and inline the text instead.
  const stylesUrl = api.runtime.getURL('src/content/styles.css');
  if (stylesUrl.startsWith('safari-')) {
    const link = document.createElement('link');
    link.id = 'ytsc-styles';
    link.rel = 'stylesheet';
    link.href = stylesUrl;
    document.documentElement.appendChild(link);
  } else {
    const styles = document.createElement('style');
    styles.id = 'ytsc-styles';
    document.documentElement.appendChild(styles);
    fetch(stylesUrl)
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then((css) => { styles.textContent = css; })
      .catch(() => {});
  }

  const {
    DEFAULTS, SIZES, SIZE_LABELS, WINDOWS, STYLES, STYLE_LABELS, windowLabel, sizeMigration, highlightSetting,
  } = globalThis.YTSC.Settings;
  const ATTRS = {
    style: 'ytscStyle',
    size: 'ytscSize',
    clean: 'ytscClean',
    highlight: 'ytscHighlight',
    boringHighlight: 'ytscBoringHighlight',
    frostedWindow: 'ytscFrostedWindow',
    tiktokWindow: 'ytscTiktokWindow',
    boringWindow: 'ytscBoringWindow',
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
  // Promise form works in both Chrome (MV3) and Safari. A size saved on the old
  // ladder is moved first, so it keeps looking the same.
  store.get(['size', 'sizeLadder'])
    .then((raw) => { const patch = sizeMigration(raw); return patch && store.set(patch); })
    .catch(() => {})
    .then(() => store.get(DEFAULTS))
    .then(apply, () => {});
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    if (area === 'local' && changes[LANGUAGE_HISTORY]) {
      languageHistory = Preference.clean(changes[LANGUAGE_HISTORY].newValue);
      applyLearnedLanguage();
    }
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
    // main.js (page world) shows this toast too, with its own timer: hide only our message.
    toastTimer = setTimeout(() => {
      if (el.textContent === text) el.classList.remove('ytsc-toast-visible');
    }, 1200);
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
      const highlightKey = !e.altKey && e.key === 'h' && !e.shiftKey;
      if (!delta && !cleanKey && !windowKey && !highlightKey && !styleKey) return;
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
      if (highlightKey) {
        const key = highlightSetting(current.style);
        const on = !current[key];
        setting(key, on, on ? 'Word highlight: on' : 'Word highlight: off');
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
