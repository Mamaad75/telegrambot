/**
 * SurfaceSampler
 * -----------------------------------------------------------------------------
 * Turns the box blueprint into interleaved typed arrays ready for the GPU.
 *
 * Boxes are picked with probability proportional to face area x density, so a
 * big torso panel gets proportionally more particles than a knuckle — the cloud
 * reads as an evenly lit surface instead of clumping on small parts.
 *
 * Everything is generated from a seeded PRNG so a given configuration always
 * produces the exact same character (useful for art direction and for tests).
 */

import { PARTS, getBounds } from './CharacterBlueprint.js';

/** mulberry32 — tiny, fast, good enough distribution, fully deterministic. */
export function createRandom(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The six faces of a unit cube: axis index + sign. */
const FACES = [
  { axis: 0, sign: 1 }, { axis: 0, sign: -1 },
  { axis: 1, sign: 1 }, { axis: 1, sign: -1 },
  { axis: 2, sign: 1 }, { axis: 2, sign: -1 },
];

/**
 * Build the cumulative distribution over (part, face) pairs.
 * @returns {{ cdf: Float64Array, entries: Array, total: number }}
 */
function buildDistribution(parts) {
  const entries = [];
  let total = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const [w, h, d] = part.size;
    for (const face of FACES) {
      // Area of the face perpendicular to `axis`.
      const area = face.axis === 0 ? h * d : face.axis === 1 ? w * d : w * h;
      const weight = area * (part.density ?? 1);
      total += weight;
      entries.push({ part, face, weight });
    }
  }

  const cdf = new Float64Array(entries.length);
  let acc = 0;
  for (let i = 0; i < entries.length; i++) {
    acc += entries[i].weight / total;
    cdf[i] = acc;
  }
  cdf[cdf.length - 1] = 1;

  return { cdf, entries, total };
}

/** Binary search into the CDF. */
function pick(cdf, r) {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Scatter (birth) position for a particle.
 * 70% of the dust lives in a wide spherical shell, 30% in a flattened disc, so
 * the convergence reads as both a collapse and an inward spiral.
 */
function scatterPosition(random, out, o, spread) {
  const disc = random() < 0.3;
  const u = random();
  const v = random();
  const theta = u * Math.PI * 2;

  if (disc) {
    const r = (2.4 + Math.pow(random(), 0.6) * 5.2) * spread;
    out[o] = Math.cos(theta) * r;
    out[o + 1] = (random() - 0.5) * 2.2 * spread;
    out[o + 2] = Math.sin(theta) * r;
  } else {
    const phi = Math.acos(2 * v - 1);
    const r = (2.9 + Math.pow(random(), 0.65) * 4.9) * spread;
    out[o] = Math.sin(phi) * Math.cos(theta) * r;
    out[o + 1] = Math.cos(phi) * r * 0.78;
    out[o + 2] = Math.sin(phi) * Math.sin(theta) * r;
  }
}

/**
 * @param {object} options
 * @param {number} options.count       particles to generate
 * @param {number} [options.seed]      PRNG seed
 * @param {number} [options.spread]    dust cloud radius multiplier
 * @param {number} [options.edgeWidth] width of the bright cube-edge band
 * @param {number} [options.thickness] inward jitter, gives the shell volume
 * @param {Array}  [options.parts]     blueprint override
 */
export function sampleCharacter({
  count,
  seed = 1337,
  spread = 1,
  edgeWidth = 0.055,
  thickness = 0.018,
  parts = PARTS,
} = {}) {
  const random = createRandom(seed);
  const { cdf, entries } = buildDistribution(parts);

  const position = new Float32Array(count * 3);
  const scatter = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  const edge = new Float32Array(count);

  const halfHeights = getBounds(parts);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const i4 = i * 4;

    const entry = entries[pick(cdf, random())];
    const { part, face } = entry;
    const half = [part.size[0] * 0.5, part.size[1] * 0.5, part.size[2] * 0.5];

    // Uniform point on the chosen face, in the box's local space.
    const local = [0, 0, 0];
    local[face.axis] = half[face.axis] * face.sign;

    const tangents = [0, 1, 2].filter((a) => a !== face.axis);
    let minBorder = Infinity;
    for (const axis of tangents) {
      const c = (random() * 2 - 1) * half[axis];
      local[axis] = c;
      minBorder = Math.min(minBorder, half[axis] - Math.abs(c));
    }

    // Edge factor: 1 right on the cube edge, 0 in the middle of a face.
    const edgeFactor = 1 - Math.min(minBorder / edgeWidth, 1);
    edge[i] = Math.min(1, edgeFactor * edgeFactor + (part.accent ?? 0));

    // Push a little inside the shell so the surface has depth.
    const inset = random() * thickness;
    local[face.axis] -= face.sign * inset;

    position[i3] = part.pos[0] + local[0];
    position[i3 + 1] = part.pos[1] + local[1];
    position[i3 + 2] = part.pos[2] + local[2];

    normal[i3] = face.axis === 0 ? face.sign : 0;
    normal[i3 + 1] = face.axis === 1 ? face.sign : 0;
    normal[i3 + 2] = face.axis === 2 ? face.sign : 0;

    scatterPosition(random, scatter, i3, spread);

    // x stagger, y dissolve offset, z phase, w size jitter
    seeds[i4] = random();
    seeds[i4 + 1] = random();
    seeds[i4 + 2] = random();
    seeds[i4 + 3] = random();
  }

  return { position, scatter, normal, seeds, edge, count, bounds: halfHeights };
}

/**
 * Particles for the chest core: a shell-biased sphere so the cluster has a
 * dense, bright rim and a hollow, hot centre.
 */
export function sampleCore({ count, radius, seed = 24601 } = {}) {
  const random = createRandom(seed);
  const seeds = new Float32Array(count * 4);
  const radii = new Float32Array(count);
  const position = new Float32Array(count * 3); // placeholder, animated in shader

  for (let i = 0; i < count; i++) {
    const i4 = i * 4;
    seeds[i4] = random();
    seeds[i4 + 1] = random();
    seeds[i4 + 2] = random();
    seeds[i4 + 3] = random();
    radii[i] = radius * (0.35 + Math.pow(random(), 0.4) * 0.65);
  }

  return { position, seeds, radii, count };
}
