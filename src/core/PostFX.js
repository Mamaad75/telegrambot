/**
 * PostFX
 * -----------------------------------------------------------------------------
 * A purpose-built bloom + grade pipeline. three's EffectComposer chain is not
 * used on purpose: it would ship several extra passes we do not need and force
 * a full-resolution ping-pong. This does the job in five small draws.
 *
 *   scene (HDR, half float)
 *     -> threshold (1/2 res)
 *     -> blur H, blur V          -> bloom A   (wide, bright)
 *     -> blur H, blur V (1/4)    -> bloom B   (very wide, soft)
 *     -> composite: background + scene + bloom, ACES, vignette, grain
 *
 * Two bloom scales instead of one full mip chain is the sweet spot: it reads as
 * a real lens without the six extra render targets.
 */

import {
  Color,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
} from 'three';

import fullscreenVertex from '../shaders/post/fullscreen.vert.glsl';
import thresholdFragment from '../shaders/post/threshold.frag.glsl';
import blurFragment from '../shaders/post/blur.frag.glsl';
import compositeFragment from '../shaders/post/composite.frag.glsl';

const BLACK_PIXEL = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
BLACK_PIXEL.needsUpdate = true;

function createTarget(width, height, type) {
  const rt = new WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.colorSpace = LinearSRGBColorSpace;
  rt.texture.generateMipmaps = false;
  return rt;
}

export class PostFX {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {object} settings resolved config + quality tier
   */
  constructor(renderer, settings) {
    this.renderer = renderer;
    this.settings = settings;
    this.enabled = true;

    // Half float keeps highlights above 1.0 so the bloom threshold has
    // something to bite into. WebGL1 without the extension falls back to LDR.
    this.type =
      renderer.capabilities.isWebGL2 || renderer.extensions.has('OES_texture_half_float')
        ? HalfFloatType
        : UnsignedByteType;

    this.bloomScale = settings.bloomScale;
    this.size = new Vector2(1, 1);

    this.rtScene = createTarget(1, 1, this.type);
    this.rtA = createTarget(1, 1, this.type);
    this.rtB = createTarget(1, 1, this.type);
    this.rtC = createTarget(1, 1, this.type);
    this.rtD = createTarget(1, 1, this.type);

    this.quad = new Mesh(new PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.fsScene = new Scene();
    this.fsScene.add(this.quad);
    this.fsCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.thresholdMaterial = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: thresholdFragment,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: settings.post.bloomThreshold },
        uKnee: { value: settings.post.bloomKnee },
      },
    });

    this.blurMaterial = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: blurFragment,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new Vector2() },
        uDirection: { value: new Vector2(1, 0) },
      },
    });

    this.compositeMaterial = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      depthWrite: false,
      depthTest: false,
      transparent: !!settings.transparent,
      uniforms: {
        tDiffuse: { value: null },
        tBloomA: { value: BLACK_PIXEL },
        tBloomB: { value: BLACK_PIXEL },
        uBloomStrength: { value: settings.post.bloom ? settings.post.bloomStrength : 0 },
        uExposure: { value: settings.post.exposure },
        uVignette: { value: settings.post.vignette },
        uGrain: { value: settings.post.grain ?? settings.grain },
        uChromatic: { value: settings.post.chromatic ?? settings.chromatic },
        uTime: { value: 0 },
        uBgTop: { value: new Color().setStyle(settings.colors.bgTop) },
        uBgBottom: { value: new Color().setStyle(settings.colors.bgBottom) },
        uBgGlow: { value: new Color().setStyle(settings.colors.bgGlow) },
        uBgGlowStrength: { value: settings.backgroundGlow },
        uBgGlowCenter: { value: new Vector2(...settings.backgroundGlowCenter) },
        uTransparent: { value: settings.transparent ? 1 : 0 },
      },
    });
  }

  setSize(width, height, pixelRatio) {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    if (this.size.x === w && this.size.y === h) return;

    this.size.set(w, h);
    this.rtScene.setSize(w, h);

    const bw = Math.max(1, Math.floor(w * this.bloomScale));
    const bh = Math.max(1, Math.floor(h * this.bloomScale));
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);
    this.rtC.setSize(Math.max(1, bw >> 1), Math.max(1, bh >> 1));
    this.rtD.setSize(Math.max(1, bw >> 1), Math.max(1, bh >> 1));
  }

  /** Swap the fullscreen quad's material and draw it into `target`. */
  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.fsScene, this.fsCamera);
  }

  _blur(source, target, dirX, dirY) {
    const u = this.blurMaterial.uniforms;
    u.tDiffuse.value = source.texture;
    u.uTexel.value.set(1 / source.width, 1 / source.height);
    u.uDirection.value.set(dirX, dirY);
    this._blit(this.blurMaterial, target);
  }

  /**
   * @param {import('three').Scene} scene
   * @param {import('three').Camera} camera
   * @param {number} time
   */
  render(scene, camera, time) {
    const renderer = this.renderer;

    // 1. HDR scene pass
    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    const bloomOn = this.settings.post.bloom && this.compositeMaterial.uniforms.uBloomStrength.value > 0;

    if (bloomOn) {
      // 2. bright pass
      this.thresholdMaterial.uniforms.tDiffuse.value = this.rtScene.texture;
      this._blit(this.thresholdMaterial, this.rtA);

      // 3. separable blur -> bloom A
      this._blur(this.rtA, this.rtB, 1, 0);
      this._blur(this.rtB, this.rtA, 0, 1);

      if (this.settings.bloomPasses > 1) {
        // 4. second, wider octave -> bloom B
        this._blur(this.rtA, this.rtC, 1, 0);
        this._blur(this.rtC, this.rtD, 0, 1);
        this.compositeMaterial.uniforms.tBloomB.value = this.rtD.texture;
      } else {
        this.compositeMaterial.uniforms.tBloomB.value = this.rtA.texture;
      }
      this.compositeMaterial.uniforms.tBloomA.value = this.rtA.texture;
    } else {
      this.compositeMaterial.uniforms.tBloomA.value = BLACK_PIXEL;
      this.compositeMaterial.uniforms.tBloomB.value = BLACK_PIXEL;
    }

    // 5. composite to the canvas
    this.compositeMaterial.uniforms.tDiffuse.value = this.rtScene.texture;
    this.compositeMaterial.uniforms.uTime.value = time;
    this._blit(this.compositeMaterial, null);
  }

  setBloomStrength(value) {
    this.compositeMaterial.uniforms.uBloomStrength.value = value;
  }

  /** Used by AdaptiveQuality to buy back frame time without visible popping. */
  setBloomScale(scale) {
    if (Math.abs(scale - this.bloomScale) < 0.01) return;
    this.bloomScale = scale;
    const w = this.size.x;
    const h = this.size.y;
    this.size.set(0, 0); // force setSize to recompute
    this.setSize(w, h, 1);
  }

  setColors(colors) {
    const u = this.compositeMaterial.uniforms;
    if (colors.bgTop) u.uBgTop.value.setStyle(colors.bgTop);
    if (colors.bgBottom) u.uBgBottom.value.setStyle(colors.bgBottom);
    if (colors.bgGlow) u.uBgGlow.value.setStyle(colors.bgGlow);
  }

  dispose() {
    [this.rtScene, this.rtA, this.rtB, this.rtC, this.rtD].forEach((rt) => rt.dispose());
    this.quad.geometry.dispose();
    this.thresholdMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}
