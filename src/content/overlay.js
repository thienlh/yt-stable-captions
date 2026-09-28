(() => {
  'use strict';

  /**
   * Caption overlay rendered inside the YouTube player (frosted-block style).
   * Hides the native caption windows, paints one short chunk at a time and
   * marks the word being spoken (styling decides how subtle that is).
   * Single responsibility: DOM rendering only.
   */
  class CaptionOverlay {
    constructor() {
      this.el = null;
      this.chunk = null;
      this.spans = [];
      this.activeIndex = -1;
      this.hideStyle = null;
      this.resizeObserver = null;
    }

    mount() {
      this._hideNative();
      const player = document.querySelector('.html5-video-player') || document.body;
      if (getComputedStyle(player).position === 'static') {
        player.style.position = 'relative';
      }
      if (!this.el) {
        this.el = document.createElement('div');
        this.el.id = 'ytsc-overlay';
        this.el.setAttribute('aria-live', 'off');
        player.appendChild(this.el);
        // Scale text with the player (theater, fullscreen, mini player); styles.css
        // turns this into a font size using the size setting.
        this.resizeObserver = new ResizeObserver(() => {
          this.el.style.setProperty('--ytsc-player-h', `${player.clientHeight}px`);
        });
        this.resizeObserver.observe(player);
      }
      return this.el;
    }

    /**
     * @param chunk  { text, words: [{ text, startMs }] } or null
     * @param timeMs playback time, used to highlight the active word (optional)
     */
    render(chunk, timeMs = null) {
      if (!this.el) this.mount();
      if (!chunk) {
        if (this.chunk) this.clear();
        return;
      }
      if (chunk !== this.chunk) this._paint(chunk);
      this.el.classList.toggle('ytsc-untimed', timeMs == null);
      if (timeMs != null) this._highlight(timeMs);
    }

    clear() {
      this.chunk = null;
      this.spans = [];
      this.activeIndex = -1;
      if (this.el) {
        this.el.textContent = '';
        this.el.classList.remove('ytsc-visible', 'ytsc-fresh');
      }
    }

    destroy() {
      this.clear();
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.el?.remove();
      this.el = null;
      this.hideStyle?.remove();
      this.hideStyle = null;
    }

    _paint(chunk) {
      this.chunk = chunk;
      this.activeIndex = -1;
      this.el.textContent = '';
      const words = chunk.words?.length ? chunk.words : [{ text: chunk.text }];
      this.spans = words.map((word, i) => {
        if (i) this.el.appendChild(document.createTextNode(' '));
        const span = document.createElement('span');
        span.className = 'ytsc-word';
        span.textContent = word.text;
        this.el.appendChild(span);
        return span;
      });
      this.el.classList.add('ytsc-visible');
      // Restart the per-chunk entrance animation (only the TikTok style defines one).
      this.el.classList.remove('ytsc-fresh');
      void this.el.offsetWidth;
      this.el.classList.add('ytsc-fresh');
    }

    _highlight(timeMs) {
      const words = this.chunk?.words || [];
      let index = -1;
      for (let i = 0; i < words.length; i++) {
        if (words[i].startMs <= timeMs) index = i;
        else break;
      }
      if (index === this.activeIndex) return;
      this.spans[this.activeIndex]?.classList.remove('ytsc-active');
      this.spans[index]?.classList.add('ytsc-active');
      this.activeIndex = index;
    }

    _hideNative() {
      if (this.hideStyle) return;
      this.hideStyle = document.createElement('style');
      this.hideStyle.id = 'ytsc-hide-native';
      this.hideStyle.textContent =
        '.ytp-caption-window-container{display:none!important}';
      document.documentElement.appendChild(this.hideStyle);
    }
  }

  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, { CaptionOverlay });
})();
