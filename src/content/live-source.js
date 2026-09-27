(() => {
  'use strict';

  const loadDep = (key, path) => {
    if (globalThis.YTSC?.[key]) return globalThis.YTSC[key];
    if (typeof require !== 'undefined') return require(path)[key];
    throw new Error(`YTSC dependency missing: ${key}`);
  };

  /**
   * Live fallback when no timedtext payload is available.
   * Reads YouTube's own caption DOM, extracts only newly spoken words, and
   * groups them into short chunks that are shown whole (never word by word).
   *
   * - LiveWordDiff: pure snapshot -> new words
   * - LiveDomSource: MutationObserver on .ytp-caption-window-container
   */

  class LiveWordDiff {
    constructor({ merger = null, textUtils = null } = {}) {
      this.text = textUtils || loadDep('TextUtils', '../core/text-utils.js');
      this.merger = merger || new (loadDep('RollingTextMerger', '../core/rolling-merger.js'))();
      this.prev = [];
    }

    /** Returns the words in `snapshot` that were not on screen before. */
    push(snapshot) {
      const next = this.text.splitWords(snapshot);
      if (!next.length) return [];
      const prev = this.prev;
      const key = (words) => words.map((w) => this.text.comparableWord(w));
      const prevKeys = key(prev);
      const nextKeys = key(next);

      // Partial re-render or a scrolled-off row: nothing new was said.
      const at = this._indexOf(prevKeys, nextKeys);
      if (at >= 0) {
        if (at + next.length === prev.length) this.prev = next;
        return [];
      }

      let overlap = this.merger.overlapSize(prevKeys, nextKeys);
      if (!overlap && prev.length > 1) {
        // ASR often rewrites its last word; ignore it and retry.
        overlap = this.merger.overlapSize(prevKeys.slice(0, -1), nextKeys);
        if (overlap) overlap += nextKeys.length > overlap ? 1 : 0;
      }
      this.prev = next;
      return next.slice(overlap);
    }

    _indexOf(haystack, needle) {
      outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
        for (let j = 0; j < needle.length; j++) {
          if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
      }
      return -1;
    }
  }

  class LiveDomSource {
    constructor({ diff = null, chunker = null, onChunk = () => {}, pauseMs = 700 } = {}) {
      this.diff = diff || new LiveWordDiff();
      this.chunker = chunker || new (loadDep('LiveChunker', '../core/chunker.js'))();
      this.onChunk = onChunk;
      this.pauseMs = pauseMs;
      this.observer = null;
      this.lastSeen = '';
      this.frame = 0;
      this.idle = 0;
    }

    container() {
      return document.querySelector('.ytp-caption-window-container');
    }

    readText() {
      const c = this.container();
      if (!c) return '';
      const segs = c.querySelectorAll('.ytp-caption-segment');
      const parts = segs.length ? [...segs].map((s) => s.textContent || '') : [c.textContent || ''];
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    start() {
      const target = document.querySelector('.html5-video-player') || document.body;
      // Coalesce bursts of mutations into one read per frame to avoid half-rendered snapshots.
      this.observer = new MutationObserver(() => {
        if (!this.frame) this.frame = requestAnimationFrame(() => this._read());
      });
      this.observer.observe(target, { childList: true, subtree: true, characterData: true });
      this._read();
    }

    _read() {
      this.frame = 0;
      const t = this.readText();
      if (!t || t === this.lastSeen) return;
      this.lastSeen = t;
      const words = this.diff.push(t);
      if (!words.length) return;
      for (const chunk of this.chunker.push(words, performance.now())) this.onChunk(chunk);
      clearTimeout(this.idle);
      this.idle = setTimeout(() => {
        const chunk = this.chunker.flush();
        if (chunk) this.onChunk(chunk);
      }, this.pauseMs);
    }

    stop() {
      this.observer?.disconnect();
      this.observer = null;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      clearTimeout(this.idle);
    }
  }

  const api = { LiveWordDiff, LiveDomSource };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
