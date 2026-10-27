(() => {
  'use strict';

  const loadDep = (key, path) => {
    if (globalThis.YTSC?.[key]) return globalThis.YTSC[key];
    if (typeof require !== 'undefined') return require(path)[key];
    throw new Error(`YTSC dependency missing: ${key}`);
  };

  /**
   * Turns a YouTube timedtext JSON3 payload into stable subtitle cues.
   * Handles two real shapes:
   *  1. rollup rows (aAppend + "\n" separators) -> pair rows into 2-line cues
   *  2. streaming windows (growing/overlapping text) -> merge into phrase cues
   * Single responsibility: JSON3 -> cues. No DOM, no fetch.
   */
  class Json3Parser {
    constructor({ textUtils = null, merger = null } = {}) {
      this.text = textUtils || loadDep('TextUtils', './text-utils.js');
      this.merger = merger || new (loadDep('RollingTextMerger', './rolling-merger.js'))();
    }

    parse(payload) {
      if (!Array.isArray(payload?.events)) return [];
      const events = [...payload.events].sort(
        (a, b) => Number(a?.tStartMs || 0) - Number(b?.tStartMs || 0)
      );

      const rollup = this._parseRollup(events);
      if (rollup && rollup.length) return this._index(rollup);

      return this._index(this._parseStreaming(events));
    }

    // ---- rollup path ----

    _parseRollup(events) {
      const rows = [];
      let sawBreak = false;

      for (const event of events) {
        if (this.text.isRollupBreak(event)) {
          sawBreak = true;
          continue;
        }
        const text = this.text.eventText(event);
        const startMs = Number(event?.tStartMs);
        if (!text || !Number.isFinite(startMs)) continue;
        rows.push({ startMs, endMs: this._eventEndMs(event, startMs), text });
      }

      if (!sawBreak || rows.length < 2) return null;

      const cues = [];
      for (let i = 0; i < rows.length; i += 2) {
        const first = rows[i];
        const second = rows[i + 1];
        const next = rows[i + 2];
        const text = second
          ? this.text.normalize(`${first.text} ${second.text}`)
          : first.text;
        const naturalEnd = Math.max(first.endMs, second?.endMs || 0);
        const nextStart = next?.startMs;
        const endMs =
          Number.isFinite(nextStart) && nextStart > first.startMs
            ? nextStart
            : naturalEnd > first.startMs
              ? naturalEnd
              : first.startMs + 1800;
        cues.push({ startMs: first.startMs, endMs, text });
      }
      return cues;
    }

    // ---- streaming path ----

    _parseStreaming(events) {
      const raw = events
        .map((event) => {
          const text = this.text.eventText(event);
          const startMs = Number(event?.tStartMs);
          if (!text || !Number.isFinite(startMs)) return null;
          return {
            startMs,
            endMs: this._eventEndMs(event, startMs),
            text,
            append: Boolean(event?.aAppend),
          };
        })
        .filter(Boolean);

      // Fill missing durations from the next cue (read-frog #2235 lesson:
      // never use a fixed 200ms; ASR events carry real durations).
      raw.forEach((event, i) => {
        if (event.endMs <= event.startMs) {
          const nextStart = raw[i + 1]?.startMs;
          event.endMs = nextStart > event.startMs ? nextStart : event.startMs + 1800;
        }
      });

      const cues = [];
      for (const event of raw) {
        const prev = cues[cues.length - 1];
        const mergedText = prev ? this.merger.merge(prev.text, event.text) : event.text;
        const mergedWords = this.text.splitWords(mergedText).length;
        const gap = prev ? event.startMs - prev.endMs : Infinity;

        const shouldMerge =
          prev &&
          (event.append ||
            (gap <= 450 &&
              gap >= -900 &&
              !this.text.sentenceIsComplete(prev.text) &&
              mergedWords <= 16 &&
              mergedText.length <= 140));

        if (shouldMerge) {
          prev.text = mergedText;
          prev.endMs = Math.max(prev.endMs, event.endMs);
        } else {
          cues.push({ startMs: event.startMs, endMs: event.endMs, text: event.text });
        }
      }
      return cues;
    }

    // ---- word path (feeds the chunker) ----

    /**
     * JSON3 -> flat list of timed words { text, startMs, endMs }.
     * ASR tracks carry per-word seg offsets. Plain lyric lines (no offsets, and
     * the track does not already break lines itself) are `estimated`: timing is
     * only the line's span spread by length, the first word is `cueStart`, and
     * the chunker keeps the line together. A one-word lyric cue gets the same
     * flags, so it is not glued to the previous line or dropped as a filler.
     * The overlay still highlights from those times; `h` turns that off.
     * Formatted captions that already contain newlines stay on the old path:
     * short chunks and the same highlight.
     */
    parseWords(payload) {
      if (!Array.isArray(payload?.events)) return [];
      const events = [...payload.events].sort(
        (a, b) => Number(a?.tStartMs || 0) - Number(b?.tStartMs || 0)
      );
      // Most cues already have a newline: a formatted subtitle, not a lyric line.
      const formatted = this._formattedTrack(events);
      // One real multi-word line means the untimed cues are lyrics, including
      // a one-word cue like "stay". A stream of single words is still ASR.
      const lyric = !formatted && this._lyricTrack(events);

      let words = [];
      let prevTexts = [];
      let prevEndMs = -Infinity;
      events.forEach((event, i) => {
        if (this.text.isRollupBreak(event)) return;
        const startMs = Number(event?.tStartMs);
        if (!Number.isFinite(startMs)) return;
        let endMs = this._eventEndMs(event, startMs);
        if (endMs <= startMs) {
          const nextStart = Number(events[i + 1]?.tStartMs);
          endMs = nextStart > startMs ? nextStart : startMs + 1800;
        }
        let eventWords = this._eventWords(event, startMs, endMs);
        if (!eventWords.length) return;

        // Rolling windows repeat the previous window's words; keep only new ones.
        // Untimed captions only count as a window when the new line extends the
        // previous one ("Was" → "Was bedeutet"). Sharing a word or two, or
        // repeating the line, is a lyric, not a window.
        const texts = eventWords.map((w) => w.text);
        const overlap = this.merger.overlapSize(prevTexts, texts);
        const hasOffsets = this._hasWordOffsets(event);
        const windowGrew =
          prevTexts.length > 0 &&
          overlap === prevTexts.length &&
          texts.length > prevTexts.length;
        const rolling =
          formatted || hasOffsets
            ? overlap >= 2 || (overlap >= 1 && (event.aAppend || overlap === prevTexts.length))
            : windowGrew;
        if (rolling && startMs <= prevEndMs + 1000) eventWords = eventWords.slice(overlap);
        // Lyric lines have no per-word times and no authored wrap. Keep each
        // cue together, including a one-word cue. Highlight still follows the
        // spread times. Formatted captions are chunked as before.
        if (lyric && !hasOffsets && !rolling) {
          for (const word of eventWords) word.estimated = true;
          eventWords[0].cueStart = true;
        }
        prevTexts = texts;
        prevEndMs = endMs;
        words.push(...eventWords);
      });

      words.sort((a, b) => a.startMs - b.startMs);
      // An event can also open with a mark that belongs to the previous event's last word.
      words = this._attachPunctuation(words);
      words.forEach((word, i) => {
        const nextStart = words[i + 1]?.startMs;
        if (nextStart > word.startMs) word.endMs = Math.min(word.endMs, nextStart);
        // ASR events stay on screen long after their last word was spoken.
        word.endMs = Math.min(word.endMs, word.startMs + (word.timed ? 1200 : 2000));
        if (word.endMs <= word.startMs) word.endMs = word.startMs + 300;
        delete word.timed;
        // The newline in a formatted cue is how YouTube fits the window, not a
        // second line we should show. Short chunks replace it.
        if (formatted) delete word.lineBreak;
      });
      return words;
    }

    /**
     * True when this untimed track has a real lyric line: two or more words that
     * are not just a rolling window growing ("Was" → "Was bedeutet").
     */
    _lyricTrack(events) {
      if (events.some((event) => this._hasWordOffsets(event))) return false;
      let lyricLines = 0;
      let prevTexts = [];
      for (const event of events) {
        if (this.text.isRollupBreak(event)) continue;
        const texts = this.text.splitWords(this.text.rawEventText(event));
        if (!texts.length) continue;
        const overlap = prevTexts.length ? this.merger.overlapSize(prevTexts, texts) : 0;
        const grew =
          prevTexts.length > 0 && overlap === prevTexts.length && texts.length > prevTexts.length;
        prevTexts = texts;
        if (!grew && texts.length >= 2) lyricLines++;
      }
      return lyricLines > 0;
    }

    /** True when cues already wrap themselves (more with a newline than without). */
    _formattedTrack(events) {
      let broken = 0;
      let plain = 0;
      for (const event of events) {
        const raw = this.text.rawEventText(event);
        if (!raw.replace(/\s+/g, '')) continue;
        if (raw.includes('\n')) broken++;
        else plain++;
      }
      return broken > plain;
    }

    _hasWordOffsets(event) {
      const segs = Array.isArray(event?.segs) ? event.segs : [];
      return segs.length > 1 && segs.slice(1).every((s) => s.tOffsetMs != null);
    }

    _eventWords(event, startMs, endMs) {
      let segs = Array.isArray(event?.segs) ? event.segs : [];
      const hasOffsets = this._hasWordOffsets(event);
      if (!hasOffsets) {
        // Authored captions put a line break in the text, not in a separate event.
        const groups = this.text
          .rawEventText(event)
          .split(/\r?\n+/)
          .map((line) => this.text.splitWords(line))
          .filter((line) => line.length);
        const texts = [];
        const lineBreakAt = new Set();
        for (const line of groups) {
          if (texts.length) lineBreakAt.add(texts.length);
          texts.push(...line);
        }
        segs = [{ utf8: '', tOffsetMs: 0, texts, lineBreakAt }];
      }

      const out = [];
      segs.forEach((seg, i) => {
        const texts = seg.texts || this.text.splitWords(seg.utf8);
        if (!texts.length) return;
        const segStart = startMs + Number(seg.tOffsetMs || 0);
        const next = segs[i + 1];
        const segEnd = Math.max(segStart, next ? startMs + Number(next.tOffsetMs) : endMs);
        const totalChars = texts.reduce((n, t) => n + t.length, 0);
        let offset = 0;
        texts.forEach((text, wordIndex) => {
          const wStart = segStart + ((segEnd - segStart) * offset) / totalChars;
          offset += text.length;
          const wEnd = segStart + ((segEnd - segStart) * offset) / totalChars;
          const word = {
            text,
            startMs: Math.round(wStart),
            endMs: Math.round(wEnd),
            timed: hasOffsets && texts.length === 1,
          };
          if (seg.lineBreakAt?.has(wordIndex)) word.lineBreak = true;
          out.push(word);
        });
      });
      // Punctuation can arrive as its own seg (", " or " !"). Fold it across the whole
      // event, so a repeated window tokenizes the same however its segs are cut.
      return this._attachPunctuation(out);
    }

    /** A folded mark keeps its word's timing: a lingering mark is not speech. */
    _attachPunctuation(words) {
      return this.text.attachPunctuation(words, (w) => w.text, (w, text) => ({ ...w, text }));
    }

    _eventEndMs(event, startMs) {
      const segs = Array.isArray(event?.segs) ? event.segs : [];
      const eventDur = Number(event?.dDurationMs) || 0;
      const segEnd = Math.max(
        0,
        ...segs.map((s) => Number(s.tOffsetMs || 0) + Number(s.dDurationMs || 0))
      );
      const dur = Math.max(eventDur, segEnd);
      return startMs + (dur > 0 ? dur : 0);
    }

    _index(cues) {
      return cues.map((cue, index) => ({ ...cue, index }));
    }
  }

  const api = { Json3Parser };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
