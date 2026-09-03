/**
 * Default configuration.
 * -----------------------------------------------------------------------------
 * Every value here is overridable per instance — from JS, from a data-attribute
 * on the mount element, or from an Elementor control. Keep it flat and boring:
 * this object is the public contract of the whole library.
 */

export const DEFAULTS = {
  /** 'auto' | 'low' | 'medium' | 'high' — caps the particle budget. */
  quality: 'auto',

  /** Explicit particle count; null lets the quality tier decide. */
  particleCount: null,
  coreParticleCount: null,

  /** Deterministic seed: same seed, same character. */
  seed: 1337,

  /** Character scale + framing. */
  scale: 1,
  /** Closest the camera may sit; narrow viewports automatically pull back. */
  cameraDistance: 7.2,
  cameraFov: 34,
  characterOffsetY: 0.05,
  /** Share of the frame the character is allowed to fill on each axis. */
  fit: {
    fitHeight: 0.86,
    fitWidth: 0.78,
  },

  /** Palette. */
  colors: {
    deep: '#062a63',      // shadow side of the body
    mid: '#2f7dff',       // main body blue
    hot: '#9ce7ff',       // cube-edge highlight
    core: '#ff7a1a',      // chest energy core
    coreEdge: '#ffd08a',  // outer shell of the core
    bgTop: '#050a1c',
    bgBottom: '#01030a',
    bgGlow: '#0a3a7a',
  },
  backgroundGlow: 0.85,
  backgroundGlowCenter: [0.5, 0.55],
  /** true = transparent canvas so an Elementor section background shows through. */
  transparent: false,

  /** Intro timing (seconds). The brief asks for a 4-6s assembly. */
  formation: {
    duration: 5.2,
    delay: 0.25,
    stagger: 0.55,   // 0 = every particle lands together, 0.8 = long trailing tail
    arc: 1.35,       // how much particles curve on the way in
    coreIgniteAt: 0.62, // fraction of the formation when the chest lights up
  },

  /** Idle life. */
  motion: {
    drift: 0.085,       // curl-noise wobble amplitude on the settled body
    noiseScale: 0.55,
    noiseSpeed: 0.16,
    breath: 1,
    autoRotate: 0.045,  // radians/second of slow turntable
    sway: 0.055,        // gentle idle sway amplitude
  },

  /** Pointer interaction. */
  pointer: {
    enabled: true,
    radius: 1.5,
    push: 0.45,
    parallax: 0.28,     // how far the character leans toward the cursor
    damping: 3.2,       // higher = snappier
    touch: true,
  },

  /** Scroll driven dissolve / reform. */
  scroll: {
    enabled: true,
    distance: 2.6,      // how far particles fly apart at full dissolve
    start: 0.05,        // fraction of viewport scrolled before dissolve begins
    end: 0.85,          // fraction where dissolve is complete
    parallax: 0.35,     // vertical drift of the character while scrolling
    reformOnReturn: true,
  },

  /** Particle look. */
  particles: {
    size: 1.55,
    opacity: 1,
  },

  /** Post processing. */
  post: {
    bloom: true,
    bloomStrength: 1.15,
    bloomThreshold: 0.32,
    bloomKnee: 0.4,
    exposure: 1.18,
    vignette: 0.55,
    grain: null,      // null = take it from the quality tier
    chromatic: null,
  },

  /** Behaviour. */
  pauseWhenOffscreen: true,
  respectReducedMotion: true,
  maxPixelRatio: null, // null = quality tier
  /** Frames below this fps for a sustained window trigger a quality step down. */
  adaptiveQuality: true,
  targetFps: 50,
};

/** Deep merge that treats arrays as atomic values. */
export function mergeConfig(base, override) {
  if (!override) return { ...base };
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    const v = override[key];
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])) {
      out[key] = mergeConfig(base[key], v);
    } else {
      out[key] = v;
    }
  }
  return out;
}
