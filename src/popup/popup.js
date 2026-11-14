(() => {
  'use strict';

  /**
   * Popup: previews each caption style, edits the settings, and
   * says whether the active tab is a YouTube or HackerTube video (or asks for
   * site access when it is missing). Settings are written to storage;
   * settings-bridge.js applies them to open video tabs.
   */
  const { Settings } = globalThis.YTSC;
  const { DEFAULTS, STYLES, SIZES, SIZE_LABELS, WINDOWS, windowLabel, sizeMigration, highlightSetting } = Settings;
  const api = globalThis.browser ?? globalThis.chrome;
  const store = api.storage.sync ?? api.storage.local; // Safari may lack sync

  const state = { ...DEFAULTS };
  const $ = (id) => document.getElementById(id);

  // ---------- Style previews ----------

  const FROSTED_LEVELS = { clear: [0.12, 10], light: [0.25, 14], medium: [0.38, 16], dark: [0.55, 18], solid: [0.78, 20] };
  const BOX_ALPHA = { off: 0, 25: 0.25, 50: 0.5, 75: 0.75, 100: 1 }; // Short's and Boring's background

  // A still caption per style: the look, without words changing under the eye.
  // The second word is marked, as the word being spoken.
  const SAMPLE = ['learn', 'something', 'new'];

  class Preview {
    constructor(el) {
      this.el = el;
      this.style = el.dataset.preview;
      const cap = document.createElement('div');
      cap.className = `cap ${this.style}`;
      SAMPLE.forEach((text, i) => {
        if (i) cap.append(' ');
        const span = document.createElement('span');
        span.className = i === 1 ? 'w cur' : 'w';
        span.textContent = text;
        cap.append(span);
      });
      el.appendChild(cap);
    }

    apply() {
      const [alpha, blur] = FROSTED_LEVELS[state.frostedWindow] || FROSTED_LEVELS.medium;
      this.el.style.setProperty('--pv-alpha', alpha);
      this.el.style.setProperty('--pv-blur', `${blur}px`);
      const shortAlpha = BOX_ALPHA[state.tiktokWindow] ?? 0;
      this.el.style.setProperty('--pv-tt-alpha', shortAlpha);
      this.el.style.setProperty('--pv-tt-pad', shortAlpha ? '.12em .45em' : '0');
      this.el.style.setProperty('--pv-boring-alpha', BOX_ALPHA[state.boringWindow] ?? 0.75);
      this.el.classList.toggle('plain', !state[highlightSetting(this.style)]);
    }
  }
  const previews = [...document.querySelectorAll('[data-preview]')].map((el) => new Preview(el));

  // ---------- Rendering ----------

  const dots = $('size-dots');
  SIZES.forEach((_, i) => {
    const bar = document.createElement('span');
    bar.style.height = `${4 + i * 2}px`; // a rising scale: one bar per size
    dots.appendChild(bar);
  });

  let windowListFor = null;
  function renderWindowList() {
    const w = WINDOWS[state.style];
    $('window-title').textContent = w.label;
    if (windowListFor === state.style) return;
    windowListFor = state.style;
    const list = $('window-list');
    list.textContent = '';
    for (const level of w.levels) {
      const b = document.createElement('button');
      b.dataset.window = level;
      b.textContent = windowLabel(level);
      list.appendChild(b);
    }
  }

  function render() {
    renderWindowList();
    const sizeIndex = SIZES.indexOf(state.size);
    const level = state[WINDOWS[state.style].key];

    for (const card of document.querySelectorAll('[data-style]')) {
      const sel = card.dataset.style === state.style;
      card.classList.toggle('sel', sel);
      card.setAttribute('aria-pressed', String(sel));
    }
    [...dots.children].forEach((d, i) => {
      d.classList.toggle('lit', i <= sizeIndex);
      d.classList.toggle('here', i === sizeIndex);
    });
    $('size-label').textContent = SIZE_LABELS[state.size];

    for (const b of document.querySelectorAll('[data-window]')) {
      const sel = b.dataset.window === level;
      b.classList.toggle('sel', sel);
      b.setAttribute('aria-pressed', String(sel));
    }

    const highlight = state[highlightSetting(state.style)];
    $('highlight').setAttribute('aria-checked', String(highlight));
    $('highlight-hint').textContent = highlight ? 'Mark the word being spoken' : 'Show each caption plainly';
    $('clean').setAttribute('aria-checked', String(state.clean));

    previews.forEach((p) => p.apply());
  }

  function update(patch, { persist = true } = {}) {
    Object.assign(state, patch);
    render();
    if (persist) store.set(patch).catch(() => {});
  }

  const stepSize = (delta) => {
    const i = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(state.size) + delta));
    update({ size: SIZES[i] });
  };
  const toggleHighlight = () => {
    const key = highlightSetting(state.style);
    update({ [key]: !state[key] });
  };
  const cycleWindow = () => {
    const w = WINDOWS[state.style];
    update({ [w.key]: w.levels[(w.levels.indexOf(state[w.key]) + 1) % w.levels.length] });
  };

  // ---------- Input ----------

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.style) update({ style: t.dataset.style });
    else if (t.dataset.sizeStep) stepSize(Number(t.dataset.sizeStep));
    else if (t.dataset.window) update({ [WINDOWS[state.style].key]: t.dataset.window });
    else if (t.id === 'highlight') toggleHighlight();
    else if (t.id === 'clean') update({ clean: !state.clean });
  });

  // The same keys as on the video (minus `c`, which belongs to the player).
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.repeat) return;
    if (e.altKey && !e.shiftKey && e.code === 'KeyC') {
      e.preventDefault();
      update({ style: STYLES[(STYLES.indexOf(state.style) + 1) % STYLES.length] });
    } else if (e.altKey) {
      return;
    } else if (e.key === '=' || e.key === '+') stepSize(1);
    else if (e.key === '-') stepSize(-1);
    else if (e.key === 'w') cycleWindow();
    else if (e.key === 'h') toggleHighlight();
    else if (e.key === 'C' && e.shiftKey) update({ clean: !state.clean });
  });

  // The learned caption language lives in local storage, separate from synced settings.
  const LANGUAGE_HISTORY = 'captionLanguageHistory';
  const languageHint = document.querySelector('[data-language-hint]');
  const applyLanguageHint = (history) => {
    if (!languageHint) return;
    const learned = globalThis.YTSC.CaptionLanguagePreference?.preferred(history);
    languageHint.title = learned
      ? `Preferred language: ${learned}. A language you pick in YouTube's subtitles menu replaces it.`
      : "Starts with your browser language. A language you pick in YouTube's subtitles menu replaces it.";
  };
  api.storage.local?.get({ [LANGUAGE_HISTORY]: [] })
    .then((raw) => applyLanguageHint(raw?.[LANGUAGE_HISTORY]))
    .catch(() => {});

  // Keep in step with shortcut changes made on the video while the popup is open.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    if (area === 'local' && changes[LANGUAGE_HISTORY]) applyLanguageHint(changes[LANGUAGE_HISTORY].newValue);
    const patch = {};
    for (const key of Object.keys(DEFAULTS)) if (changes[key]) patch[key] = changes[key].newValue ?? DEFAULTS[key];
    if (Object.keys(patch).length) update(patch, { persist: false });
  });

  // ---------- Video-site status ----------
  // Host permissions are enough to see supported tabs' URLs; no `tabs` permission needed.

  // Firefox lets the user withhold or revoke host access (MV3 host permissions
  // are opt-in there); without it no content script runs, so offer to grant it.
  const VIDEO_SITES = {
    origins: [
      'https://www.youtube.com/*',
      'https://www.youtube-nocookie.com/*',
      'https://hackertube.org/*',
    ],
  };

  async function hasAccess(sites = VIDEO_SITES) {
    try {
      return await api.permissions.contains(sites);
    } catch {
      return true; // no permissions API: assume the install granted it
    }
  }

  $('grant').addEventListener('click', async () => {
    let granted = false;
    try {
      granted = await api.permissions.request(VIDEO_SITES); // needs this click as the user gesture
    } catch { /* request refused */ }
    if (!granted) return;
    $('grant').hidden = true;
    $('status').hidden = false;
    $('status').dataset.state = 'standby';
    $('status-text').textContent = 'reload page';
  });

  async function showStatus() {
    let url = '';
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      url = tab?.url || '';
    } catch { /* no tab info: treat as an unsupported page */ }
    const host = /^https:\/\/(www\.youtube\.com|www\.youtube-nocookie\.com|hackertube\.org)\//.exec(url)?.[1];
    // Access to an unrelated video site is not required for this page to work.
    // HackerTube also needs access to its youtube-nocookie caption iframe.
    const origins = host ? [`https://${host}/*`] : VIDEO_SITES.origins;
    if (host === 'hackertube.org') origins.push('https://www.youtube-nocookie.com/*');
    if (!(await hasAccess({ origins }))) {
      $('status').hidden = true;
      $('grant').hidden = false;
      return;
    }
    const onYouTube = host === 'www.youtube.com' || host === 'www.youtube-nocookie.com';
    const onHackerTube = host === 'hackertube.org';
    const onVideo = /^https:\/\/www\.youtube\.com\/watch\b/.test(url)
      || /^https:\/\/www\.youtube-nocookie\.com\/embed\/[^/?#]+/.test(url)
      || /^https:\/\/hackertube\.org\/watch\/[^/?#]+/.test(url);
    // The little TV in the header: lit with a caption on a video, warm on other
    // supported pages, dark elsewhere.
    const state = onVideo ? 'on' : onYouTube || onHackerTube ? 'standby' : 'off';
    $('status').dataset.state = state;
    $('status-text').textContent = { on: 'on the tube', standby: 'pick a video', off: "tube's off" }[state];
  }

  // ---------- Start ----------

  render();
  // A size saved on the old ladder is moved first (see Settings.sizeMigration).
  store.get(['size', 'sizeLadder'])
    .then((raw) => { const patch = sizeMigration(raw); return patch && store.set(patch); })
    .catch(() => {})
    .then(() => store.get(DEFAULTS))
    .then((saved) => update(saved, { persist: false }), () => {});
  showStatus();
})();
