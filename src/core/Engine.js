/**
 * Engine
 * -----------------------------------------------------------------------------
 * Renderer, camera, sizing and the render loop. Deliberately knows nothing
 * about particles — it owns the WebGL lifecycle and hands a clean `dt` to
 * whoever subscribed.
 *
 * Cost control lives here too: the loop is fully stopped when the hero scrolls
 * out of view or the tab is hidden, so an idle hero costs exactly zero GPU.
 */

import {
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export class Engine {
  /**
   * @param {HTMLElement} container
   * @param {object} settings resolved config + quality tier
   */
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.running = false;
    this.visible = true;
    this.pageVisible = true;
    this.onFrame = null;
    this.onResize = null;

    this.renderer = new WebGLRenderer({
      antialias: false,           // additive points do not alias; MSAA is wasted cost
      alpha: !!settings.transparent,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });

    this.renderer.setClearColor(0x000000, 0);
    // Tone mapping happens in the composite pass, in the same shader as the
    // grade, so the renderer itself stays neutral.
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.autoClear = true;

    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('particle-hero__canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      position: 'absolute',
      inset: '0',
    });
    container.appendChild(this.canvas);

    this.scene = new Scene();
    this.scene.background = null;

    this.camera = new PerspectiveCamera(settings.cameraFov, 1, 0.1, 100);
    this.camera.position.set(0, 0, settings.cameraDistance);
    this.camera.lookAt(0, 0, 0);

    // Set by HeroExperience once the character exists; until then the
    // configured distance is used as-is.
    this.framing = null;

    // Own clock rather than THREE.Clock: one fewer deprecated dependency and we
    // need the "resumed after a pause" behaviour to be explicit anyway.
    this.lastTime = 0;
    this.elapsed = 0;
    this.pixelRatio = 1;
    this.width = 1;
    this.height = 1;

    this._tick = this._tick.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._handleResize = this._handleResize.bind(this);

    this._observeSize();
    this._observeVisibility();
    document.addEventListener('visibilitychange', this._onVisibility);

    this.resize();
  }

  _observeSize() {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this._handleResize);
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', this._handleResize, { passive: true });
    }
  }

  _observeVisibility() {
    if (!this.settings.pauseWhenOffscreen || typeof IntersectionObserver === 'undefined') return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          this.visible = entry.isIntersecting;
        }
        this._syncRunState();
      },
      { rootMargin: '120px 0px' }
    );
    this.intersectionObserver.observe(this.container);
  }

  _onVisibility() {
    this.pageVisible = document.visibilityState !== 'hidden';
    this._syncRunState();
  }

  _syncRunState() {
    const shouldRun = this.wanted && this.visible && this.pageVisible;
    if (shouldRun && !this.running) {
      this.running = true;
      this.lastTime = performance.now();
      this.frameId = requestAnimationFrame(this._tick);
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.frameId);
    }
  }

  _handleResize() {
    this.resize();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio);

    this.width = width;
    this.height = height;

    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);

    this.camera.aspect = width / height;
    this.camera.position.z = this._fitDistance();
    this.camera.updateProjectionMatrix();

    if (this.onResize) this.onResize(width, height, this.pixelRatio);
  }

  /**
   * Frame the character so it occupies the same share of the viewport on any
   * aspect ratio. The configured `cameraDistance` is the closest the camera may
   * ever get; narrow viewports simply need more room.
   *
   * @returns {number} camera z
   */
  _fitDistance() {
    const base = this.settings.cameraDistance;
    if (!this.framing) return base;

    const scale = this.settings.scale || 1;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const { fitHeight, fitWidth } = this.settings.fit;

    const distH = (this.framing.height * scale) / fitHeight / (2 * tan);
    const distW = (this.framing.width * scale) / fitWidth / (2 * tan * this.camera.aspect);

    return Math.max(base, distH, distW);
  }

  /**
   * @param {{width:number,height:number}} framing character extents in local units
   */
  setFraming(framing) {
    this.framing = framing;
    this.resize();
  }

  setPixelRatio(ratio) {
    // Persist it as the new ceiling, otherwise the next resize would restore
    // the ratio an adaptive downgrade just gave up.
    this.settings.maxPixelRatio = ratio;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, ratio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    if (this.onResize) this.onResize(this.width, this.height, this.pixelRatio);
  }

  start() {
    this.wanted = true;
    this._syncRunState();
  }

  stop() {
    this.wanted = false;
    this._syncRunState();
  }

  _tick(now) {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this._tick);

    // Clamp dt: a background tab or a long task must not teleport the
    // animation forward when the page comes back.
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.elapsed += dt;
    if (this.onFrame) this.onFrame(dt, this.elapsed);
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    else window.removeEventListener('resize', this._handleResize);
    if (this.intersectionObserver) this.intersectionObserver.disconnect();

    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}
