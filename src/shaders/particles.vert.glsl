// ---------------------------------------------------------------------------
// particles.vert.glsl
// One vertex = one luminous particle of the character.
//
// Every state the particle can be in is evaluated on the GPU from a handful of
// scalar uniforms, so the CPU never touches a buffer after upload:
//
//   uForm      0 -> 1  scattered dust assembles into the character
//   uDissolve  0 -> 1  the character breaks apart again (scroll driven)
//   uPointer            local space cursor that pushes and swirls the field
//
// Attribute layout
//   position   final resting place on the character surface
//   aScatter   birth position, out in the surrounding dust cloud
//   aNormal    surface normal at `position` (used for breathing + rim light)
//   aSeed      x stagger, y dissolve offset, z phase, w size jitter
//   aEdge      0 face .. 1 cube edge, drives the hard silhouette highlight
// ---------------------------------------------------------------------------

#include ./lib/noise.glsl;

attribute vec3  aScatter;
attribute vec3  aNormal;
attribute vec4  aSeed;
attribute float aEdge;

uniform float uTime;
uniform float uForm;
uniform float uStagger;
uniform float uArc;
uniform float uDissolve;
uniform float uDissolveDistance;
uniform float uBreath;

uniform float uSize;
uniform float uPixelRatio;
uniform float uOpacity;

uniform vec3  uPointer;
uniform float uPointerActive;
uniform float uPointerRadius;
uniform float uPointerPush;

uniform vec3  uCenter;
uniform vec3  uCorePos;
uniform float uCoreGlow;
uniform float uCoreFalloff;

uniform vec3  uColorDeep;
uniform vec3  uColorMid;
uniform vec3  uColorHot;
uniform vec3  uColorCore;

uniform float uDrift;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform vec2  uBounds; // min / max Y of the character, for the vertical ramp

varying vec3  vColor;
varying float vAlpha;
varying float vEnergy;

const float PI = 3.14159265359;

// Quintic ease out: fast departure, long luxurious settle.
float easeOutQuint(float t) { return 1.0 - pow(1.0 - t, 5.0); }
// Slight magnetic snap so the last few percent feel like they lock into place.
float easeOutBackSoft(float t) {
  float f = 1.0 - t;
  return 1.0 - (f * f * f) * (1.0 + 0.35 * sin(f * PI));
}

void main() {
  // -- 1. formation progress, staggered per particle --------------------------
  float delay = aSeed.x * uStagger;
  float span  = max(1.0 - uStagger, 0.0001);
  float t     = clamp((uForm - delay) / span, 0.0, 1.0);
  float form  = mix(easeOutQuint(t), easeOutBackSoft(t), 0.45);

  // -- 2. the dust cloud state ------------------------------------------------
  // Slow curl drift so the pre-formation cloud is never static.
  vec3 wander = curlNoise(aScatter * 0.11 + vec3(0.0, uTime * 0.045, 0.0));
  vec3 from   = aScatter + wander * 1.35;

  // -- 3. the assembled state -------------------------------------------------
  // Surface particles keep breathing along a curl field so the body reads as
  // living energy rather than a frozen point cloud.
  vec3 flow = curlNoise(position * uNoiseScale + vec3(0.0, uTime * uNoiseSpeed, 0.0));
  vec3 formed = position + flow * uDrift * (0.35 + 0.65 * aSeed.z);
  formed += aNormal * sin(uTime * 1.15 + aSeed.z * 6.2831) * 0.010 * uBreath;

  // -- 4. travel along a curved path, not a straight line ---------------------
  vec3 pos = mix(from, formed, form);

  vec3 toTarget = formed - from;
  vec3 axis     = normalize(vec3(aSeed.z - 0.5, aSeed.w - 0.5, aSeed.x - 0.5) + 1e-4);
  vec3 tangent  = normalize(cross(normalize(toTarget + 1e-4), axis) + 1e-4);
  pos += tangent * sin(form * PI) * uArc * (0.35 + 0.65 * aSeed.y);

  // -- 5. scroll dissolve -----------------------------------------------------
  float dStart = aSeed.y * 0.40;
  float diss   = smoothstep(dStart, dStart + 0.60, uDissolve);
  if (diss > 0.0) {
    vec3 outward = normalize(position - uCenter + 1e-4);
    vec3 turb    = curlNoise(position * 0.32 + uTime * 0.12);
    pos += (outward * 1.35 + turb * 1.05 + vec3(0.0, 0.30, 0.0))
         * diss * uDissolveDistance * (0.55 + 0.45 * aSeed.w);
  }

  // -- 6. pointer field: push away and swirl around the cursor ---------------
  if (uPointerActive > 0.001) {
    vec3  delta   = pos - uPointer;
    float dist    = length(delta);
    float falloff = pow(1.0 - smoothstep(0.0, uPointerRadius, dist), 1.6) * uPointerActive;
    vec3  dir     = normalize(delta + 1e-5);
    pos += dir * falloff * uPointerPush * (0.6 + 0.4 * aSeed.w);
    pos += cross(dir, vec3(0.0, 0.0, 1.0)) * falloff * uPointerPush * 0.45;
  }

  // -- 7. colour --------------------------------------------------------------
  // Energy = how far a particle is from rest. Travelling and dissolving
  // particles run hot, settled ones cool down to deep blue.
  float energy = clamp((1.0 - form) * 0.9 + diss * 0.85, 0.0, 1.0);

  float height = clamp((position.y - uBounds.x) / max(uBounds.y - uBounds.x, 1e-4), 0.0, 1.0);
  vec3  col    = mix(uColorDeep, uColorMid, smoothstep(0.0, 1.0, height * 0.65 + aEdge * 0.45));
  col = mix(col, uColorHot, clamp(aEdge * 0.5 + energy * 0.75, 0.0, 1.0));

  // Orange chest core bleeding light into the surrounding body particles.
  float coreInfluence = exp(-distance(position, uCorePos) * uCoreFalloff) * uCoreGlow;
  col = mix(col, uColorCore, clamp(coreInfluence, 0.0, 1.0));

  vColor  = col;
  vEnergy = energy;

  // -- 8. size + alpha --------------------------------------------------------
  float twinkle = 0.78 + 0.22 * sin(uTime * 2.1 + aSeed.z * 42.0);
  vAlpha = uOpacity
         * mix(0.24, 1.0, form)          // dust is dim, body is bright
         * (1.0 - diss * 0.88)           // fade out while dispersing
         * twinkle;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

  float size = uSize * (0.55 + 0.75 * aSeed.w) * (0.85 + 0.5 * aEdge);
  size *= 1.0 + energy * 0.85 + coreInfluence * 0.7;

  gl_PointSize = clamp(size * uPixelRatio * (18.0 / max(-mvPosition.z, 0.1)), 0.6, 64.0);
  gl_Position  = projectionMatrix * mvPosition;
}
