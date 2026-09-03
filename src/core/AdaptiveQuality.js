/**
 * AdaptiveQuality
 * -----------------------------------------------------------------------------
 * A hero animation must never be the reason a page feels broken. This watches a
 * rolling frame-time average and steps quality down when the device cannot keep
 * up — cheapest-looking sacrifice first.
 *
 * Steps (in order): pixel ratio -> bloom resolution -> bloom off.
 * It never steps back up: oscillating quality is more noticeable than a
 * slightly softer image, and the first seconds of a page load are the worst
 * possible time to sample performance (hence the warmup).
 */

export class AdaptiveQuality {
  /**
   * @param {object} o
   * @param {number} o.targetFps
   * @param {(step:number)=>void} o.onDowngrade
   */
  constructor({ targetFps = 50, onDowngrade, warmup = 1.5, window: windowSeconds = 2 }) {
    this.targetFps = targetFps;
    this.onDowngrade = onDowngrade;
    this.warmup = warmup;
    this.windowSeconds = windowSeconds;

    this.elapsed = 0;
    this.accumulated = 0;
    this.frames = 0;
    this.step = 0;
    this.maxSteps = 3;
  }

  update(dt) {
    this.elapsed += dt;
    if (this.elapsed < this.warmup || this.step >= this.maxSteps) return;

    this.accumulated += dt;
    this.frames += 1;
    if (this.accumulated < this.windowSeconds) return;

    const fps = this.frames / this.accumulated;
    this.accumulated = 0;
    this.frames = 0;

    if (fps < this.targetFps) {
      this.step += 1;
      this.onDowngrade(this.step);
      // Give the new settings a fresh window before judging again.
      this.elapsed = this.warmup;
    }
  }

  reset() {
    this.accumulated = 0;
    this.frames = 0;
  }
}
