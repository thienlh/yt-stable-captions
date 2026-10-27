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
    lineChars: 32, // wrap a manual caption line once it is longer than this
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
      // A manual caption line starts its own chunk and is not cut mid-line.
      if (next.cueStart || next.standalone || current[current.length - 1].standalone) return true;
      if (next.estimated && current[current.length - 1].estimated) return false;
      const o = this.opts;
      if (current.length >= o.maxWords) return true;
      const chars = current.reduce((n, w) => n + w.text.length + 1, 0) + next.text.length;
      if (chars > o.maxChars) return true;
      const last = current[current.length - 1];
      return next.startMs - last.endMs >= o.pauseMs;
    }

    breakAfter(current) {
      const last = current[current.length - 1];
      if (!last || last.estimated) return false;
      if (this.text.sentenceIsComplete(last.text)) return true;
      return current.length >= this.opts.minCommaWords && /[,;:]["'»”’)]*$/u.test(last.text);
    }

    toChunk(words) {
      const balanced = this._balanceManual(words);
      return {
        startMs: balanced[0].startMs,
        endMs: balanced[balanced.length - 1].endMs,
        text: balanced.map((w) => w.text).join(' '),
        words: balanced,
      };
    }

    /**
     * A manual line has no authored wrap and no word times. Break it into even
     * visual lines (a `lineBreak` on the first word of each extra line) so the
     * overlay can show it the way a subtitle is read, top line then bottom line.
     */
    _balanceManual(words) {
      if (words.length < 2 || words.some((w) => !w.estimated || w.lineBreak)) return words;
      const ends = [];
      let used = 0;
      words.forEach((word, i) => {
        used += word.text.length + (i ? 1 : 0);
        ends.push(used);
      });
      const total = ends[ends.length - 1];
      const lineCount = Math.ceil(total / this.opts.lineChars);
      if (lineCount < 2) return words;
      const breaks = new Set();
      for (let line = 1; line < lineCount; line++) {
        const goal = (total * line) / lineCount;
        let best = -1;
        let bestDist = Infinity;
        for (let i = 1; i < words.length; i++) {
          if (breaks.has(i)) continue;
          // Don't split an echo pair ("lang thang") just because it sits on the midpoint.
          const dist = Math.abs(ends[i - 1] - goal) + this._echoPenalty(words[i - 1].text, words[i].text);
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        }
        if (best > 0) breaks.add(best);
      }
      if (!breaks.size) return words;
      return words.map((word, i) => (breaks.has(i) ? { ...word, lineBreak: true } : word));
    }

    /** Extra cost for a break between words that rhyme, like Vietnamese "lang thang". */
    _echoPenalty(prev, next) {
      const a = String(prev || '').toLocaleLowerCase();
      const b = String(next || '').toLocaleLowerCase();
      if (a.length < 3 || b.length < 3) return 0;
      return a.slice(-3) === b.slice(-3) ? 8 : 0;
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
