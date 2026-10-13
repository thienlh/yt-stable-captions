(() => {
  'use strict';

  /**
   * Popup: shows both caption styles playing live, edits the settings, and
   * says whether the active tab is a YouTube video (or asks for youtube.com
   * access when it is missing). Settings are written to
   * storage; settings-bridge.js applies them to open YouTube tabs.
   */
  const { CaptionChunker, Disfluency, cueAtTime, Settings } = globalThis.YTSC;
  const { DEFAULTS, SIZES, SIZE_LABELS, SIZE_VALUES, WINDOWS, windowLabel } = Settings;
  const api = globalThis.browser ?? globalThis.chrome;
  const store = api.storage.sync ?? api.storage.local; // Safari may lack sync

  const state = { ...DEFAULTS };
  const $ = (id) => document.getElementById(id);

  // ---------- Live previews (the extension's own chunker and cleaner) ----------

  const FROSTED_LEVELS = { clear: [0.12, 10], light: [0.25, 14], medium: [0.38, 16], dark: [0.55, 18], solid: [0.78, 20] };
  const SHORT_ALPHA = { off: 0, 25: 0.25, 50: 0.5, 75: 0.75, 100: 1 };

  const SAMPLE = '[Music] So, um, I I think captions should feel, uh, calm and easy. Every word lands where you expect it.';
  const SAMPLE_WORDS = (() => {
    let t = 400;
    return SAMPLE.split(' ').map((text) => {
      const startMs = t;
      t += text === '[Music]' ? 1400 : 170 + 32 * text.length + (/[.,]$/.test(text) ? 240 : 0);
      return { text, startMs, endMs: t - 40 };
    });
  })();
  const LOOP_MS = SAMPLE_WORDS[SAMPLE_WORDS.length - 1].endMs + 1400;
  let chunks = [];
  const rebuildChunks = () => {
    chunks = new CaptionChunker().build(state.clean ? new Disfluency().clean(SAMPLE_WORDS) : SAMPLE_WORDS);
  };

  class Preview {
    constructor(el) {
      this.el = el;
      this.style = el.dataset.preview;
      this.cap = document.createElement('div');
      this.cap.className = `cap ${this.style}`;
      el.appendChild(this.cap);
    }

    apply() {
      this.el.style.setProperty('--pv-size', SIZE_VALUES[state.size]);
      const [alpha, blur] = FROSTED_LEVELS[state.frostedWindow] || FROSTED_LEVELS.medium;
      this.el.style.setProperty('--pv-alpha', alpha);
      this.el.style.setProperty('--pv-blur', `${blur}px`);
      const shortAlpha = SHORT_ALPHA[state.tiktokWindow] ?? 0;
      this.el.style.setProperty('--pv-tt-alpha', shortAlpha);
      this.el.style.setProperty('--pv-tt-pad', shortAlpha ? '.12em .45em' : '0');
      this.current = undefined; // repaint: the words may have changed
    }

    render(t) {
      const chunk = cueAtTime(chunks, t);
      if (chunk !== this.current) {
        this.current = chunk;
        this.cap.textContent = '';
        this.cap.classList.remove('fresh');
        if (!chunk) {
          this.cap.classList.remove('on');
          return;
        }
        this.spans = chunk.words.map((w, i) => {
          if (i) this.cap.append(' ');
          const span = document.createElement('span');
          span.className = 'w';
          span.textContent = w.text;
          this.cap.append(span);
          return span;
        });
        this.cap.classList.add('on');
        void this.cap.offsetWidth; // restart the Short pop-in
        this.cap.classList.add('fresh');
      }
      if (!chunk) return; // still between chunks
      let active = -1;
      chunk.words.forEach((w, i) => { if (w.startMs <= t) active = i; });
      this.spans.forEach((s, i) => s.classList.toggle('cur', i === active));
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

    $('clean').setAttribute('aria-checked', String(state.clean));

    previews.forEach((p) => p.apply());
  }

  function update(patch, { persist = true } = {}) {
    const cleanChanged = 'clean' in patch && patch.clean !== state.clean;
    Object.assign(state, patch);
    if (cleanChanged) rebuildChunks();
    render();
    if (persist) store.set(patch).catch(() => {});
  }

  const stepSize = (delta) => {
    const i = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(state.size) + delta));
    update({ size: SIZES[i] });
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
    else if (t.id === 'clean') update({ clean: !state.clean });
  });

  // The same keys as on the video (minus `c`, which belongs to the player).
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.repeat) return;
    if (e.altKey && !e.shiftKey && e.code === 'KeyC') {
      e.preventDefault();
      update({ style: state.style === 'frosted' ? 'tiktok' : 'frosted' });
    } else if (e.altKey) {
      return;
    } else if (e.key === '=' || e.key === '+') stepSize(1);
    else if (e.key === '-') stepSize(-1);
    else if (e.key === 'w') cycleWindow();
    else if (e.key === 'C' && e.shiftKey) update({ clean: !state.clean });
  });

  // Keep in step with shortcut changes made on the video while the popup is open.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && area !== 'local') return;
    const patch = {};
    for (const key of Object.keys(DEFAULTS)) if (changes[key]) patch[key] = changes[key].newValue ?? DEFAULTS[key];
    if (Object.keys(patch).length) update(patch, { persist: false });
  });

  // ---------- "On YouTube" status ----------
  // Host permission for youtube.com is enough to see a YouTube tab's URL; no `tabs` permission needed.

  // Firefox lets the user withhold or revoke host access (MV3 host permissions
  // are opt-in there); without it no content script runs, so offer to grant it.
  const YOUTUBE = { origins: ['https://www.youtube.com/*'] };

  async function hasAccess() {
    try {
      return await api.permissions.contains(YOUTUBE);
    } catch {
      return true; // no permissions API: assume the install granted it
    }
  }

  $('grant').addEventListener('click', async () => {
    let granted = false;
    try {
      granted = await api.permissions.request(YOUTUBE); // needs this click as the user gesture
    } catch { /* request refused */ }
    if (!granted) return;
    $('grant').hidden = true;
    $('status').hidden = false;
    $('status').dataset.state = 'standby';
    $('status-text').textContent = 'reload YouTube';
  });

  async function showStatus() {
    if (!(await hasAccess())) {
      $('status').hidden = true;
      $('grant').hidden = false;
      return;
    }
    let url = '';
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      url = tab?.url || '';
    } catch { /* no tab info: treat as not on YouTube */ }
    const onVideo = /^https:\/\/www\.youtube\.com\/watch\b/.test(url);
    const onYouTube = /^https:\/\/www\.youtube\.com\//.test(url);
    // The little TV in the header: lit with a caption on a video, warm on other
    // YouTube pages, dark elsewhere.
    const state = onVideo ? 'on' : onYouTube ? 'standby' : 'off';
    $('status').dataset.state = state;
    $('status-text').textContent = { on: 'on the tube', standby: 'pick a video', off: "tube's off" }[state];
  }

  // ---------- Start ----------

  rebuildChunks();
  render();
  store.get(DEFAULTS).then((saved) => update(saved, { persist: false }), () => {});
  showStatus();

  // Read the clock here rather than trusting the rAF timestamp: that one can
  // precede t0 (a negative time shows nothing) and runs on its own timeline.
  const t0 = performance.now();
  const frame = () => {
    const t = (performance.now() - t0) % LOOP_MS;
    previews.forEach((p) => p.render(t));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();
