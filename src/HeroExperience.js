/**
 * HeroExperience
 * -----------------------------------------------------------------------------
 * The conductor. Owns the animation state and hands it to every subsystem once
 * per frame:
 *
 *   Engine        WebGL lifecycle, sizing, pause/resume
 *   ParticleField the character body
 *   EnergyCore    the chest reactor
 *   PostFX        bloom + grade
 *   Pointer       damped cursor
 *   ScrollDriver  dissolve amount from scroll position
 *
 * A single `state` object is the only thing that crosses module boundaries per
 * frame, which keeps the subsystems independently testable and replaceable.
 */

import { Group, Vector3 } from 'three';

import { getExtents } from './character/CharacterBlueprint.js';

import { DEFAULTS, mergeConfig } from './config.js';
import { detectCapabilities } from './core/Capabilities.js';
import { Engine } from './core/Engine.js';
import { PostFX } from './core/PostFX.js';
import { AdaptiveQuality } from './core/AdaptiveQuality.js';
import { ParticleField } from './particles/ParticleField.js';
import { EnergyCore } from './particles/EnergyCore.js';
import { Pointer } from './interaction/Pointer.js';
import { ScrollDriver } from './interaction/ScrollDriver.js';
import { Tween } from './anim/Tween.js';
import { clamp, damp, easeOutBack, easeOutCubic } from './anim/easings.js';

const LINEAR = (t) => t;
/** The pointer is projected onto this plane, just in front of the chest. */
const POINTER_PLANE_Z = 0.3;

export class HeroExperience {
  /**
   * @param {HTMLElement} container
   * @param {Partial<typeof DEFAULTS>} [options]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.destroyed = false;
    this.listeners = new Map();

    const capabilities = detectCapabilities(options.quality ?? DEFAULTS.quality);
    this.capabilities = capabilities;

    if (!capabilities.webgl) {
      container.classList.add('particle-hero--unsupported');
      this._emit('unsupported', { reason: 'webgl-unavailable' });
      return;
    }

    // Merge order: defaults -> quality tier -> caller options. The tier only
    // fills in the values the caller left as null.
    const config = mergeConfig(DEFAULTS, options);
    config.particleCount = options.particleCount ?? config.particleCount ?? capabilities.particles;
    config.coreParticleCount =
      options.coreParticleCount ?? config.coreParticleCount ?? capabilities.coreParticles;
    config.maxPixelRatio = config.maxPixelRatio ?? capabilities.maxPixelRatio;
    config.post = {
      ...config.post,
      bloom: config.post.bloom && capabilities.bloom,
      grain: config.post.grain ?? capabilities.grain,
      chromatic: config.post.chromatic ?? capabilities.chromatic,
    };
    config.bloomScale = capabilities.bloomScale;
    config.bloomPasses = capabilities.bloomPasses;
    config.grain = capabilities.grain;
    config.chromatic = capabilities.chromatic;

    this.reducedMotion = config.respectReducedMotion && capabilities.reducedMotion;
    this.config = config;

    // ---- animation state, the single source of truth for the frame ---------
    this.state = {
      time: 0,
      form: 0,
      opacity: 0,
      dissolve: 0,
      coreGlow: 0,
      flare: 0,
      pointerActive: 0,
      pointerLocal: new Vector3(),
    };

    this.tweens = {
      reveal: new Tween(),
      form: new Tween(),
      core: new Tween(),
      flare: new Tween(),
    };

    this._build();
    this._bind();
    this.play();
  }

  // --------------------------------------------------------------------------
  // construction
  // --------------------------------------------------------------------------

  _build() {
    const { config } = this;

    this.engine = new Engine(this.container, config);
    this.postFX = new PostFX(this.engine.renderer, config);

    this.field = new ParticleField({
      count: config.particleCount,
      colors: config.colors,
      config,
    });

    this.core = new EnergyCore({
      count: config.coreParticleCount,
      colors: config.colors,
      config,
    });

    this.character = new Group();
    this.character.scale.setScalar(config.scale);
    this.character.position.y = config.characterOffsetY;
    this.character.add(this.field.points);
    this.character.add(this.core.group);
    this.engine.scene.add(this.character);

    this.pointer = new Pointer(this.container, config.pointer);
    this.scroll = new ScrollDriver(this.container, config.scroll);

    this.adaptive = new AdaptiveQuality({
      targetFps: config.targetFps,
      onDowngrade: (step) => this._downgrade(step),
    });

    this.spin = 0;
    this._wasDissolved = false;
    this._ray = new Vector3();
    this._worldPointer = new Vector3();

    this.engine.onResize = (w, h, ratio) => {
      this.postFX.setSize(w, h, ratio);
      this.field.setPixelRatio(ratio);
      this.core.setPixelRatio(ratio);
      this.scroll.refresh();
      if (this.reducedMotion) this._renderOnce();
    };
    this.engine.onFrame = (dt) => this._frame(dt);

    this.engine.setFraming(getExtents());
    this.container.classList.add('particle-hero--ready');
  }

  _bind() {
    if (this.reducedMotion) {
      // Straight to the final pose: no assembly, no dissolve, one frame drawn.
      this.state.form = 1;
      this.state.opacity = 1;
      this.state.coreGlow = 1;
      this.config.motion.drift = 0;
      this.config.motion.breath = 0;
      this.field.material.uniforms.uDrift.value = 0;
      this.field.material.uniforms.uBreath.value = 0;
      return;
    }

    const { formation } = this.config;

    this.tweens.reveal.to({ to: 1, duration: 1.1, delay: formation.delay * 0.5, ease: easeOutCubic });

    this.tweens.form.to({
      to: 1,
      duration: formation.duration,
      delay: formation.delay,
      ease: LINEAR, // per-particle easing already lives in the vertex shader
      onComplete: () => {
        this.container.classList.add('particle-hero--formed');
        this._emit('formed');
        this._pulse(0.7);
      },
    });

    // The chest ignites part way through the assembly, so the character reads
    // as "powering on" rather than "finished".
    this.tweens.core.to({
      to: 1,
      duration: 1.4,
      delay: formation.delay + formation.duration * formation.coreIgniteAt,
      ease: easeOutBack,
      onComplete: () => {
        this._emit('core-online');
        this._pulse(1);
      },
    });
  }

  // --------------------------------------------------------------------------
  // per frame
  // --------------------------------------------------------------------------

  _frame(dt) {
    const { state, config } = this;
    state.time += dt;

    if (!this.reducedMotion) {
      state.opacity = this.tweens.reveal.update(dt);
      state.form = this.tweens.form.update(dt);
      state.coreGlow = this.tweens.core.update(dt);
      state.flare = this.tweens.flare.update(dt);
    }

    this._updatePointer(dt);
    this._updateScroll(dt);
    this._updateTransform(dt);

    this.field.update(state);
    this.core.update(state);

    this.postFX.render(this.engine.scene, this.engine.camera, state.time);

    if (config.adaptiveQuality) this.adaptive.update(dt);
  }

  _updatePointer(dt) {
    const { config, state } = this;
    if (!config.pointer.enabled) {
      state.pointerActive = 0;
      return;
    }

    const p = this.pointer.update(dt);
    state.pointerActive = this.pointer.strength;

    // Unproject the cursor onto a plane just in front of the chest, then move
    // it into the character's local space so the shader can work in the same
    // coordinates as the particle targets.
    const camera = this.engine.camera;
    this._ray.set(p.x, p.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const t = (POINTER_PLANE_Z - camera.position.z) / (this._ray.z || -1e-6);
    this._worldPointer.copy(camera.position).addScaledVector(this._ray, t);

    this.character.updateMatrixWorld();
    state.pointerLocal.copy(this.character.worldToLocal(this._worldPointer));
  }

  _updateScroll(dt) {
    const { config, state } = this;
    if (!config.scroll.enabled || this.reducedMotion) return;

    const target = this.scroll.progress;
    state.dissolve = damp(state.dissolve, target, 5.5, dt);

    // Reassembling after a real dissolve deserves a flash of the core.
    if (state.dissolve > 0.55) this._wasDissolved = true;
    if (this._wasDissolved && state.dissolve < 0.08) {
      this._wasDissolved = false;
      this._pulse(0.8);
    }
  }

  _updateTransform(dt) {
    const { config, state } = this;
    const p = this.pointer.value;

    if (!this.reducedMotion) {
      this.spin += config.motion.autoRotate * dt;
    }

    const parallax = config.pointer.enabled ? config.pointer.parallax : 0;
    const lean = this.pointer.strength;

    this.character.rotation.y = damp(
      this.character.rotation.y,
      this.spin + p.x * parallax * lean,
      4,
      dt
    );
    this.character.rotation.x = damp(
      this.character.rotation.x,
      -p.y * parallax * 0.45 * lean,
      4,
      dt
    );

    const sway = this.reducedMotion ? 0 : Math.sin(state.time * 0.55) * config.motion.sway;
    const scrollLift = state.dissolve * config.scroll.parallax;
    this.character.position.y = config.characterOffsetY + sway + scrollLift;
  }

  /** One-off render, used for the reduced-motion static frame. */
  _renderOnce() {
    this.field.update(this.state);
    this.core.update(this.state);
    this._updateTransform(1 / 60);
    this.postFX.render(this.engine.scene, this.engine.camera, this.state.time);
  }

  /** Transient burst of the core, used on ignition and on reform. */
  _pulse(strength = 1) {
    this.tweens.flare.set(strength).to({ to: 0, duration: 0.9, ease: easeOutCubic });
  }

  _downgrade(step) {
    if (step === 1) {
      this.engine.setPixelRatio(Math.max(1, this.engine.pixelRatio * 0.75));
    } else if (step === 2) {
      this.postFX.setBloomScale(0.22);
    } else {
      this.postFX.setBloomStrength(0);
    }
    this._emit('quality-downgrade', { step });
  }

  // --------------------------------------------------------------------------
  // public API
  // --------------------------------------------------------------------------

  play() {
    if (this.destroyed || !this.engine) return this;
    if (this.reducedMotion) {
      this._renderOnce();
      this.container.classList.add('particle-hero--formed');
      this._emit('formed');
      return this;
    }
    this.engine.start();
    return this;
  }

  pause() {
    this.engine?.stop();
    return this;
  }

  /** Replay the assembly from scratch. */
  replay() {
    if (!this.engine || this.reducedMotion) return this;
    this.container.classList.remove('particle-hero--formed');
    this.state.form = 0;
    this.state.opacity = 0;
    this.state.coreGlow = 0;
    this.tweens.reveal.set(0);
    this.tweens.core.set(0);
    this.tweens.form.set(0);
    this._bind();
    this.play();
    return this;
  }

  /** Manually drive the dissolve, 0 = assembled, 1 = full dust. */
  setDissolve(value) {
    this.state.dissolve = clamp(value);
    return this;
  }

  setColors(colors) {
    Object.assign(this.config.colors, colors);
    this.field?.setColors(this.config.colors);
    this.core?.setColors(this.config.colors);
    this.postFX?.setColors(this.config.colors);
    if (this.reducedMotion) this._renderOnce();
    return this;
  }

  /** Re-measure after a layout change (Elementor tabs, accordions, etc.). */
  refresh() {
    this.engine?.resize();
    this.scroll?.refresh();
    return this;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return this;
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  _emit(event, detail = {}) {
    this.listeners.get(event)?.forEach((fn) => fn(detail));
    this.container.dispatchEvent(
      new CustomEvent(`particlehero:${event}`, { detail: { ...detail, instance: this }, bubbles: true })
    );
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pointer?.dispose();
    this.scroll?.dispose();
    this.field?.dispose();
    this.core?.dispose();
    this.postFX?.dispose();
    this.engine?.dispose();
    this.listeners.clear();
    this.container.classList.remove('particle-hero--ready', 'particle-hero--formed');
    delete this.container.__particleHero;
  }
}
