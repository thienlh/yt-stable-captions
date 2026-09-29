(() => {
  'use strict';

  const loadDep = (key, path) => {
    if (globalThis.YTSC?.[key]) return globalThis.YTSC[key];
    if (typeof require !== 'undefined') return require(path)[key];
    throw new Error(`YTSC dependency missing: ${key}`);
  };

  // Hesitation sounds. "à" (vi) is left out: it is also a real sentence particle.
  const FILLERS = new Set([
    'um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'hm', 'mm', // en
    'äh', 'ähm', 'öh', 'ehm', // de
    'ờ', 'ừm', 'ừ', 'ơ', 'ờm', // vi
  ]);
  // Sound tags YouTube's ASR inserts for music ("[Music]", "[Musik]", "[âm nhạc]").
  const MUSIC_TAGS = new Set(['music', 'musik', 'música', 'musique', 'musica', 'muziek', 'âm nhạc', 'nhạc']);
  const MUSIC_NOTE = '♪';

  // Discourse markers that are often, but not always, filler (opt-in).
  const AGGRESSIVE_PHRASES = [['you', 'know'], ['i', 'mean'], ['weißt', 'du'], ['kiểu', 'như']];

  /**
   * "Clean verbatim" captions: drops fillers (um, uh, äh, ờ…) and stumbles
   * ("I I I think", "It's, um, it's"), the way subtitle guidelines ask, and
   * turns "[Music]" tags into a standalone ♪.
   * Works on timed words { text, startMs, endMs }. Pure, no DOM.
   * Single responsibility: disfluency detection and removal.
   */
  class Disfluency {
    /**
     * @param aggressive also treat "like", "you know", "I mean" (…) as fillers
     * @param drop       kinds that clean() removes (default: both)
     */
    constructor({ aggressive = false, drop = ['filler', 'repeat'], textUtils = null } = {}) {
      this.aggressive = aggressive;
      this.drop = new Set(drop);
      this.text = textUtils || loadDep('TextUtils', './text-utils.js');
    }

    /** Index-aligned kinds: 'filler' | 'repeat' | undefined. */
    detect(words) {
      const key = (i) => this.text.comparableWord(words[i]?.text);
      const kinds = words.map((_, i) => (FILLERS.has(key(i)) ? 'filler' : undefined));

      if (this.aggressive) {
        for (let i = 0; i < words.length; i++) {
          for (const phrase of AGGRESSIVE_PHRASES) {
            if (phrase.every((p, j) => key(i + j) === p)) phrase.forEach((_, j) => { kinds[i + j] = 'filler'; });
          }
          // "like" as a filler only when set off by commas ("And, like, when …").
          const commaBefore = i > 0 && /,$/.test(words[i - 1].text);
          if (key(i) === 'like' && (/,$/.test(words[i].text) || commaBefore)) kinds[i] = 'filler';
        }
      }

      // Repeats, looking through fillers. The last occurrence flows into the
      // sentence, so earlier copies are the stumble.
      const content = words.map((_, i) => i).filter((i) => !kinds[i]);
      for (let n = 0; n < content.length; n++) {
        const [a, b, c, d] = content.slice(n, n + 4);
        if (!key(a)) continue;
        if (b != null && key(a) === key(b)) kinds[a] = 'repeat';
        if (d != null && key(a) === key(c) && key(b) === key(d)) {
          kinds[a] = kinds[a] || 'repeat';
          kinds[b] = kinds[b] || 'repeat';
        }
      }
      return kinds;
    }

    /**
     * "[Music]" (possibly spanning words, like "[âm nhạc]") -> one standalone ♪
     * covering the tag's time; consecutive tags merge into a single note.
     */
    replaceMusicTags(words) {
      const out = [];
      for (let i = 0; i < words.length; i++) {
        const end = this._bracketEnd(words, i);
        const inner = end < 0 ? null : words.slice(i, end + 1).map((w) => w.text).join(' ');
        const tag = inner?.replace(/^\[|\][.,!?…]*$/gu, '').trim().toLocaleLowerCase();
        if (!tag || !MUSIC_TAGS.has(tag)) {
          out.push(words[i]);
          continue;
        }
        const prev = out[out.length - 1];
        if (prev?.text === MUSIC_NOTE) prev.endMs = Math.max(prev.endMs, words[end].endMs);
        else out.push({ text: MUSIC_NOTE, startMs: words[i].startMs, endMs: words[end].endMs, standalone: true });
        i = end;
      }
      return out;
    }

    /** Index of the word closing a "[…]" tag that starts at i (max 3 words), or -1. */
    _bracketEnd(words, i) {
      if (!words[i].text.startsWith('[')) return -1;
      for (let j = i; j < Math.min(words.length, i + 3); j++) {
        if (/\][.,!?…]*$/u.test(words[j].text)) return j;
      }
      return -1;
    }

    /**
     * Returns new words without fillers and repeats, kept well-formed:
     * a dropped word's terminal punctuation moves to the previous word, a
     * dropped sentence-initial capital passes to the next word, and the
     * previous word absorbs the dropped time (so no fake pause splits chunks).
     */
    clean(words) {
      words = this.replaceMusicTags(words);
      const kinds = this.detect(words);
      const out = [];
      let capitalizeNext = false;
      words.forEach((word, i) => {
        if (!this.drop.has(kinds[i])) {
          let { text } = word;
          if (capitalizeNext) {
            text = text.charAt(0).toLocaleUpperCase() + text.slice(1);
            capitalizeNext = false;
          }
          out.push({ ...word, text });
          return;
        }
        const prev = out[out.length - 1];
        const startsSentence = !prev || this.text.sentenceIsComplete(prev.text);
        if (startsSentence && /^\p{Lu}/u.test(word.text)) capitalizeNext = true;
        if (!prev || prev.standalone) return; // the ♪ cue takes no punctuation or extra time
        const terminal = word.text.match(/[.!?…]+$/u)?.[0];
        if (terminal && !/[.!?…,;:]$/u.test(prev.text)) prev.text += terminal;
        prev.endMs = Math.max(prev.endMs, word.endMs);
      });
      return out;
    }
  }

  Disfluency.MUSIC_NOTE = MUSIC_NOTE;

  const api = { Disfluency };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
