(() => {
  'use strict';

  /**
   * Mirrors the popup settings onto <html data-ytsc-style="…" data-ytsc-size="…">,
   * and registers the bundled font with this browser's extension URL.
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
  const apply = (settings) => {
    for (const [key, attr] of Object.entries(ATTRS)) {
      if (key in settings) document.documentElement.dataset[attr] = settings[key] || DEFAULTS[key];
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
})();
