(() => {
  'use strict';

  /** Popup: reads/writes settings; settings-bridge.js applies them to open tabs. */
  const DEFAULTS = { style: 'frosted', size: 'medium', clean: false };
  const api = globalThis.browser ?? globalThis.chrome;
  const store = api.storage.sync ?? api.storage.local; // Safari may lack sync

  store.get(DEFAULTS).then((settings) => {
    for (const [key, value] of Object.entries(settings)) {
      const checkbox = document.querySelector(`input[type="checkbox"][name="${key}"]`);
      if (checkbox) {
        checkbox.checked = Boolean(value);
        continue;
      }
      const radios = [...document.querySelectorAll(`input[name="${key}"]`)];
      const current = radios.find((r) => r.value === value) || radios[0];
      if (current) current.checked = true;
    }
  });

  for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) {
    checkbox.addEventListener('change', () => store.set({ [checkbox.name]: checkbox.checked }));
  }

  for (const radio of document.querySelectorAll('input[type="radio"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) store.set({ [radio.name]: radio.value });
    });
  }
})();
