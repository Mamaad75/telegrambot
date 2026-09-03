/**
 * Tween — a single scalar in flight.
 * Driven by the render loop (no timers), so it pauses automatically whenever
 * the experience pauses and never drifts out of sync with the frame clock.
 */

import { clamp, easeOutCubic } from './easings.js';

export class Tween {
  constructor(value = 0) {
    this.value = value;
    this.start = value;
    this.end = value;
    this.elapsed = 0;
    this.delay = 0;
    this.duration = 0;
    this.ease = easeOutCubic;
    this.active = false;
    this.onComplete = null;
  }

  /**
   * @param {object} o
   * @param {number} o.to        target value
   * @param {number} [o.from]    defaults to the current value
   * @param {number} o.duration  seconds
   * @param {number} [o.delay]   seconds
   * @param {Function} [o.ease]
   * @param {Function} [o.onComplete]
   */
  to(o) {
    this.start = o.from ?? this.value;
    this.end = o.to;
    this.duration = Math.max(o.duration ?? 0, 1e-4);
    this.delay = o.delay ?? 0;
    this.ease = o.ease ?? easeOutCubic;
    this.onComplete = o.onComplete ?? null;
    this.elapsed = 0;
    this.active = true;
    return this;
  }

  /** Jump to a value and cancel any tween in flight. */
  set(value) {
    this.value = value;
    this.start = value;
    this.end = value;
    this.active = false;
    this.onComplete = null;
    return this;
  }

  update(dt) {
    if (!this.active) return this.value;

    this.elapsed += dt;
    if (this.elapsed < this.delay) return this.value;

    const t = clamp((this.elapsed - this.delay) / this.duration);
    this.value = this.start + (this.end - this.start) * this.ease(t);

    if (t >= 1) {
      this.active = false;
      this.value = this.end;
      if (this.onComplete) {
        const cb = this.onComplete;
        this.onComplete = null;
        cb();
      }
    }
    return this.value;
  }
}
