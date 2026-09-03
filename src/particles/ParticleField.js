/**
 * ParticleField
 * -----------------------------------------------------------------------------
 * The body of the character: one THREE.Points draw call, one custom shader,
 * zero per-frame buffer updates. The CPU only writes uniforms.
 *
 * Buffers are uploaded once and never touched again, which is what lets this
 * run 90k+ additive particles at 60fps on a laptop and still hold 60 on a
 * mid-range phone at the low tier.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';

import vertexShader from '../shaders/particles.vert.glsl';
import fragmentShader from '../shaders/particles.frag.glsl';
import { sampleCharacter } from '../character/SurfaceSampler.js';
import { CORE_POSITION } from '../character/CharacterBlueprint.js';

export class ParticleField {
  /**
   * @param {object} options
   * @param {number} options.count
   * @param {object} options.colors  resolved palette (css strings)
   * @param {object} options.config  merged runtime config
   */
  constructor({ count, colors, config }) {
    this.config = config;
    this.count = count;

    const data = sampleCharacter({
      count,
      seed: config.seed,
      spread: config.scale >= 1 ? 1 : 0.85,
    });

    this.bounds = data.bounds;

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.position, 3));
    geometry.setAttribute('aScatter', new BufferAttribute(data.scatter, 3));
    geometry.setAttribute('aNormal', new BufferAttribute(data.normal, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(data.seeds, 4));
    geometry.setAttribute('aEdge', new BufferAttribute(data.edge, 1));
    // The dust cloud is far larger than the body; a generous sphere keeps the
    // renderer from frustum-culling particles that are still on their way in.
    geometry.boundingSphere = null;
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius = Math.max(geometry.boundingSphere.radius, 14);

    this.geometry = geometry;

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uForm: { value: 0 },
        uStagger: { value: config.formation.stagger },
        uArc: { value: config.formation.arc },
        uDissolve: { value: 0 },
        uDissolveDistance: { value: config.scroll.distance },
        uBreath: { value: config.motion.breath },

        uSize: { value: config.particles.size },
        uPixelRatio: { value: 1 },
        uOpacity: { value: 0 },

        uPointer: { value: new Vector3(0, 0, 0) },
        uPointerActive: { value: 0 },
        uPointerRadius: { value: config.pointer.radius },
        uPointerPush: { value: config.pointer.push },

        uCenter: { value: new Vector3(0, 0, 0) },
        uCorePos: { value: new Vector3(...CORE_POSITION) },
        uCoreGlow: { value: 0 },
        uCoreFalloff: { value: 3.8 },

        uColorDeep: { value: new Color().setStyle(colors.deep) },
        uColorMid: { value: new Color().setStyle(colors.mid) },
        uColorHot: { value: new Color().setStyle(colors.hot) },
        uColorCore: { value: new Color().setStyle(colors.core) },

        uDrift: { value: config.motion.drift },
        uNoiseScale: { value: config.motion.noiseScale },
        uNoiseSpeed: { value: config.motion.noiseSpeed },
        uBounds: { value: new Vector2(data.bounds.min, data.bounds.max) },
      },
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
  }

  /** @param {number} ratio device pixel ratio actually in use */
  setPixelRatio(ratio) {
    this.material.uniforms.uPixelRatio.value = ratio;
  }

  setColors(colors) {
    const u = this.material.uniforms;
    if (colors.deep) u.uColorDeep.value.setStyle(colors.deep);
    if (colors.mid) u.uColorMid.value.setStyle(colors.mid);
    if (colors.hot) u.uColorHot.value.setStyle(colors.hot);
    if (colors.core) u.uColorCore.value.setStyle(colors.core);
  }

  /**
   * @param {object} state per-frame animation state owned by HeroExperience
   */
  update(state) {
    const u = this.material.uniforms;
    u.uTime.value = state.time;
    u.uForm.value = state.form;
    u.uOpacity.value = state.opacity * this.config.particles.opacity;
    u.uDissolve.value = state.dissolve;
    u.uCoreGlow.value = state.coreGlow;
    u.uPointerActive.value = state.pointerActive;
    u.uPointer.value.copy(state.pointerLocal);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
