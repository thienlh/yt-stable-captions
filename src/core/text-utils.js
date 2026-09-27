(() => {
  'use strict';

  /**
   * Pure text helpers for caption normalization.
   * Single responsibility: string normalization only, no timing logic.
   */
  class TextUtils {
    static normalize(text) {
      return String(text || '')
        .replace(/[\u200b\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    static comparableWord(word) {
      return String(word || '')
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    }

    static splitWords(text) {
      const n = TextUtils.normalize(text);
      return n ? n.split(/\s+/) : [];
    }

    static sentenceIsComplete(text) {
      return /[.!?…]["'»”’)}\]]*$/u.test(TextUtils.normalize(text));
    }

    static rawEventText(event) {
      const segs = Array.isArray(event?.segs) ? event.segs : [];
      return segs.map((s) => s.utf8 || '').join('');
    }

    static eventText(event) {
      return TextUtils.normalize(TextUtils.rawEventText(event));
    }

    static isRollupBreak(event) {
      return Boolean(event?.aAppend) && /^\s*\n\s*$/u.test(TextUtils.rawEventText(event));
    }
  }

  const api = { TextUtils };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
