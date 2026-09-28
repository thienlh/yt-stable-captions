(() => {
  'use strict';

  /** Popup: reads/writes settings; settings-bridge.js applies them to open tabs. */
  const DEFAULTS = { style: 'frosted', size: 'medium' };

  chrome.storage.sync.get(DEFAULTS, (settings) => {
    for (const [key, value] of Object.entries(settings)) {
      const radios = [...document.querySelectorAll(`input[name="${key}"]`)];
      const current = radios.find((r) => r.value === value) || radios[0];
      if (current) current.checked = true;
    }
  });

  for (const radio of document.querySelectorAll('input[type="radio"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) chrome.storage.sync.set({ [radio.name]: radio.value });
    });
  }
})();
