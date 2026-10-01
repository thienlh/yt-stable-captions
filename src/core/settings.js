(() => {
  'use strict';

  /**
   * The settings vocabulary shared by the popup and settings-bridge.js:
   * keys, defaults, allowed values and the labels people see.
   * Single responsibility: data only, no storage or DOM.
   */
  const STYLES = ['frosted', 'tiktok']; // "tiktok" is the internal key of the style shown as "Short"
  const STYLE_LABELS = { frosted: 'Frosted', tiktok: 'Short' };
  const STYLE_TAGS = { frosted: 'calm', tiktok: 'fun' };

  const SIZES = ['tiny', 'xsmall', 'small', 'medium', 'large', 'xlarge', 'xxlarge'];
  const SIZE_LABELS = {
    tiny: 'Tiny', xsmall: 'Extra small', small: 'Small', medium: 'Medium',
    large: 'Large', xlarge: 'Extra large', xxlarge: 'XXL',
  };
  // Fraction of the player height; mirrored by html[data-ytsc-size] rules in styles.css.
  const SIZE_VALUES = {
    tiny: 0.03, xsmall: 0.036, small: 0.042, medium: 0.048, large: 0.055, xlarge: 0.064, xxlarge: 0.075,
  };

  // Window (background) levels are per style: the frosted panel vs. a box behind Short text.
  const WINDOWS = {
    frosted: { key: 'frostedWindow', levels: ['clear', 'light', 'medium', 'dark', 'solid'], label: 'Frosted panel' },
    tiktok: { key: 'tiktokWindow', levels: ['off', '25', '50', '75', '100'], label: 'Background' },
  };
  const WINDOW_LABELS = { clear: 'Clear', light: 'Light', medium: 'Medium', dark: 'Dark', solid: 'Solid', off: 'Off' };
  const windowLabel = (level) => WINDOW_LABELS[level] || `${level}%`;

  const DEFAULTS = { style: 'frosted', size: 'medium', clean: true, frostedWindow: 'medium', tiktokWindow: 'off' };

  const Settings = {
    STYLES, STYLE_LABELS, STYLE_TAGS, SIZES, SIZE_LABELS, SIZE_VALUES, WINDOWS, WINDOW_LABELS, DEFAULTS, windowLabel,
  };

  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, { Settings });
  if (typeof module !== 'undefined' && module.exports) module.exports = { Settings };
})();
