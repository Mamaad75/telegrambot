/**
 * ScrollDriver
 * -----------------------------------------------------------------------------
 * Maps the hero's position in the viewport to a 0..1 dissolve amount.
 *
 * Because the value is a pure function of scroll position, scrolling back up
 * reassembles the character for free — no state machine, no "direction"
 * tracking, and it stays correct after a page restore or an anchor jump.
 *
 * The element rect is measured in a rAF-throttled scroll handler and cached, so
 * the render loop never forces a synchronous layout.
 */

import { clamp } from '../anim/easings.js';

export class ScrollDriver {
  /**
   * @param {HTMLElement} element
   * @param {object} config config.scroll
   */
  constructor(element, config) {
    this.element = element;
    this.config = config;
    this.progress = 0;
    this._queued = false;

    this._onScroll = this._onScroll.bind(this);
    this._measure = this._measure.bind(this);

    if (!config.enabled) return;

    window.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onScroll, { passive: true });
    this._measure();
  }

  _onScroll() {
    if (this._queued) return;
    this._queued = true;
    requestAnimationFrame(this._measure);
  }

  _measure() {
    this._queued = false;
    const rect = this.element.getBoundingClientRect();
    const vh = window.innerHeight || 1;

    // 0 while the hero fills the viewport, 1 once it has scrolled `end` of a
    // viewport height away.
    const scrolled = -rect.top / vh;
    const { start, end } = this.config;
    this.progress = clamp((scrolled - start) / Math.max(end - start, 1e-4));
  }

  /** Force a re-measure, e.g. after Elementor re-lays out the section. */
  refresh() {
    if (this.config.enabled) this._measure();
  }

  dispose() {
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onScroll);
  }
}
