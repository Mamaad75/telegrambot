/**
 * Capabilities
 * -----------------------------------------------------------------------------
 * Decides how expensive the experience is allowed to be *before* the first
 * frame, then the Engine keeps refining it at runtime (see AdaptiveQuality).
 *
 * The rule of thumb encoded here: fill rate, not particle count, is what kills
 * additive point clouds on mobile — so low tiers lose bloom resolution and
 * pixel ratio before they lose particles.
 */

const TIERS = {
  low: {
    particles: 22000,
    coreParticles: 900,
    maxPixelRatio: 1.35,
    bloom: true,
    bloomScale: 0.25,
    bloomPasses: 1,
    grain: 0.012,
    chromatic: 0.0,
  },
  medium: {
    particles: 52000,
    coreParticles: 1600,
    maxPixelRatio: 1.75,
    bloom: true,
    bloomScale: 0.35,
    bloomPasses: 2,
    grain: 0.016,
    chromatic: 0.0018,
  },
  high: {
    particles: 96000,
    coreParticles: 2600,
    maxPixelRatio: 2,
    bloom: true,
    bloomScale: 0.5,
    bloomPasses: 2,
    grain: 0.018,
    chromatic: 0.0026,
  },
};

/** @returns {{ webgl: false } | { webgl: true, webgl2: boolean }} */
export function detectWebGL() {
  if (typeof window === 'undefined' || !window.WebGLRenderingContext) {
    return { webgl: false, webgl2: false };
  }
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) return { webgl: true, webgl2: true };
    const gl1 = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return { webgl: !!gl1, webgl2: false };
  } catch (e) {
    return { webgl: false, webgl2: false };
  }
}

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function isCoarsePointer() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

/**
 * @param {'auto'|'low'|'medium'|'high'} [preset]
 * @returns {object} tier settings plus diagnostic flags
 */
export function detectCapabilities(preset = 'auto') {
  const gl = detectWebGL();
  const reducedMotion = prefersReducedMotion();
  const coarse = isCoarsePointer();

  let tier = preset;

  if (preset === 'auto') {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || (coarse ? 4 : 8);
    // Both axes scale with DPR, so the real pixel count is dpr squared. Getting
    // this wrong rates a 2x laptop display as cheap as a 1x one.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixels = window.innerWidth * window.innerHeight * dpr * dpr;

    let score = 0;
    score += cores >= 8 ? 2 : cores >= 4 ? 1 : 0;
    score += memory >= 8 ? 2 : memory >= 4 ? 1 : 0;
    score += gl.webgl2 ? 1 : 0;
    score += coarse ? 0 : 1;
    // A 4K desktop display costs as much as a weak GPU: pay for it in tier.
    if (pixels > 4.5e6) score -= 1;

    tier = score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';
  }

  return {
    ...TIERS[tier] ?? TIERS.medium,
    tier: TIERS[tier] ? tier : 'medium',
    webgl: gl.webgl,
    webgl2: gl.webgl2,
    reducedMotion,
    coarsePointer: coarse,
  };
}

export { TIERS };
