/**
 * CharacterBlueprint
 * -----------------------------------------------------------------------------
 * The character is authored as data, not as a downloaded 3D model: a list of
 * axis aligned boxes describing a futuristic, cubic humanoid. Nothing to fetch,
 * nothing to decode, and the silhouette can be retuned by editing numbers.
 *
 * Units are metres-ish. The figure stands ~3.2 units tall, feet at y = -1.68,
 * crown at y = +1.60, so the origin sits at the character's centre of mass.
 *
 * Each part:
 *   pos      centre of the box
 *   size     full width / height / depth
 *   density  relative particle density multiplier (1 = average)
 *   accent   0..1, how much this part burns toward the hot highlight colour
 *            (visor, vents and the core housing read as emissive hardware)
 */

const mirror = (part) => {
  const [x, y, z] = part.pos;
  return { ...part, pos: [-x, y, z] };
};

/** Parts that exist on the right side and get mirrored to the left. */
const LATERAL = [
  // shoulder pad
  { pos: [0.74, 0.80, 0.0], size: [0.36, 0.32, 0.56], density: 1.15, accent: 0.25 },
  // upper arm / elbow / forearm / hand
  { pos: [0.76, 0.40, 0.0], size: [0.25, 0.58, 0.27], density: 1.0, accent: 0.0 },
  { pos: [0.76, 0.06, 0.0], size: [0.23, 0.14, 0.25], density: 1.2, accent: 0.55 },
  { pos: [0.76, -0.24, 0.0], size: [0.22, 0.48, 0.23], density: 1.0, accent: 0.0 },
  { pos: [0.76, -0.56, 0.0], size: [0.21, 0.21, 0.21], density: 1.25, accent: 0.2 },
  // hip / thigh / knee / shin / foot
  { pos: [0.27, -0.44, 0.0], size: [0.32, 0.22, 0.36], density: 1.1, accent: 0.35 },
  { pos: [0.27, -0.78, 0.0], size: [0.35, 0.56, 0.37], density: 1.0, accent: 0.0 },
  { pos: [0.27, -1.10, 0.0], size: [0.31, 0.14, 0.33], density: 1.2, accent: 0.5 },
  { pos: [0.27, -1.38, 0.0], size: [0.29, 0.48, 0.29], density: 1.0, accent: 0.0 },
  { pos: [0.27, -1.62, 0.07], size: [0.33, 0.16, 0.50], density: 1.1, accent: 0.15 },
];

/** Parts on the centre line. */
const CENTRAL = [
  // head, visor, neck
  { pos: [0.0, 1.32, 0.0], size: [0.64, 0.58, 0.62], density: 1.05, accent: 0.0 },
  { pos: [0.0, 1.34, 0.32], size: [0.46, 0.17, 0.04], density: 3.4, accent: 1.0 },
  { pos: [0.0, 1.32, -0.33], size: [0.30, 0.30, 0.05], density: 1.4, accent: 0.6 },
  { pos: [0.0, 0.99, 0.0], size: [0.24, 0.16, 0.24], density: 1.1, accent: 0.4 },
  // chest, core housing, abdomen, pelvis
  { pos: [0.0, 0.58, 0.0], size: [1.08, 0.74, 0.58], density: 1.0, accent: 0.0 },
  { pos: [0.0, 0.60, 0.30], size: [0.40, 0.40, 0.06], density: 2.0, accent: 0.9 },
  { pos: [0.0, 0.08, 0.0], size: [0.74, 0.44, 0.46], density: 1.0, accent: 0.0 },
  { pos: [0.0, -0.22, 0.0], size: [0.88, 0.28, 0.50], density: 1.05, accent: 0.3 },
  // dorsal thruster pack + vents
  { pos: [0.0, 0.66, -0.40], size: [0.64, 0.52, 0.22], density: 1.0, accent: 0.2 },
  { pos: [0.0, 0.42, -0.52], size: [0.46, 0.10, 0.06], density: 1.8, accent: 1.0 },
];

/** The full parts list, mirrored and flattened. */
export const PARTS = [
  ...CENTRAL,
  ...LATERAL,
  ...LATERAL.map(mirror),
];

/** World position of the chest energy core. */
export const CORE_POSITION = [0.0, 0.60, 0.16];

/** Radius of the core cluster. */
export const CORE_RADIUS = 0.24;

/** Vertical extent of the figure, used for the vertical colour ramp. */
export function getBounds(parts = PARTS) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of parts) {
    min = Math.min(min, p.pos[1] - p.size[1] * 0.5);
    max = Math.max(max, p.pos[1] + p.size[1] * 0.5);
  }
  return { min, max };
}

/**
 * Full bounding box of the figure. The camera uses this to frame the character
 * identically on a 21:9 desktop and a portrait phone.
 *
 * @returns {{ width: number, height: number, depth: number }}
 */
export function getExtents(parts = PARTS) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const p of parts) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p.pos[axis] - p.size[axis] * 0.5);
      max[axis] = Math.max(max[axis], p.pos[axis] + p.size[axis] * 0.5);
    }
  }

  return {
    width: max[0] - min[0],
    height: max[1] - min[1],
    depth: max[2] - min[2],
  };
}
