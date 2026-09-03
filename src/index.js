/**
 * particle-hero — public entry point.
 * -----------------------------------------------------------------------------
 * Built as a UMD/IIFE bundle exposing `window.ParticleHero`, so WordPress can
 * enqueue one file with no module loader, no import maps and no build step on
 * the server.
 *
 *   ParticleHero.mount(el, options)  -> HeroExperience
 *   ParticleHero.autoInit(root)      -> HeroExperience[]   (scans [data-particle-hero])
 *   ParticleHero.get(el)             -> the instance mounted on that element
 *   ParticleHero.destroyAll()
 */

import { HeroExperience } from './HeroExperience.js';
import { DEFAULTS, mergeConfig } from './config.js';
import { detectCapabilities, detectWebGL, prefersReducedMotion } from './core/Capabilities.js';

const instances = new Set();

/** Parse the JSON config carried by the mount element, tolerating junk. */
function readConfig(element) {
  const raw = element.getAttribute('data-particle-hero');
  if (!raw || raw === 'true' || raw === '1') return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (typeof console !== 'undefined') {
      console.warn('[particle-hero] invalid data-particle-hero JSON, using defaults.', error);
    }
    return {};
  }
}

/**
 * Mount the experience on an element.
 * @param {HTMLElement|string} target element or selector
 * @param {object} [options]
 * @returns {HeroExperience|null}
 */
export function mount(target, options = {}) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (!element) return null;
  if (element.__particleHero) return element.__particleHero;

  const config = mergeConfig(readConfig(element), options);
  const instance = new HeroExperience(element, config);

  element.__particleHero = instance;
  instances.add(instance);
  return instance;
}

/**
 * Mount only once the element is close to the viewport.
 * Keeps below-the-fold instances from spending GPU time (and battery) on a
 * page the visitor may never scroll to.
 */
export function mountLazy(element, options = {}, rootMargin = '400px') {
  if (typeof IntersectionObserver === 'undefined') return mount(element, options);
  if (element.__particleHero) return element.__particleHero;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        mount(element, options);
      }
    },
    { rootMargin }
  );
  observer.observe(element);
  element.__particleHeroObserver = observer;
  return null;
}

/**
 * Scan the DOM for `[data-particle-hero]` and mount each one.
 * @param {ParentNode} [root=document]
 */
export function autoInit(root = document) {
  const nodes = root.querySelectorAll('[data-particle-hero]');
  const mounted = [];
  nodes.forEach((node) => {
    if (node.__particleHero) return;
    const eager = node.hasAttribute('data-particle-hero-eager');
    const instance = eager ? mount(node) : mountLazy(node);
    if (instance) mounted.push(instance);
  });
  return mounted;
}

export function get(element) {
  return element?.__particleHero ?? null;
}

export function destroyAll() {
  instances.forEach((instance) => instance.destroy());
  instances.clear();
}

/** Fast, side-effect-free support probe for conditional loading. */
export function isSupported() {
  return detectWebGL().webgl;
}

function boot() {
  autoInit(document);

  // Elementor re-renders widgets in the editor and on tab/carousel changes;
  // hook in so each rebuilt widget gets a fresh instance.
  const elementor = window.elementorFrontend;
  if (elementor?.hooks?.addAction) {
    elementor.hooks.addAction('frontend/element_ready/particle_hero.default', ($scope) => {
      const node = $scope?.[0]?.querySelector?.('[data-particle-hero]');
      if (!node) return;
      get(node)?.destroy();
      mount(node);
    });
    elementor.hooks.addAction('frontend/element_ready/global', ($scope) => {
      const node = $scope?.[0]?.querySelector?.('[data-particle-hero]');
      if (node && !node.__particleHero && !node.__particleHeroObserver) mountLazy(node);
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

export {
  HeroExperience,
  DEFAULTS,
  detectCapabilities,
  detectWebGL,
  prefersReducedMotion,
};
