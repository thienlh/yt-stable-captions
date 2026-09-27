(() => {
  'use strict';

  const getTextUtils = () =>
    globalThis.YTSC?.TextUtils || (typeof require !== 'undefined' && require('./text-utils.js').TextUtils);

  /**
   * Merges rolling ASR windows ("Was" -> "Was bedeutet" -> "Was bedeutet das?")
   * without duplicating the overlapping prefix.
   * Single responsibility: text merging only.
   */
  class RollingTextMerger {
    constructor(textUtils = getTextUtils()) {
      this.text = textUtils;
    }

    merge(first, second) {
      const T = this.text;
      const a = T.normalize(first);
      const b = T.normalize(second);
      if (!a) return b;
      if (!b) return a;
      if (a === b) return a;

      const aWords = T.splitWords(a);
      const bWords = T.splitWords(b);

      // One window is a prefix of the other: keep the longer one.
      if (this._isPrefix(aWords, bWords)) return b;
      if (this._isPrefix(bWords, aWords)) return a;

      // Otherwise find suffix/prefix word overlap.
      const overlap = this._overlapSize(aWords, bWords);
      if (overlap > 0) {
        return T.normalize(`${a} ${bWords.slice(overlap).join(' ')}`);
      }
      return T.normalize(`${a} ${b}`);
    }

    /** How many leading words of `next` already end `prev` (rolling-window overlap). */
    overlapSize(prevWords, nextWords) {
      return this._overlapSize(prevWords, nextWords);
    }

    _isPrefix(shorter, longer) {
      const T = this.text;
      return (
        shorter.length <= longer.length &&
        shorter.every((w, i) => T.comparableWord(w) === T.comparableWord(longer[i]))
      );
    }

    _overlapSize(aWords, bWords) {
      const T = this.text;
      const max = Math.min(aWords.length, bWords.length);
      for (let size = max; size > 0; size--) {
        const left = aWords.slice(-size);
        const right = bWords.slice(0, size);
        if (left.every((w, i) => T.comparableWord(w) === T.comparableWord(right[i]))) {
          return size;
        }
      }
      return 0;
    }
  }

  const api = { RollingTextMerger };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
