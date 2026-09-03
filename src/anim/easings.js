/**
 * Easings + frame rate independent smoothing helpers.
 * Deliberately dependency free: a hero animation should not drag a tween
 * library into a WordPress page just to move a handful of scalars.
 */

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Gentle overshoot, used when the core ignites. */
export const easeOutBack = (t, overshoot = 1.24) => {
  const c3 = overshoot + 1;
  const f = t - 1;
  return 1 + c3 * f * f * f + overshoot * f * f;
};

export const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Exponential smoothing that behaves identically at 30fps and 144fps.
 * `lambda` is roughly "how many e-foldings per second".
 */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Maps `v` from [inMin,inMax] to [0,1], clamped. */
export const remap = (v, inMin, inMax) => clamp((v - inMin) / (inMax - inMin || 1e-6));
