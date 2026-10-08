import { Vector3 } from 'three';

/**
 * Ready-made hair parts, combined like VRoid Studio's hairstyle items (base,
 * bangs, sides, back, extensions) and built from the inside out like game
 * hair cards (a base of opaque cards for the silhouette, then layers over it).
 * A part is a set of paths drawn on the hair guide, as if with the brush:
 * each becomes a lock through the editor (rooted on the scalp, laid over the
 * hair already there), all in one group the user can remove.
 *
 * Directions around the head: θ around the vertical from the front (+z,
 * θ = 0) towards +x, φ from the top of the head (0) to its equator (π/2).
 */
export const hairParts = [
  { id: 'base', name: 'Base', length: 0.07 },
  { id: 'bangs', name: 'Franja reta', length: 0.11 },
  { id: 'sidebangs', name: 'Franja lateral', length: 0.13 },
  { id: 'sides', name: 'Laterais', length: 0.22 },
  { id: 'backShort', name: 'Traseira curta', length: 0.1 },
  { id: 'backMid', name: 'Traseira média', length: 0.24 },
  { id: 'backLong', name: 'Traseira longa', length: 0.45 },
  { id: 'ponytail', name: 'Rabo de cavalo', length: 0.32 },
  { id: 'pigtails', name: 'Maria-chiquinha', length: 0.26 },
];
const direction = (theta, phi) => new Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));

/** A point on the guide's cap in a direction from the head centre (null where the guide is not). */
function capPoint(editor, theta, phi) {
  const C = editor.state.frame.C, d = direction(theta, phi);
  editor.raycaster.set(C.clone().addScaledVector(d, 0.6), d.clone().negate());
  const [hit] = editor.raycaster.intersectObject(editor.guide.mesh, false);
  return hit ? hit.point.clone() : null;
}
/** A point on the guide's veil at an angle and height below the head centre. */
function veilPoint(editor, theta, y) {
  const C = editor.state.frame.C, d = new Vector3(Math.sin(theta), 0, Math.cos(theta));
  editor.raycaster.set(new Vector3(C.x, y, C.z).addScaledVector(d, 0.6), d.clone().negate());
  const [hit] = editor.raycaster.intersectObject(editor.guide.mesh, false);
  return hit ? hit.point.clone() : null;
}
/** A path over the cap from (θ0, φ0) to (θ1, φ1), then straight down the veil by `drop` metres. */
function fallPath(editor, theta0, phi0, theta1, phi1, drop = 0) {
  const points = [], C = editor.state.frame.C, steps = 10;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, p = capPoint(editor, theta0 + (theta1 - theta0) * t, phi0 + (phi1 - phi0) * t);
    if (p) points.push(p);
  }
  if (drop > 0 && points.length) {
    const start = points.at(-1).y, rows = Math.max(1, Math.round(drop / 0.025));
    for (let k = 1; k <= rows; k++) { const p = veilPoint(editor, theta1, Math.min(start, C.y) - drop * k / rows); if (p) points.push(p); }
  }
  return points;
}
/** Evenly spread angles over [a, b] (count of them). */
const spread = (a, b, count) => Array.from({ length: count }, (_, i) => a + (b - a) * (count === 1 ? 0.5 : i / (count - 1)));

/**
 * Paths (and their lock settings) for a part; `length` sets the part's main
 * length (the fall below the head for the back and sides, the reach of the
 * bangs over the forehead).
 */
function partPaths(editor, id, length) {
  const R = editor.state.frame.R, paths = [];
  const add = (points, params = {}) => { if (points.length >= 3) paths.push({ points, params }); };
  if (id === 'bangs' || id === 'sidebangs') {
    const reach = Math.min(Math.PI / 2, 0.95 + length / R * 0.5);
    for (const theta of spread(-0.75, 0.75, 9)) {
      const sweep = id === 'sidebangs' ? 0.55 : 0;
      add(fallPath(editor, theta * 0.6, 0.45, theta + sweep, reach), { width: 0.028 });
    }
  }
  if (id === 'sides') for (const side of [-1, 1]) for (const theta of spread(1.05, 2.0, 5)) add(fallPath(editor, side * theta * 0.75, 0.55, side * theta, Math.PI / 2, length), { width: 0.032 });
  if (id.startsWith('back')) {
    const count = id === 'backShort' ? 13 : 15;
    for (const theta of spread(Math.PI - 1.75, Math.PI + 1.75, count)) add(fallPath(editor, Math.PI + (theta - Math.PI) * 0.45, 0.35, theta, Math.PI / 2, length), { width: 0.038 });
    // A second, inner row from the crown fills the back under the first.
    for (const theta of spread(Math.PI - 1.4, Math.PI + 1.4, count - 3)) add(fallPath(editor, Math.PI + (theta - Math.PI) * 0.3, 0.2, theta, Math.PI / 2, length * 0.92), { width: 0.04 });
  }
  if (id === 'ponytail' || id === 'pigtails') {
    const gathers = id === 'ponytail' ? [[Math.PI, 1.15]] : [[Math.PI / 2 + 0.55, 1.05], [-(Math.PI / 2 + 0.55), 1.05]];
    for (const [gTheta, gPhi] of gathers) {
      const G = capPoint(editor, gTheta, gPhi);
      if (!G) continue;
      const out = G.clone().sub(editor.state.frame.C).normalize();
      // Locks from all over the head (or its side) gather at G, then fall as one tail.
      const thetas = id === 'ponytail' ? spread(-Math.PI, Math.PI, 18) : spread(Math.sign(gTheta) * 0.35, Math.sign(gTheta) * (Math.PI - 0.35), 9);
      thetas.forEach((theta, k) => {
        const head = fallPath(editor, theta, 0.4, gTheta + (theta - gTheta) * 0.08, gPhi);
        if (head.length < 3) return;
        const lateral = (k / Math.max(1, thetas.length - 1) - 0.5) * 0.03;
        const side = new Vector3().crossVectors(out, new Vector3(0, 1, 0)).normalize();
        const tail = [];
        for (let s = 1; s <= 10; s++) {
          const t = s / 10;
          tail.push(G.clone().addScaledVector(out, 0.012 + 0.025 * Math.sin(Math.min(1, t * 2) * Math.PI / 2)).addScaledVector(side, lateral * (0.3 + t)).add(new Vector3(0, -length * t, 0)));
        }
        add([...head, ...tail], { width: 0.026 });
      });
    }
  }
  return paths;
}

/** The locks of a part (not yet added to the hair): one per path, plus the base's even fill. */
export function makePart(editor, id, { length } = {}) {
  const part = hairParts.find(p => p.id === id);
  if (!part) return [];
  length ??= part.length;
  if (id === 'base') {
    // The innermost layer: short locks over the whole scalp, combed back, from the fill lattice.
    // Wide cards, few of them: the base gives coverage and silhouette (opaque variants), not detail.
    const s = editor.settings, keep = { spacing: s.spacing, length: s.length, imitate: s.imitate, width: s.width };
    Object.assign(s, { spacing: 0.028, length, imitate: false, width: 0.04 });
    const made = [];
    for (const site of editor.fillSites().list) if (site.root) made.push(editor.fillLock(site.root, new Set(made)));
    Object.assign(s, keep);
    return made;
  }
  const made = [];
  for (const { points, params } of partPaths(editor, id, length)) {
    const root = editor.nearestRoot(points[0]);
    if (!root) continue;
    const lock = editor.lockAlong(root, points, { ...editor.creationParams(), ...params });
    if (lock) made.push(lock);
  }
  return made;
}
export const partName = id => hairParts.find(p => p.id === id)?.name ?? id;
