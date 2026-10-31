(() => {
  'use strict';

  /**
   * The settings vocabulary shared by the popup and settings-bridge.js:
   * keys, defaults, allowed values and the labels people see.
   * Single responsibility: data only, no storage or DOM.
   */
  const STYLES = ['frosted', 'tiktok', 'boring']; // "tiktok" is the internal key of the style shown as "Short"
  const STYLE_LABELS = { frosted: 'Frosted', tiktok: 'Short', boring: 'Boring' };
  const STYLE_TAGS = { frosted: 'calm', tiktok: 'fun', boring: 'for accessibility' };

  const SIZES = ['tiny', 'xsmall', 'small', 'medium', 'large', 'xlarge', 'xxlarge'];
  const SIZE_LABELS = {
    tiny: 'Tiny', xsmall: 'Extra small', small: 'Small', medium: 'Medium',
    large: 'Large', xlarge: 'Extra large', xxlarge: 'XXL',
  };
  // Fraction of the player height; mirrored by html[data-ytsc-size] rules in styles.css.
  // Size ladder 2: three steps below ladder 1 (Medium is the old Tiny), which ran
  // too big on large screens.
  const SIZE_VALUES = {
    tiny: 0.02, xsmall: 0.023, small: 0.026, medium: 0.03, large: 0.036, xlarge: 0.042, xxlarge: 0.048,
  };
  const SIZE_LADDER = 2;
  // A size saved on ladder 1 → the ladder 2 step that looks the same (the old Large
  // and up have no match; they get the largest step).
  const LADDER_1_SIZES = {
    tiny: 'medium', xsmall: 'large', small: 'xlarge', medium: 'xxlarge', large: 'xxlarge', xlarge: 'xxlarge', xxlarge: 'xxlarge',
  };
  /**
   * The storage patch that moves a saved size onto the current ladder, or null when
   * it is already there. Takes the raw stored values (not merged with DEFAULTS).
   */
  const sizeMigration = ({ size, sizeLadder } = {}) => {
    if (sizeLadder === SIZE_LADDER) return null;
    const patch = { sizeLadder: SIZE_LADDER };
    if (Object.hasOwn(LADDER_1_SIZES, size)) patch.size = LADDER_1_SIZES[size];
    return patch;
  };

  // Window (background) levels are per style: the frosted panel, a box behind Short text,
  // or Boring's black box (YouTube's levels, minus none: it is there for legibility).
  const WINDOWS = {
    frosted: { key: 'frostedWindow', levels: ['clear', 'light', 'medium', 'dark', 'solid'], label: 'Frosted panel' },
    tiktok: { key: 'tiktokWindow', levels: ['off', '25', '50', '75', '100'], label: 'Background' },
    boring: { key: 'boringWindow', levels: ['25', '50', '75', '100'], label: 'Background' },
  };
  const WINDOW_LABELS = { clear: 'Clear', light: 'Light', medium: 'Medium', dark: 'Dark', solid: 'Solid', off: 'Off' };
  const windowLabel = (level) => WINDOW_LABELS[level] || `${level}%`;

  // highlight: mark the word being spoken; off shows each caption plainly. Boring keeps
  // its own, off by default, so it starts out as plain as YouTube's captions.
  const highlightSetting = (style) => (style === 'boring' ? 'boringHighlight' : 'highlight');

  const DEFAULTS = {
    style: 'frosted', size: 'medium', clean: true, highlight: true, boringHighlight: false,
    frostedWindow: 'medium', tiktokWindow: 'off', boringWindow: '75',
  };

  const Settings = {
    STYLES, STYLE_LABELS, STYLE_TAGS, SIZES, SIZE_LABELS, SIZE_VALUES, WINDOWS, WINDOW_LABELS, DEFAULTS, windowLabel,
    sizeMigration, highlightSetting,
  };

  globalThis.YTSC = Object.assign(globalThis.YTSC || {}, { Settings });
  if (typeof module !== 'undefined' && module.exports) module.exports = { Settings };
})();
