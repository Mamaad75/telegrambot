// ---------------------------------------------------------------------------
// composite.frag.glsl — the final grade, and the only pass that touches the
// canvas. Order matters: the deep space gradient is laid down first, the
// additive particle buffer and its bloom are added on top (they are light, not
// paint), then everything goes through one tone map so highlights roll off
// instead of clipping to flat white.
//
// background gradient -> + scene -> + bloom -> chromatic -> ACES -> vignette -> grain
// ---------------------------------------------------------------------------
varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;

uniform float uBloomStrength;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uChromatic;
uniform float uTime;

uniform vec3  uBgTop;
uniform vec3  uBgBottom;
uniform vec3  uBgGlow;
uniform float uBgGlowStrength;
uniform vec2  uBgGlowCenter;
uniform float uTransparent; // 1 = punch the background out, let the page show

// Narkowicz 2015, ACES filmic approximation.
vec3 acesFilm(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2  uv  = vUv;
  vec2  dir = uv - 0.5;
  float r2  = dot(dir, dir);

  // -- background ------------------------------------------------------------
  vec3 bg = mix(uBgBottom, uBgTop, smoothstep(0.0, 1.0, uv.y));
  float halo = pow(max(1.0 - length((uv - uBgGlowCenter) * vec2(1.0, 1.15)) * 1.35, 0.0), 2.6);
  bg += uBgGlow * halo * uBgGlowStrength;
  bg *= 1.0 - uTransparent;

  // -- scene with edge-weighted lens dispersion ------------------------------
  vec2 disp = dir * r2 * uChromatic;
  vec3 scene;
  scene.r = texture2D(tDiffuse, uv + disp).r;
  scene.g = texture2D(tDiffuse, uv).g;
  scene.b = texture2D(tDiffuse, uv - disp).b;

  vec3 bloom = texture2D(tBloomA, uv).rgb * 0.62
             + texture2D(tBloomB, uv).rgb * 0.38;

  vec3 col = bg + scene + bloom * uBloomStrength;
  col = acesFilm(col * uExposure);

  col *= 1.0 - smoothstep(0.25, 0.95, r2 * 1.6) * uVignette;

  float g = hash(uv * 1024.0 + fract(uTime) * 91.7) - 0.5;
  col += g * uGrain;

  // When transparent, alpha follows luminance so the glow blends onto whatever
  // the page puts behind the canvas.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float alpha = mix(1.0, clamp(luma * 2.4, 0.0, 1.0), uTransparent);

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
