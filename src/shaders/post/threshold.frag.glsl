// threshold.frag.glsl — bright pass with a soft knee so the bloom ramps in
// smoothly instead of popping at the cutoff.
varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;

void main() {
  vec3  c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

  float knee = max(uKnee, 1e-4);
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contribution = max(soft, l - uThreshold) / max(l, 1e-4);

  gl_FragColor = vec4(c * contribution, 1.0);
}
