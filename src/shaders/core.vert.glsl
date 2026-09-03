// ---------------------------------------------------------------------------
// core.vert.glsl — the orange energy core inside the chest.
// Particles orbit a small sphere; the whole cluster pulses like a heartbeat and
// flares on impact events (formation completion, scroll reform).
// ---------------------------------------------------------------------------

#include ./lib/noise.glsl;

attribute vec4  aSeed;
attribute float aRadius;

uniform float uTime;
uniform float uIgnite;     // 0 -> 1, the core lighting up
uniform float uPulse;      // heartbeat amplitude
uniform float uFlare;      // transient burst
uniform float uSize;
uniform float uPixelRatio;
uniform float uOpacity;
uniform float uDissolve;
uniform vec3  uColorCore;
uniform vec3  uColorEdge;

varying vec3  vColor;
varying float vAlpha;

void main() {
  float beat = 0.5 + 0.5 * sin(uTime * 2.4 + sin(uTime * 1.1) * 0.6);
  float pulse = 1.0 + beat * 0.16 * uPulse + uFlare * 0.55;

  // Orbit: each particle rotates on its own axis at its own rate.
  float a = aSeed.x * 6.2831 + uTime * (0.25 + aSeed.y * 0.55);
  float b = aSeed.z * 3.1415 + uTime * (0.18 + aSeed.w * 0.35);
  vec3 orbit = vec3(sin(b) * cos(a), cos(b), sin(b) * sin(a));

  vec3 pos = orbit * aRadius * pulse * mix(0.15, 1.0, uIgnite);
  pos += curlNoise(pos * 3.2 + uTime * 0.35) * 0.045 * uIgnite;
  pos += orbit * uDissolve * 1.6 * (0.4 + aSeed.y);

  float shell = smoothstep(0.0, 1.0, aRadius);
  vColor = mix(uColorCore, uColorEdge, shell * 0.85);
  vAlpha = uOpacity * uIgnite * (0.55 + 0.45 * beat) * (1.0 - uDissolve * 0.85);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float size = uSize * (0.5 + aSeed.w) * (1.0 + uFlare * 1.2);
  gl_PointSize = clamp(size * uPixelRatio * (18.0 / max(-mvPosition.z, 0.1)), 0.8, 90.0);
  gl_Position  = projectionMatrix * mvPosition;
}
