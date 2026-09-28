(() => {
  'use strict';

  /**
   * Mirrors the chosen caption style onto <html data-ytsc-style="…">.
   * Runs in the ISOLATED world (the only place with chrome.storage); the
   * MAIN-world overlay needs no code for this, styles.css keys off the attribute.
   * Single responsibility: settings -> DOM attribute.
   */
  const DEFAULTS = { style: 'frosted' };
  const apply = (style) => {
    document.documentElement.dataset.ytscStyle = style || DEFAULTS.style;
  };

  apply(DEFAULTS.style);
  chrome.storage.sync.get(DEFAULTS, (settings) => apply(settings.style));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.style) apply(changes.style.newValue);
  });
})();
