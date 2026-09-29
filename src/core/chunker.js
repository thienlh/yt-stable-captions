(() => {
  'use strict';

  const loadDep = (key, path) => {
    if (globalThis.YTSC?.[key]) return globalThis.YTSC[key];
    if (typeof require !== 'undefined') return require(path)[key];
    throw new Error(`YTSC dependency missing: ${key}`);
  };

  const DEFAULTS = {
    maxWords: 6, // TikTok-style short bursts
    maxChars: 30, // ~2 lines at the overlay's max width
    pauseMs: 600, // silence that forces a new chunk
    holdMs: 500, // keep a chunk visible briefly after its last word
    minCommaWords: 3, // break after a comma once the chunk has this many words
  };

  /**
   * Where to cut a word stream into chunks. Shared by batch and live chunking.
   * Single responsibility: break decisions only.
   */
  class ChunkRules {
    constructor(options = {}, textUtils = null) {
      this.opts = { ...DEFAULTS, ...options };
      this.text = textUtils || loadDep('TextUtils', './text-utils.js');
    }

    breakBefore(current, next) {
      if (!current.length) return false;
      // Standalone words (e.g. the ♪ music cue) always get a chunk of their own.
      if (next.standalone || current[current.length - 1].standalone) return true;
      const o = this.opts;
      if (current.length >= o.maxWords) return true;
      const chars = current.reduce((n, w) => n + w.text.length + 1, 0) + next.text.length;
      if (chars > o.maxChars) return true;
      const last = current[current.length - 1];
      return next.startMs - last.endMs >= o.pauseMs;
    }

    breakAfter(current) {
      const last = current[current.length - 1];
      if (!last) return false;
      if (this.text.sentenceIsComplete(last.text)) return true;
      return current.length >= this.opts.minCommaWords && /[,;:]["'»”’)]*$/u.test(last.text);
    }

    toChunk(words) {
      return {
        startMs: words[0].startMs,
        endMs: words[words.length - 1].endMs,
        text: words.map((w) => w.text).join(' '),
        words,
      };
    }
  }

  /**
   * Timed words -> short timed chunks (whole timeline known up front).
   */
  class CaptionChunker {
    constructor(options = {}) {
      this.rules = new ChunkRules(options);
    }

    build(words) {
      const r = this.rules;
      const chunks = [];
      let current = [];
      for (const word of words) {
        if (r.breakBefore(current, word)) {
          chunks.push(r.toChunk(current));
          current = [];
        }
        current.push(word);
        if (r.breakAfter(current)) {
          chunks.push(r.toChunk(current));
          current = [];
        }
      }
      if (current.length) chunks.push(r.toChunk(current));

      const { holdMs } = r.opts;
      return chunks.map((chunk, index) => {
        const nextStart = chunks[index + 1]?.startMs ?? Infinity;
        const endMs = Math.min(chunk.endMs + holdMs, nextStart);
        return { ...chunk, endMs: Math.max(endMs, chunk.startMs + 1), index };
      });
    }
  }

  /**
   * Incremental chunking for words arriving in real time (live DOM mode).
   * Only complete chunks are emitted, so nothing grows word by word on screen.
   */
  class LiveChunker {
    constructor(options = {}) {
      this.rules = new ChunkRules({ maxWords: 5, ...options });
      this.pending = [];
      this.count = 0;
    }

    /** Returns the chunks completed by these words (possibly none). */
    push(texts, nowMs) {
      const r = this.rules;
      const closed = [];
      for (const text of texts) {
        const word = { text, startMs: nowMs, endMs: nowMs };
        if (r.breakBefore(this.pending, word)) closed.push(this._close());
        this.pending.push(word);
        if (r.breakAfter(this.pending)) closed.push(this._close());
      }
      return closed;
    }

    /** Closes whatever is pending (called after a pause). */
    flush() {
      return this.pending.length ? this._close() : null;
    }

    _close() {
      const chunk = { ...this.rules.toChunk(this.pending), index: this.count++ };
      this.pending = [];
      return chunk;
    }
  }

  const api = { ChunkRules, CaptionChunker, LiveChunker };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
