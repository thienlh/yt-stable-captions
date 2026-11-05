(() => {
  'use strict';

  /**
   * Reads caption tracks from the YouTube player response.
   * Single responsibility: track discovery + best-track choice. No fetch, no DOM writes.
   */
  class TrackProvider {
    getPlayer() {
      return document.getElementById('movie_player') || null;
    }

    getTracks() {
      return this.getTracksWithSource().tracks;
    }

    getTracksWithSource() {
      // 1. Live player response (most reliable, includes fresh baseUrl).
      try {
        const player = this.getPlayer();
        let resp =
          (player && typeof player.getPlayerResponse === 'function' && player.getPlayerResponse()) ||
          null;
        if (typeof resp === 'string') {
          try { resp = JSON.parse(resp); } catch { /* keep string */ }
        }
        const tracks = TrackProvider.tracksFromResponse(resp);
        if (tracks.length) {
          return {
            tracks,
            translationLanguages: TrackProvider.translationLanguagesFromResponse(resp),
            defaultTrack: TrackProvider.defaultTrackFromResponse(resp),
            source: 'movie_player.getPlayerResponse',
          };
        }
      } catch { /* fall through */ }

      // 2. Initial page data (populated before the player API is ready).
      try {
        const init = window.ytInitialPlayerResponse;
        const tracks = TrackProvider.tracksFromResponse(init);
        if (tracks.length) {
          return {
            tracks,
            translationLanguages: TrackProvider.translationLanguagesFromResponse(init),
            defaultTrack: TrackProvider.defaultTrackFromResponse(init),
            source: 'ytInitialPlayerResponse',
          };
        }
      } catch { /* fall through */ }

      // 3. Embedded JSON in the page (works even when the API is gated).
      try {
        const tracks = this.getTracksFromEmbeddedJson();
        if (tracks.length) return { tracks, defaultTrack: null, source: 'embedded-json' };
      } catch { /* fall through */ }

      return { tracks: [], translationLanguages: [], defaultTrack: null, source: 'none' };
    }

    /** The video's own caption track, from the audio track's default index. */
    static defaultTrackFromResponse(resp) {
      const renderer = resp?.captions?.playerCaptionsTracklistRenderer;
      const raw = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
      const audio = Array.isArray(renderer?.audioTracks) ? renderer.audioTracks : [];
      const indexed = audio.find((item) => Number.isInteger(item?.defaultCaptionTrackIndex));
      const index = indexed?.defaultCaptionTrackIndex ?? renderer?.defaultCaptionTrackIndex;
      const track = Number.isInteger(index) ? raw[index] : null;
      return typeof track?.baseUrl === 'string' && track.baseUrl ? track : null;
    }

    static sameVideo(track, videoId) {
      if (!videoId || !track?.baseUrl) return true;
      try {
        const id = new URL(track.baseUrl, 'https://www.youtube.com/').searchParams.get('v');
        return !id || id === videoId;
      } catch {
        return true;
      }
    }

    /**
     * The track Shift+L restores. YouTube carries the last caption language onto
     * the next video, so the first download may already be that language. Prefer
     * the player's default track, otherwise the source behind a carried translation.
     */
    static videoOriginal({ defaultTrack = null, observed = null, preferred = '' } = {}) {
      if (defaultTrack) return { track: defaultTrack, translationLanguage: null };
      if (!observed?.track) return null;
      const visible = observed.translationLanguage || observed.track.languageCode;
      if (observed.translationLanguage &&
          TrackProvider.sameCaptionLanguage(visible, preferred) &&
          !TrackProvider.sameCaptionLanguage(observed.track.languageCode, preferred)) {
        return { track: observed.track, translationLanguage: null };
      }
      return observed;
    }

    static tracksFromResponse(resp) {
      const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const arr = Array.isArray(tracks) ? tracks : [];
      // NOTE: do not filter on 'timedtext' substring — some locales serve
      // translated baseUrls without it. Any non-empty baseUrl is fetchable.
      return arr.filter((t) => typeof t?.baseUrl === 'string' && t.baseUrl.length > 0);
    }

    static translationLanguagesFromResponse(resp) {
      const languages = resp?.captions?.playerCaptionsTracklistRenderer?.translationLanguages;
      return Array.isArray(languages) ? languages : [];
    }

    static normalizeLanguage(language) {
      return String(language || '').trim().replaceAll('_', '-').toLowerCase();
    }

    static languageMatches(a, b) {
      const left = TrackProvider.normalizeLanguage(a);
      const right = TrackProvider.normalizeLanguage(b);
      return Boolean(left && right) &&
        (left === right || left.split('-')[0] === right.split('-')[0]);
    }

    /**
     * en matches en-US. zh-Hant does not match zh-Hans: a different subtag is a
     * different caption track, while a bare base code still matches a region.
     */
    static sameCaptionLanguage(a, b) {
      const left = TrackProvider.normalizeLanguage(a);
      const right = TrackProvider.normalizeLanguage(b);
      if (!left || !right) return false;
      if (left === right) return true;
      const [baseA, ...restA] = left.split('-');
      const [baseB, ...restB] = right.split('-');
      return baseA === baseB && (!restA.length || !restB.length);
    }

    /** The visible language: an auto-translation target, otherwise the source track. */
    static languageFromUrl(url) {
      try {
        const u = new URL(url, globalThis.location?.href || 'https://www.youtube.com/');
        return TrackProvider.normalizeLanguage(u.searchParams.get('tlang') || u.searchParams.get('lang')) || null;
      } catch {
        return null;
      }
    }

    /**
     * True when a settings-menu label is one of the player's caption tracks or
     * translation languages. Quality and speed rows do not match.
     */
    static matchesCaptionLabel(label, tracks = [], translationLanguages = []) {
      const text = TrackProvider.normalizeLabel(label);
      if (!text) return false;
      const names = [...tracks, ...translationLanguages]
        .map((entity) => TrackProvider.normalizeLabel(TrackProvider.trackLabel(entity)))
        .filter(Boolean);
      return names.some((name) => text === name || text.startsWith(`${name} `) || text.startsWith(`${name}(`) ||
        name.startsWith(`${text} `) || name.startsWith(`${text}(`));
    }

    static trackLabel(entity) {
      const name = entity?.name || entity?.languageName;
      if (!name) return '';
      if (typeof name === 'string') return name;
      if (typeof name.simpleText === 'string') return name.simpleText;
      if (Array.isArray(name.runs)) return name.runs.map((run) => run?.text || '').join('');
      return '';
    }

    static normalizeLabel(label) {
      return String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    /** Prefer an exact regional match, then another track in the same base language. */
    pickLanguage(tracks, language) {
      const matches = tracks.filter((t) => TrackProvider.languageMatches(t.languageCode, language));
      const normalized = TrackProvider.normalizeLanguage(language);
      const exact = matches.filter((t) => TrackProvider.normalizeLanguage(t.languageCode) === normalized);
      return this.pickBest(exact.length ? exact : matches);
    }

    findTranslationLanguage(languages, language) {
      const normalized = TrackProvider.normalizeLanguage(language);
      return languages.find((l) => TrackProvider.normalizeLanguage(l.languageCode) === normalized) ||
        languages.find((l) => TrackProvider.languageMatches(l.languageCode, language)) || null;
    }

    /** Recover the source track and optional translation from a timedtext URL. */
    static selectionFromUrl(url, tracks) {
      if (!url) return null;
      try {
        const u = new URL(url, globalThis.location?.href || 'https://www.youtube.com/');
        const language = u.searchParams.get('lang');
        const kind = u.searchParams.get('kind');
        const candidates = tracks.filter((t) =>
          TrackProvider.normalizeLanguage(t.languageCode) === TrackProvider.normalizeLanguage(language));
        const track = candidates.find((t) => (t.kind || '') === (kind || '')) || candidates[0];
        return track ? { track, translationLanguage: u.searchParams.get('tlang') || null } : null;
      } catch {
        return null;
      }
    }

    getTracksFromEmbeddedJson() {
      // Scans inline scripts for "captionTracks":[...] without needing the player API.
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent || '';
        if (!text.includes('captionTracks')) continue;
        const match = text.match(/"captionTracks"\s*:\s*(\[.*?\])\s*,\s*"audioTracks"/s)
          || text.match(/"captionTracks"\s*:\s*(\[.*?\])/s);
        if (!match) continue;
        try {
          const parsed = JSON.parse(match[1]);
          const good = parsed.filter((t) => typeof t?.baseUrl === 'string');
          if (good.length) return good;
        } catch { /* try next script */ }
      }
      return [];
    }

    /** Prefer manual tracks over ASR; prefer English; else first available. */
    pickBest(tracks) {
      if (!tracks.length) return null;
      const isAsr = (t) => t.kind === 'asr' || String(t.vssId || '').startsWith('.');
      const isEn = (t) => String(t.languageCode || '').toLowerCase().startsWith('en');
      const manual = tracks.filter((t) => !isAsr(t));
      const auto = tracks.filter((t) => isAsr(t));
      return (
        manual.find(isEn) || manual[0] || auto.find(isEn) || auto[0] || tracks[0] || null
      );
    }

    async fetchJson3(track, fmt = 'json3') {
      if (!track?.baseUrl) throw new Error('caption track has no baseUrl');
      const sep = track.baseUrl.includes('?') ? '&' : '?';
      return this.fetchUrl(`${track.baseUrl}${sep}fmt=${fmt}`, fmt);
    }

    /** Same signed URL, forced to json3 (the player may request another format). */
    static withJson3(url) {
      const u = new URL(url, location.href);
      u.searchParams.set('fmt', 'json3');
      return u.toString();
    }

    async fetchUrl(url, fmt = 'json3') {
      // ytscOwn: tells timedtext-tap.js not to re-publish our own requests.
      const res = await fetch(url, { credentials: 'include', ytscOwn: true });
      if (!res.ok) throw new Error(`timedtext fetch failed: HTTP ${res.status} fmt=${fmt}`);
      const text = await res.text();
      if (!text || !text.trim()) {
        throw new Error(`timedtext empty body: HTTP ${res.status} ct=${res.headers.get('content-type')} fmt=${fmt} (YouTube gated this URL; falling back to live captions)`);
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`timedtext not JSON: ct=${res.headers.get('content-type')} len=${text.length} head=${text.slice(0, 120)}`);
      }
    }
  }

  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, { TrackProvider });
})();
