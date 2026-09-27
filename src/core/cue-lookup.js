(() => {
  'use strict';

  /**
   * Binary-search lookup of the active cue at a given playback time.
   * Single responsibility: time -> cue. Pure, no DOM.
   */
  class CueLookup {
    atTime(cues, timeMs) {
      let low = 0;
      let high = cues.length - 1;
      let candidate = null;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (cues[mid].startMs <= timeMs) {
          candidate = cues[mid];
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return candidate && timeMs < candidate.endMs ? candidate : null;
    }
  }

  function cueAtTime(cues, timeMs) {
    return new CueLookup().atTime(cues, timeMs);
  }

  const api = { CueLookup, cueAtTime };
  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
