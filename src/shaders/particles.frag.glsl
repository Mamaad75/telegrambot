// ---------------------------------------------------------------------------
// particles.frag.glsl
// A procedural glow sprite: no texture fetch, no atlas, no extra download.
// Two stacked falloffs give the classic "bloom dot" look — a wide soft halo
// plus a tight hot centre that survives tone mapping.
// ---------------------------------------------------------------------------

varying vec3  vColor;
varying float vAlpha;
varying float vEnergy;

void main() {
  vec2  uv = gl_PointCoord - 0.5;
  float d  = length(uv) * 2.0;
  if (d > 1.0) discard;

  float halo = pow(1.0 - d, 2.4);            // soft outer glow
  float core = pow(1.0 - d, 14.0) * 1.15;    // hot pinpoint centre
  float mask = halo * 0.72 + core;

  // Hot particles bleed toward white so the eye reads them as over-exposed.
  vec3 col = mix(vColor, vec3(1.0), core * 0.55 + vEnergy * 0.22);

  gl_FragColor = vec4(col * mask, mask * vAlpha);
  #include <colorspace_fragment>
}
