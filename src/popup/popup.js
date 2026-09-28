(() => {
  'use strict';

  /** Popup: reads/writes the caption style; settings-bridge.js applies it to open tabs. */
  const DEFAULTS = { style: 'frosted' };
  const radios = [...document.querySelectorAll('input[name="style"]')];

  chrome.storage.sync.get(DEFAULTS, ({ style }) => {
    const current = radios.find((r) => r.value === style) || radios[0];
    current.checked = true;
  });

  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (radio.checked) chrome.storage.sync.set({ style: radio.value });
    });
  }
})();
