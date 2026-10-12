(() => {
  'use strict';

  /**
   * A faint, slowly drifting dither (a Paper shader) behind the popup. Purely
   * decorative: without WebGL the plain background stays, and reduced motion
   * holds it still. It never touches settings.
   */
  const P = globalThis.PaperShaders;
  const host = document.querySelector('.backdrop');
  if (!P || !host) return;

  const SPEED = 0.16;
  const color = (c) => P.getShaderColorFromString(c);
  const sizing = {
    u_fit: 2, u_scale: 1, u_rotation: 0, u_offsetX: 0, u_offsetY: 0,
    u_originX: 0.5, u_originY: 0.5, u_worldWidth: 0, u_worldHeight: 0,
  };
  // Accent dots at low alpha over the popup background (--bg in popup.css).
  const uniforms = (dark) => ({
    u_colorBack: color(dark ? '#1a1b20' : '#fbfaf8'),
    u_colorFront: color(dark ? 'rgba(126,156,216,0.22)' : 'rgba(126,156,216,0.24)'),
    u_shape: P.DitheringShapes.warp,
    u_type: P.DitheringTypes['4x4'],
    u_pxSize: 2,
  });

  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let mount;
  try {
    mount = new P.ShaderMount(host, P.ditheringFragmentShader, { ...sizing, ...uniforms(scheme.matches) },
      undefined, still.matches ? 0 : SPEED, 0, 1); // pixel ratio 1: crisp enough for 2px dots
  } catch {
    return; // no WebGL: the plain background stays
  }
  scheme.addEventListener('change', () => mount.setUniforms(uniforms(scheme.matches)));
  still.addEventListener('change', () => mount.setSpeed(still.matches ? 0 : SPEED));
})();
