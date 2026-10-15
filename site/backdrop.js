(() => {
  'use strict';

  /* The popup's dither (src/popup/backdrop.js): warp, 4×4, 2px, drifting slowly.
     The back color is this page's navy instead of the popup's paper or charcoal. */
  const P = globalThis.PaperShaders;
  const host = document.querySelector('.backdrop');
  if (!P || !host) return;

  const SPEED = 0.16;
  const color = (c) => P.getShaderColorFromString(c);
  const uniforms = {
    u_fit: 2, u_scale: 1, u_rotation: 0, u_offsetX: 0, u_offsetY: 0,
    u_originX: 0.5, u_originY: 0.5, u_worldWidth: 0, u_worldHeight: 0,
    u_colorBack: color('#1a2744'),
    u_colorFront: color('rgba(126,156,216,0.22)'),
    u_shape: P.DitheringShapes.warp,
    u_type: P.DitheringTypes['4x4'],
    u_pxSize: 2,
  };

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let mount;
  try {
    mount = new P.ShaderMount(host, P.ditheringFragmentShader, uniforms,
      undefined, still.matches ? 0 : SPEED, 0, 1);
  } catch {
    return;
  }
  still.addEventListener('change', () => mount.setSpeed(still.matches ? 0 : SPEED));
})();
