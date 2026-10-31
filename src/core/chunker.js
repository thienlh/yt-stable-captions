(() => {
  'use strict';

  const loadDep = (key, path) => {
    if (globalThis.YTSC?.[key]) return globalThis.YTSC[key];
    if (typeof require !== 'undefined') return require(path)[key];
    throw new Error(`YTSC dependency missing: ${key}`);
  };

  const DEFAULTS = {
    maxWords: 7, // one glance
    maxChars: 42, // one line of the Frosted and Boring panel (max-width 42ch)
    pauseMs: 600, // silence that forces a new chunk
    holdMs: 500, // keep a chunk visible briefly after its last word
    minCommaWords: 5, // break after a comma once the chunk has this many words
    strandWords: 3, // a sentence end this close to a full chunk is not left on its own
    lineChars: 32, // wrap a manual caption line once it is longer than this
  };
  // Per caption style (the `style` option). Short keeps TikTok-style bursts that
  // fit its narrow box in about two lines.
  const STYLE_OPTIONS = {
    tiktok: { maxWords: 6, maxChars: 30, minCommaWords: 3 },
  };
  // Live chunks show only once complete, so every extra word shows them later.
  const LIVE_MAX_WORDS = { default: 6, tiktok: 5 };

  /**
   * Where to cut a word stream into chunks. Shared by batch and live chunking.
   * Single responsibility: break decisions only.
   */
  class ChunkRules {
    constructor(options = {}, textUtils = null) {
      this.opts = { ...DEFAULTS, ...STYLE_OPTIONS[options.style], ...options };
      this.text = textUtils || loadDep('TextUtils', './text-utils.js');
    }

    breakBefore(current, next) {
      return this.mustBreak(current, next) || this.isFull(current, next);
    }

    /** A break the words ask for: a new caption line, a standalone cue or a pause. */
    mustBreak(current, next) {
      if (!current.length) return false;
      const last = current[current.length - 1];
      // Standalone words (e.g. the ♪ music cue) always get a chunk of their own.
      // A manual caption line starts its own chunk and is not cut mid-line.
      if (next.cueStart || next.standalone || last.standalone) return true;
      if (next.estimated && last.estimated) return false;
      return next.startMs - last.endMs >= this.opts.pauseMs;
    }

    /** No room for the next word. */
    isFull(current, next) {
      if (!current.length) return false;
      if (next.estimated && current[current.length - 1].estimated) return false;
      return current.length >= this.opts.maxWords || !this.fits([...current, next]);
    }

    fits(words) {
      return this._length(words) <= this.opts.maxChars;
    }

    breakAfter(current) {
      const last = current[current.length - 1];
      if (!last || last.estimated) return false;
      if (this.text.sentenceIsComplete(last.text)) return true;
      return current.length >= this.opts.minCommaWords && this._endsClause(last);
    }

    /**
     * How many words from words[i] on finish their sentence or clause, when that
     * is at most strandWords; 0 when more follow. Cutting before them would
     * leave them stranded in a chunk of their own.
     */
    strandedTail(words, i) {
      for (let n = 1; n <= this.opts.strandWords; n++) {
        const word = words[i + n - 1];
        if (!word || (n > 1 && this.mustBreak([words[i + n - 2]], word))) return n - 1;
        if (this.text.sentenceIsComplete(word.text) || this._endsClause(word)) return n;
      }
      return 0;
    }

    /**
     * Where to cut a full chunk early so `tail` joins its last words: after its
     * last comma, or else where the two chunks come out about even. 0 when the
     * tail fits with neither.
     */
    earlyCut(current, tail) {
      const lastComma = current.findLastIndex((w, i) => i && i < current.length - 1 && this._endsClause(w));
      if (lastComma > 0 && this.fits([...current.slice(lastComma + 1), ...tail])) return lastComma + 1;
      let best = 0;
      let bestGap = Infinity;
      for (let cut = 2; cut < current.length; cut++) {
        const rest = [...current.slice(cut), ...tail];
        const gap = Math.abs(this._length(current.slice(0, cut)) - this._length(rest));
        if (this.fits(rest) && gap < bestGap) {
          best = cut;
          bestGap = gap;
        }
      }
      return best;
    }

    /** Characters on screen, spaces included. */
    _length(words) {
      return words.reduce((n, w) => n + w.text.length + 1, -1);
    }

    _endsClause(word) {
      return /[,;:]["'»”’)]*$/u.test(word.text);
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
      this.options = options;
      this.setStyle(options.style);
    }

    /** Chunk for this caption style from now on (the next build). */
    setStyle(style) {
      this.rules = new ChunkRules({ ...this.options, style });
    }

    build(words) {
      const r = this.rules;
      const chunks = [];
      let current = [];
      let pulledIn = 0; // words of a stranded tail still to take past the size cap
      const close = (count = current.length) => {
        chunks.push(r.toChunk(current.slice(0, count)));
        current = current.slice(count);
      };
      words.forEach((word, i) => {
        if (pulledIn) pulledIn--;
        else if (r.mustBreak(current, word)) close();
        else if (r.isFull(current, word)) {
          // The whole timeline is known, so look ahead: a sentence or clause that
          // ends a few words later goes into this chunk if it fits, or else the
          // chunk is cut early so those words don't end up on their own.
          const tail = words.slice(i, i + r.strandedTail(words, i));
          if (tail.length && r.fits([...current, ...tail])) pulledIn = tail.length - 1;
          else close((tail.length && r.earlyCut(current, tail)) || current.length);
        }
        current.push(word);
        if (r.breakAfter(current)) close();
      });
      if (current.length) close();

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
      this.options = options;
      this.setStyle(options.style);
      this.pending = [];
      this.count = 0;
    }

    /** Chunk for this caption style from now on; words already pending stay. */
    setStyle(style) {
      const maxWords = LIVE_MAX_WORDS[style] ?? LIVE_MAX_WORDS.default;
      this.rules = new ChunkRules({ maxWords, ...this.options, style });
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
