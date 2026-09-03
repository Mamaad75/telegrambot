/**
 * EnergyCore
 * -----------------------------------------------------------------------------
 * The orange reactor in the chest: an orbiting particle cluster plus a
 * camera-facing HDR halo. It is intentionally a separate draw call from the
 * body so it can ignite on its own timeline and flare on events without
 * touching the 90k-particle field.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
} from 'three';

import coreVertex from '../shaders/core.vert.glsl';
import coreFragment from '../shaders/core.frag.glsl';
import glowVertex from '../shaders/glow.vert.glsl';
import glowFragment from '../shaders/glow.frag.glsl';
import { sampleCore } from '../character/SurfaceSampler.js';
import { CORE_POSITION, CORE_RADIUS } from '../character/CharacterBlueprint.js';

export class EnergyCore {
  constructor({ count, colors, config }) {
    this.config = config;
    this.group = new Group();
    this.group.position.set(...CORE_POSITION);
    this.group.renderOrder = 2;

    const data = sampleCore({ count, radius: CORE_RADIUS, seed: config.seed + 7 });

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.position, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(data.seeds, 4));
    geometry.setAttribute('aRadius', new BufferAttribute(data.radii, 1));
    geometry.boundingSphere = null;
    this.geometry = geometry;

    this.material = new ShaderMaterial({
      vertexShader: coreVertex,
      fragmentShader: coreFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIgnite: { value: 0 },
        uPulse: { value: 1 },
        uFlare: { value: 0 },
        uSize: { value: config.particles.size * 1.05 },
        uPixelRatio: { value: 1 },
        uOpacity: { value: 1 },
        uDissolve: { value: 0 },
        uColorCore: { value: new Color().setStyle(colors.core) },
        uColorEdge: { value: new Color().setStyle(colors.coreEdge) },
      },
    });

    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;

    // Camera-facing halo: one quad, one radial falloff, big visual return.
    this.glowMaterial = new ShaderMaterial({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIgnite: { value: 0 },
        uFlare: { value: 0 },
        uOpacity: { value: 0.55 },
        uScale: { value: CORE_RADIUS * 4.2 * (config.scale || 1) },
        uColor: { value: new Color().setStyle(colors.core) },
      },
    });

    this.glow = new Mesh(new PlaneGeometry(1, 1), this.glowMaterial);
    this.glow.frustumCulled = false;

    this.group.add(this.glow);
    this.group.add(this.points);
  }

  setPixelRatio(ratio) {
    this.material.uniforms.uPixelRatio.value = ratio;
  }

  setColors(colors) {
    if (colors.core) {
      this.material.uniforms.uColorCore.value.setStyle(colors.core);
      this.glowMaterial.uniforms.uColor.value.setStyle(colors.core);
    }
    if (colors.coreEdge) this.material.uniforms.uColorEdge.value.setStyle(colors.coreEdge);
  }

  update(state) {
    const u = this.material.uniforms;
    u.uTime.value = state.time;
    u.uIgnite.value = state.coreGlow;
    u.uFlare.value = state.flare;
    u.uDissolve.value = state.dissolve;
    u.uOpacity.value = state.opacity;

    const g = this.glowMaterial.uniforms;
    g.uTime.value = state.time;
    g.uIgnite.value = state.coreGlow;
    g.uFlare.value = state.flare;
    g.uOpacity.value = state.opacity * 0.55 * (1 - state.dissolve * 0.9);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.glow.geometry.dispose();
    this.glowMaterial.dispose();
  }
}
