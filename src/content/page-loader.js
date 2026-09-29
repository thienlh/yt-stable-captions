(() => {
  'use strict';

  /**
   * Fallback for browsers that ignore `"world": "MAIN"` in the manifest (Safari).
   * The page-world scripts must share YouTube's JS context (to see the player
   * API and its caption requests). When they did not run there, this isolated
   * content script injects the same files into the page with <script src>.
   *
   * Listed twice in the manifest: at document_start (after the tap) and at
   * document_idle (after main.js). Each run handles its own phase, and the
   * page-world scripts mark <html> when they actually ran in the page.
   * Single responsibility: make sure page-world scripts run in the page.
   */
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.runtime?.getURL) return;

  const PHASES = {
    start: { marker: 'ytscTap', files: ['src/content/timedtext-tap.js'] },
    idle: {
      marker: 'ytscMain',
      files: [
        'src/core/text-utils.js',
        'src/core/rolling-merger.js',
        'src/core/json3-parser.js',
        'src/core/cue-lookup.js',
        'src/core/chunker.js',
        'src/core/disfluency.js',
        'src/content/track-provider.js',
        'src/content/live-source.js',
        'src/content/overlay.js',
        'src/content/main.js',
      ],
    },
  };

  const phase = document.readyState === 'loading' ? PHASES.start : PHASES.idle;
  if (document.documentElement.dataset[phase.marker]) return; // ran in the page already

  // YouTube enforces Trusted Types; where that reaches content scripts, a policy is needed.
  let toScriptURL = (url) => url;
  try {
    const policy = globalThis.trustedTypes?.createPolicy('ytsc-loader', { createScriptURL: (url) => url });
    if (policy) toScriptURL = (url) => policy.createScriptURL(url);
  } catch { /* policy name not allowed: plain strings are accepted then */ }

  const parent = document.head || document.documentElement;
  for (const file of phase.files) {
    const script = document.createElement('script');
    script.src = toScriptURL(api.runtime.getURL(file));
    script.async = false; // keep dependency order
    script.onload = () => script.remove();
    parent.appendChild(script);
  }
})();
