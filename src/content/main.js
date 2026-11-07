(() => {
  'use strict';

  /**
   * Composition root: wires provider/tap -> parser -> chunker -> lookup -> overlay.
   * Depends on abstractions (constructor injection) so tests can fake the player.
   *
   * `mode` is where the controller is:
   *   idle      not on a watch page (native captions untouched)
   *   loading   finding and fetching this video's captions
   *   timeline  the whole caption track is known; painted from video time
   *   live      stabilizing the native caption DOM as it changes
   *   none      nothing to show for this video (native captions untouched)
   * Every async step (navigation, track polling, fetches) runs under a
   * generation number and gives up if a newer step has started since, so a
   * slow answer for an old video or an old source never replaces a newer one.
   */
  class StableCaptionsController {
    constructor({
      provider,
      parser,
      chunker,
      disfluency,
      lookup,
      overlay,
      log = () => {},
      pollMs = 250,
    } = {}) {
      const NS = globalThis.YTSC || {};
      this.provider = provider || new NS.TrackProvider();
      this.parser = parser || new NS.Json3Parser();
      this.chunker = chunker || new NS.CaptionChunker();
      this.disfluency = disfluency || new NS.Disfluency();
      this.lookup = lookup || new NS.CueLookup();
      this.overlay = overlay || new NS.CaptionOverlay();
      this.log = log;
      this.pollMs = pollMs;
      this.mode = 'idle';
      this.gen = 0; // bumped by each navigation and each newly installed timeline
      this.live = null;
      this.cues = []; // caption chunks
      this.words = []; // timed words of the loaded track (re-chunked when settings change)
      this.loadedUrl = null;
      this.videoId = null;
      this.raf = 0;
      this.video = null;
    }

    start() {
      window.addEventListener('yt-navigate-finish', () => this.reload());
      // The player's own (signed) caption download, captured by timedtext-tap.js.
      // Also fires when the user switches CC language, so we follow their choice.
      window.addEventListener('ytsc:timedtext', (e) => this.onTap(e.detail));
      // Media events don't bubble, but a capturing listener on document still sees
      // them, including from a <video> YouTube swapped in (e.g. after a long sleep).
      for (const type of ['play', 'pause', 'seeked', 'loadeddata']) {
        document.addEventListener(type, (e) => this.onMediaEvent(e), true);
      }
      // "Clean verbatim" and the style (chunk length) are popup settings mirrored onto
      // <html> by settings-bridge.js.
      // aria-pressed on the CC button repaints while paused (no frame loop then).
      this.followStyle();
      new MutationObserver((records) => {
        const changed = (name) => records.some((r) => r.attributeName === name);
        if (changed('data-ytsc-style')) this.followStyle();
        if (changed('data-ytsc-clean') || changed('data-ytsc-style')) this.rechunk();
        if (records.some((r) => r.target.matches?.('.ytp-subtitles-button'))) this.renderNow();
      }).observe(document.documentElement, {
        attributes: true,
        subtree: true,
        attributeFilter: ['data-ytsc-clean', 'data-ytsc-style', 'aria-pressed'],
      });
      this.reload();
    }

    onMediaEvent(e) {
      if (!e.target.matches?.('video.html5-main-video')) return;
      if (this.mode !== 'timeline' && this.mode !== 'live') return;
      this.video = e.target;
      this.overlay.mount(); // re-homes the overlay if YouTube rebuilt the player
      this.live?.observe();
      this.renderNow();
    }

    cleanEnabled() {
      return document.documentElement.dataset.ytscClean === 'true';
    }

    /** Each style has its own chunk length (see chunker.js). */
    followStyle() {
      const style = document.documentElement.dataset.ytscStyle;
      this.chunker.setStyle?.(style);
      this.live?.chunker.setStyle?.(style);
    }

    buildChunks(words) {
      return this.chunker.build(this.cleanEnabled() ? this.disfluency.clean(words) : words);
    }

    rechunk() {
      if (!this.words.length) return;
      this.cues = this.buildChunks(this.words);
      this.renderNow();
    }

    tapFor(videoId) {
      const entry = window.__ytscTimedtext;
      return entry && entry.videoId === videoId ? entry : null;
    }

    /**
     * The player's own caption download. It is signed and in the language the
     * viewer picked, so it replaces whatever is showing or still loading.
     */
    async onTap(entry) {
      if (!entry || entry.videoId !== this.currentVideoId() || entry.url === this.loadedUrl) return;
      await this.loadFromTap(entry, this.gen);
    }

    async loadFromTap(entry, gen) {
      let payload = null;
      try {
        payload = JSON.parse(entry.body);
      } catch {
        // Player asked for another format; the same signed URL works as json3.
        try {
          payload = await this.provider.fetchUrl(globalThis.YTSC.TrackProvider.withJson3(entry.url));
        } catch (err) {
          this.log(`[ytsc] tap refetch failed: ${err?.message || err}`);
          return false;
        }
        if (gen !== this.gen) return false; // navigated, or a newer timeline arrived
      }
      if (!this.useTimeline(payload, entry.url, `tap lang=${entry.lang}`)) return false;
      this.videoId = entry.videoId;
      return true;
    }

    /** Installs a timeline; anything still loading for the old state is dropped. */
    useTimeline(payload, url, label) {
      const words = this.parser.parseWords(payload);
      const chunks = this.buildChunks(words);
      if (!words.length) return false;
      this.stop();
      this.gen++;
      this.mode = 'timeline';
      this.words = words;
      this.cues = chunks;
      this.loadedUrl = url;
      this.log(`[ytsc] ${chunks.length} chunks (${label})`);
      this.overlay.mount();
      this.attachVideo();
      return true;
    }

    currentVideoId() {
      try {
        return new URLSearchParams(location.search).get('v');
      } catch {
        return null;
      }
    }

    async reload() {
      const gen = ++this.gen; // supersedes any older reload, load or tap refetch
      const id = this.currentVideoId();
      if (!id || location.pathname !== '/watch') {
        // Also the mini player: leave its native captions alone.
        this.release('idle');
        return;
      }
      // Wait for the player to expose captions (SPA navigation is async).
      for (let i = 0; i < 40; i++) {
        const found = this.provider.getTracksWithSource
          ? this.provider.getTracksWithSource()
          : { tracks: this.provider.getTracks() };
        if (found.tracks.length) break;
        await new Promise((r) => setTimeout(r, this.pollMs));
        if (gen !== this.gen) return; // navigated again, or a tap installed a timeline
      }
      if (gen !== this.gen || this.currentVideoId() !== id) return;
      if (id === this.videoId && this.mode === 'timeline') {
        this.attachVideo();
        return;
      }
      await this.load(id, gen);
    }

    async load(videoId, gen = ++this.gen) {
      this.stop();
      this.mode = 'loading';
      this.videoId = videoId;
      try {
        const found = this.provider.getTracksWithSource
          ? this.provider.getTracksWithSource()
          : { tracks: this.provider.getTracks(), source: 'legacy' };
        const tracks = found.tracks;
        const best = this.provider.pickBest(tracks);
        if (!best) {
          const player = document.getElementById('movie_player');
          let hint = 'no-player';
          try {
            const resp = player?.getPlayerResponse?.();
            hint = resp ? `resp-keys=${Object.keys(resp).join(',')}` : 'empty-response';
            if (resp?.captions) hint += ` captions-keys=${Object.keys(resp.captions).join(',')}`;
          } catch (e) { hint = `err=${e?.message}`; }
          this.log(`[ytsc] no caption tracks (source=${found.source}, ${hint}, init=${window.ytInitialPlayerResponse ? 'yes' : 'no'})`);
          this.release('none');
          return;
        }
        const tapped = this.tapFor(videoId);
        if (tapped && (await this.loadFromTap(tapped, gen))) return;
        if (gen !== this.gen) return;
        this.log(`[ytsc] loading track ${best.languageCode} kind=${best.kind || 'manual'} source=${found.source} (${tracks.length} tracks)`);
        try {
          const payload = await this.provider.fetchJson3(best);
          if (gen !== this.gen) return; // navigated, or the player's own download won
          if (!this.useTimeline(payload, best.baseUrl, 'fetch mode')) throw new Error('no words in payload');
        } catch (err) {
          if (gen !== this.gen) return;
          // Timedtext is increasingly gated (empty body). Live DOM until the player's
          // own download is tapped (turn CC on), then onTap switches to timeline mode.
          this.log(`[ytsc] fetch failed, live mode: ${err?.message || err}`);
          this.startLiveMode();
        }
      } catch (err) {
        this.log(`[ytsc] load failed: ${err?.message || err}`);
        if (gen === this.gen) this.release('none');
      }
    }

    /** Follows the player's own CC toggle (the `c` key or the CC button). */
    captionsEnabled() {
      const button = document.querySelector('.ytp-subtitles-button');
      return !button || button.getAttribute('aria-pressed') !== 'false';
    }

    attachVideo() {
      this.video = document.querySelector('video.html5-main-video');
      this.renderNow();
    }

    /**
     * Paints the cue at the current time, then keeps a frame loop going only while
     * the video plays. A paused video is repainted by onMediaEvent (seek, play) or a
     * CC toggle, so paused tabs do no per-frame work.
     */
    renderNow() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.mode === 'live') {
        // Live mode paints from its own source; CC off takes its caption down now.
        if (!this.captionsEnabled()) this.hideLiveChunk();
        return;
      }
      if (!this.cues.length) return;
      const tick = () => {
        this.raf = 0;
        if (!this.video?.isConnected) this.video = document.querySelector('video.html5-main-video');
        // No video yet: its 'loadeddata'/'play' event calls back in.
        if (!this.video) return;
        const timeMs = this.video.currentTime * 1000;
        const cue = this.captionsEnabled() ? this.lookup.atTime(this.cues, timeMs) : null;
        this.overlay.render(cue, timeMs);
        if (!this.video.paused) this.raf = requestAnimationFrame(tick);
      };
      tick();
    }

    startLiveMode() {
      const NS = globalThis.YTSC || {};
      const DomSource = NS.LiveDomSource;
      if (!DomSource || !NS.LiveChunker) {
        this.log('[ytsc] live mode unavailable (missing live-source.js), reload extension');
        this.release('none');
        return;
      }
      this.stop();
      this.mode = 'live';
      this.overlay.mount();
      this.log('[ytsc] live mode: stabilizing native captions (enable CC in player)');
      this.live = new DomSource({
        chunker: new NS.LiveChunker({ style: document.documentElement.dataset.ytscStyle }),
        onChunk: (chunk) => {
          if (!this.captionsEnabled()) {
            this.hideLiveChunk();
            return;
          }
          // Live chunks are cleaned one at a time (repeats spanning two chunks stay).
          if (this.cleanEnabled()) {
            const words = this.disfluency.clean(chunk.words);
            if (!words.length) return;
            chunk = { ...chunk, words, text: words.map((w) => w.text).join(' ') };
          }
          this.overlay.render(chunk);
          clearTimeout(this.liveHold);
          this.liveHold = setTimeout(() => this.overlay.render(null), 3000);
        },
      });
      this.live.start();
    }

    hideLiveChunk() {
      clearTimeout(this.liveHold);
      this.overlay.render(null);
    }

    /** Tears down what is showing. Native captions stay hidden (a load may follow). */
    stop() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.cues = [];
      this.words = [];
      this.loadedUrl = null;
      this.video = null;
      clearTimeout(this.liveHold);
      this.live?.stop();
      this.live = null;
      this.mode = 'idle';
      this.overlay.clear();
    }

    /** Nothing of ours to show: remove the overlay and give native captions back. */
    release(mode) {
      this.stop();
      this.mode = mode;
      this.overlay.destroy();
    }
  }

  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, { StableCaptionsController });

  // Auto-start in the page (not under node:test). In an isolated content-script
  // world the player API is invisible, so don't start there.
  const isolatedWorld = Boolean((globalThis.browser ?? globalThis.chrome)?.runtime?.id);
  if (typeof window !== 'undefined' && window.document && !isolatedWorld && !globalThis.YTSC_STARTED) {
    globalThis.YTSC_STARTED = true;
    const start = () => new StableCaptionsController({ log: console.debug.bind(console) }).start();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }
})();
