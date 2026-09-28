(() => {
  'use strict';

  /**
   * Mirrors the popup settings onto <html data-ytsc-style="…" data-ytsc-size="…">.
   * Runs in the ISOLATED world (the only place with chrome.storage); the
   * MAIN-world overlay needs no code for this, styles.css keys off the attribute.
   * Single responsibility: settings -> DOM attribute.
   */
  const DEFAULTS = { style: 'frosted', size: 'medium' };
  const ATTRS = { style: 'ytscStyle', size: 'ytscSize' };
  const apply = (settings) => {
    for (const [key, attr] of Object.entries(ATTRS)) {
      if (key in settings) document.documentElement.dataset[attr] = settings[key] || DEFAULTS[key];
    }
  };

  apply(DEFAULTS);
  chrome.storage.sync.get(DEFAULTS, apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const changed = {};
    for (const key of Object.keys(ATTRS)) if (changes[key]) changed[key] = changes[key].newValue;
    apply(changed);
  });
})();
