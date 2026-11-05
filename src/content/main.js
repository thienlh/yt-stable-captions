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
      disfluency,
      lookup,
      overlay,
      log = () => {},
    } = {}) {
      const NS = globalThis.YTSC || {};
      this.provider = provider || new NS.TrackProvider();
      this.parser = parser || new NS.Json3Parser();
      this.chunker = chunker || new NS.CaptionChunker();
      this.disfluency = disfluency || new NS.Disfluency();
      this.lookup = lookup || new NS.CueLookup();
      this.overlay = overlay || new NS.CaptionOverlay();
      this.log = log;
      this.cues = []; // caption chunks
      this.words = []; // timed words of the loaded track (re-chunked when settings change)
      this.loadedUrl = null;
      this.videoId = null;
      this.raf = 0;
      this.video = null;
      this.originalSelection = null;
      this.selectionVideoId = null;
      this.languageSwitching = false;
      this.pendingSelection = null;
      this.selectionTimeoutMs = 10000;
      this.taps = []; // this video's tapped downloads, reused when the player answers from its cache
      this.loadGeneration = 0; // bumped by every new caption source; stale downloads check it
      this.activeCaptionLanguage = null;
      this.captionChoiceAt = 0; // last trusted click on a caption row in YouTube's menu
      this.captionChoiceMs = 5000;
      this.applyingPlayerTrack = false;
      this.toastTimer = 0;
    }

    start() {
      window.addEventListener('yt-navigate-finish', () => this.reload());
      // The player's own (signed) caption download, captured by timedtext-tap.js.
      // Also fires when the user switches CC language, so we follow their choice.
      window.addEventListener('ytsc:timedtext', (e) => this.onTap(e.detail));
      window.addEventListener('keydown', (e) => {
        this.onCaptionMenuEvent(e);
        this.onLanguageKey(e);
      }, true);
      // Capture runs before YouTube's own menu handler, so a caption click is armed
      // before the player applies the track.
      window.addEventListener('click', (e) => this.onCaptionMenuEvent(e), true);
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
      if (!this.cues.length && !this.live) return;
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

    async onTap(entry) {
      if (!entry || entry.videoId !== this.currentVideoId()) return;
      this.rememberTap(entry);
      if (entry.url === this.loadedUrl) return;
      const pending = this.pendingSelection;
      if (!pending) {
        const previousLanguage = this.activeCaptionLanguage;
        const loaded = await this.loadFromTap(entry);
        if (loaded) this.learnManualSelection(entry, previousLanguage);
        return;
      }
      // While a shortcut switch is in flight, only the requested language may load.
      if (pending.videoId !== entry.videoId || !this.entryMatchesSelection(entry, pending.selection)) return;
      this.pendingSelection = null;
      // The timeout keeps running: a non-JSON tap is downloaded again, which can stall.
      let loaded = false;
      try {
        loaded = await this.loadFromTap(entry);
      } finally {
        clearTimeout(pending.timer);
        pending.resolve?.(loaded);
      }
    }

    rememberTap(entry) {
      this.taps = this.taps.filter((t) => t.videoId === entry.videoId && t.url !== entry.url);
      this.taps.push(entry);
      if (this.taps.length > 8) this.taps.shift();
    }

    cachedTap(selection) {
      const videoId = this.currentVideoId();
      return this.taps.findLast((t) => t.videoId === videoId && this.entryMatchesSelection(t, selection)) || null;
    }

    settlePending(loaded) {
      const pending = this.pendingSelection;
      this.pendingSelection = null;
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.resolve?.(loaded);
    }

    async loadFromTap(entry) {
      const generation = ++this.loadGeneration;
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
        // A language switch or navigation started while this downloaded: it no longer applies.
        if (generation !== this.loadGeneration) return false;
      }
      return this.useTimeline(payload, entry.url, `tap lang=${entry.lang}`);
    }

    useTimeline(payload, url, label) {
      const words = this.parser.parseWords(payload);
      const chunks = this.buildChunks(words);
      if (!words.length) return false;
      this.stop();
      this.words = words;
      this.cues = chunks;
      this.noteLoadedCaption(url);
      this.loadedUrl = url;
      this.log(`[ytsc] ${chunks.length} chunks (${label})`);
      this.overlay.mount();
      this.attachVideo();
      return true;
    }

    entryMatchesSelection(entry, selection) {
      const { TrackProvider } = globalThis.YTSC;
      try {
        const u = new URL(entry.url, globalThis.location?.href || 'https://www.youtube.com/');
        // Manual and ASR tracks share a language code; only `kind` tells them apart.
        // A translation names its source track the same way, plus `tlang`.
        const sameSource = TrackProvider.normalizeLanguage(u.searchParams.get('lang')) ===
            TrackProvider.normalizeLanguage(selection.track.languageCode) &&
          (u.searchParams.get('kind') || '') === (selection.track.kind || '');
        const translated = u.searchParams.get('tlang');
        if (selection.translationLanguage) {
          return sameSource && TrackProvider.languageMatches(translated, selection.translationLanguage);
        }
        return sameSource && !translated;
      } catch {
        return false;
      }
    }

    onLanguageKey(e) {
      if (e.key !== 'L' || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const target = e.target;
      if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]')) return;
      if ((!this.cues.length && !this.live) || !this.captionsEnabled()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void this.toggleCaptionLanguage();
    }

    browserLanguage() {
      return globalThis.navigator?.language || '';
    }

    learnedCaptionLanguage() {
      return globalThis.document?.documentElement?.dataset?.ytscLearnedLanguage || '';
    }

    preferredCaptionLanguage() {
      return this.learnedCaptionLanguage() || this.browserLanguage();
    }

    noteCaptionLanguage(language) {
      language = globalThis.YTSC.TrackProvider.normalizeLanguage(language);
      if (!language) return;
      this.activeCaptionLanguage = language;
    }

    noteLoadedCaption(url) {
      this.noteCaptionLanguage(globalThis.YTSC.TrackProvider.languageFromUrl(url));
      this.freezeOriginal(url);
    }

    /**
     * Original means the video's own captions. YouTube opens the next video in
     * the language you just picked, so that first download must not become the
     * track Shift+L restores. A preferred-language placeholder is replaced once
     * the real source is known.
     */
    freezeOriginal(url) {
      const { TrackProvider } = globalThis.YTSC;
      const videoId = this.currentVideoId();
      if (!videoId) return;
      const found = this.provider.getTracksWithSource
        ? this.provider.getTracksWithSource()
        : { tracks: this.provider.getTracks?.() || [], defaultTrack: null };
      const tracks = found.tracks || [];
      let defaultTrack = found.defaultTrack || null;
      if (defaultTrack && !TrackProvider.sameVideo(defaultTrack, videoId)) defaultTrack = null;
      if (defaultTrack) {
        this.selectionVideoId = videoId;
        this.originalSelection = { track: defaultTrack, translationLanguage: null };
        return;
      }
      const observed = (url && TrackProvider.selectionFromUrl(url, tracks)) ||
        (this.selectionVideoId === videoId ? this.originalSelection : null);
      const selection = TrackProvider.videoOriginal({
        observed,
        preferred: this.preferredCaptionLanguage(),
      });
      if (!selection?.track) return;
      const prior = this.selectionVideoId === videoId ? this.originalSelection : null;
      if (prior && !this.isPreferredSelection(prior) && this.isPreferredSelection(selection)) return;
      this.selectionVideoId = videoId;
      this.originalSelection = selection;
    }

    isPreferredSelection(selection) {
      if (!selection?.track) return false;
      const visible = selection.translationLanguage || selection.track.languageCode;
      return globalThis.YTSC.TrackProvider.languageMatches(visible, this.preferredCaptionLanguage());
    }

    /**
     * A caption row in YouTube's settings menu, not a quality or speed row.
     * Only a trusted click or Enter/Space counts: the player's own downloads
     * are not a choice.
     */
    onCaptionMenuEvent(event) {
      if (!event?.isTrusted) return;
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      if (event.type === 'keydown' && event.repeat) return;
      const label = this.captionMenuLabel(event.target);
      if (!label) return;
      this.watchPlayer();
      this.armCaptionMenuChoice(label);
    }

    captionMenuLabel(target) {
      const item = target?.closest?.('.ytp-menuitem');
      if (!item?.closest?.('.ytp-settings-menu, .ytp-popup')) return '';
      return item.querySelector?.('.ytp-menuitem-label')?.textContent?.trim() || '';
    }

    armCaptionMenuChoice(label) {
      const found = this.provider.getTracksWithSource
        ? this.provider.getTracksWithSource()
        : { tracks: this.provider.getTracks?.() || [], translationLanguages: [] };
      const { TrackProvider } = globalThis.YTSC;
      if (!TrackProvider.matchesCaptionLabel(label, found.tracks, found.translationLanguages)) return false;
      this.captionChoiceAt = Date.now();
      return true;
    }

    captionMenuArmed() {
      return this.captionChoiceAt > 0 && Date.now() - this.captionChoiceAt < this.captionChoiceMs;
    }

    /**
     * YouTube applies a menu choice through setOption. Wrapping it catches the
     * language even when the signed download is slow. Calls with no preceding
     * caption-menu gesture are the player's own, and are ignored.
     */
    watchPlayer() {
      const player = this.provider.getPlayer?.();
      if (!player || player.__ytscSetOption || typeof player.setOption !== 'function') return;
      const original = player.setOption.bind(player);
      const controller = this;
      player.setOption = function (module, option, value) {
        const result = original(module, option, value);
        if (module === 'captions' && option === 'track') controller.notePlayerTrackChoice(value);
        return result;
      };
      player.__ytscSetOption = true;
    }

    notePlayerTrackChoice(track) {
      if (this.applyingPlayerTrack || this.languageSwitching || !this.captionMenuArmed()) return;
      const language = globalThis.YTSC.TrackProvider.normalizeLanguage(
        track?.translationLanguage?.languageCode || track?.languageCode
      );
      if (!language) return;
      this.captionChoiceAt = 0;
      this.reportManualLanguage(language);
    }

    learnManualSelection(entry, previousLanguage) {
      if (this.languageSwitching || this.pendingSelection || !this.captionMenuArmed()) return;
      const selected = globalThis.YTSC.TrackProvider.languageFromUrl(entry.url);
      // A refetch of the language already showing leaves the gesture armed for
      // the download of the row the user actually picked.
      if (!selected || selected === previousLanguage) return;
      this.captionChoiceAt = 0;
      this.reportManualLanguage(selected);
    }

    reportManualLanguage(language) {
      // document is shared with the isolated-world bridge; each world's window is not.
      // A JSON string crosses where a detail object does not (notably Firefox).
      const target = globalThis.document;
      if (!target?.dispatchEvent) return;
      target.dispatchEvent(new CustomEvent('ytsc:manual-caption-language', {
        detail: JSON.stringify({ language }),
      }));
    }

    languageName(code) {
      try {
        return new Intl.DisplayNames([this.browserLanguage() || 'en'], { type: 'language' }).of(code) || code;
      } catch {
        return code;
      }
    }

    captureOriginalSelection(tracks) {
      const videoId = this.currentVideoId();
      const tapped = this.tapFor(videoId);
      this.freezeOriginal(this.loadedUrl || tapped?.url);
      if (this.selectionVideoId === videoId && this.originalSelection) return this.originalSelection;
      let selection = globalThis.YTSC.TrackProvider.selectionFromUrl(this.loadedUrl || tapped?.url, tracks);
      if (!selection) {
        const player = this.provider.getPlayer?.();
        try {
          // The player reports an auto-translation on the track itself.
          const current = player?.getOption?.('captions', 'track');
          const sameKind = (t) => (t.kind || '') === (current?.kind || '');
          const track = current?.languageCode &&
            (this.provider.pickLanguage(tracks.filter(sameKind), current.languageCode) ||
              this.provider.pickLanguage(tracks, current.languageCode));
          if (track) selection = { track, translationLanguage: current.translationLanguage?.languageCode || null };
        } catch { /* use the provider's default below */ }
      }
      if (!selection) selection = { track: this.provider.pickBest(tracks), translationLanguage: null };
      this.selectionVideoId = videoId;
      this.originalSelection = selection.track ? selection : null;
      if (this.originalSelection && !this.activeCaptionLanguage) {
        this.noteCaptionLanguage(this.originalSelection.translationLanguage || this.originalSelection.track.languageCode);
      }
      return this.originalSelection;
    }

    /**
     * Switches the player itself, like its own subtitles menu, so a later download
     * (CC toggled, player rebuilt) brings back the same language instead of the old
     * one. Our own fetch could not do that, and a rewritten URL can't auto-translate.
     * Returns null if the player didn't switch, else a promise of whether the new
     * captions loaded.
     */
    switchPlayerCaptions(selection) {
      const player = this.provider.getPlayer?.();
      if (!player || typeof player.setOption !== 'function') return null;
      const track = { languageCode: selection.track.languageCode };
      if (selection.track.kind) track.kind = selection.track.kind;
      // The player takes auto-translation on the track, not as a separate option.
      if (selection.translationLanguage) track.translationLanguage = { languageCode: selection.translationLanguage };
      // The player may answer a track it loaded before from its cache, without a download.
      const cached = this.cachedTap(selection);
      const pending = cached ? null : { selection, videoId: this.currentVideoId() };
      const loaded = pending && new Promise((resolve) => { pending.resolve = resolve; });
      this.settlePending(false);
      this.pendingSelection = pending;
      this.loadGeneration++;
      this.watchPlayer();
      this.applyingPlayerTrack = true;
      try {
        player.setOption('captions', 'track', track);
      } catch (err) {
        this.settlePending(false);
        this.log(`[ytsc] player language switch failed: ${err?.message || err}`);
        return null;
      } finally {
        this.applyingPlayerTrack = false;
      }
      // The player is on this track now, even if its download has not arrived.
      this.noteCaptionLanguage(selection.translationLanguage || selection.track.languageCode);
      if (cached) return this.loadFromTap(cached);
      // YouTube's request is captured by timedtext-tap; live captions bridge the gap.
      this.startLiveMode();
      // Fires while waiting for the tap or while loading it; a promise settles only once.
      pending.timer = setTimeout(() => {
        if (this.pendingSelection === pending) this.pendingSelection = null;
        pending.resolve(false);
      }, this.selectionTimeoutMs);
      return loaded;
    }

    activeMatchesLanguage(language) {
      const { TrackProvider } = globalThis.YTSC;
      return TrackProvider.languageMatches(this.activeCaptionLanguage, language);
    }

    /** The preferred-language selection, or an error toast string. */
    preferredSelection(found, original) {
      const requested = this.preferredCaptionLanguage();
      if (!requested) return { error: 'Caption language unavailable' };
      const direct = this.provider.pickLanguage(found.tracks, requested);
      if (direct) return { selection: { track: direct, translationLanguage: null } };
      const languages = found.translationLanguages || [];
      const supported = this.provider.findTranslationLanguage(languages, requested);
      if (languages.length && !supported) {
        return { error: `${this.languageName(requested)} captions unavailable` };
      }
      return {
        selection: {
          track: original.track,
          translationLanguage: supported?.languageCode || requested,
        },
      };
    }

    showingSelection(selection) {
      if (!selection?.track || !this.loadedUrl) return false;
      if (!this.entryMatchesSelection({ url: this.loadedUrl }, selection)) return false;
      // The player can already be on another language while the previous download's
      // URL is still the one we loaded. Trust the language we last asked for.
      const { TrackProvider } = globalThis.YTSC;
      const visible = TrackProvider.normalizeLanguage(selection.translationLanguage || selection.track.languageCode);
      return !this.activeCaptionLanguage || TrackProvider.languageMatches(this.activeCaptionLanguage, visible);
    }

    async toggleCaptionLanguage() {
      if (this.languageSwitching) return;
      this.languageSwitching = true;
      // This press is ours. A caption click just before it must not be learned
      // from the download the shortcut itself triggers.
      this.captionChoiceAt = 0;
      try {
        const videoId = this.currentVideoId();
        const found = this.provider.getTracksWithSource
          ? this.provider.getTracksWithSource()
          : { tracks: this.provider.getTracks(), translationLanguages: [] };
        const original = this.captureOriginalSelection(found.tracks);
        if (!original) {
          this.showToast('No captions available');
          return;
        }
        const preferred = this.preferredSelection(found, original);
        if (preferred.error) {
          this.showToast(preferred.error);
          return;
        }
        // Follow the language on screen: preferred goes back to the video's
        // original, anything else goes to preferred.
        const selection = this.activeMatchesLanguage(this.preferredCaptionLanguage())
          ? original
          : preferred.selection;
        if (this.showingSelection(selection)) {
          const name = this.languageName(selection.translationLanguage || selection.track.languageCode);
          this.showToast(`Captions: ${name}`);
          return;
        }
        const loading = this.switchPlayerCaptions(selection);
        if (!loading) {
          this.showToast('Could not switch caption language');
          return;
        }
        const loaded = await loading;
        if (videoId !== this.currentVideoId()) return;
        const name = this.languageName(selection.translationLanguage || selection.track.languageCode);
        const autoTranslated = Boolean(selection.translationLanguage);
        this.showToast(loaded
          ? `Captions: ${name}${autoTranslated ? ' (auto-translated)' : ''}`
          : `${name} captions did not load`);
      } finally {
        this.languageSwitching = false;
      }
    }

    showToast(text) {
      const player = this.overlay.el?.parentElement || document.querySelector('.html5-video-player');
      if (!player) return;
      let el = document.getElementById('ytsc-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'ytsc-toast';
        player.appendChild(el);
      }
      el.textContent = text;
      el.classList.add('ytsc-toast-visible');
      clearTimeout(this.toastTimer);
      // settings-bridge.js shows this toast too, with its own timer: hide only our message.
      this.toastTimer = setTimeout(() => {
        if (el.textContent === text) el.classList.remove('ytsc-toast-visible');
      }, 1600);
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
      if (this.videoId !== videoId) {
        this.originalSelection = null;
        this.selectionVideoId = null;
        this.activeCaptionLanguage = null;
        this.captionChoiceAt = 0;
        this.settlePending(false);
      }
      this.videoId = videoId;
      this.loadGeneration++;
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
        if (tapped) this.rememberTap(tapped);
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
      if (!this.cues.length) return; // live mode paints from its own source
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
        chunker: new NS.LiveChunker({ style: document.documentElement.dataset.ytscStyle }),
        onChunk: (chunk) => {
          if (!this.captionsEnabled()) return;
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
      this.liveMode = false;
      this.overlay.clear();
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
