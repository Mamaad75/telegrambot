/**
 * Pointer
 * -----------------------------------------------------------------------------
 * Normalised, damped cursor tracking.
 *
 * Two details make it feel "natural" rather than "wired to the mouse":
 *  1. everything is exponentially smoothed with a frame-rate independent damp,
 *     so the character leans and settles instead of snapping;
 *  2. when no pointer is present (mobile, or an idle desktop) a slow Lissajous
 *     figure keeps driving the field, so the scene is never dead.
 *
 * All listeners are passive and registered on window, which keeps scrolling
 * smooth on touch devices.
 */

import { damp } from '../anim/easings.js';

export class Pointer {
  /**
   * @param {HTMLElement} element mount element, used for hit testing
   * @param {object} config config.pointer
   */
  constructor(element, config) {
    this.element = element;
    this.config = config;

    /** Raw target in -1..1 space. */
    this.target = { x: 0, y: 0 };
    /** Smoothed value the renderer actually consumes. */
    this.value = { x: 0, y: 0 };
    /** 0..1 ramp: how much the pointer currently influences the field. */
    this.strength = 0;
    this.targetStrength = 0;
    this.idleTime = 0;
    this.hasPointer = false;

    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onTouch = this._onTouch.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);

    if (!config.enabled) return;

    window.addEventListener('pointermove', this._onMove, { passive: true });
    window.addEventListener('pointerleave', this._onLeave, { passive: true });
    window.addEventListener('blur', this._onLeave);

    if (config.touch) {
      window.addEventListener('touchmove', this._onTouch, { passive: true });
      window.addEventListener('touchend', this._onTouchEnd, { passive: true });
      window.addEventListener('touchcancel', this._onTouchEnd, { passive: true });
    }
  }

  _setFromClient(clientX, clientY) {
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.target.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.target.y = -(((clientY - rect.top) / rect.height) * 2 - 1);

    // Influence fades out once the cursor is well outside the hero.
    const outside =
      Math.max(0, Math.abs(this.target.x) - 1) + Math.max(0, Math.abs(this.target.y) - 1);
    this.targetStrength = Math.max(0, 1 - outside * 1.5);
    this.hasPointer = true;
    this.idleTime = 0;
  }

  _onMove(event) {
    this._setFromClient(event.clientX, event.clientY);
  }

  _onTouch(event) {
    const touch = event.touches && event.touches[0];
    if (touch) this._setFromClient(touch.clientX, touch.clientY);
  }

  _onTouchEnd() {
    this.targetStrength = 0;
  }

  _onLeave() {
    this.targetStrength = 0;
  }

  /**
   * @param {number} dt seconds
   * @returns {{x:number,y:number,strength:number}}
   */
  update(dt) {
    this.idleTime += dt;

    // No pointer for a while? Hand over to the ambient drift.
    if (this.idleTime > 2.5 || !this.hasPointer) {
      const t = this.idleTime * 0.22;
      this.target.x = Math.sin(t) * 0.55;
      this.target.y = Math.sin(t * 0.73 + 1.1) * 0.35;
      this.targetStrength = this.hasPointer ? 0.35 : 0.5;
    }

    const lambda = this.config.damping;
    this.value.x = damp(this.value.x, this.target.x, lambda, dt);
    this.value.y = damp(this.value.y, this.target.y, lambda, dt);
    this.strength = damp(this.strength, this.targetStrength, lambda * 0.75, dt);

    return this.value;
  }

  dispose() {
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerleave', this._onLeave);
    window.removeEventListener('blur', this._onLeave);
    window.removeEventListener('touchmove', this._onTouch);
    window.removeEventListener('touchend', this._onTouchEnd);
    window.removeEventListener('touchcancel', this._onTouchEnd);
  }
}
