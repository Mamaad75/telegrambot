// core.frag.glsl — same procedural sprite as the body, tuned hotter.
varying vec3  vColor;
varying float vAlpha;

void main() {
  vec2  uv = gl_PointCoord - 0.5;
  float d  = length(uv) * 2.0;
  if (d > 1.0) discard;

  float halo = pow(1.0 - d, 2.0);
  float core = pow(1.0 - d, 10.0) * 1.4;
  float mask = halo * 0.8 + core;

  vec3 col = mix(vColor, vec3(1.0, 0.95, 0.85), core * 0.7);
  gl_FragColor = vec4(col * mask, mask * vAlpha);
  #include <colorspace_fragment>
}
