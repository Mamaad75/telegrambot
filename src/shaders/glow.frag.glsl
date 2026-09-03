// glow.frag.glsl — radial HDR falloff with a soft anamorphic streak.
varying vec2 vUv;

uniform float uTime;
uniform float uIgnite;
uniform float uFlare;
uniform float uOpacity;
uniform vec3  uColor;

void main() {
  vec2  p = vUv - 0.5;
  float d = length(p) * 2.0;

  float glow   = pow(max(1.0 - d, 0.0), 3.0);
  float streak = pow(max(1.0 - abs(p.y) * 9.0, 0.0), 2.5)
               * pow(max(1.0 - abs(p.x) * 1.6, 0.0), 2.0) * 0.55;

  float beat = 0.85 + 0.15 * sin(uTime * 2.4);
  float a = (glow + streak) * uIgnite * beat * uOpacity * (1.0 + uFlare * 1.6);

  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
