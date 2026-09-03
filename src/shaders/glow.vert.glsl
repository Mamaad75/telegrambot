// glow.vert.glsl — camera facing billboard for the chest halo.
varying vec2 vUv;
uniform float uScale;

void main() {
  vUv = uv;
  // Billboard: strip rotation out of the model-view matrix.
  vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += position.xy * uScale;
  gl_Position = projectionMatrix * mvPosition;
}
