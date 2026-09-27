(() => {
  'use strict';

  /**
   * Composition root: wires provider/tap -> parser -> chunker -> lookup -> overlay.
   * Depends on abstractions (constructor injection) so tests can fake the player.
   */
  class StableCaptionsController {
    constructor({
      provider,
      parser,
      chunker,
      lookup,
      overlay,
      log = () => {},
    } = {}) {
      const NS = globalThis.YTSC || {};
      this.provider = provider || new NS.TrackProvider();
      this.parser = parser || new NS.Json3Parser();
      this.chunker = chunker || new NS.CaptionChunker();
      this.lookup = lookup || new NS.CueLookup();
      this.overlay = overlay || new NS.CaptionOverlay();
      this.log = log;
      this.cues = []; // TikTok-style chunks
      this.loadedUrl = null;
      this.videoId = null;
      this.raf = 0;
      this.video = null;
      this._onVideoBound = false;
    }

    start() {
      window.addEventListener('yt-navigate-finish', () => this.reload());
      // The player's own (signed) caption download, captured by timedtext-tap.js.
      // Also fires when the user switches CC language, so we follow their choice.
      window.addEventListener('ytsc:timedtext', (e) => this.onTap(e.detail));
      this.reload();
    }

    tapFor(videoId) {
      const entry = window.__ytscTimedtext;
      return entry && entry.videoId === videoId ? entry : null;
    }

    async onTap(entry) {
      if (!entry || entry.videoId !== this.currentVideoId() || entry.url === this.loadedUrl) return;
      await this.loadFromTap(entry);
    }

    async loadFromTap(entry) {
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
      }
      return this.useTimeline(payload, entry.url, `tap lang=${entry.lang}`);
    }

    useTimeline(payload, url, label) {
      const chunks = this.chunker.build(this.parser.parseWords(payload));
      if (!chunks.length) return false;
      this.stop();
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
      const id = this.currentVideoId();
      if (!id || location.pathname !== '/watch') {
        this.stop();
        return;
      }
      // Wait for the player to expose captions (SPA navigation is async).
      let source = 'none';
      for (let i = 0; i < 40; i++) {
        const found = this.provider.getTracksWithSource
          ? this.provider.getTracksWithSource()
          : { tracks: this.provider.getTracks(), source: 'legacy' };
        if (found.tracks.length) {
          source = found.source;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      this._lastSource = source;
      if (this.currentVideoId() !== id) return; // user navigated away
      if (id === this.videoId && this.cues.length) {
        this.attachVideo();
        return;
      }
      await this.load(id);
    }

    async load(videoId) {
      this.stop();
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
          return;
        }
        const tapped = this.tapFor(videoId);
        if (tapped && (await this.loadFromTap(tapped))) return;
        this.log(`[ytsc] loading track ${best.languageCode} kind=${best.kind || 'manual'} source=${found.source} (${tracks.length} tracks)`);
        try {
          const payload = await this.provider.fetchJson3(best);
          if (!this.useTimeline(payload, best.baseUrl, 'fetch mode')) throw new Error('no words in payload');
        } catch (err) {
          // Timedtext is increasingly gated (empty body). Live DOM until the player's
          // own download is tapped (turn CC on), then onTap switches to timeline mode.
          this.log(`[ytsc] fetch failed, live mode: ${err?.message || err}`);
          this.startLiveMode();
        }
      } catch (err) {
        this.log(`[ytsc] load failed: ${err?.message || err}`);
      }
    }

    attachVideo() {
      this.video = document.querySelector('video.html5-main-video');
      if (!this.video) return;
      if (!this._onVideoBound) {
        this._onVideoBound = true;
      }
      cancelAnimationFrame(this.raf);
      const tick = () => {
        if (!document.body.contains(this.video)) {
          this.video = document.querySelector('video.html5-main-video');
          if (!this.video) {
            this.raf = requestAnimationFrame(tick);
            return;
          }
        }
        const timeMs = this.video.currentTime * 1000;
        this.overlay.render(this.lookup.atTime(this.cues, timeMs), timeMs);
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    }

    startLiveMode() {
      const NS = globalThis.YTSC || {};
      this.stop();
      this.liveMode = true;
      this.overlay.mount();
      this.log('[ytsc] live mode: stabilizing native captions (enable CC in player)');
      const DomSource = NS.LiveDomSource;
      if (!DomSource || !NS.LiveChunker) {
        this.log('[ytsc] live mode unavailable (missing live-source.js), reload extension');
        return;
      }
      this.live = new DomSource({
        onChunk: (chunk) => {
          this.overlay.render(chunk);
          clearTimeout(this.liveHold);
          this.liveHold = setTimeout(() => this.overlay.render(null), 3000);
        },
      });
      this.live.start();
    }

    stop() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.cues = [];
      this.loadedUrl = null;
      this.video = null;
      clearTimeout(this.liveHold);
      this.live?.stop();
      this.live = null;
      this.liveMode = false;
      this.overlay.clear();
    }
  }

  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, { StableCaptionsController });

  // Auto-start in the page (not under node:test).
  if (typeof window !== 'undefined' && window.document && !globalThis.YTSC_STARTED) {
    globalThis.YTSC_STARTED = true;
    const start = () => new StableCaptionsController({ log: console.debug.bind(console) }).start();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }
})();
