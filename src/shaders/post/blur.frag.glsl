// blur.frag.glsl — separable 9 tap gaussian using bilinear "dual tap" offsets,
// so a 9 tap kernel costs 5 fetches.
varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform vec2 uDirection;

void main() {
  vec2 off1 = uTexel * uDirection * 1.3846153846;
  vec2 off2 = uTexel * uDirection * 3.2307692308;

  vec4 c = texture2D(tDiffuse, vUv) * 0.2270270270;
  c += texture2D(tDiffuse, vUv + off1) * 0.3162162162;
  c += texture2D(tDiffuse, vUv - off1) * 0.3162162162;
  c += texture2D(tDiffuse, vUv + off2) * 0.0702702703;
  c += texture2D(tDiffuse, vUv - off2) * 0.0702702703;

  gl_FragColor = c;
}
