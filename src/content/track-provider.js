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
        if (tracks.length) return { tracks, source: 'movie_player.getPlayerResponse' };
      } catch { /* fall through */ }

      // 2. Initial page data (populated before the player API is ready).
      try {
        const init = window.ytInitialPlayerResponse;
        const tracks = TrackProvider.tracksFromResponse(init);
        if (tracks.length) return { tracks, source: 'ytInitialPlayerResponse' };
      } catch { /* fall through */ }

      // 3. Embedded JSON in the page (works even when the API is gated).
      try {
        const tracks = this.getTracksFromEmbeddedJson();
        if (tracks.length) return { tracks, source: 'embedded-json' };
      } catch { /* fall through */ }

      return { tracks: [], source: 'none' };
    }

    static tracksFromResponse(resp) {
      const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      const arr = Array.isArray(tracks) ? tracks : [];
      // NOTE: do not filter on 'timedtext' substring — some locales serve
      // translated baseUrls without it. Any non-empty baseUrl is fetchable.
      return arr.filter((t) => typeof t?.baseUrl === 'string' && t.baseUrl.length > 0);
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
