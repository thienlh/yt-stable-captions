(() => {
  'use strict';

  // Opening of Tim Urban's TED talk (arj7oStGLkU), cut with the extension's
  // chunker from the English captions on that video. Times are milliseconds.
  const CLIP_START = 13;
  const CLIP_END = 42;
  const CHUNKS = [[13000,15500,[["So",13000],["in",13417],["college,",13833]]],[15500,17000,[["I",15500],["was",15571],["a",15786],["government",15857],["major,",16571]]],[17000,18544,[["which",17000],["means",17368],["I",17735],["had",17809],["to",18029],["write",18176]]],[18544,19500,[["a",18544],["lot",18618],["of",18838],["papers.",18985]]],[19500,20757,[["Now,",19500],["when",19729],["a",19957],["normal",20014],["student",20357]]],[20757,21500,[["writes",20757],["a",21100],["paper,",21157]]],[21500,23024,[["they",21500],["might",21744],["spread",22049],["the",22415],["work",22598],["out",22841]]],[23024,24000,[["a",23024],["little",23085],["like",23451],["this.",23695]]],[24000,27000,[["So,",24000],["you",24818],["know,",25636]]],[27000,28563,[["you",27000],["get",27188],["started",27375],["maybe",27813],["a",28125],["little",28188]]],[28563,29909,[["slowly,",28563],["but",29000],["you",29182],["get",29364],["enough",29545]]],[29909,31234,[["done",29909],["in",30152],["the",30273],["first",30455],["week",30758],["that,",31000]]],[31234,32359,[["with",31234],["some",31422],["heavier",31609],["days",31938],["later",32125]]],[32359,34400,[["on,",32359],["everything",32500],["gets",33500],["done,",33900]]],[34400,36000,[["things",34400],["stay",35000],["civil.",35400]]],[36000,37417,[["And",36000],["I",36250],["would",36333],["want",36750],["to",37083],["do",37250]]],[37417,38500,[["that",37417],["like",37750],["that.",38083]]],[38500,39500,[["That",38500],["would",38711],["be",38974],["the",39079],["plan.",39237]]],[39500,41500,[["I",39500],["would",39600],["have",40100],["it",40500],["all",40700],["ready",41000]]],[41500,42500,[["to",41500],["go,",41700]]]].map(([startMs, endMs, words]) => ({
    startMs,
    endMs,
    words: words.map(([text, wordStart]) => ({ text, startMs: wordStart })),
  }));

  // Mirrors src/core/settings.js and the toasts in src/content/settings-bridge.js.
  const SIZES = ['tiny', 'xsmall', 'small', 'medium', 'large', 'xlarge', 'xxlarge'];
  const SIZE_LABELS = {
    tiny: 'Tiny', xsmall: 'Extra small', small: 'Small', medium: 'Medium',
    large: 'Large', xlarge: 'Extra large', xxlarge: 'XXL',
  };
  const FROSTED_WINDOWS = ['clear', 'light', 'medium', 'dark', 'solid'];
  const SHORT_WINDOWS = ['off', '25', '50', '75', '100'];
  const WINDOW_LABELS = {
    clear: 'Clear', light: 'Light', medium: 'Medium', dark: 'Dark', solid: 'Solid',
  };
  const windowText = (level) => WINDOW_LABELS[level] || `${level}%`;

  // The talk's cues are already clean, so ⇧C plays this line: fillers and the
  // repeated "I" fold away, the same edit src/core/disfluency.js would make.
  const DEMO_LINE = [
    { text: 'So,', drop: false, at: 0 },
    { text: 'um,', drop: true, at: 280 },
    { text: 'I', drop: true, at: 560 },
    { text: 'I', drop: true, at: 820 },
    { text: 'I', drop: false, at: 1080 },
    { text: 'think', drop: false, at: 1360 },
    { text: "it's", drop: false, at: 1640 },
    { text: 'better.', drop: false, at: 1920 },
  ];

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOLD_CLEAN = reduceMotion ? 800 : 1600;
  const TOAST_MS = 2400;
  const TOUR_LOOP = 92;

  const screen = document.querySelector('.screen');
  const overlay = document.getElementById('ytsc-overlay');
  const toast = document.getElementById('ytsc-toast');
  if (!screen || !overlay || !toast) return;

  new ResizeObserver(([entry]) => {
    overlay.style.setProperty('--ytsc-player-h', `${entry.contentRect.height}px`);
  }).observe(screen);

  const state = {
    captions: false,
    style: 'frosted',
    size: 'medium',
    highlight: true,
    clean: true,
    frostedWindow: 'medium',
    tiktokWindow: 'off',
  };

  const apply = () => {
    screen.dataset.ytscStyle = state.style;
    screen.dataset.ytscSize = state.size;
    screen.dataset.ytscHighlight = String(state.highlight);
    screen.dataset.ytscFrostedWindow = state.frostedWindow;
    screen.dataset.ytscTiktokWindow = state.tiktokWindow;
    if (!state.captions) overlay.classList.remove('ytsc-visible');
  };

  const pop = () => {
    if (reduceMotion || !overlay.classList.contains('ytsc-visible')) return;
    overlay.classList.remove('ytsc-fresh');
    void overlay.offsetWidth;
    overlay.classList.add('ytsc-fresh');
  };

  let toastTimer = 0;
  const quietIndicator = () => {
    toast.classList.remove('ytsc-toast-visible');
    document.querySelectorAll('.key.is-hot').forEach((el) => el.classList.remove('is-hot'));
    document.querySelectorAll('kbd.is-down').forEach((el) => el.classList.remove('is-down'));
  };

  const indicate = (shortcut, kbd, message) => {
    clearTimeout(toastTimer);
    toast.replaceChildren();
    const cap = document.createElement('kbd');
    cap.textContent = kbd;
    const label = document.createElement('span');
    label.textContent = message;
    toast.append(cap, label);
    toast.classList.add('ytsc-toast-visible');
    document.querySelectorAll('.key.is-hot').forEach((el) => el.classList.remove('is-hot'));
    document.querySelectorAll('kbd.is-down').forEach((el) => el.classList.remove('is-down'));
    const row = document.querySelector(`.key[data-shortcut="${shortcut}"]`);
    if (row) {
      row.classList.add('is-hot');
      const down = row.querySelector(`kbd[data-kbd="${kbd}"]`);
      if (down) down.classList.add('is-down');
    }
    toastTimer = setTimeout(quietIndicator, TOAST_MS);
  };

  let player = null;
  let chunk = null;
  let spans = [];
  let active = -1;
  let looping = false;
  let demoOn = false;
  let demoStarted = 0;
  let manual = false;
  const laters = [];

  const clearLaters = () => {
    laters.splice(0).forEach((id) => clearTimeout(id));
  };
  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    laters.push(id);
  };

  let origin = performance.now();
  let lastFrame = origin;

  // Frames stop while the tab is hidden. Hold the tour clock over the gap so
  // a returning visitor sees the step they left, not every missed one at once.
  const holdClockOverGaps = () => {
    const now = performance.now();
    const gap = now - lastFrame;
    lastFrame = now;
    if (gap < 500) return;
    origin += gap;
    demoStarted += gap;
  };

  const localT = () => ((performance.now() - origin) % (TOUR_LOOP * 1000)) / 1000;

  const cueAt = (timeMs) => {
    for (let i = 0; i < CHUNKS.length; i++) {
      const cue = CHUNKS[i];
      if (timeMs >= cue.startMs && timeMs < cue.endMs) return cue;
    }
    return null;
  };

  const paint = (next) => {
    if (next === chunk) return;
    chunk = next;
    active = -1;
    overlay.classList.remove('ytsc-demo', 'ytsc-clean', 'ytsc-fresh');
    overlay.textContent = '';
    spans = [];
    if (!next || !state.captions) {
      overlay.classList.remove('ytsc-visible');
      return;
    }
    next.words.forEach((word, i) => {
      if (i) overlay.appendChild(document.createTextNode(' '));
      const span = document.createElement('span');
      span.className = 'ytsc-word';
      span.textContent = word.text;
      overlay.appendChild(span);
      spans.push(span);
    });
    overlay.classList.add('ytsc-visible');
    if (state.style === 'tiktok') pop();
  };

  const setActive = (index) => {
    if (index === active) return;
    if (active >= 0 && spans[active]) spans[active].classList.remove('ytsc-active');
    active = index;
    if (index >= 0 && spans[index]) spans[index].classList.add('ytsc-active');
  };

  const highlight = (timeMs) => {
    if (!chunk || !chunk.words) return;
    let index = -1;
    const words = chunk.words;
    for (let i = 0; i < words.length; i++) {
      if (words[i].startMs <= timeMs) index = i;
      else break;
    }
    setActive(index);
  };

  const highlightDemo = () => {
    const elapsed = performance.now() - demoStarted;
    let index = -1;
    for (let i = 0; i < DEMO_LINE.length; i++) {
      if (DEMO_LINE[i].at <= elapsed) index = i;
    }
    if (overlay.classList.contains('ytsc-clean')) {
      while (index >= 0 && DEMO_LINE[index].drop) index -= 1;
    }
    setActive(index);
  };

  const showDirtyLine = () => {
    demoOn = true;
    demoStarted = performance.now();
    chunk = { demo: true };
    active = -1;
    overlay.classList.add('ytsc-demo');
    overlay.classList.remove('ytsc-clean');
    overlay.textContent = '';
    spans = [];
    DEMO_LINE.forEach((word) => {
      const span = document.createElement('span');
      span.className = word.drop ? 'ytsc-word ytsc-drop' : 'ytsc-word';
      span.textContent = word.text;
      overlay.appendChild(span);
      spans.push(span);
    });
    overlay.classList.add('ytsc-visible');
    if (state.style === 'tiktok') pop();
  };

  const finishDemo = () => {
    demoOn = false;
    clearLaters();
    overlay.classList.remove('ytsc-demo', 'ytsc-clean');
    chunk = null;
    state.clean = true;
    apply();
  };

  // ⇧C plays on the tour clock, same as the other keys. The talk's cues have
  // no fillers, so the beat swaps in one example line, then folds it clean.
  const showCleanOff = () => {
    clearLaters();
    state.captions = true;
    state.clean = false;
    apply();
    showDirtyLine();
    indicate('clean', '⇧C', 'Clean captions: off');
  };
  const showCleanOn = () => {
    if (!demoOn) return;
    state.clean = true;
    apply();
    void overlay.offsetWidth;
    overlay.classList.add('ytsc-clean');
    indicate('clean', '⇧C', 'Clean captions: on (no um, uh, repeats)');
  };

  // One change, then a long look. Pairs (off/on, two window steps) sit
  // further apart than the old two-second cuts.
  const BEATS = [
    { at: 1.5, run() { state.captions = true; apply(); indicate('captions', 'C', 'Captions on'); } },
    { at: 9, run() { state.size = 'large'; apply(); indicate('size', '+', 'Caption size: Large'); } },
    { at: 17, run() { state.frostedWindow = 'dark'; apply(); indicate('window', 'W', 'Frosted panel: Dark'); } },
    { at: 25, run() { state.frostedWindow = 'solid'; apply(); indicate('window', 'W', 'Frosted panel: Solid'); } },
    { at: 33, run() { state.highlight = false; apply(); indicate('highlight', 'H', 'Word highlight: off'); } },
    { at: 41, run() { state.highlight = true; apply(); indicate('highlight', 'H', 'Word highlight: on'); } },
    { at: 49, run: showCleanOff },
    { at: 56, run: showCleanOn },
    { at: 63, run() { if (demoOn) finishDemo(); } },
    { at: 67, run() { state.style = 'tiktok'; apply(); pop(); indicate('style', '⌥C', 'Style: Short'); } },
    { at: 75, run() { state.tiktokWindow = '25'; apply(); indicate('window', 'W', 'Background: 25%'); } },
    { at: 83, run() { state.tiktokWindow = '50'; apply(); indicate('window', 'W', 'Background: 50%'); } },
  ];
  const fired = new Set();
  let lastT = -1;

  const restartTour = () => {
    manual = false;
    clearTimeout(toastTimer);
    quietIndicator();
    finishDemo();
    state.captions = false;
    state.style = 'frosted';
    state.size = 'medium';
    state.highlight = true;
    state.clean = true;
    state.frostedWindow = 'medium';
    state.tiktokWindow = 'off';
    apply();
    fired.clear();
  };

  const advanceTour = () => {
    const t = localT();
    if (lastT >= 0 && t < lastT - 0.4) restartTour();
    lastT = localT();
    if (manual) return;
    for (const beat of BEATS) {
      if (t >= beat.at && !fired.has(beat)) {
        fired.add(beat);
        beat.run();
      }
    }
  };

  const takeOver = () => {
    manual = true;
    clearLaters();
    if (demoOn) finishDemo();
  };

  const stepSize = (delta) => {
    let index = SIZES.indexOf(state.size);
    if (index < 0) index = SIZES.indexOf('medium');
    index = Math.min(SIZES.length - 1, Math.max(0, index + delta));
    state.size = SIZES[index];
    apply();
    indicate('size', delta > 0 ? '+' : '−', `Caption size: ${SIZE_LABELS[state.size]}`);
  };

  const stepWindow = () => {
    const short = state.style === 'tiktok';
    const levels = short ? SHORT_WINDOWS : FROSTED_WINDOWS;
    const key = short ? 'tiktokWindow' : 'frostedWindow';
    const index = Math.max(0, levels.indexOf(state[key]));
    state[key] = levels[(index + 1) % levels.length];
    apply();
    const name = short ? 'Background' : 'Frosted panel';
    indicate('window', 'W', `${name}: ${windowText(state[key])}`);
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.repeat) return;
    const typing = e.target instanceof Element &&
      (e.target.isContentEditable || e.target.closest('input, textarea, select, [contenteditable]'));
    if (typing) return;
    const styleKey = e.altKey && !e.shiftKey && e.code === 'KeyC';
    if (e.altKey && !styleKey) return;
    const delta = !e.altKey && (e.key === '+' || e.key === '=' ? 1 : e.key === '-' ? -1 : 0);
    const cleanKey = !e.altKey && e.shiftKey && e.key === 'C';
    const windowKey = !e.altKey && !e.shiftKey && e.key === 'w';
    const highlightKey = !e.altKey && !e.shiftKey && e.key === 'h';
    const captionKey = !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C');
    if (!delta && !cleanKey && !windowKey && !highlightKey && !styleKey && !captionKey) return;
    e.preventDefault();
    e.stopPropagation();

    if (cleanKey) {
      manual = true;
      clearLaters();
      state.captions = true;
      // An example already folded clean (manual or tour hold) goes back to
      // the dirty line, so the key keeps toggling.
      if (!demoOn || state.clean) {
        state.clean = false;
        apply();
        showDirtyLine();
        indicate('clean', '⇧C', 'Clean captions: off');
        return;
      }
      state.clean = true;
      apply();
      overlay.classList.add('ytsc-clean');
      indicate('clean', '⇧C', 'Clean captions: on (no um, uh, repeats)');
      later(() => finishDemo(), HOLD_CLEAN);
      return;
    }

    takeOver();
    if (styleKey) {
      state.style = state.style === 'tiktok' ? 'frosted' : 'tiktok';
      apply();
      if (state.style === 'tiktok') pop();
      indicate('style', '⌥C', `Style: ${state.style === 'tiktok' ? 'Short' : 'Frosted'}`);
    } else if (windowKey) stepWindow();
    else if (highlightKey) {
      state.highlight = !state.highlight;
      apply();
      indicate('highlight', 'H', state.highlight ? 'Word highlight: on' : 'Word highlight: off');
    } else if (delta) stepSize(delta);
    else {
      state.captions = !state.captions;
      apply();
      indicate('captions', 'C', state.captions ? 'Captions on' : 'Captions off');
    }
  });

  const captionMs = () => {
    if (player && typeof player.getCurrentTime === 'function' && typeof YT !== 'undefined') {
      try {
        const raw = player.getCurrentTime();
        const ps = player.getPlayerState();
        const onClip = ps === YT.PlayerState.PLAYING || ps === YT.PlayerState.PAUSED || ps === YT.PlayerState.BUFFERING;
        if (onClip && raw >= CLIP_START && raw < CLIP_END + 0.3) return raw * 1000;
      } catch { /* Player not ready. */ }
    }
    // No player yet: keep walking the clip so a late tour step still has words.
    const span = (CLIP_END - CLIP_START) * 1000;
    return CLIP_START * 1000 + ((localT() * 1000) % span);
  };

  const syncCaption = () => {
    if (demoOn) {
      highlightDemo();
      return;
    }
    if (!state.captions) {
      paint(null);
      return;
    }
    const ms = captionMs();
    const next = cueAt(ms);
    paint(next);
    if (next) highlight(ms);
  };

  const replay = () => {
    if (!player || looping || typeof player.seekTo !== 'function') return;
    looping = true;
    player.seekTo(CLIP_START, true);
    if (player.getPlayerState() !== YT.PlayerState.PLAYING) player.playVideo();
    looping = false;
  };

  const frame = () => {
    holdClockOverGaps();
    if (player && typeof player.getCurrentTime === 'function') {
      try {
        if (player.getCurrentTime() >= CLIP_END) replay();
      } catch { /* Player not ready. */ }
    }
    advanceTour();
    syncCaption();
    requestAnimationFrame(frame);
  };

  // YouTube applies the viewer's caption preference after the player is
  // ready, once the captions module loads. Unload it then, and again when
  // playback starts, or both caption layers show.
  const hideNativeCaptions = () => {
    if (!player || typeof player.getOptions !== 'function') return;
    try {
      const modules = player.getOptions();
      if (!modules || modules.indexOf('captions') === -1) return;
      player.unloadModule('captions');
    } catch {
      /* Module not available yet. A later attempt will get it. */
    }
  };

  // The captions module often loads, or reloads, after onReady. A single
  // unload loses that race and the viewer's saved caption preference comes back.
  const keepCaptionsOff = () => {
    hideNativeCaptions();
    [200, 700, 1600].forEach((ms) => setTimeout(hideNativeCaptions, ms));
  };

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('player', {
      videoId: 'arj7oStGLkU',
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 1,
        mute: 1,
        start: CLIP_START,
        end: CLIP_END,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        cc_load_policy: 0,
        origin: location.origin,
      },
      events: {
        onReady(event) {
          player = event.target;
          keepCaptionsOff();
        },
        onApiChange: keepCaptionsOff,
        onStateChange(event) {
          if (event.data === YT.PlayerState.PLAYING) keepCaptionsOff();
          if (event.data === YT.PlayerState.ENDED) replay();
        },
      },
    });
  };

  apply();
  const api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(api);
  requestAnimationFrame(frame);
})();
