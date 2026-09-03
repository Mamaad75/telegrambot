/**
 * Development playground.
 * Not part of the shipped bundle — `npm run build` only bundles src/index.js.
 */

import { mount } from './index.js';

const el = document.getElementById('hero');
const hero = mount(el, {
  // A slightly showier setup than the defaults, useful while art directing.
  formation: { duration: 5.4 },
});

if (hero) {
  document.getElementById('c-tier').textContent =
    `${hero.capabilities.tier} · ${hero.config.particleCount.toLocaleString('en')}p`;

  const bind = (id, fn) => {
    const input = document.getElementById(id);
    input.addEventListener('input', () => fn(parseFloat(input.value)));
  };

  bind('c-size', (v) => (hero.field.material.uniforms.uSize.value = v));
  bind('c-drift', (v) => (hero.field.material.uniforms.uDrift.value = v));
  bind('c-bloom', (v) => hero.postFX.setBloomStrength(v));
  bind('c-push', (v) => (hero.field.material.uniforms.uPointerPush.value = v));
  bind('c-dissolve', (v) => {
    hero.config.scroll.enabled = v > 0 ? false : true;
    hero.setDissolve(v);
  });

  document.getElementById('c-replay').addEventListener('click', () => hero.replay());

  // Simple fps read-out.
  const fpsEl = document.getElementById('c-fps');
  let frames = 0;
  let last = performance.now();
  const loop = () => {
    frames += 1;
    const now = performance.now();
    if (now - last >= 500) {
      fpsEl.textContent = Math.round((frames * 1000) / (now - last));
      frames = 0;
      last = now;
    }
    requestAnimationFrame(loop);
  };
  loop();

  el.addEventListener('particlehero:formed', () => console.log('[particle-hero] formed'));
}
