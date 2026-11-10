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
   * Async steps can finish out of order, so each checks it is still wanted:
   *  - `gen` counts navigations; anything started for an earlier page is dropped.
   *  - The player's own download (a tap) outranks our fetch: our fetch never
   *    replaces a tapped timeline, and among taps only the newest one installs.
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
      this.gen = 0; // bumped by each navigation
      this.tapSeq = 0; // bumped by each tap, so an older tap refetch loses
      this.source = null; // 'tap' | 'fetch': where the installed timeline came from
      this.live = null;
      this.cues = []; // caption chunks
      this.words = []; // timed words of the loaded track (re-chunked when settings change)
      this.loadedUrl = null;
      this.videoId = null;
      this.raf = 0;
      this.video = null;
      this.originalSelection = null;
      this.selectionVideoId = null;
      this.startSeenFor = null; // video whose starting captions are already known or left behind
      this.languageSwitching = false;
      this.pendingSelection = null;
      this.selectionTimeoutMs = 10000;
      this.cacheMissRefetchMs = 250; // let a normal player download win before refetching
      this.taps = []; // this video's tapped downloads, reused when the player answers from its cache
      this.tapCacheLimit = 4;
      this.tapCacheCharLimit = 1000000; // total UTF-16 code units, not eight unbounded bodies
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
      if (!entry) return;
      if (entry.videoId !== this.currentVideoId()) {
        // The tap bridge publishes before the controller sees the event. Do not
        // let an unwanted mini-player/other-video response linger in that global.
        if (globalThis.window?.__ytscTimedtext === entry) delete globalThis.window.__ytscTimedtext;
        return;
      }
      this.rememberTap(entry);
      if (entry.url === this.loadedUrl) return;
      const pending = this.pendingSelection;
      if (!pending) {
        const previousLanguage = this.activeCaptionLanguage;
        const loaded = await this.loadFromTap(entry);
        if (loaded) this.learnManualSelection(entry, previousLanguage);
        return;
      }
      // Until a shortcut switch ends, only its requested language may load: a
      // late download of another language would show it and discard the
      // requested one.
      if (pending.videoId !== entry.videoId || !this.entryMatchesSelection(entry, pending.selection)) return;
      // A matching tap is now the preferred load attempt. Do not let the delayed
      // cache-miss fallback supersede its in-flight JSON3 refetch.
      clearTimeout(pending.refetchTimer);
      await this.loadForSwitch(pending, entry);
    }

    /**
     * Loads a download of the language a shortcut switch asked for. A newer one
     * (a fresh download while a cached one is fetched again) takes over, so only
     * the latest attempt may end the switch as failed. The timeout keeps running:
     * a non-JSON download is fetched again, which can stall.
     */
    async loadForSwitch(pending, entry, payloadPromise = null) {
      const attempt = pending.attempts = (pending.attempts || 0) + 1;
      let loaded = false;
      try {
        loaded = await this.loadFromTap(entry, payloadPromise);
      } finally {
        if (loaded || pending.attempts === attempt) this.settleSwitch(pending, loaded);
      }
    }

    /** An evicted track may not produce a player download when it comes from YouTube's cache. */
    refetchForSwitch(pending) {
      const { TrackProvider } = globalThis.YTSC;
      const selection = pending.selection;
      const url = new URL(selection.track.baseUrl, globalThis.location?.href || 'https://www.youtube.com/');
      if (selection.translationLanguage) url.searchParams.set('tlang', selection.translationLanguage);
      else url.searchParams.delete('tlang');
      const requestUrl = TrackProvider.withJson3(url.toString());
      const entry = {
        url: requestUrl,
        body: '',
        videoId: pending.videoId,
        lang: selection.translationLanguage || selection.track.languageCode,
        at: Date.now(),
      };
      return this.loadForSwitch(pending, entry, this.provider.fetchUrl(requestUrl));
    }

    rememberTap(entry) {
      this.taps = this.taps.filter((t) => t.videoId === entry.videoId && t.url !== entry.url);
      this.taps.push(entry);
      this.pruneTapCache(entry.videoId);
      // An oversized/evicted response still loads through onTap's local reference,
      // but must not stay alive through the tap bridge's latest-entry global.
      if (globalThis.window?.__ytscTimedtext === entry && !this.taps.includes(entry)) {
        delete globalThis.window.__ytscTimedtext;
      }
    }

    pruneTapCache(videoId) {
      this.taps = this.taps.filter((entry) => entry.videoId === videoId);
      let chars = this.taps.reduce((sum, entry) => sum + (entry.body?.length || 0), 0);
      while (this.taps.length > this.tapCacheLimit || chars > this.tapCacheCharLimit) {
        chars -= this.taps[0].body?.length || 0;
        this.taps.shift();
      }
      const latest = globalThis.window?.__ytscTimedtext;
      if (latest && latest.videoId !== videoId) delete globalThis.window.__ytscTimedtext;
    }

    clearTapCache() {
      this.taps = [];
      if (globalThis.window?.__ytscTimedtext) delete globalThis.window.__ytscTimedtext;
    }

    cachedTap(selection) {
      const videoId = this.currentVideoId();
      return this.taps.findLast((t) => t.videoId === videoId && this.entryMatchesSelection(t, selection)) || null;
    }

    settlePending(result) {
      this.settleSwitch(this.pendingSelection, result);
    }

    /**
     * Ends a shortcut switch once: its captions loaded (true), did not (false),
     * or a caption-menu choice took over ('cancelled').
     */
    settleSwitch(pending, result) {
      if (!pending || pending.settled) return;
      pending.settled = true;
      if (this.pendingSelection === pending) this.pendingSelection = null;
      clearTimeout(pending.timer);
      clearTimeout(pending.refetchTimer);
      pending.resolve?.(result);
    }

    async loadFromTap(entry, payloadPromise = null) {
      const gen = this.gen;
      const seq = ++this.tapSeq;
      let payload = null;
      try {
        if (payloadPromise) {
          payload = await payloadPromise;
          if (gen !== this.gen || seq !== this.tapSeq) return false;
        } else {
          payload = JSON.parse(entry.body);
        }
      } catch (error) {
        if (payloadPromise) {
          this.log(`[ytsc] cache-miss refetch failed: ${error?.message || error}`);
          return false;
        }
        // Player asked for another format; the same signed URL works as json3.
        try {
          payload = await this.provider.fetchUrl(globalThis.YTSC.TrackProvider.withJson3(entry.url));
        } catch (err) {
          this.log(`[ytsc] tap refetch failed: ${err?.message || err}`);
          return false;
        }
        // Navigated, or a newer tap or language switch started while this downloaded.
        if (gen !== this.gen || seq !== this.tapSeq) return false;
      }
      if (!this.useTimeline(payload, entry.url, `tap lang=${entry.lang}`, 'tap')) return false;
      this.videoId = entry.videoId;
      return true;
    }

    /** Our own fetch is no longer wanted: the page changed, or the player's download is showing. */
    superseded(gen) {
      return gen !== this.gen || this.source === 'tap';
    }

    useTimeline(payload, url, label, source) {
      const words = this.parser.parseWords(payload);
      const chunks = this.buildChunks(words);
      if (!words.length) return false;
      this.stop();
      this.mode = 'timeline';
      this.source = source;
      this.words = words;
      this.cues = chunks;
      this.noteLoadedCaption(url, source);
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
          return sameSource && TrackProvider.sameCaptionLanguage(translated, selection.translationLanguage);
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
      if ((this.mode !== 'timeline' && this.mode !== 'live') || !this.captionsEnabled()) return;
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

    noteLoadedCaption(url, source = null) {
      this.noteCaptionLanguage(globalThis.YTSC.TrackProvider.languageFromUrl(url));
      this.freezeOriginal(url, source);
    }

    /**
     * Original means the captions the video started with, translation and
     * manual/ASR track included. YouTube opens the next video in the language
     * you just picked, so a first download in the preferred language must not
     * become the track Shift+L restores: the player's default track, or the
     * source behind a carried translation, stands in for it. A
     * preferred-language placeholder is replaced once the real source is known.
     */
    freezeOriginal(url, source = null) {
      const { TrackProvider } = globalThis.YTSC;
      const videoId = this.currentVideoId();
      if (!videoId) return;
      const found = this.provider.getTracksWithSource
        ? this.provider.getTracksWithSource()
        : { tracks: this.provider.getTracks?.() || [], defaultTrack: null };
      const tracks = found.tracks || [];
      let defaultTrack = found.defaultTrack || null;
      if (defaultTrack && !TrackProvider.sameVideo(defaultTrack, videoId)) defaultTrack = null;
      // Compare with the language Shift+L would show, not the raw request:
      // a carried pt-BR translation is the preference of a pt-PT browser when
      // pt-BR is the auto-translation YouTube offers.
      const preferred = this.resolvePreferred(found).language;
      const prior = this.selectionVideoId === videoId ? this.originalSelection : null;
      const observed = (url && TrackProvider.selectionFromUrl(url, tracks)) || null;
      const videoOwn = (seen) => (defaultTrack
        ? { track: defaultTrack, translationLanguage: null }
        : TrackProvider.videoOriginal({ observed: seen, preferred }));
      // The player's first download of this video is how it started. Our own
      // fetch is only a guess, and a Shift+L switch or menu choice is not a start.
      const starting = Boolean(observed) && source === 'tap' && this.startSeenFor !== videoId &&
        !this.pendingSelection && !this.captionMenuArmed();
      let selection;
      if (starting) {
        this.startSeenFor = videoId;
        selection = this.isPreferredSelection(observed, preferred) ? videoOwn(observed) : observed;
      } else {
        // A source track, once known, stays the original. Later menu languages
        // update the preference and must not replace it. A preferred-language
        // placeholder can still give way to the real source.
        if (prior && !this.isPreferredSelection(prior, preferred)) return;
        selection = videoOwn(observed || prior);
      }
      if (!selection?.track) return;
      this.selectionVideoId = videoId;
      this.originalSelection = selection;
    }

    isPreferredSelection(selection, preferred) {
      if (!selection?.track) return false;
      const visible = selection.translationLanguage || selection.track.languageCode;
      return globalThis.YTSC.TrackProvider.sameCaptionLanguage(visible, preferred);
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
      if (this.applyingPlayerTrack || !this.captionMenuArmed()) return;
      const language = globalThis.YTSC.TrackProvider.normalizeLanguage(
        track?.translationLanguage?.languageCode || track?.languageCode
      );
      if (!language) return;
      this.captionChoiceAt = 0;
      // Downloads after a menu choice show that choice, not how the video started.
      this.startSeenFor = this.currentVideoId();
      // A menu choice made while Shift+L waits wins: stop waiting so its download
      // loads like any other, and learn it now. A download of the shortcut's
      // language still in flight must not land after it.
      if (this.pendingSelection) {
        this.tapSeq++;
        this.settlePending('cancelled');
      }
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
      // Downloads after this press come from the shortcut, not from how the video started.
      this.startSeenFor = videoId;
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
      const pending = { selection, videoId: this.currentVideoId() };
      const loaded = new Promise((resolve) => { pending.resolve = resolve; });
      this.settlePending(false);
      this.pendingSelection = pending;
      this.tapSeq++; // a tap refetch still in flight is for the language we are leaving
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
      // Fires while waiting for the tap or while loading it, cached or not: a cached
      // non-JSON tap is downloaded again too, which can stall.
      pending.timer = setTimeout(() => this.settleSwitch(pending, false), this.selectionTimeoutMs);
      // A cached JSON download shows at once. Otherwise YouTube's request is
      // captured by timedtext-tap, or the cached one is fetched again as json3:
      // live captions in the new language bridge the gap, and stay if it stalls.
      if (cached) {
        this.loadForSwitch(pending, cached).catch((err) => {
          this.log(`[ytsc] cached caption load failed: ${err?.message || err}`);
        });
      } else {
        // YouTube can answer from its own cache without a timedtext request. Give a
        // normal player download a head start, then refetch an evicted/missing track
        // ourselves instead of waiting for a tap forever or duplicating every request.
        pending.refetchTimer = setTimeout(() => {
          if (this.pendingSelection !== pending || pending.settled) return;
          this.refetchForSwitch(pending).catch((err) => {
            this.log(`[ytsc] cache-miss caption load failed: ${err?.message || err}`);
          });
        }, this.cacheMissRefetchMs);
      }
      if (!cached || this.loadedUrl !== cached.url) this.startLiveMode();
      return loaded;
    }

    /**
     * True when the captions on screen are the resolved preferred selection.
     * An exact track (zh-Hans) does not count as its sibling (zh-Hant). A base
     * track still counts for a regional code when no exact track exists (en for en-US).
     */
    showingPreferred(selection) {
      const { TrackProvider } = globalThis.YTSC;
      const visible = TrackProvider.normalizeLanguage(
        selection?.translationLanguage || selection?.track?.languageCode
      );
      const active = TrackProvider.normalizeLanguage(this.activeCaptionLanguage);
      if (!active || !visible) return false;
      if (active === visible) return true;
      const requested = TrackProvider.normalizeLanguage(this.preferredCaptionLanguage());
      if (requested === visible) return false;
      return TrackProvider.sameCaptionLanguage(active, visible);
    }

    /**
     * What the preferred language becomes on this video: a matching track, else
     * the auto-translate language YouTube offers for it (pt-PT can become
     * pt-BR). `language` is that visible code, or the request when nothing matches.
     */
    resolvePreferred(found) {
      const requested = this.preferredCaptionLanguage();
      if (!requested) return { requested, direct: null, supported: null, languages: [], language: '' };
      const direct = this.provider.pickLanguage(found.tracks || [], requested);
      const languages = found.translationLanguages || [];
      const supported = direct ? null : this.provider.findTranslationLanguage(languages, requested);
      const language = direct?.languageCode || supported?.languageCode || requested;
      return { requested, direct, supported, languages, language };
    }

    /** The preferred-language selection, or an error toast string. */
    preferredSelection(found, original) {
      const { requested, direct, supported, languages } = this.resolvePreferred(found);
      if (!requested) return { error: 'Caption language unavailable' };
      if (direct) return { selection: { track: direct, translationLanguage: null } };
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
      return !this.activeCaptionLanguage || TrackProvider.sameCaptionLanguage(this.activeCaptionLanguage, visible);
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
        // Follow the resolved selection on screen. A different script or region
        // with its own track is not already the preferred language.
        const selection = this.showingPreferred(preferred.selection) ? original : preferred.selection;
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
        // A caption-menu choice replaced this switch; YouTube shows its own selection.
        if (loaded === 'cancelled' || videoId !== this.currentVideoId()) return;
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
        const url = new URL(location.href);
        if (url.pathname === '/watch') return url.searchParams.get('v');
        // HackerTube uses YouTube's privacy-enhanced /embed/<id> player.
        // This method runs in that iframe, not on HackerTube's own watch page.
        return url.pathname.match(/^\/embed\/([\w-]+)\/?$/)?.[1] || null;
      } catch {
        return null;
      }
    }

    async reload() {
      const gen = ++this.gen; // supersedes any older reload, load or tap refetch
      // A tap may already have installed this video's timeline (checked below).
      const id = this.currentVideoId();
      if (!id) {
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
        if (gen !== this.gen) return; // navigated again
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
      if (this.videoId !== videoId) {
        this.originalSelection = null;
        this.selectionVideoId = null;
        this.startSeenFor = null;
        this.activeCaptionLanguage = null;
        this.captionChoiceAt = 0;
        this.settlePending(false);
        this.pruneTapCache(videoId);
      }
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
        if (tapped) this.rememberTap(tapped);
        if (tapped && (await this.loadFromTap(tapped))) return;
        if (this.superseded(gen)) return;
        this.log(`[ytsc] loading track ${best.languageCode} kind=${best.kind || 'manual'} source=${found.source} (${tracks.length} tracks)`);
        try {
          const payload = await this.provider.fetchJson3(best);
          if (this.superseded(gen)) return; // navigated, or the player's own download is showing
          if (!this.useTimeline(payload, best.baseUrl, 'fetch mode', 'fetch')) throw new Error('no words in payload');
        } catch (err) {
          if (this.superseded(gen)) return;
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
      this.source = null;
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
      this.clearTapCache();
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
