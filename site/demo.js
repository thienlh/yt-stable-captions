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

  const screen = document.querySelector('.screen');
  const overlay = document.getElementById('ytsc-overlay');
  if (!screen || !overlay) return;

  new ResizeObserver(([entry]) => {
    overlay.style.setProperty('--ytsc-player-h', `${entry.contentRect.height}px`);
  }).observe(screen);

  let player = null;
  let chunk = null;
  let spans = [];
  let active = -1;
  let looping = false;

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
    overlay.textContent = '';
    spans = [];
    if (!next) {
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
  };

  const highlight = (timeMs) => {
    let index = -1;
    const words = chunk.words;
    for (let i = 0; i < words.length; i++) {
      if (words[i].startMs <= timeMs) index = i;
      else break;
    }
    if (index === active) return;
    if (active >= 0) spans[active].classList.remove('ytsc-active');
    active = index;
    if (index >= 0) spans[index].classList.add('ytsc-active');
  };

  const replay = () => {
    if (!player || looping || typeof player.seekTo !== 'function') return;
    looping = true;
    player.seekTo(CLIP_START, true);
    if (player.getPlayerState() !== YT.PlayerState.PLAYING) player.playVideo();
    looping = false;
  };

  const frame = () => {
    if (player && typeof player.getCurrentTime === 'function') {
      const time = player.getCurrentTime();
      if (time >= CLIP_END) replay();
      const ms = time * 1000;
      const next = cueAt(ms);
      paint(next);
      if (next) highlight(ms);
    }
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

  const api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(api);
  requestAnimationFrame(frame);
})();
