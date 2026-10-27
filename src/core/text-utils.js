(() => {
  'use strict';

  // Punctuation that hangs off the word before it ("hello ," -> "hello,") or
  // leads into the word after it ("¿ qué" -> "¿qué"). Bare straight quotes are
  // ambiguous (opening or closing), so they stay put.
  const CLOSING = /^[.,;:!?…%)\]}»”’"'、。，！？；：）」』]+$/u;
  const OPENING = /^[(\[{«“‘¿¡（「『]+$/u;
  const QUOTES = /^["']+$/u;

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
      return n ? TextUtils.attachPunctuation(n.split(/\s+/)) : [];
    }

    /** 'prev' | 'next' for a punctuation-only token, else null. */
    static punctuationSide(token) {
      if (OPENING.test(token)) return 'next';
      if (CLOSING.test(token) && !QUOTES.test(token)) return 'prev';
      return null;
    }

    /**
     * Folds punctuation-only tokens into the neighbouring word, so "hello , world !"
     * reads "hello, world!" and the marks don't count as words.
     * Works on strings, or on any item given textOf/withText accessors.
     */
    static attachPunctuation(items, textOf = (x) => x, withText = (_, text) => text) {
      const out = [];
      let lead = null; // opening marks waiting for the next word
      for (const item of items) {
        const text = textOf(item);
        const side = TextUtils.punctuationSide(text);
        if (side === 'next' || (side === 'prev' && lead)) {
          lead = { item: lead?.item ?? item, text: (lead?.text ?? '') + text };
        } else if (side === 'prev' && out.length) {
          const i = out.length - 1;
          out[i] = withText(out[i], textOf(out[i]) + text);
        } else {
          out.push(lead ? withText(item, lead.text + text) : item);
          lead = null;
        }
      }
      if (lead) out.push(withText(lead.item, lead.text));
      return out;
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
