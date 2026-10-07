import {
  BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, MeshStandardMaterial, Quaternion, SRGBColorSpace,
  SkinnedMesh, Triangle, Uint16BufferAttribute, Vector3,
} from 'three';
import { SurfaceCollider } from './collision.mjs';

/**
 * Hair grooming for game characters.
 *
 * A hairstyle is a set of guide strands rooted on the scalp, the way XGen,
 * Houdini and Blender groom: brushes and physics act on the guides, and the
 * game mesh is generated from them as textured hair cards (Epic's hair-card
 * workflow: several cards per clump, alpha strand texture laid out root to tip).
 *
 * - The scalp is the part of the head above an editable hairline (16 control
 *   points around the head, in head-centred angles).
 * - Partings split the scalp; roots connected without crossing a parting form a
 *   section, which is what you select and pull as one lock.
 * - Physics is Dynamic Follow-The-Leader (Müller, Chentanez & Kim 2012): each
 *   point is placed at its rest distance from the previous one in one pass, so
 *   strands never stretch, and velocities get the s_damping correction
 *   v_i = (p_i − x_i)/Δt − s_damping·d_{i+1}/Δt. Points held by a clip or a tie
 *   split a strand; between two held points the chain is solved with
 *   FABRIK-style backward/forward passes (Aristidou & Lasenby 2011).
 * - Collision uses the exact skin surface above the pelvis (and the outfit)
 *   (the paper used a few ellipsoids), plus a density grid for hair volume and
 *   friction (Petrovic et al. 2005).
 */
export const POINTS = 16;
export const HAIRLINE_POINTS = 16;
export const hairTextureTypes = ['straight', 'wavy', 'curly', 'coily'];
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const round = (v, digits = 1000) => Math.round(v * digits) / digits;

// ---------------------------------------------------------------- data model

/** A natural hairline: high on the forehead, above the ears, low at the nape (radians of elevation). */
export function defaultHairline() {
  return Array.from({ length: HAIRLINE_POINTS }, (_, k) => {
    const c = Math.cos(k / HAIRLINE_POINTS * TAU);
    return round(c > 0 ? 0.08 + (0.42 - 0.08) * c : 0.08 + (-0.62 - 0.08) * -c);
  });
}

export function defaultGroom() {
  return { v: 1, hairline: defaultHairline(), partings: [], density: 240, length: 0.17, guides: null, ties: [], seed: 1 };
}

/** Bounded, serialisable copy of groom data (positions are in head-normalised units). */
export function normalizeGroom(value) {
  const base = defaultGroom();
  if (!value || typeof value !== 'object') return base;
  const finite = (x, a, b, fallback) => Number.isFinite(x) ? clamp(x, a, b) : fallback;
  const result = {
    v: 1,
    hairline: Array.isArray(value.hairline) && value.hairline.length === HAIRLINE_POINTS ? value.hairline.map((x, k) => round(finite(x, -1.2, 1.2, base.hairline[k]))) : base.hairline,
    partings: Array.isArray(value.partings) ? value.partings.slice(0, 24).map(line => Array.isArray(line) ? line.slice(0, 200).filter(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)).map(([t, f]) => [round(t), round(f)]) : []).filter(line => line.length > 1) : [],
    density: Math.round(finite(value.density, 40, 600, base.density)),
    length: round(finite(value.length, 0.02, 1.2, base.length)),
    seed: Math.floor(finite(value.seed, 0, 1e9, 1)),
    guides: null, ties: [],
  };
  if (Array.isArray(value.guides)) {
    result.guides = value.guides.slice(0, 1200).filter(g => g && Number.isInteger(g.f) && Array.isArray(g.b) && Array.isArray(g.p) && g.p.length === POINTS * 3 && g.p.every(Number.isFinite)).map(g => ({
      // b[0] in [2, 3] marks the quad's second triangle (see rootPoint).
      f: g.f, b: [round(finite(g.b[0], 0, 3, 0.33), 1e5), round(finite(g.b[1], 0, 1, 0.33), 1e5)],
      p: g.p.map(x => round(clamp(x, -30, 30))),
      r: Array.isArray(g.r) && g.r.length === POINTS * 3 && g.r.every(Number.isFinite) ? g.r.map(x => round(clamp(x, -30, 30))) : undefined,
      fz: g.fz ? 1 : 0,
      c: Array.isArray(g.c) ? g.c.filter(c => Array.isArray(c) && c.length === 4 && c.every(Number.isFinite) && c[0] >= 1 && c[0] < POINTS).map(([i, x, y, z]) => [Math.round(i), round(x), round(y), round(z)]) : [],
      t: Math.round(finite(g.t, 0, 3, 0)), cu: round(finite(g.cu, 0, 1, 0.5)), w: round(finite(g.w, 0.3, 3, 1)),
      br: Number.isInteger(g.br) && g.br >= 0 ? g.br : -1,
    }));
  }
  if (Array.isArray(value.ties)) {
    result.ties = value.ties.slice(0, 32).filter(t => t && Array.isArray(t.p) && t.p.length === 3 && t.p.every(Number.isFinite)).map(t => ({ p: t.p.map(x => round(x)) }));
  }
  return result;
}

// ---------------------------------------------------------- head and scalp

/**
 * Head frame from the morphed body: centre C and radius R of the head, the
 * head-weighted vertices, and every body face (base-mesh order) for roots.
 */
export function headFrame(data, positions) {
  const count = positions.length / 3;
  const headBone = data.skeleton.bones.findIndex(bone => bone.name === 'head');
  const headWeight = new Float32Array(count);
  for (let v = 0; v < count; v++) for (let k = 0; k < 4; k++) if (data.joints[v * 4 + k] === headBone) headWeight[v] += data.weights[v * 4 + k] / 65535;
  const bodyGroup = data.base.faceGroups.indexOf('body');
  const faces = [];
  for (let f = 0; f < data.faceGroup.length; f++) if (data.faceGroup[f] === bodyGroup) faces.push(f);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const used = new Uint8Array(count);
  for (const f of faces) for (let c = 0; c < 4; c++) used[data.faces[f * 4 + c]] = 1;
  for (let v = 0; v < count; v++) if (used[v] && headWeight[v] > 0.6) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[v * 3 + k]); max[k] = Math.max(max[k], positions[v * 3 + k]); }
  const R = (max[1] - min[1]) / 2;
  const C = new Vector3(0, (min[1] + max[1]) / 2 + R * 0.12, (min[2] + max[2]) / 2 - R * 0.08);
  return { C, R, headWeight, faces, used };
}

export function anglesOf(frame, x, y, z) {
  const dx = x - frame.C.x, dy = y - frame.C.y, dz = z - frame.C.z;
  return { theta: Math.atan2(dx, dz), phi: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Hairline elevation at an azimuth: periodic Catmull-Rom through the control points. */
export function hairlineAt(hairline, theta) {
  const n = hairline.length, t = ((theta / TAU) % 1 + 1) % 1 * n;
  const i = Math.floor(t), f = t - i;
  const p = k => hairline[((i + k) % n + n) % n];
  const p0 = p(-1), p1 = p(0), p2 = p(1), p3 = p(2);
  return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/** Signed scalp coverage per base vertex (radians above the hairline; −1 off the head). */
export function scalpField(frame, positions, hairline) {
  const count = positions.length / 3, field = new Float32Array(count).fill(-1);
  for (let v = 0; v < count; v++) {
    if (!frame.used[v] || frame.headWeight[v] < 0.3) continue;
    const { theta, phi } = anglesOf(frame, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    // The face (front, below the brows) never grows scalp hair.
    field[v] = phi - hairlineAt(hairline, theta);
  }
  return field;
}

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Scalp triangles (body faces fully above the hairline) with areas, for sampling roots. */
function scalpTriangles(data, positions, frame, field) {
  const tris = [];
  frame.faces.forEach((face, f) => {
    const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
    if (!ids.every(v => field[v] >= 0)) return;
    for (const [a, b, c, q] of [[0, 1, 2, 0], [0, 2, 3, 1]]) {
      const A = new Vector3().fromArray(positions, ids[a] * 3), B = new Vector3().fromArray(positions, ids[b] * 3), Cc = new Vector3().fromArray(positions, ids[c] * 3);
      const area = new Triangle(A, B, Cc).getArea();
      if (area > 0) tris.push({ f, half: q, area });
    }
  });
  return tris;
}

/** World position and normal of a root stored as (body face, barycentric u, v) on its first or second triangle. */
export function rootPoint(data, positions, normals, frame, f, b) {
  const face = frame.faces[f];
  if (face === undefined) return null;
  const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
  // b packs the triangle choice: u > 1 means the second half of the quad.
  const second = b[0] > 1, u = second ? b[0] - 2 : b[0], v = b[1];
  const [a, bb, c] = second ? [ids[0], ids[2], ids[3]] : [ids[0], ids[1], ids[2]];
  const w = 1 - u - v;
  const p = new Vector3(), n = new Vector3();
  for (const [id, s] of [[a, w], [bb, u], [c, v]]) {
    p.x += positions[id * 3] * s; p.y += positions[id * 3 + 1] * s; p.z += positions[id * 3 + 2] * s;
    n.x += normals[id * 3] * s; n.y += normals[id * 3 + 1] * s; n.z += normals[id * 3 + 2] * s;
  }
  return { p, n: n.normalize() };
}

/** Blue-noise roots on the scalp: area-weighted samples kept only if far enough from the others. */
export function sampleRoots(data, positions, normals, frame, field, density, seed, existing = []) {
  const tris = scalpTriangles(data, positions, frame, field);
  const total = tris.reduce((s, t) => s + t.area, 0);
  if (!total) return { roots: [], spacing: 0 };
  const spacing = Math.sqrt(total / density) * 0.92;
  const random = rng(seed * 7919 + 17);
  const cell = spacing, grid = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const accept = p => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const q of grid.get(`${cx + i},${cy + j},${cz + k}`) ?? []) if (q.distanceToSquared(p) < spacing * spacing) return false;
    }
    return true;
  };
  const add = p => { const k = key(p.x, p.y, p.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); };
  for (const p of existing) add(p);
  const cumulative = [];
  let acc = 0;
  for (const t of tris) { acc += t.area; cumulative.push(acc); }
  const roots = [];
  for (let attempt = 0; attempt < density * 30 && roots.length < density * 1.2; attempt++) {
    const r = random() * total;
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < r) lo = mid + 1; else hi = mid; }
    const t = tris[lo];
    let u = random(), v = random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const b = [t.half ? u + 2 : u, v];
    const root = rootPoint(data, positions, normals, frame, t.f, b);
    if (!accept(root.p)) continue;
    add(root.p);
    roots.push({ f: t.f, b, ...root });
  }
  return { roots, spacing };
}

/** Sections: roots joined to near neighbours unless a parting line separates them (in head angles). */
export function computeSections(frame, rootPositions, partings, spacing) {
  const n = rootPositions.length, angles = rootPositions.map(p => anglesOf(frame, p.x, p.y, p.z));
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const crosses = (a, b) => {
    for (const line of partings) for (let k = 0; k + 1 < line.length; k++) {
      const [t1, f1] = line[k], [t2, f2] = line[k + 1];
      if (Math.abs(t1 - t2) > Math.PI || Math.abs(a.theta - b.theta) > Math.PI) continue;
      const d = (x1, y1, x2, y2, x3, y3) => (x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1);
      const d1 = d(t1, f1, t2, f2, a.theta, a.phi), d2 = d(t1, f1, t2, f2, b.theta, b.phi);
      const d3 = d(a.theta, a.phi, b.theta, b.phi, t1, f1), d4 = d(a.theta, a.phi, b.theta, b.phi, t2, f2);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
    return false;
  };
  const limit = (spacing * 1.9) ** 2;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (rootPositions[i].distanceToSquared(rootPositions[j]) > limit) continue;
    if (!crosses(angles[i], angles[j])) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
  }
  const ids = new Map();
  return Array.from({ length: n }, (_, i) => { const r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r); });
}

// ------------------------------------------------------------- collision

/**
 * Hair collider: the exact head surface (hair rests on it) plus capsules
 * around neck, torso and arms, and optionally the outfit surface.
 */
export function hairCollider(data, positions, normals, frame, skeleton, outfit = null) {
  // Collide with the real skin above the pelvis (head, neck, shoulders, back,
  // chest and arms) rather than fitted capsules: a capsule wide enough for the
  // chest is far too wide at the neck and props the hair up like an umbrella.
  const head = new SurfaceCollider(0.015);
  const pelvis = skeleton.heads[skeleton.byName.get('pelvis')]?.y ?? frame.C.y - 0.7;
  const index = [];
  for (const face of frame.faces) {
    const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
    if (ids.some(v => positions[v * 3 + 1] < pelvis)) continue;
    index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  head.add(positions, normals, index);
  if (outfit) head.add(outfit.positions, outfit.normals, outfit.index, { orient: true });
  const hit = {};
  // Broad phase: a lazily filled distance grid (8 mm cells). A cell whose
  // centre is farther from every surface than the thickness plus half its
  // diagonal cannot hold a colliding point, so the exact query is skipped.
  const cell = 0.008, half = cell * Math.sqrt(3) / 2;
  const lo = [0, 1, 2].map(k => Math.min(...head.layers.map(l => l.min[k])) - 0.04);
  const hi = [0, 1, 2].map(k => Math.max(...head.layers.map(l => l.max[k])) + 0.04);
  const dims = [0, 1, 2].map(k => Math.ceil((hi[k] - lo[k]) / cell));
  const field = new Float32Array(dims[0] * dims[1] * dims[2]).fill(NaN);
  const clearance = (x, y, z) => {
    const i = Math.floor((x - lo[0]) / cell), j = Math.floor((y - lo[1]) / cell), k = Math.floor((z - lo[2]) / cell);
    if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return Infinity;
    const id = (k * dims[1] + j) * dims[0] + i;
    let d = field[id];
    if (Number.isNaN(d)) {
      d = Infinity;
      for (const layer of head.layers) if (layer.closest(lo[0] + (i + 0.5) * cell, lo[1] + (j + 0.5) * cell, lo[2] + (k + 0.5) * cell, 0.03, hit)) d = Math.min(d, hit.distance);
      field[id] = d;
    }
    return d;
  };
  return {
    head, capsules: [], normal: new Float32Array(3), depth: 0,
    /** Push p (array slice x,y,z at offset o) out to `thickness`; returns true if moved. */
    resolve(p, o, thickness) {
      if (clearance(p[o], p[o + 1], p[o + 2]) > thickness + half) return false;
      // The layer that most needs the point moved (skin or clothing), so a point
      // between skin and shirt does not alternate between the two surfaces.
      if (!head.deepest(p[o], p[o + 1], p[o + 2], 0.03, thickness, 0.03, hit) || hit.distance >= thickness) return false;
      const push = thickness - hit.distance;
      p[o] += hit.nx * push; p[o + 1] += hit.ny * push; p[o + 2] += hit.nz * push;
      // Contact normal and depth, for friction.
      this.normal[0] = hit.nx; this.normal[1] = hit.ny; this.normal[2] = hit.nz; this.depth = push;
      return true;
    },
  };
}

// --------------------------------------------------------------- physics

export class HairSim {
  /**
   * Guide-strand solver following AMD TressFX (GPUOpen, MIT), used in shipped
   * games. Per step and strand: Verlet integration with exponential damping
   * and gravity; global shape constraints pulling points towards the styled
   * shape (strength and effective range from the root); local shape
   * constraints restoring each segment's rest direction in the frame of the
   * previous one (root direction and curls); several length passes in which
   * held points (root, clips, the lock being pulled) do not move; and
   * collision with the skin (and clothing) with Coulomb friction.
   *
   * guides: [{ points, segment, rest (styled shape), frozen, clips: Map(index → Vector3), grab }].
   * Unfrozen hair keeps its shape only near the root, so a released lock falls;
   * frozen hair holds its whole styled shape, like hair set with product.
   */
  constructor(guides, collider, { thickness = 0.004, damping = 0.08, gravity = -9.81, lengthIterations = 4, localIterations = 2, clampDelta = 0.05 } = {}) {
    this.guides = guides; this.collider = collider;
    this.thickness = thickness; this.damping = damping; this.gravity = gravity;
    this.lengthIterations = lengthIterations; this.localIterations = localIterations; this.clampDelta = clampDelta;
    this.friction = { static: 0.8, kinetic: 0.5 };
    this.dftlDamping = 0; this.dftlMode = 'none';
    // TressFX defaults use local 0.9; global matching only holds the root area.
    this.free = { global: 0.2, range: 0.25, local: 0.9 };
    this.held = { global: 0.8, range: 1, local: 0.95 };
    for (const g of guides) this.adopt(g);
  }
  adopt(g) {
    g.old ??= Float32Array.from(g.points);
    g.rest ??= Float32Array.from(g.points);
    g.velocity ??= new Float32Array(POINTS * 3);
    g.grab ??= null;
  }
  /** Make the current shape the styled (rest) shape of a guide. */
  static setRest(g) { g.rest = Float32Array.from(g.points); g.old = Float32Array.from(g.points); }
  step(dt = 1 / 60) {
    const decay = Math.exp(-this.damping * dt * 60), g2 = this.gravity * dt * dt, th = this.thickness;
    const fixed = new Uint8Array(POINTS), target = new Float32Array(POINTS * 3);
    for (const g of this.guides) {
      this.adopt(g);
      if (g.frozen && !g.grab && !g.clips.size) { g.old.set(g.points); continue; }
      const x = g.points, old = g.old, rest = g.rest, l = g.segment;
      fixed.fill(0); fixed[0] = 1;
      // The follicle sets the direction a hair leaves the scalp: the first
      // segment keeps its styled direction (unless that point is being held).
      // Without it gravity tips front-top roots over sideways and opens a
      // bare parting down the middle.
      fixed[1] = 1; target[3] = rest[3]; target[4] = rest[4]; target[5] = rest[5];
      for (const [i, t] of g.clips) { fixed[i] = 1; target[i * 3] = t.x; target[i * 3 + 1] = t.y; target[i * 3 + 2] = t.z; }
      if (g.grab) for (const [i, t] of g.grab) { fixed[i] = 1; target[i * 3] = t.x; target[i * 3 + 1] = t.y; target[i * 3 + 2] = t.z; }
      // 1. Verlet integration with damping and gravity.
      for (let i = 1; i < POINTS; i++) {
        for (let k = 0; k < 3; k++) {
          const cur = x[i * 3 + k], next = cur + decay * (cur - old[i * 3 + k]) + (k === 1 ? g2 : 0);
          old[i * 3 + k] = cur; x[i * 3 + k] = next;
        }
        if (fixed[i]) { x[i * 3] = target[i * 3]; x[i * 3 + 1] = target[i * 3 + 1]; x[i * 3 + 2] = target[i * 3 + 2]; }
      }
      // 2. Global shape constraints: towards the styled shape near the root (all of it when frozen).
      const shape = g.frozen ? this.held : this.free;
      const range = Math.max(1, Math.round(shape.range * POINTS));
      for (let i = 1; i < range; i++) if (!fixed[i]) for (let k = 0; k < 3; k++) x[i * 3 + k] += shape.global * (rest[i * 3 + k] - x[i * 3 + k]);
      // 3. Local shape constraints (TressFX LocalShapeConstraints): rotate the
      // rest segment i→i+1 by the rotation taking rest segment i-1→i onto the
      // current one, then split the correction between both ends.
      const stiffness = 0.5 * Math.min(shape.local, 0.95);
      for (let iteration = 0; iteration < this.localIterations; iteration++) {
        for (let i = 1; i + 1 < POINTS; i++) {
          let ax = rest[i * 3] - rest[i * 3 - 3], ay = rest[i * 3 + 1] - rest[i * 3 - 2], az = rest[i * 3 + 2] - rest[i * 3 - 1];
          let bx = x[i * 3] - x[i * 3 - 3], by = x[i * 3 + 1] - x[i * 3 - 2], bz = x[i * 3 + 2] - x[i * 3 - 1];
          const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1;
          ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
          const vx = rest[i * 3 + 3] - rest[i * 3], vy = rest[i * 3 + 4] - rest[i * 3 + 1], vz = rest[i * 3 + 5] - rest[i * 3 + 2];
          // Rodrigues for the shortest rotation a→b: v' = v·c + w×v + w(w·v)/(1+c), w = a×b.
          const c = ax * bx + ay * by + az * bz;
          let rx = vx, ry = vy, rz = vz;
          if (c > -0.999) {
            const wx = ay * bz - az * by, wy = az * bx - ax * bz, wz = ax * by - ay * bx, f = (wx * vx + wy * vy + wz * vz) / (1 + c);
            rx = vx * c + (wy * vz - wz * vy) + wx * f;
            ry = vy * c + (wz * vx - wx * vz) + wy * f;
            rz = vz * c + (wx * vy - wy * vx) + wz * f;
          }
          const dx = stiffness * (x[i * 3] + rx - x[i * 3 + 3]), dy = stiffness * (x[i * 3 + 1] + ry - x[i * 3 + 4]), dz = stiffness * (x[i * 3 + 2] + rz - x[i * 3 + 5]);
          if (!fixed[i]) { x[i * 3] -= dx; x[i * 3 + 1] -= dy; x[i * 3 + 2] -= dz; }
          if (!fixed[i + 1]) { x[i * 3 + 3] += dx; x[i * 3 + 4] += dy; x[i * 3 + 5] += dz; }
        }
      }
      // 4. Length constraints; held points do not move.
      for (let iteration = 0; iteration < this.lengthIterations; iteration++) {
        for (let i = 0; i + 1 < POINTS; i++) {
          const wa = fixed[i] ? 0 : 1, wb = fixed[i + 1] ? 0 : 1, w = wa + wb;
          if (!w) continue;
          const dx = x[i * 3 + 3] - x[i * 3], dy = x[i * 3 + 4] - x[i * 3 + 1], dz = x[i * 3 + 5] - x[i * 3 + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-9, corr = (d - l) / d / w;
          x[i * 3] += dx * corr * wa; x[i * 3 + 1] += dy * corr * wa; x[i * 3 + 2] += dz * corr * wa;
          x[i * 3 + 3] -= dx * corr * wb; x[i * 3 + 4] -= dy * corr * wb; x[i * 3 + 5] -= dz * corr * wb;
        }
        // Contacts are projected with the other constraints (PBD solver loop,
        // Müller et al. 2007) so shape, length and collision converge together;
        // resolved once at the end they fight and a resting tip flips each step.
        if (this.collider) for (let i = 1; i < POINTS; i++) if (!fixed[i]) this.collider.resolve(x, i * 3, th);
      }
      // 5. Collision with friction, inside a final follow-the-leader pass from
      // the root (DFTL): every point ends at exactly its segment length, and a
      // held point the strand cannot reach is approached as closely as it allows.
      const before = this.before ??= new Float32Array(POINTS * 3), contact = this.contact ??= new Uint8Array(POINTS);
      before.set(x); contact.fill(0);
      for (let i = 1; i < POINTS; i++) {
        place(x, i, i - 1, l);
        if (this.collider?.resolve(x, i * 3, th)) {
          contact[i] = 1;
          // Coulomb friction from the contact depth d (Macklin et al. 2014,
          // eqs. 23-24): the tangential motion of this step is removed when
          // below mu_s·d (static), else reduced by mu_k·d (kinetic). Hair lying
          // on the head stays where it was combed; hanging hair still falls.
          const n = this.collider.normal, d = this.collider.depth;
          const mx = x[i * 3] - old[i * 3], my = x[i * 3 + 1] - old[i * 3 + 1], mz = x[i * 3 + 2] - old[i * 3 + 2];
          const mn = mx * n[0] + my * n[1] + mz * n[2];
          const tx = mx - n[0] * mn, ty = my - n[1] * mn, tz = mz - n[2] * mn, tl = Math.hypot(tx, ty, tz);
          const f = tl < this.friction.static * d ? 1 : Math.min(this.friction.kinetic * d / (tl || 1), 1);
          x[i * 3] -= tx * f; x[i * 3 + 1] -= ty * f; x[i * 3 + 2] -= tz * f;
          place(x, i, i - 1, l);
          // As in TressFX, a point in contact loses its velocity.
          old[i * 3] = x[i * 3]; old[i * 3 + 1] = x[i * 3 + 1]; old[i * 3 + 2] = x[i * 3 + 2];
          continue;
        }
        // TressFX clamps the per-step motion to keep the solver stable.
        const mx = x[i * 3] - old[i * 3], my = x[i * 3 + 1] - old[i * 3 + 1], mz = x[i * 3 + 2] - old[i * 3 + 2], m2 = mx * mx + my * my + mz * mz;
        if (m2 > this.clampDelta * this.clampDelta) {
          const f = this.clampDelta / Math.sqrt(m2);
          old[i * 3] = x[i * 3] - mx * f; old[i * 3 + 1] = x[i * 3 + 1] - my * f; old[i * 3 + 2] = x[i * 3 + 2] - mz * f;
        }
      }
      // DFTL velocity correction (Müller et al. 2012): v_i -= s·d_{i+1}/Δt,
      // with d the correction the pass gave the next point. Without it the
      // pass feeds energy back every step and hair at rest keeps swaying.
      for (let i = 1; i < POINTS; i++) {
        if (fixed[i] || contact[i]) continue;
        if (this.dftlMode === 'self') { for (let k = 0; k < 3; k++) old[i * 3 + k] += x[i * 3 + k] - before[i * 3 + k]; continue; }
        if (i + 1 < POINTS) for (let k = 0; k < 3; k++) old[i * 3 + k] += this.dftlDamping * (x[i * 3 + 3 + k] - before[i * 3 + 3 + k]);
      }
    }
    this.volume(dt);
  }
  /**
   * Hair-hair friction and repulsion through a density grid (Petrovic et al.
   * 2005; also the volume pass of Unity's hair system): points are splatted to
   * the grid nodes with trilinear weights, so density and velocity vary
   * continuously as hair moves. Friction blends each point's velocity with the
   * interpolated grid velocity; where density exceeds the target, a push
   * proportional to its gradient spreads hair out. A continuous field matters:
   * per-cell counts jump as a point crosses a cell and make resting hair sway.
   */
  volume(dt, cell = 0.015, friction = 0.06, repulsion = 0.0006, target = 1.2) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const g of this.guides) for (let i = 2; i < POINTS; i++) for (let k = 0; k < 3; k++) { const v = g.points[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    if (!(lo[0] < hi[0])) return;
    const nx = Math.ceil((hi[0] - lo[0]) / cell) + 2, ny = Math.ceil((hi[1] - lo[1]) / cell) + 2, nz = Math.ceil((hi[2] - lo[2]) / cell) + 2, count = nx * ny * nz;
    if (!this.grid || this.grid.rho.length < count) this.grid = { rho: new Float32Array(count), vel: new Float32Array(count * 3) };
    const rho = this.grid.rho, vel = this.grid.vel;
    rho.fill(0, 0, count); vel.fill(0, 0, count * 3);
    const at = (i, j, k) => (k * ny + j) * nx + i;
    // Trilinear cell coordinates of a point: base node and fractions.
    const cellOf = (x, y, z, out) => {
      const fx = (x - lo[0]) / cell, fy = (y - lo[1]) / cell, fz = (z - lo[2]) / cell;
      out[0] = Math.floor(fx); out[1] = Math.floor(fy); out[2] = Math.floor(fz);
      out[3] = fx - out[0]; out[4] = fy - out[1]; out[5] = fz - out[2];
    };
    const c = new Float64Array(6);
    for (const g of this.guides) for (let i = 2; i < POINTS; i++) {
      const x = g.points, o = g.old;
      cellOf(x[i * 3], x[i * 3 + 1], x[i * 3 + 2], c);
      const vx = x[i * 3] - o[i * 3], vy = x[i * 3 + 1] - o[i * 3 + 1], vz = x[i * 3 + 2] - o[i * 3 + 2];
      for (let corner = 0; corner < 8; corner++) {
        const a = corner & 1, b = (corner >> 1) & 1, d = corner >> 2;
        const w = (a ? c[3] : 1 - c[3]) * (b ? c[4] : 1 - c[4]) * (d ? c[5] : 1 - c[5]), id = at(c[0] + a, c[1] + b, c[2] + d);
        rho[id] += w; vel[id * 3] += w * vx; vel[id * 3 + 1] += w * vy; vel[id * 3 + 2] += w * vz;
      }
    }
    for (const g of this.guides) {
      if (g.frozen) continue;
      const x = g.points, o = g.old;
      for (let i = 2; i < POINTS; i++) {
        cellOf(x[i * 3], x[i * 3 + 1], x[i * 3 + 2], c);
        let r = 0, ux = 0, uy = 0, uz = 0, gx = 0, gy = 0, gz = 0;
        for (let corner = 0; corner < 8; corner++) {
          const a = corner & 1, b = (corner >> 1) & 1, d = corner >> 2;
          const wx = a ? c[3] : 1 - c[3], wy = b ? c[4] : 1 - c[4], wz = d ? c[5] : 1 - c[5], id = at(c[0] + a, c[1] + b, c[2] + d), q = rho[id];
          const w = wx * wy * wz;
          r += w * q;
          if (q > 0) { ux += w * vel[id * 3] / q; uy += w * vel[id * 3 + 1] / q; uz += w * vel[id * 3 + 2] / q; }
          // Gradient of the trilinear density inside the cell.
          gx += (a ? 1 : -1) * wy * wz * q; gy += (b ? 1 : -1) * wx * wz * q; gz += (d ? 1 : -1) * wx * wy * q;
        }
        // Verlet velocity is x - old: blend it with the local average by moving old.
        const vx = x[i * 3] - o[i * 3], vy = x[i * 3 + 1] - o[i * 3 + 1], vz = x[i * 3 + 2] - o[i * 3 + 2];
        let mx = vx + (ux - vx) * friction, my = vy + (uy - vy) * friction, mz = vz + (uz - vz) * friction;
        if (r > target) { const push = repulsion * Math.min(1, (r - target) / target); mx -= gx * push; my -= gy * push; mz -= gz * push; }
        o[i * 3] = x[i * 3] - mx; o[i * 3 + 1] = x[i * 3 + 1] - my; o[i * 3 + 2] = x[i * 3 + 2] - mz;
      }
    }
  }
  /** Run until still (or a frame budget), as when letting freshly grown hair fall. */
  settle(frames = 90) { for (let f = 0; f < frames; f++) this.step(); }
}

/** Unit direction of each segment (index i = segment i−1 → i), the strand's rest shape. */
export function restDirections(points) {
  const rest = new Float32Array(POINTS * 3);
  for (let i = 1; i < POINTS; i++) {
    const dx = points[i * 3] - points[i * 3 - 3], dy = points[i * 3 + 1] - points[i * 3 - 2], dz = points[i * 3 + 2] - points[i * 3 - 1];
    const l = Math.hypot(dx, dy, dz) || 1;
    rest[i * 3] = dx / l; rest[i * 3 + 1] = dy / l; rest[i * 3 + 2] = dz / l;
  }
  return rest;
}

function place(p, i, from, length) {
  const dx = p[i * 3] - p[from * 3], dy = p[i * 3 + 1] - p[from * 3 + 1], dz = p[i * 3 + 2] - p[from * 3 + 2];
  const d = Math.hypot(dx, dy, dz) || 1e-9, s = length / d;
  p[i * 3] = p[from * 3] + dx * s; p[i * 3 + 1] = p[from * 3 + 1] + dy * s; p[i * 3 + 2] = p[from * 3 + 2] + dz * s;
}

/**
 * A new strand lies on the scalp the way hair grows: it leaves the root with a
 * slight lift, then runs along the head surface downwards (away from the crown
 * on top), and simply continues where it leaves the head; gravity does the rest.
 */
export function growStrand(root, normal, frame, length) {
  const points = new Float32Array(POINTS * 3), segment = length / (POINTS - 1);
  // Flow of a freshly grown head of hair: away from the face. Front and side
  // roots run back and outward over the ears, the back falls straight down.
  const flow = p => {
    const n = p.clone().sub(frame.C).normalize();
    // Hair at the forehead is combed up and back over the head; the sides and
    // back fall downward and slightly outward.
    // No hard parting: roots near the midline comb straight back, covering the
    // top; only roots further out turn to the sides.
    const front = smooth(0.15, 0.65, n.z), side = Math.max(-1, Math.min(1, n.x / 0.35));
    // Sideways flow only over the upper head; below its widest part hair hangs straight.
    const upper = smooth(-0.2, 0.35, n.y);
    const want = new Vector3(side * (0.3 - 0.1 * front) * upper, -1 + 2 * front, (-0.2 - 0.6 * front) * (0.3 + 0.7 * upper));
    // Only the part pointing into the head is removed: on the head the strand
    // follows its surface, past it the strand falls freely instead of being
    // forced around a sphere (which flips direction below the head's centre).
    const t = want.addScaledVector(n, -Math.min(0, want.dot(n)));
    if (t.lengthSq() < 1e-4) t.set(0, -1, 0);
    return { t: t.normalize(), n };
  };
  let p = root.clone(), dir = null;
  for (let i = 0; i < POINTS; i++) {
    points.set([p.x, p.y, p.z], i * 3);
    const { t, n } = flow(p);
    // Roots leave the scalp at an angle; further on, the strand lies on the head.
    const onHead = p.distanceTo(frame.C) < frame.R * 1.15;
    const lift = i === 0 ? 0.15 : onHead ? 0.06 : 0;
    const next = t.clone().addScaledVector(i === 0 ? normal : n, lift).normalize();
    dir = dir ? dir.lerp(next, 0.7).normalize() : next;
    p = p.clone().addScaledVector(dir, segment);
  }
  return { points, segment };
}

/** Resample a strand to POINTS points along its first `length` metres (cut or grow). */
export function resampleStrand(points, length) {
  const cumulative = [0];
  for (let i = 1; i < POINTS; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i * 3] - points[i * 3 - 3], points[i * 3 + 1] - points[i * 3 - 2], points[i * 3 + 2] - points[i * 3 - 1]));
  const total = cumulative.at(-1), out = new Float32Array(POINTS * 3);
  const tipDir = [0, 1, 2].map(k => points[(POINTS - 1) * 3 + k] - points[(POINTS - 2) * 3 + k]);
  const tl = Math.hypot(...tipDir) || 1;
  for (let i = 0; i < POINTS; i++) {
    const s = length * i / (POINTS - 1);
    if (s >= total) {
      // Growing: extend along the tip's direction.
      for (let k = 0; k < 3; k++) out[i * 3 + k] = points[(POINTS - 1) * 3 + k] + tipDir[k] / tl * (s - total);
      continue;
    }
    let j = 1;
    while (j < POINTS - 1 && cumulative[j] < s) j++;
    const t = (s - cumulative[j - 1]) / Math.max(1e-9, cumulative[j] - cumulative[j - 1]);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = points[(j - 1) * 3 + k] * (1 - t) + points[j * 3 + k] * t;
  }
  return { points: out, segment: length / (POINTS - 1) };
}

// ------------------------------------------------------------ hair cards

let strandTexture;
/**
 * Alpha strand atlas, four variations side by side, root at the top (v = 0)
 * and tips at the bottom (v = 1), as hair-card texture layouts are laid out.
 */
export function hairCardTexture() {
  if (strandTexture) return strandTexture;
  if (typeof document === 'undefined') return null;
  const width = 512, height = 1024, canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  const random = rng(4242);
  for (let column = 0; column < 4; column++) {
    const x0 = column * width / 4, w = width / 4;
    for (let s = 0; s < 90; s++) {
      const x = x0 + w * (0.06 + random() * 0.88), end = height * (0.72 + random() * 0.28);
      const sway = (random() - 0.5) * w * 0.12, shade = 175 + Math.floor(random() * 80);
      g.strokeStyle = `rgba(${shade},${shade},${shade},${0.55 + random() * 0.45})`;
      g.lineWidth = 1 + random() * 1.6;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= end; y += 16) g.lineTo(x + Math.sin(y / height * Math.PI * (1 + random() * 0.2)) * sway, y);
      g.stroke();
    }
    // Thin out towards the tip so card ends are soft.
    const fade = g.createLinearGradient(0, height * 0.65, 0, height);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = fade; g.fillRect(x0, height * 0.65, w, height * 0.35);
    // And fade in from the root: cards blend into the scalp instead of
    // starting with a hard edge along the hairline.
    // Kept short: hairline strands start at the hairline, and a long fade
    // leaves the front of the scalp bare.
    const root = g.createLinearGradient(0, 0, 0, height * 0.03);
    root.addColorStop(0, 'rgba(0,0,0,0.85)'); root.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = root; g.fillRect(x0, 0, w, height * 0.03);
    g.globalCompositeOperation = 'source-over';
  }
  strandTexture = new CanvasTexture(canvas);
  strandTexture.colorSpace = SRGBColorSpace; strandTexture.flipY = false; strandTexture.userData.shared = true;
  strandTexture.anisotropy = 4;
  return strandTexture;
}

const curlShapes = { wavy: { wave: 0.08, radius: 0.007, helix: 0 }, curly: { wave: 0.035, radius: 0.009, helix: 1 }, coily: { wave: 0.018, radius: 0.007, helix: 1 } };

/** Centre line of a strand with its curl applied (curls grow in from 2 cm below the root). */
function curledLine(points, settings, k) {
  const shape = curlShapes[hairTextureTypes[settings.t]];
  const out = Array.from({ length: POINTS }, (_, i) => new Vector3().fromArray(points, i * 3));
  if (!shape) return out;
  const tangents = out.map((p, i) => out[Math.min(POINTS - 1, i + 1)].clone().sub(out[Math.max(0, i - 1)]).normalize());
  let s = 0;
  const base = out.map(p => p.clone());
  for (let i = 1; i < POINTS; i++) {
    s += base[i].distanceTo(base[i - 1]);
    const grow = smooth(0.01 * k, 0.04 * k, s), strength = 0.4 + settings.cu * 1.2;
    const phase = TAU * s / (shape.wave * k) + settings.phase;
    const side = new Vector3(0, 1, 0).cross(tangents[i]); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
    const other = tangents[i].clone().cross(side).normalize();
    out[i].addScaledVector(side, Math.sin(phase) * shape.radius * k * strength * grow);
    if (shape.helix) out[i].addScaledVector(other, Math.cos(phase) * shape.radius * k * strength * grow);
  }
  return out;
}

/**
 * Card mesh from guides: two crossed alpha cards per guide (Epic's
 * multi-card clumps), tapering to the tip; braided locks become three
 * interlaced strand tubes; ties get a band. Returns geometry data with skin
 * weights from `weightsFor(point)`.
 */
export function buildCards(guides, frame, { width = 0.022, weightsFor, ties = [], k = 1 } = {}) {
  const pos = [], uv = [], joints = [], weights = [], index = [], owner = [];
  let current = -1;
  const vertex = (p, u, v) => {
    pos.push(p.x, p.y, p.z); uv.push(u, v);
    // Which guide and strand point each vertex comes from, for picking.
    owner.push(current, Math.round(v * (POINTS - 1)));
    const [j, w] = weightsFor(p); joints.push(...j); weights.push(...w);
    return pos.length / 3 - 1;
  };
  const ribbon = (line, offsets, column, widthScale) => {
    const u0 = column * 0.25 + 0.01, u1 = column * 0.25 + 0.24, rows = [];
    line.forEach((p, i) => {
      // Slightly narrower at the root (it grows out of the scalp), full width
      // two points later, then tapering to the tip.
      const half = widthScale * (0.75 + 0.25 * Math.min(1, i / 2)) * (1 - 0.65 * i / (line.length - 1)) / 2;
      const v = i / (line.length - 1);
      rows.push([vertex(p.clone().addScaledVector(offsets[i], -half), u0, v), vertex(p.clone().addScaledVector(offsets[i], half), u1, v)]);
    });
    for (let i = 0; i + 1 < rows.length; i++) index.push(rows[i][0], rows[i + 1][0], rows[i][1], rows[i][1], rows[i + 1][0], rows[i + 1][1]);
  };
  const tube = (line, radii, column, sides = 5) => {
    const rings = line.map((p, i) => {
      const t = line[Math.min(line.length - 1, i + 1)].clone().sub(line[Math.max(0, i - 1)]).normalize();
      const a = new Vector3(0, 0, 1).cross(t); if (a.lengthSq() < 1e-6) a.set(1, 0, 0); a.normalize();
      const b = t.clone().cross(a).normalize();
      return Array.from({ length: sides + 1 }, (_, s) => {
        const angle = s / sides * TAU;
        return vertex(p.clone().addScaledVector(a, Math.cos(angle) * radii[i]).addScaledVector(b, Math.sin(angle) * radii[i]), column * 0.25 + 0.02 + 0.21 * s / sides, i / (line.length - 1));
      });
    });
    for (let i = 0; i + 1 < rings.length; i++) for (let s = 0; s < sides; s++) index.push(rings[i][s], rings[i + 1][s], rings[i][s + 1], rings[i][s + 1], rings[i + 1][s], rings[i + 1][s + 1]);
  };
  const braids = new Map();
  guides.forEach((g, n) => {
    current = n;
    const settings = { t: g.t ?? 0, cu: g.cu ?? 0.5, phase: (n * 2.399) % TAU };
    const line = curledLine(g.points, settings, k);
    const end = g.br >= 0 ? Math.max(2, g.braidStart ?? 2) + 1 : POINTS;
    if (g.br >= 0) { if (!braids.has(g.br)) braids.set(g.br, []); braids.get(g.br).push(g); }
    const visible = line.slice(0, end);
    if (visible.length < 2) return;
    const offsets = visible.map((p, i) => {
      const t = visible[Math.min(visible.length - 1, i + 1)].clone().sub(visible[Math.max(0, i - 1)]).normalize();
      const out = p.clone().sub(frame.C).normalize();
      const side = t.clone().cross(out); if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      return side.normalize();
    });
    const outs = visible.map((p, i) => offsets[i].clone().cross(visible[Math.min(visible.length - 1, i + 1)].clone().sub(visible[Math.max(0, i - 1)]).normalize()).normalize());
    const w = width * (g.w ?? 1), column = n % 4;
    ribbon(visible, offsets, column, w);
    // Second card lifted and tilted 25° off the first, so the lock has depth.
    // Both grow in over the first points: at the root the cards lie together
    // on the scalp instead of standing up like shingles along the hairline.
    const grow = i => Math.min(1, i / 3);
    ribbon(visible.map((p, i) => p.clone().addScaledVector(outs[i], 0.0025 * k * grow(i))), offsets.map((o, i) => o.clone().multiplyScalar(1 - 0.094 * grow(i)).addScaledVector(outs[i], 0.423 * grow(i)).normalize()), (column + 2) % 4, w * 0.85);
    // Follow cards, as TressFX's follow hairs: copies of the guide offset to
    // either side at the root (separating slightly towards the tip). They fill
    // the scalp between guides at no simulation cost.
    for (const sign of [-1, 1]) {
      const spread = i => sign * w * 0.5 * (1 + 0.3 * i / (visible.length - 1));
      ribbon(visible.map((p, i) => p.clone().addScaledVector(offsets[i], spread(i)).addScaledVector(outs[i], 0.0012 * k * grow(i))), offsets, (column + (sign > 0 ? 1 : 3)) % 4, w * 0.9);
    }
  });
  // Braids: three strands circling the lock's centre line.
  for (const group of braids.values()) {
    current = guides.indexOf(group[0]);
    const start = Math.max(2, group[0].braidStart ?? 2);
    const centre = [];
    for (let i = start; i < POINTS; i++) {
      const c = new Vector3();
      for (const g of group) c.add(new Vector3().fromArray(g.points, i * 3));
      centre.push(c.divideScalar(group.length));
    }
    const fine = [];
    for (let i = 0; i + 1 < centre.length; i++) for (let s = 0; s < 4; s++) fine.push(centre[i].clone().lerp(centre[i + 1], s / 4));
    fine.push(centre.at(-1));
    const r = Math.min(0.03 * k, Math.max(0.008 * k, Math.sqrt(group.length) * 0.0045 * k));
    let s = 0;
    const strands = [[], [], []];
    fine.forEach((p, i) => {
      if (i) s += p.distanceTo(fine[i - 1]);
      const t = fine[Math.min(fine.length - 1, i + 1)].clone().sub(fine[Math.max(0, i - 1)]).normalize();
      const out = p.clone().sub(frame.C).normalize();
      const side = t.clone().cross(out).normalize(), depth = side.clone().cross(t).normalize();
      const taper = 1 - 0.55 * i / (fine.length - 1);
      for (let j = 0; j < 3; j++) {
        const phase = TAU * s / (r * 4.5) + TAU * j / 3;
        strands[j].push(p.clone().addScaledVector(side, Math.sin(phase) * r * 0.8 * taper).addScaledVector(depth, Math.sin(2 * phase) * r * 0.35 * taper));
      }
    });
    strands.forEach((line, j) => tube(line, line.map((_, i) => r * 0.62 * (1 - 0.5 * i / (line.length - 1))), j));
  }
  // Ties: a band where the locks are gathered.
  current = -1;
  for (const tie of ties) {
    const p = new Vector3(...tie.world);
    const axis = (tie.axis ? new Vector3(...tie.axis) : p.clone().sub(frame.C)).normalize();
    const a = new Vector3(0, 1, 0).cross(axis); if (a.lengthSq() < 1e-6) a.set(1, 0, 0); a.normalize();
    const b = axis.clone().cross(a).normalize(), radius = (tie.radius ?? 0.012) * k;
    const ring = Array.from({ length: 13 }, (_, s) => p.clone().addScaledVector(a, Math.cos(s / 12 * TAU) * radius).addScaledVector(b, Math.sin(s / 12 * TAU) * radius));
    tube(ring, ring.map(() => 0.003 * k), 3, 4);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.userData.owner = Int32Array.from(owner);
  return geometry;
}

export function hairCardMaterial(color) {
  const map = hairCardTexture();
  return new MeshStandardMaterial({ color, map, alphaTest: 0.35, side: DoubleSide, roughness: 0.55, metalness: 0 });
}

// --------------------------------------------------- building from data

/** Head-normalised ↔ world. */
export const toWorld = (frame, q) => new Vector3(frame.C.x + q[0] * frame.R, frame.C.y + q[1] * frame.R, frame.C.z + q[2] * frame.R);
export const toLocal = (frame, x, y, z) => [(x - frame.C.x) / frame.R, (y - frame.C.y) / frame.R, (z - frame.C.z) / frame.R];

/**
 * Live guides from groom data on this body: roots re-snapped to their scalp
 * faces (so the style follows body changes), new roots grown and settled when
 * the groom has none yet. Returns guides plus everything editing needs.
 */
export function prepareGroom(context, groomData, { settle = true } = {}) {
  const { data, positions } = context;
  const groom = normalizeGroom(groomData);
  const frame = headFrame(data, positions);
  const normals = vertexNormals(data, positions, frame);
  const field = scalpField(frame, positions, groom.hairline);
  const k = frame.R / 0.11;
  const collider = hairCollider(data, positions, normals, frame, context.skeleton, context.outfitSurface ?? null);
  const guides = [];
  let spacing = 0.016 * k;
  if (groom.guides?.length) {
    for (const g of groom.guides) {
      const root = rootPoint(data, positions, normals, frame, g.f, g.b);
      if (!root) continue;
      const points = new Float32Array(POINTS * 3);
      for (let i = 0; i < POINTS; i++) points.set(toWorld(frame, g.p.slice(i * 3, i * 3 + 3)).toArray(), i * 3);
      // Keep the styled shape relative to where the root now sits.
      const shift = root.p.clone().sub(new Vector3().fromArray(points, 0));
      for (let i = 0; i < POINTS; i++) { points[i * 3] += shift.x; points[i * 3 + 1] += shift.y; points[i * 3 + 2] += shift.z; }
      const segment = Math.hypot(points[3] - points[0], points[4] - points[1], points[5] - points[2]);
      // The styled shape, saved with the pose; older grooms have only the pose.
      let rest;
      if (g.r) {
        rest = new Float32Array(POINTS * 3);
        for (let i = 0; i < POINTS; i++) rest.set(toWorld(frame, g.r.slice(i * 3, i * 3 + 3)).add(shift).toArray(), i * 3);
      }
      guides.push({ f: g.f, b: g.b, root: root.p, normal: root.n, points, rest, segment, frozen: !!g.fz, clips: new Map(g.c.map(([i, x, y, z]) => [i, toWorld(frame, [x, y, z]).add(shift)])), t: g.t, cu: g.cu, w: g.w, br: g.br });
    }
    const area = scalpTriangles(data, positions, frame, field).reduce((sum, t) => sum + t.area, 0);
    if (area) spacing = Math.sqrt(area / groom.density) * 0.92;
  } else {
    const { roots, spacing: sp } = sampleRoots(data, positions, normals, frame, field, groom.density, groom.seed);
    spacing = sp || spacing;
    for (const r of roots) {
      const strand = growStrand(r.p, r.n, frame, groom.length * k * (0.9 + 0.2 * ((r.p.x * 9731 + r.p.y * 3571) % 1 + 1) % 1));
      guides.push({ f: r.f, b: r.b, root: r.p, normal: r.n, ...strand, frozen: false, clips: new Map(), t: 0, cu: 0.5, w: 1, br: -1 });
    }
  }
  const sim = new HairSim(guides, collider, { thickness: 0.004 * k });
  // The grown shape stays the rest (styled) shape, as TressFX keeps its
  // initial positions as the target of the shape constraints: those
  // constraints are what hold hair up against gravity. Adopting the settled
  // state as the new rest removes that support and hair sags a step further
  // each time (forehead locks slid over the eyes).
  if (settle && !groom.guides?.length) sim.settle(135);
  const ties = groom.ties.map(t => ({ world: toWorld(frame, t.p).toArray() }));
  return { groom, frame, normals, field, k, collider, guides, sim, spacing, ties };
}

/** Serialise live guides back to groom data. */
export function serializeGroom(state) {
  const { frame, groom, guides } = state;
  return normalizeGroom({
    ...groom,
    guides: guides.map(g => ({
      f: g.f, b: g.b, fz: g.frozen ? 1 : 0, t: g.t, cu: g.cu, w: g.w, br: g.br,
      p: Array.from({ length: POINTS }, (_, i) => toLocal(frame, g.points[i * 3], g.points[i * 3 + 1], g.points[i * 3 + 2])).flat(),
      r: g.rest ? Array.from({ length: POINTS }, (_, i) => toLocal(frame, g.rest[i * 3], g.rest[i * 3 + 1], g.rest[i * 3 + 2])).flat() : undefined,
      c: [...g.clips].map(([i, t]) => [i, ...toLocal(frame, t.x, t.y, t.z)]),
    })),
    ties: (state.ties ?? []).map(t => ({ p: toLocal(frame, ...t.world) })),
  });
}

/** Smooth per-base-vertex normals of the body surface. */
export function vertexNormals(data, positions, frame) {
  const normals = new Float32Array(positions.length);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  for (const face of frame.faces) {
    const ids = [0, 1, 2, 3].map(k => data.faces[face * 4 + k]);
    a.fromArray(positions, ids[0] * 3); b.fromArray(positions, ids[1] * 3); c.fromArray(positions, ids[2] * 3);
    n.crossVectors(b.sub(a), c.sub(a));
    for (const id of ids) { normals[id * 3] += n.x; normals[id * 3 + 1] += n.y; normals[id * 3 + 2] += n.z; }
  }
  for (let v = 0; v < normals.length / 3; v++) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= l; normals[v * 3 + 1] /= l; normals[v * 3 + 2] /= l;
  }
  return normals;
}

/** Skin weights for hair: the head near the scalp, blending to the upper spine below the neck. */
export function hairWeights(data, skeleton) {
  const index = name => data.skeleton.bones.findIndex(bone => bone.name === name);
  const head = index('head'), neck = index('neck_01'), spine = index('spine_03');
  const neckY = skeleton.heads[skeleton.byName.get('neck_01')].y;
  return p => {
    const t = smooth(neckY - 0.06, neckY + 0.02, p.y);
    if (t >= 1) return [[head, 0, 0, 0], [1, 0, 0, 0]];
    return [[head, neck, spine, 0], [t, (1 - t) * 0.4, (1 - t) * 0.6, 0]];
  };
}

/** The game mesh for a groom: cards skinned to the rig. */
export function groomMesh(context, state, color) {
  const weightsFor = hairWeights(context.data, context.skeleton);
  const guides = state.guides.map(g => ({ ...g, braidStart: g.br >= 0 ? braidStart(g) : 2 }));
  const geometry = buildCards(guides, state.frame, { width: state.spacing * 1.6, weightsFor, ties: state.ties, k: state.k });
  const mesh = new SkinnedMesh(geometry, hairCardMaterial(color));
  mesh.name = 'Hair';
  mesh.userData.style = 'groom';
  return mesh;
}

/** A braid starts at its first held point beyond the root (a tie), else just below the root. */
export function braidStart(g) {
  const held = [...g.clips.keys()].filter(i => i > 0).sort((a, b) => a - b);
  return held[0] ?? 2;
}
