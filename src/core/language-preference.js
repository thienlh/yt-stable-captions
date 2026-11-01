(() => {
  'use strict';

  /**
   * Learns the preferred caption language from the latest manual YouTube
   * selection. Pure data: no DOM, storage, video IDs or watch history.
   * The array shape also migrates the earlier rolling-history storage cleanly.
   */
  class CaptionLanguagePreference {
    static normalize(language) {
      return String(language || '').trim().replaceAll('_', '-').toLowerCase();
    }

    static clean(history) {
      if (!Array.isArray(history)) return [];
      return history.filter((entry) =>
        CaptionLanguagePreference.normalize(entry?.language) &&
        Number.isFinite(entry?.selectedAt)
      ).map((entry) => ({
        language: CaptionLanguagePreference.normalize(entry.language),
        selectedAt: entry.selectedAt,
      })).slice(-1);
    }

    static record(history, language, selectedAt = Date.now()) {
      const normalized = CaptionLanguagePreference.normalize(language);
      if (!normalized || !Number.isFinite(selectedAt)) return CaptionLanguagePreference.clean(history);
      return [{ language: normalized, selectedAt }];
    }

    static preferred(history) {
      return CaptionLanguagePreference.clean(history).at(-1)?.language || null;
    }
  }

  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, { CaptionLanguagePreference });
  if (typeof module !== 'undefined' && module.exports) module.exports = { CaptionLanguagePreference };
})();
