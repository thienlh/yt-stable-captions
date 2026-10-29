(() => {
  'use strict';

  // Opening of Tim Urban's TED talk (arj7oStGLkU): the English caption lines
  // on that video, split into chunks of up to six words, laughter cues left
  // out. Times are milliseconds. The clip runs past one tour loop, so the
  // video only jumps back when the tour starts over.
  const CLIP_START = 13;
  const CLIP_END = 116;
  const CHUNKS = [[12645,14515,[["So",12645],["in",12873],["college,",13102]]],[15349,16937,[["I",15349],["was",15423],["a",15647],["government",15721],["major,",16466]]],[16937,18096,[["which",16937],["means",17299],["I",17661],["had",17734],["to",17951]]],[18096,19423,[["write",18096],["a",18458],["lot",18530],["of",18747],["papers.",18892]]],[19423,20301,[["Now,",19423],["when",19657],["a",19891],["normal",19950]]],[20301,21495,[["student",20301],["writes",20710],["a",21061],["paper,",21120]]],[21495,22768,[["they",21495],["might",21727],["spread",22016],["the",22363],["work",22537]]],[22768,23892,[["out",22768],["a",22942],["little",23000],["like",23347],["this.",23579]]],[23892,25543,[["So,",23892],["you",24180],["know",24468],["--",24851]]],[26748,27776,[["you",26748],["get",26919],["started",27091],["maybe",27490]]],[27776,28599,[["a",27776],["little",27833],["slowly,",28175]]],[28599,29494,[["but",28599],["you",28778],["get",28957],["enough",29136]]],[29494,30591,[["done",29494],["in",29732],["the",29851],["first",30030],["week",30328]]],[30591,31335,[["that,",30591],["with",30877],["some",31106]]],[31335,32446,[["heavier",31335],["days",31735],["later",31964],["on,",32250]]],[32446,33617,[["everything",32446],["gets",33062],["done,",33309]]],[33617,35103,[["things",33617],["stay",33987],["civil.",34233]]],[35853,36989,[["And",35853],["I",36080],["would",36156],["want",36534],["to",36837]]],[36989,38148,[["do",36989],["that",37140],["like",37443],["that.",37746]]],[38148,39366,[["That",38148],["would",38399],["be",38714],["the",38839],["plan.",39028]]],[39366,40561,[["I",39366],["would",39466],["have",39964],["it",40362]]],[40561,41880,[["all",40561],["ready",40860],["to",41358],["go,",41557]]],[41880,42940,[["but",41880],["then,",42067],["actually,",42379]]],[42940,44398,[["the",42940],["paper",43127],["would",43439],["come",43751],["along,",44000]]],[44398,45369,[["and",44398],["then",44622],["I",44921],["would",44995]]],[45369,46839,[["kind",45369],["of",45667],["do",45816],["this.",45966]]],[48757,49859,[["And",48757],["that",48941],["would",49186],["happen",49492]]],[49859,51400,[["every",49859],["single",50165],["paper.",50533]]],[51638,53167,[["But",51638],["then",51991],["came",52461],["my",52932]]],[53167,55544,[["90-page",53167],["senior",53991],["thesis,",54697]]],[55544,56851,[["a",55544],["paper",55609],["you're",55936],["supposed",56328]]],[56851,57855,[["to",56851],["spend",56982],["a",57308],["year",57374],["on.",57635]]],[57855,58934,[["And",57855],["I",58045],["knew",58109],["for",58363],["a",58553],["paper",58617]]],[58934,60268,[["like",58934],["that,",59188],["my",59506],["normal",59633],["work",60014]]],[60268,61498,[["flow",60268],["was",60522],["not",60712],["an",60903],["option.",61030]]],[61498,62168,[["It",61498],["was",61620],["way",61803],["too",61985]]],[62168,62923,[["big",62168],["a",62351],["project.",62412]]],[62923,64100,[["So",62923],["I",63038],["planned",63096],["things",63500],["out,",63845]]],[64100,65442,[["and",64100],["I",64324],["decided",64398],["I",64920],["kind",64994],["of",65293]]],[65442,67781,[["had",65442],["to",65665],["go",65814],["something",65963],["like",66634],["this.",66932]]],[67781,68507,[["This",67781],["is",68023],["how",68144],["the",68326]]],[68507,69257,[["year",68507],["would",68749],["go.",69052]]],[69257,71248,[["So",69257],["I'd",69464],["start",69775],["off",70292],["light,",70603]]],[71248,72262,[["and",71248],["I'd",71465],["bump",71683],["it",71972],["up",72117]]],[72262,73590,[["in",72262],["the",72407],["middle",72624],["months,",73059]]],[73590,74590,[["and",73590],["then",73778],["at",74028],["the",74153],["end,",74340]]],[74590,75216,[["I",74590],["would",74653],["kick",74966]]],[75216,76240,[["it",75216],["up",75341],["into",75466],["high",75716],["gear",75966]]],[76240,77703,[["just",76240],["like",76470],["a",76700],["little",76758],["staircase.",77103]]],[77703,78673,[["How",77703],["hard",77885],["could",78128],["it",78431],["be",78552]]],[78673,80233,[["to",78673],["walk",78795],["up",79037],["the",79159],["stairs?",79340]]],[80233,82052,[["No",80233],["big",80398],["deal,",80645],["right?",81057]]],[83090,83529,[["But",83090],["then,",83255]]],[83529,84924,[["the",83529],["funniest",83693],["thing",84132],["happened.",84406]]],[84924,86735,[["Those",84924],["first",85252],["few",85580],["months?",85776]]],[86791,87982,[["They",86791],["came",87083],["and",87375],["went,",87593]]],[87982,89591,[["and",87982],["I",88172],["couldn't",88236],["quite",88743],["do",89060],["stuff.",89187]]],[89591,90545,[["So",89591],["we",89710],["had",89830],["an",90009],["awesome",90128]]],[90545,91940,[["new",90545],["revised",90724],["plan.",91142]]],[92655,94314,[["And",92655],["then",93041],["--",93556]]],[95744,97029,[["But",95744],["then",95958],["those",96244],["middle",96601]]],[97029,98552,[["months",97029],["actually",97457],["went",98028],["by,",98314]]],[98552,99360,[["and",98552],["I",98794],["didn't",98875]]],[99360,100758,[["really",99360],["write",99845],["words,",100249]]],[100758,103093,[["and",100758],["so",101102],["we",101331],["were",101561],["here.",102020]]],[103500,104678,[["And",103500],["then",103721],["two",104015],["months",104236]]],[104678,106100,[["turned",104678],["into",105119],["one",105414],["month,",105634]]],[106100,107749,[["which",106100],["turned",106439],["into",106845],["two",107116],["weeks.",107319]]],[107749,109558,[["And",107749],["one",107994],["day",108240],["I",108485],["woke",108567],["up",108894]]],[109724,110859,[["with",109724],["three",110073],["days",110510]]],[110859,112843,[["until",110859],["the",111295],["deadline,",111557]]],[113502,114503,[["still",113502],["not",113860],["having",114074]]],[114503,115457,[["written",114503],["a",115004],["word,",115075]]]].map(([startMs, endMs, words]) => ({
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

  const indicate = (shortcut, kbd, message, hint) => {
    clearTimeout(toastTimer);
    toast.replaceChildren();
    const cap = document.createElement('kbd');
    cap.textContent = kbd;
    const label = document.createElement('span');
    label.textContent = message;
    if (hint) {
      // Phones drop the hint so the toast stays on one line.
      const extra = document.createElement('span');
      extra.className = 'ytsc-toast-hint';
      extra.textContent = ` ${hint}`;
      label.append(extra);
    }
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
    indicate('clean', '⇧C', 'Clean captions: on', '(no um, uh, repeats)');
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
    rewind();
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
      indicate('clean', '⇧C', 'Clean captions: on', '(no um, uh, repeats)');
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

  // The tour's restart, with captions off, is the one seam a visitor sees.
  const rewind = () => {
    if (!player || typeof player.seekTo !== 'function') return;
    try {
      player.seekTo(CLIP_START, true);
    } catch { /* Player not ready. */ }
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
