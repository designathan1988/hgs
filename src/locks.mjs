import {
  BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, Float32BufferAttribute, MeshStandardMaterial, RepeatWrapping,
  SkinnedMesh, Triangle, Uint16BufferAttribute, Uint32BufferAttribute, Vector2, Vector3,
} from 'three';
import { defaultHairline, hairCollider, hairWeights, headFrame, scalpField, vertexNormals } from './scalp.mjs';

/**
 * Mesh hair locks ("mechas"): stylised hair built from solid, smooth locks,
 * each rooted on the scalp, the way chunky game hair (The Sims) is modelled.
 *
 * - A lock is a chain of LOCK_POINTS particles. Particle 0 is the root, held
 *   on a scalp triangle (base-mesh vertices + barycentric weights), so it
 *   follows any body change.
 * - Physics is Dynamic Follow-The-Leader (Müller, Kim & Chentanez 2012): one
 *   pass from the root places each particle at its rest distance, so a lock
 *   never stretches, and the velocity correction v_i -= s_damping·d_{i+1}/Δt
 *   removes the energy that pass would add. Shape preservation follows
 *   Sánchez-Banderas et al. 2015 (global and local shape constraints added to
 *   DFTL, fading from root to tip), so a fresh lock holds near the scalp and
 *   hangs below. Held points (root, pins, the point being pulled) split the
 *   chain; between two held points it is solved FABRIK-style.
 * - Collision uses the skin (and outfit) surface with the lock's own
 *   half-thickness (plus its curl radius), as DFTL does for curly hair; locks
 *   push each other apart by their thickness. Contacts are position-only
 *   (pre-stabilised) so resting hair gains no velocity, and the simulation
 *   sleeps when every particle is still (PhysX-style threshold + counter).
 * - "Set as rest" stores the settled shape as the styled shape. Styled locks
 *   keep a uniform global shape constraint whose target is offset against
 *   gravity, so the settled shape is an exact equilibrium and does not sag.
 * - The mesh is a closed elliptical tube swept along a centripetal
 *   Catmull-Rom of the chain with rotation-minimising frames (double
 *   reflection, Wang et al. 2008), turned so the flat side faces the surface
 *   it lies on. Width, volume (thickness/width), taper, twist and a helical
 *   curl (DFTL's rendering curl) shape it; the tip is rounded.
 */
export const LOCK_POINTS = 20;
const N = LOCK_POINTS;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const round = (v, digits = 1e5) => Math.round(v * digits) / digits;

export const lockDefaults = Object.freeze({ width: 0.05, volume: 0.18, taper: 0.85, curl: 0, turns: 4, twist: 0, stiffness: 0.35 });
export const lockLimits = Object.freeze({
  width: [0.006, 0.09], volume: [0.12, 1], taper: [0, 1], curl: [0, 1], turns: [0.5, 14], twist: [-TAU * 1.5, TAU * 1.5], stiffness: [0, 1],
  length: [0.015, 1.1],
});

// ------------------------------------------------------------- data model

/** Bounded, serialisable copy of a locks hairstyle (positions relative to each root, metres at head radius R). */
export function normalizeLocks(value) {
  const result = { format: 'hgs-locks', v: 1, R: 0.11, scalp: 1, locks: [] };
  if (!value || typeof value !== 'object') return result;
  const finite = (x, a, b, fallback) => Number.isFinite(x) ? clamp(x, a, b) : fallback;
  result.R = finite(value.R, 0.03, 0.4, 0.11);
  result.scalp = value.scalp === 0 || value.scalp === false ? 0 : 1;
  if (!Array.isArray(value.locks)) return result;
  for (const lock of value.locks.slice(0, 400)) {
    if (!lock || typeof lock !== 'object') continue;
    const r = lock.r;
    if (!r || !Array.isArray(r.v) || r.v.length !== 3 || !r.v.every(Number.isInteger) || !Array.isArray(r.w) || r.w.length !== 3 || !r.w.every(Number.isFinite)) continue;
    const vec = a => Array.isArray(a) && a.length === N * 3 && a.every(Number.isFinite);
    if (!vec(lock.p)) continue;
    const w = r.w.map(x => clamp(x, 0, 1)), sum = w[0] + w[1] + w[2] || 1;
    const out = {
      // Already-normalised weights are kept as they are, so saving a loaded file gives the same file.
      r: { v: r.v.map(v => Math.max(0, v)), w: w.map(x => round(Math.abs(sum - 1) < 1e-5 ? x : x / sum, 1e6)) },
      p: lock.p.map(x => round(clamp(x, -2, 2))),
      q: vec(lock.q) ? lock.q.map(x => round(clamp(x, -2, 2))) : null,
      sy: lock.sy ? 1 : 0,
      pins: Array.isArray(lock.pins) ? lock.pins.filter(p => Array.isArray(p) && p.length === 4 && p.every(Number.isFinite) && p[0] >= 2 && p[0] < N).map(([i, x, y, z]) => [Math.round(i), round(x), round(y), round(z)]) : [],
    };
    for (const [key, short] of [['width', 'w'], ['volume', 'vo'], ['taper', 'ta'], ['curl', 'cu'], ['turns', 'tu'], ['twist', 'tw'], ['stiffness', 'st']]) {
      out[short] = round(finite(lock[short], ...lockLimits[key], lockDefaults[key]), 1e4);
    }
    result.locks.push(out);
  }
  return result;
}

/** Everything a locks hairstyle needs on one body: head frame, scalp normals and field, collider, live locks. */
export function prepareLocks(context, value, { outfit = true } = {}) {
  const { data, positions } = context;
  const saved = normalizeLocks(value);
  const frame = headFrame(data, positions);
  const normals = vertexNormals(data, positions, frame);
  const field = scalpField(frame, positions, defaultHairline());
  const collider = hairCollider(data, positions, normals, frame, context.skeleton, outfit ? context.outfitSurface ?? null : null);
  const state = { frame, normals, field, collider, data, positions, locks: [], scalp: saved.scalp, sim: null };
  const scale = frame.R / saved.R;
  for (const item of saved.locks) {
    if (item.r.v.some(v => v * 3 + 2 >= positions.length)) continue;
    const lock = makeLock(state, item.r, null, {
      width: item.w * scale, volume: item.vo, taper: item.ta, curl: item.cu, turns: item.tu, twist: item.tw, stiffness: item.st,
    });
    const root = lock.rootP;
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
      lock.x[i * 3 + k] = root.getComponent(k) + item.p[i * 3 + k] * scale;
      lock.rest[i * 3 + k] = root.getComponent(k) + (item.q ?? item.p)[i * 3 + k] * scale;
    }
    lock.x.set(root.toArray(), 0); lock.rest.set(root.toArray(), 0);
    lock.seg = segmentOf(lock.x);
    // Rest and pose share the segment length (an older or edited file might not).
    fitLengths(lock.rest, lock.seg);
    lock.old.set(lock.x);
    lock.styled = Boolean(item.sy);
    for (const [i, x, y, z] of item.pins) lock.pins.set(i, new Vector3(x, y, z).multiplyScalar(scale).add(root));
    state.locks.push(lock);
  }
  state.sim = new LockSim(state);
  return state;
}

export function serializeLocks(state) {
  const R = state.frame.R;
  return normalizeLocks({
    format: 'hgs-locks', v: 1, R, scalp: state.scalp,
    locks: state.locks.map(lock => {
      const root = lock.rootP, rel = a => Array.from(a, (x, j) => x - root.getComponent(j % 3));
      return {
        r: { v: [...lock.root.v], w: [...lock.root.w] }, p: rel(lock.x), q: rel(lock.rest), sy: lock.styled ? 1 : 0,
        w: lock.width, vo: lock.volume, ta: lock.taper, cu: lock.curl, tu: lock.turns, tw: lock.twist, st: lock.stiffness,
        pins: [...lock.pins].map(([i, p]) => [i, p.x - root.x, p.y - root.y, p.z - root.z]),
      };
    }),
  });
}

/** World position and normal of a root (base vertices + barycentric weights). */
export function rootFrame(state, root) {
  const p = new Vector3(), n = new Vector3(), { positions, normals } = state;
  root.v.forEach((v, k) => {
    const w = root.w[k];
    p.x += positions[v * 3] * w; p.y += positions[v * 3 + 1] * w; p.z += positions[v * 3 + 2] * w;
    n.x += normals[v * 3] * w; n.y += normals[v * 3 + 1] * w; n.z += normals[v * 3 + 2] * w;
  });
  if (n.lengthSq() < 1e-8) n.copy(p).sub(state.frame.C);
  return { p, n: n.normalize() };
}

/** A root where the body ray hit (three base vertices): only on the scalp. */
export function rootFromHit(state, baseIds, point) {
  const { positions, field } = state;
  if (baseIds.some(v => !(field[v] >= -0.06))) return null;
  const tri = new Triangle(...baseIds.map(v => new Vector3().fromArray(positions, v * 3)));
  const bary = tri.getBarycoord(point, new Vector3());
  if (!bary) return null;
  const w = [bary.x, bary.y, bary.z].map(x => clamp(x, 0, 1)), sum = w[0] + w[1] + w[2] || 1;
  return { v: [...baseIds], w: w.map(x => x / sum) };
}

/** A new live lock; `points` (world, LOCK_POINTS) or a short sprout along the root normal. */
export function makeLock(state, root, points, params = {}) {
  const { p, n } = rootFrame(state, root);
  const lock = {
    root: { v: [...root.v], w: [...root.w] }, rootP: p, rootN: n,
    x: new Float32Array(N * 3), old: new Float32Array(N * 3), rest: new Float32Array(N * 3), prev: new Float32Array(N * 3),
    seg: 0.002, styled: false, pins: new Map(), grab: null, hold: null, facing: new Float32Array(N * 3),
    ...lockDefaults, ...params,
  };
  if (points) lock.x.set(points);
  else for (let i = 0; i < N; i++) lock.x.set(p.clone().addScaledVector(n, 0.02 * i / (N - 1)).toArray(), i * 3);
  lock.x.set(p.toArray(), 0);
  lock.seg = segmentOf(lock.x);
  lock.rest.set(lock.x); lock.old.set(lock.x);
  return lock;
}

const segmentOf = x => {
  let total = 0;
  for (let i = 1; i < N; i++) total += Math.hypot(x[i * 3] - x[i * 3 - 3], x[i * 3 + 1] - x[i * 3 - 2], x[i * 3 + 2] - x[i * 3 - 1]);
  return Math.max(1e-4, total / (N - 1));
};
export const lockLength = lock => lock.seg * (N - 1);

/** Re-space a chain to exact segment lengths, keeping each segment's direction (FTL from the root). */
function fitLengths(x, seg) { for (let i = 1; i < N; i++) place(x, i, i - 1, seg); }

function place(p, i, from, length) {
  const dx = p[i * 3] - p[from * 3], dy = p[i * 3 + 1] - p[from * 3 + 1], dz = p[i * 3 + 2] - p[from * 3 + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) { p[i * 3] = p[from * 3]; p[i * 3 + 1] = p[from * 3 + 1] - length; p[i * 3 + 2] = p[from * 3 + 2]; return; }
  const s = length / d;
  p[i * 3] = p[from * 3] + dx * s; p[i * 3 + 1] = p[from * 3 + 1] + dy * s; p[i * 3 + 2] = p[from * 3 + 2] + dz * s;
}

/**
 * Resample a polyline (any count) to LOCK_POINTS points along its first
 * `length` metres; past its end it continues straight along the tip.
 */
export function resamplePolyline(points, length) {
  const count = points.length / 3, cumulative = [0];
  for (let i = 1; i < count; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i * 3] - points[i * 3 - 3], points[i * 3 + 1] - points[i * 3 - 2], points[i * 3 + 2] - points[i * 3 - 1]));
  const total = cumulative.at(-1), out = new Float32Array(N * 3);
  const tip = [0, 1, 2].map(k => points[(count - 1) * 3 + k] - points[(count - 2) * 3 + k]), tl = Math.hypot(...tip) || 1;
  for (let i = 0; i < N; i++) {
    const s = length * i / (N - 1);
    if (s >= total) { for (let k = 0; k < 3; k++) out[i * 3 + k] = points[(count - 1) * 3 + k] + tip[k] / tl * (s - total); continue; }
    let j = 1;
    while (j < count - 1 && cumulative[j] < s) j++;
    const t = (s - cumulative[j - 1]) / Math.max(1e-9, cumulative[j] - cumulative[j - 1]);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = points[(j - 1) * 3 + k] * (1 - t) + points[j * 3 + k] * t;
  }
  return out;
}

/** Lengthen or shorten (cut) a lock to `length` metres: pose and rest are resampled, pins past the tip dropped. */
export function setLockLength(lock, length) {
  length = clamp(length, ...lockLimits.length);
  const old = lockLength(lock);
  const pins = [...lock.pins].map(([i, p]) => [i * old / (N - 1), p]);
  lock.x.set(resamplePolyline(lock.x, length));
  lock.rest.set(resamplePolyline(lock.rest, length));
  lock.seg = length / (N - 1);
  fitLengths(lock.x, lock.seg); fitLengths(lock.rest, lock.seg);
  lock.old.set(lock.x);
  lock.pins.clear();
  for (const [s, p] of pins) {
    const i = Math.round(s / lock.seg);
    if (i >= 2 && i < N) lock.pins.set(i, p);
  }
}

/** Arc length from the root to the chain position nearest `point`. */
export function arcLengthAt(lock, point) {
  let best = Infinity, at = 0, s = 0;
  const a = new Vector3(), b = new Vector3(), q = new Vector3();
  for (let i = 1; i < N; i++) {
    a.fromArray(lock.x, i * 3 - 3); b.fromArray(lock.x, i * 3);
    const ab = b.clone().sub(a), t = clamp(q.copy(point).sub(a).dot(ab) / Math.max(1e-12, ab.lengthSq()), 0, 1);
    const d = a.clone().addScaledVector(ab, t).distanceToSquared(point);
    if (d < best) { best = d; at = s + t * lock.seg; }
    s += lock.seg;
  }
  return at;
}

/**
 * Bend ("curvar") a lock from a snapshot: each segment turns about the lock's
 * width axis by an angle growing along its length; positive curls under,
 * towards the head, negative flips out.
 */
export function bendLock(lock, base, amount, frame) {
  for (const [target, source] of [[lock.x, base.x], [lock.rest, base.rest]]) {
    const out = Float32Array.from(source);
    const dir = new Vector3(), axis = new Vector3(), outward = new Vector3(), p = new Vector3();
    let total = 0;
    for (let i = 1; i < N; i++) {
      dir.set(source[i * 3] - source[i * 3 - 3], source[i * 3 + 1] - source[i * 3 - 2], source[i * 3 + 2] - source[i * 3 - 1]);
      p.fromArray(source, i * 3 - 3);
      outward.copy(p).sub(frame.C).normalize();
      axis.crossVectors(dir, outward);
      if (axis.lengthSq() < 1e-12) axis.set(1, 0, 0);
      axis.normalize();
      if (i >= 2) total += amount * 2.6 / (N - 2);
      dir.applyAxisAngle(axis, -total);
      out[i * 3] = out[i * 3 - 3] + dir.x; out[i * 3 + 1] = out[i * 3 - 2] + dir.y; out[i * 3 + 2] = out[i * 3 - 1] + dir.z;
    }
    target.set(out);
  }
  lock.old.set(lock.x);
}

// --------------------------------------------------------------- physics

/** Lock half-thickness at a chain point (the profile used by the mesh) plus the curl radius. */
// The coils of a curl are sparse: half their radius is kept clear of the body.
export const tuning = { curlCollision: 0.5 };
function collisionRadius(lock, i) {
  const u = i / (N - 1);
  const width = lock.curl > 0 ? lock.width + (curlWidth(lock) - lock.width) * curlIn(u) : lock.width;
  return 0.5 * width * sectionVolume(lock, u) * profile(lock, u * lockLength(lock), lockLength(lock)) + tuning.curlCollision * curlRadius(lock, u) + 0.0012;
}

export class LockSim {
  /**
   * DFTL with shape constraints, collision and lock-lock contact (see top of
   * file). gravity in m/s²; sDamping is DFTL's velocity correction scale.
   */
  constructor(state, { gravity = 9.81, drag = 0.04, sDamping = 0.9 } = {}) {
    this.state = state; this.gravity = gravity; this.drag = drag; this.sDamping = sDamping;
    this.sleeping = false; this.calm = 0; this.awake = 0; this.steps = 0;
    this.fixed = new Uint8Array(N); this.target = new Float32Array(N * 3);
    this.before = new Float32Array(N * 3); this.contact = new Uint8Array(N);
  }
  wake() { this.sleeping = false; this.calm = 0; this.awake = 0; for (const lock of this.state.locks) { lock.calm = 0; lock.awakeSteps = 0; } }
  /** Global (towards the styled shape) and local (segment direction) shape strengths at point i. */
  shape(lock, i) {
    const u = i / (N - 1), st = lock.stiffness;
    if (lock.styled) return { global: 0.1 + 0.25 * st, local: 0.35 + 0.5 * st };
    return { global: (0.15 + 0.7 * st) * (1 - smooth(0, 0.3 + 0.4 * st, u)), local: (0.08 + 0.55 * st) * (1 - 0.7 * u) };
  }
  holds(lock) {
    const fixed = this.fixed, target = this.target, root = lock.rootP;
    fixed.fill(0);
    fixed[0] = 1; target[0] = root.x; target[1] = root.y; target[2] = root.z;
    // The follicle sets the direction the lock leaves the scalp.
    fixed[1] = 1; target[3] = lock.rest[3]; target[4] = lock.rest[4]; target[5] = lock.rest[5];
    for (const [i, p] of lock.pins) { fixed[i] = 1; target[i * 3] = p.x; target[i * 3 + 1] = p.y; target[i * 3 + 2] = p.z; }
    if (lock.grab) { const { index, point } = lock.grab; fixed[index] = 1; target.set(reach(lock, index, point).toArray(), index * 3); }
    if (lock.hold) { fixed.fill(1); target.set(lock.hold); }
    let last = 0;
    for (let i = 0; i < N; i++) if (fixed[i]) last = i;
    return last;
  }
  step(dt = 1 / 60) {
    const locks = this.state.locks;
    if (this.sleeping || !locks.length) return false;
    this.steps++; this.awake++;
    // Settling: air drag rises after a few seconds without interaction, so
    // a hairstyle comes to rest in bounded time (real hair is heavily damped).
    const interacting = locks.some(l => l.grab || l.hold);
    if (interacting) this.awake = 0;
    const drag = this.drag + (interacting ? 0 : 0.25 * smooth(150, 420, this.awake));
    const decay = Math.exp(-drag * dt * 60), gdt2 = this.gravity * dt * dt;
    for (const lock of locks) { (lock.prev2 ??= Float32Array.from(lock.x)).set(lock.prev); lock.prev.set(lock.x); }
    // A. Integrate, shape constraints, held chains.
    for (const lock of locks) {
      const x = lock.x, old = lock.old, rest = lock.rest, fixed = this.fixed, target = this.target;
      const last = this.holds(lock);
      lock.last = last;
      for (let i = 1; i < N; i++) {
        if (fixed[i]) { old[i * 3] = x[i * 3]; old[i * 3 + 1] = x[i * 3 + 1]; old[i * 3 + 2] = x[i * 3 + 2]; x.set(target.subarray(i * 3, i * 3 + 3), i * 3); continue; }
        for (let k = 0; k < 3; k++) {
          const cur = x[i * 3 + k];
          x[i * 3 + k] = cur + decay * (cur - old[i * 3 + k]) - (k === 1 ? gdt2 : 0);
          old[i * 3 + k] = cur;
        }
      }
      // Global shape (towards rest). Styled locks aim above their rest by
      // exactly what one step of gravity moves them, so rest is an equilibrium.
      for (let i = 2; i < N; i++) {
        if (fixed[i]) continue;
        const s = this.shape(lock, i).global;
        if (s <= 1e-4) continue;
        const lift = lock.styled ? gdt2 * (1 - s) / s : 0;
        x[i * 3] += s * (rest[i * 3] - x[i * 3]);
        x[i * 3 + 1] += s * (rest[i * 3 + 1] + lift - x[i * 3 + 1]);
        x[i * 3 + 2] += s * (rest[i * 3 + 2] - x[i * 3 + 2]);
      }
      // Local shape (TressFX LocalShapeConstraints): rotate rest segment
      // i→i+1 by the rotation taking rest segment i-1→i onto the current one.
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i + 1 < N; i++) {
        const sl = 0.5 * Math.min(0.95, this.shape(lock, i + 1).local);
        if (sl <= 1e-4 || (fixed[i] && fixed[i + 1])) continue;
        let ax = rest[i * 3] - rest[i * 3 - 3], ay = rest[i * 3 + 1] - rest[i * 3 - 2], az = rest[i * 3 + 2] - rest[i * 3 - 1];
        let bx = x[i * 3] - x[i * 3 - 3], by = x[i * 3 + 1] - x[i * 3 - 2], bz = x[i * 3 + 2] - x[i * 3 - 1];
        const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1;
        ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
        const vx = rest[i * 3 + 3] - rest[i * 3], vy = rest[i * 3 + 4] - rest[i * 3 + 1], vz = rest[i * 3 + 5] - rest[i * 3 + 2];
        const c = ax * bx + ay * by + az * bz;
        let rx = vx, ry = vy, rz = vz;
        if (c > -0.999) {
          const wx = ay * bz - az * by, wy = az * bx - ax * bz, wz = ax * by - ay * bx, f = (wx * vx + wy * vy + wz * vz) / (1 + c);
          rx = vx * c + (wy * vz - wz * vy) + wx * f; ry = vy * c + (wz * vx - wx * vz) + wy * f; rz = vz * c + (wx * vy - wy * vx) + wz * f;
        }
        const dx = sl * (x[i * 3] + rx - x[i * 3 + 3]), dy = sl * (x[i * 3 + 1] + ry - x[i * 3 + 4]), dz = sl * (x[i * 3 + 2] + rz - x[i * 3 + 5]);
        if (!fixed[i]) { x[i * 3] -= dx; x[i * 3 + 1] -= dy; x[i * 3 + 2] -= dz; }
        if (!fixed[i + 1]) { x[i * 3 + 3] += dx; x[i * 3 + 4] += dy; x[i * 3 + 5] += dz; }
      }
      this.chains(lock);
    }
    // B. Locks push each other apart by their thickness (position-only).
    this.separate(locks);
    // C. DFTL from the last held point with collision, then velocity correction.
    let moved = 0, frozen = 0;
    for (const lock of locks) {
      this.holds(lock);
      this.tail(lock, true);
      let m = 0, m2 = 0;
      for (let i = 1; i < N; i++) {
        m = Math.max(m, Math.hypot(lock.x[i * 3] - lock.prev[i * 3], lock.x[i * 3 + 1] - lock.prev[i * 3 + 1], lock.x[i * 3 + 2] - lock.prev[i * 3 + 2]));
        m2 = Math.max(m2, Math.hypot(lock.x[i * 3] - lock.prev2[i * 3], lock.x[i * 3 + 1] - lock.prev2[i * 3 + 1], lock.x[i * 3 + 2] - lock.prev2[i * 3 + 2]));
      }
      // A point resting between two surfaces (skin under a shirt) can flip
      // between two valid contacts every step: no net motion over two steps
      // counts as still as well, and the lock is frozen in one of them.
      // The stillness threshold rises after ~4 s awake (PhysX-style wake
      // counter), so any small limit cycle (a tip rocking on a collar)
      // still comes to rest in bounded time.
      lock.awakeSteps = lock.grab || lock.hold ? 0 : (lock.awakeSteps ?? 0) + 1;
      const eps = 2.5e-4 * Math.min(8, 1 + Math.max(0, lock.awakeSteps - 240) / 90);
      const still = m < eps || (m2 < eps && m < 0.004);
      // Lock sleeping (Macklin et al. 2014, eq. 14, per lock so lengths stay
      // exact): a lock that has moved less than 15 mm/s for 12 steps in a row
      // is frozen where it is, which removes positional drift (creep).
      const held = lock.grab || lock.hold;
      // Once asleep a lock stays put until held, edited (wake) or pushed by another lock.
      const asleep = (lock.calm ?? 0) >= 12;
      // A real push from a moving neighbour (over 2 mm, a lock landing on it)
      // wakes a resting lock, which otherwise acts as a fixed support; an awake lock
      // counts as still by its own motion (two locks in contact pushing each
      // other a fraction of a millimetre would otherwise never rest).
      lock.calm = !held && (asleep ? !(lock.pushed > 2e-3) : still) ? (lock.calm ?? 0) + 1 : 0;
      lock.pushed = 0;
      if (lock.calm >= 12) { lock.x.set(lock.prev); lock.old.set(lock.prev); m = 0; frozen++; }
      moved = Math.max(moved, m);
    }
    this.lastMove = moved;
    if (!interacting && frozen === locks.length) this.calm++; else this.calm = 0;
    if (this.calm > 6) { this.sleeping = true; for (const lock of locks) lock.old.set(lock.x); }
    return true;
  }
  /** Chains between consecutive held points: FABRIK passes, then collision. */
  chains(lock) {
    const x = lock.x, fixed = this.fixed, l = lock.seg;
    let a = 0;
    for (let b = 1; b < N; b++) {
      if (!fixed[b]) continue;
      if (b - a > 1) {
        for (let pass = 0; pass < 6; pass++) {
          for (let i = b - 1; i > a; i--) place(x, i, i + 1, l);
          for (let i = a + 1; i < b; i++) place(x, i, i - 1, l);
        }
        for (let i = a + 1; i < b; i++) this.collide(lock, i);
        // Collision moved points after the passes: a last pass from the
        // leader restores every length exactly. The held end (not the root)
        // may end a few millimetres off its target instead of stretching.
        for (let i = a + 1; i < b; i++) place(x, i, i - 1, l);
        if (b > 1) place(x, b, b - 1, l);
      }
      a = b;
    }
  }
  /** Follow-the-leader from the last held point to the tip, with collision and friction (DFTL). */
  tail(lock, dynamic) {
    const x = lock.x, old = lock.old, l = lock.seg, before = this.before, contact = this.contact;
    const last = lock.hold ? N - 1 : this.lastHeld(lock);
    before.set(x); contact.fill(0);
    for (let i = last + 1; i < N; i++) {
      place(x, i, i - 1, l);
      // Shaped by hand (paused): the free end follows in a smooth arc.
      if (!dynamic) bendLimit(x, i, l);
      if (this.collide(lock, i)) {
        contact[i] = 1;
        place(x, i, i - 1, l);
        if (!dynamic) bendLimit(x, i, l);
        this.collide(lock, i);
        // Coulomb friction (Macklin et al. 2014): resting contact keeps its place.
        if (dynamic) {
          const n = this.state.collider.normal, d = this.state.collider.depth;
          const mx = x[i * 3] - old[i * 3], my = x[i * 3 + 1] - old[i * 3 + 1], mz = x[i * 3 + 2] - old[i * 3 + 2];
          const mn = mx * n[0] + my * n[1] + mz * n[2];
          const tx = mx - n[0] * mn, ty = my - n[1] * mn, tz = mz - n[2] * mn, tl = Math.hypot(tx, ty, tz);
          const f = tl < 0.9 * d ? 1 : Math.min(0.5 * d / (tl || 1), 1);
          x[i * 3] -= tx * f; x[i * 3 + 1] -= ty * f; x[i * 3 + 2] -= tz * f;
          place(x, i, i - 1, l);
        }
      }
    }
    if (!dynamic) { old.set(x); return; }
    for (let i = last + 1; i < N; i++) {
      if (contact[i]) { old[i * 3] = x[i * 3]; old[i * 3 + 1] = x[i * 3 + 1]; old[i * 3 + 2] = x[i * 3 + 2]; continue; }
      // d_{i+1} is the follow-the-leader correction. A neighbour in contact
      // was also pushed out of the body (by about one step of gravity every
      // step while resting); fed back as velocity, that push kept resting
      // hair creeping forever, so it is not used.
      if (i + 1 < N && !contact[i + 1]) for (let k = 0; k < 3; k++) old[i * 3 + k] += this.sDamping * (x[i * 3 + 3 + k] - before[i * 3 + 3 + k]);
      const mx = x[i * 3] - old[i * 3], my = x[i * 3 + 1] - old[i * 3 + 1], mz = x[i * 3 + 2] - old[i * 3 + 2], m = Math.hypot(mx, my, mz);
      if (m > 0.04) { const f = 0.04 / m; old[i * 3] = x[i * 3] - mx * f; old[i * 3 + 1] = x[i * 3 + 1] - my * f; old[i * 3 + 2] = x[i * 3 + 2] - mz * f; }
    }
  }
  lastHeld(lock) { let last = 1; for (let i = 0; i < N; i++) if (this.fixed[i]) last = i; return last; }
  collide(lock, i) {
    const collider = this.state.collider;
    if (!collider || i < 2) return false;
    return collider.resolve(lock.x, i * 3, Math.min(0.028, collisionRadius(lock, i)));
  }
  /**
   * Lock-lock contact over each lock's real footprint, not just its centre
   * line: a lock is a flat band (half-width a, half-thickness b). Where the
   * footprints of two locks overlap sideways (measured in the plane tangent to
   * the head), the upper lock must lie at least b_upper + b_lower further out
   * than the lower one. Hair from higher on the head lies over hair from lower
   * down, so only the upper lock moves, and only outwards: it never presses
   * the one below into the skin, the order cannot flip, and resting locks do
   * not slide sideways. Contacts are position-only and inelastic.
   */
  separate(locks) {
    if (locks.length < 2) return;
    const C = this.state.frame.C, items = [];
    let reach = 0.01;
    locks.forEach((lock, n) => {
      if (lock.hold) return;
      const L = lockLength(lock);
      for (let i = 2; i < N; i++) {
        const a = 0.5 * lock.width * profile(lock, i / (N - 1) * L, L), b = collisionRadius(lock, i) - 0.0012;
        items.push([n, i, a, b]);
        if (a > reach) reach = a;
      }
    });
    const cell = reach * 1.5, grid = new Map();
    const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (const item of items) {
      const x = locks[item[0]].x, o = item[1] * 3, k = key(x[o], x[o + 1], x[o + 2]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(item);
    }
    for (const [n, i, ai, bi] of items) {
      const A = locks[n], o = i * 3, cx = Math.floor(A.x[o] / cell), cy = Math.floor(A.x[o + 1] / cell), cz = Math.floor(A.x[o + 2] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const [m, j, aj, bj] of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          if (m <= n) continue;
          const B = locks[m], q = j * 3;
          // Two styled locks keep the arrangement they were set in.
          if (A.styled && B.styled && !this.separateStyled) continue;
          // The lock that is further from its own root where they meet lies on
          // top (it is passing over the other's root region, where that one
          // still hugs the scalp); at equal distances, hair from higher on the
          // head lies over hair from lower down.
          const si = i * A.seg, sj = j * B.seg;
          const upperIsA = si > sj + 0.006 ? true : sj > si + 0.006 ? false : layer(this.state, A) >= layer(this.state, B);
          const up = upperIsA ? A : B, low = upperIsA ? B : A, uo = upperIsA ? o : q, lo = upperIsA ? q : o, index = upperIsA ? i : j;
          if (up.pins.has(index) || up.grab?.index === index) continue;
          let nx = low.x[lo] - C.x, ny = low.x[lo + 1] - C.y, nz = low.x[lo + 2] - C.z;
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const ex = up.x[uo] - low.x[lo], ey = up.x[uo + 1] - low.x[lo + 1], ez = up.x[uo + 2] - low.x[lo + 2];
          const radial = ex * nx + ey * ny + ez * nz;
          const tangential = Math.hypot(ex - nx * radial, ey - ny * radial, ez - nz * radial), span = ai + aj;
          if (tangential >= 0.75 * span) continue;
          const need = bi + bj + 0.001;
          if (radial >= need || radial < -2 * need) continue;
          // Full push where the bands lie on each other, fading out at their edges.
          const push = Math.min(0.004, (need - radial) * 0.5) * (1 - smooth(0.45, 0.75, tangential / span));
          if (push <= 1e-7) continue;
          // A resting lock is woken only by a lock that is itself moving.
          if (((upperIsA ? B : A).calm ?? 0) < 12) up.pushed = Math.max(up.pushed ?? 0, push);
          const vn = (up.x[uo] - up.old[uo]) * nx + (up.x[uo + 1] - up.old[uo + 1]) * ny + (up.x[uo + 2] - up.old[uo + 2]) * nz;
          if (vn < 0) { up.old[uo] += nx * vn; up.old[uo + 1] += ny * vn; up.old[uo + 2] += nz * vn; }
          up.x[uo] += nx * push; up.x[uo + 1] += ny * push; up.x[uo + 2] += nz * push;
          up.old[uo] += nx * push; up.old[uo + 1] += ny * push; up.old[uo + 2] += nz * push;
        }
      }
    }
  }
  /**
   * Shape a lock without dynamics (simulation paused, or a held drag): held
   * points are placed, chains solved, the free tail follows the leader and is
   * kept out of the body. Nothing gains velocity.
   */
  pose(lock) {
    const x = lock.x, fixed = this.fixed, target = this.target;
    this.holds(lock);
    for (let i = 1; i < N; i++) if (fixed[i]) x.set(target.subarray(i * 3, i * 3 + 3), i * 3);
    this.chains(lock);
    this.tail(lock, false);
    lock.old.set(x);
  }
  /** Simulate until asleep (or a step budget): "settle now". */
  settle(maxSteps = 900) {
    this.wake();
    let n = 0;
    while (!this.sleeping && n < maxSteps) { this.step(); n++; }
    return n;
  }
}

/**
 * Follow-the-leader with a bend cone (FTL leaves the direction free, Müller
 * et al. 2012): segment i turns at most 30° from segment i-1. Used when a
 * lock is shaped by hand, so the end trails the hand in a smooth arc
 * instead of folding back on itself.
 */
const COS_BEND = Math.cos(Math.PI / 6), SIN_BEND = Math.sin(Math.PI / 6);
function bendLimit(x, i, length) {
  if (i < 2) return;
  let ax = x[i * 3 - 3] - x[i * 3 - 6], ay = x[i * 3 - 2] - x[i * 3 - 5], az = x[i * 3 - 1] - x[i * 3 - 4];
  let bx = x[i * 3] - x[i * 3 - 3], by = x[i * 3 + 1] - x[i * 3 - 2], bz = x[i * 3 + 2] - x[i * 3 - 1];
  const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
  if (la < 1e-9 || lb < 1e-9) return;
  ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
  const c = ax * bx + ay * by + az * bz;
  if (c >= COS_BEND) return;
  let px = bx - ax * c, py = by - ay * c, pz = bz - az * c;
  const lp = Math.hypot(px, py, pz);
  if (lp < 1e-9) { px = ay; py = -ax; pz = 0; const m = Math.hypot(px, py) || 1; px /= m; py /= m; } else { px /= lp; py /= lp; pz /= lp; }
  x[i * 3] = x[i * 3 - 3] + (ax * COS_BEND + px * SIN_BEND) * length;
  x[i * 3 + 1] = x[i * 3 - 2] + (ay * COS_BEND + py * SIN_BEND) * length;
  x[i * 3 + 2] = x[i * 3 - 1] + (az * COS_BEND + pz * SIN_BEND) * length;
}

/** Layer of a lock: elevation of its root seen from the head centre (crown on top). */
function layer(state, lock) {
  const d = lock.rootP.clone().sub(state.frame.C);
  return d.y / (d.length() || 1) + lock.rootP.x * 1e-6;
}

/** Clamp a pull target for point i to what the chain can reach from the root. */
function reach(lock, i, point) {
  const root = lock.rootP, max = lock.seg * i * 0.999, d = point.distanceTo(root);
  return d > max ? root.clone().addScaledVector(point.clone().sub(root), max / d) : point.clone();
}

// ------------------------------------------------------------------ mesh

/** Curls grow in below the root (from 12% to 30% of the length), where the lock can leave the scalp. */
const curlIn = u => smooth(0.12, 0.3, u);
/** Curled locks gather into narrower, rounder ringlets. */
function curlWidth(lock) { return lock.width * (1 - 0.5 * lock.curl); }
/**
 * Thickness / width along the lock: flatter near the root, where locks lie
 * stacked on the scalp (so their overlaps leave no steps), fuller below; curls
 * round it further.
 */
function sectionVolume(lock, u) {
  const flat = lock.volume * (0.45 + 0.55 * smooth(0.04, 0.42, u));
  return flat + (1 - flat) * 0.7 * lock.curl * curlIn(u);
}

/** Radius profile along a lock (0 at the tip): slight root narrowing, taper to a soft point, rounded tip. */
const TAPER = 0.93;
function tipCap(lock, length) { return Math.max(0.5 * lock.width * (1 - lock.taper * TAPER) * 1.2, 0.002, 0.02 * length); }
function profile(lock, s, length) {
  const u = clamp(s / length, 0, 1);
  const taper = 1 - lock.taper * TAPER * Math.pow(u, 1.25);
  const cap = tipCap(lock, length), d = length - s;
  const tip = d >= cap ? 1 : Math.sqrt(Math.max(0, 1 - (1 - d / cap) ** 2));
  // A lock emerges thin from the scalp and reaches full width a few centimetres on.
  const root = 0.5 + 0.5 * smooth(-0.002, Math.min(0.04, length * 0.3), s);
  return taper * tip * root;
}
/**
 * Helix radius of a curl at u. It stays larger than the lock's half-width
 * there, or the swept tube would fold through its own axis.
 */
function curlRadius(lock, u) {
  const half = 0.5 * curlWidth(lock) * (1 - lock.taper * TAPER * Math.pow(u, 1.25));
  return lock.curl * (half * 1.25 + 0.004) * curlIn(u);
}

/**
 * Surface direction each chain point lies against: the nearest skin/clothing
 * normal, else away from the head centre. Cached; a point is re-queried only
 * once it has moved 3 mm.
 */
function facings(lock, state) {
  const out = lock.facing, at = lock.facingAt ??= new Float32Array(N * 3).fill(Infinity), hit = {}, layers = state.collider?.head, C = state.frame.C;
  for (let i = 0; i < N; i++) {
    const o = i * 3, x = lock.x[o], y = lock.x[o + 1], z = lock.x[o + 2];
    if ((x - at[o]) ** 2 + (y - at[o + 1]) ** 2 + (z - at[o + 2]) ** 2 < 9e-6) continue;
    at[o] = x; at[o + 1] = y; at[o + 2] = z;
    if (i === 0) { out[0] = lock.rootN.x; out[1] = lock.rootN.y; out[2] = lock.rootN.z; continue; }
    let fx = x - C.x, fy = y - C.y, fz = z - C.z;
    const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    if (layers?.closest(x, y, z, 0.06, hit)) {
      const w = 1 - smooth(0.01, 0.06, Math.abs(hit.distance));
      fx += (hit.nx - fx) * w; fy += (hit.ny - fy) * w; fz += (hit.nz - fz) * w;
    }
    const m = Math.hypot(fx, fy, fz) || 1;
    out[o] = fx / m; out[o + 1] = fy / m; out[o + 2] = fz / m;
  }
  return out;
}

const SIDES = 12;
/**
 * Closed smooth tube for one lock: typed arrays (position, normal, uv,
 * colour, index). `vertex(x, y, z)` is called per vertex for extras (skin
 * weights). uv: u around the lock, v root → tip.
 */
export function lockSurface(lock, state, { sides = SIDES, detail = 1, vertex = null } = {}) {
  const length = lockLength(lock), w = lock.width;
  const sink = Math.max(0.002, 0.5 * w * lock.volume * 0.9);
  const ctrl = [lock.rootP.clone().addScaledVector(lock.rootN, -sink)];
  for (let i = 0; i < N; i++) ctrl.push(new Vector3().fromArray(lock.x, i * 3));
  // Centripetal Catmull-Rom, tabulated densely; arc length is read from the table.
  const curve = new CatmullRomCurve3(ctrl, false, 'centripetal');
  const T = (N + 1) * 7, table = new Float32Array((T + 1) * 3), cum = new Float32Array(T + 1), q = new Vector3();
  for (let k = 0; k <= T; k++) {
    curve.getPoint(k / T, q); table[k * 3] = q.x; table[k * 3 + 1] = q.y; table[k * 3 + 2] = q.z;
    if (k) cum[k] = cum[k - 1] + Math.hypot(q.x - table[k * 3 - 3], q.y - table[k * 3 - 2], q.z - table[k * 3 - 1]);
  }
  const total = cum[T], sinkLen = Math.max(1e-5, total - length);
  let cursor = 1;
  const pointAt = (arc, out, o) => {
    arc = clamp(arc, 0, total);
    if (arc < cum[cursor - 1]) cursor = 1;
    while (cursor < T && cum[cursor] < arc) cursor++;
    const t = (arc - cum[cursor - 1]) / Math.max(1e-12, cum[cursor] - cum[cursor - 1]);
    for (let k = 0; k < 3; k++) out[o + k] = table[(cursor - 1) * 3 + k] * (1 - t) + table[cursor * 3 + k] * t;
  };
  // Arc-length samples: a step along the lock (finer for curls), finer over the rounded tip.
  const turns = lock.curl > 0 ? lock.turns : 0;
  const h = Math.min(clamp(length / 40, 0.0035, 0.012), turns ? length / (turns * 24) : Infinity) / detail;
  const cap = tipCap(lock, length), ss = [-sinkLen];
  for (let s = 0; s < length - cap - h * 0.5; s += h) ss.push(s);
  for (let k = 0; k <= 8; k++) ss.push(length - cap + cap * Math.sin(k / 8 * Math.PI / 2));
  const M = ss.length;
  const facing = facings(lock, state);
  const line = new Float32Array(M * 3), tan = new Float32Array(M * 3), rr = new Float32Array(M * 3), want = new Float32Array(M * 3);
  for (let j = 0; j < M; j++) {
    pointAt(ss[j] + sinkLen, line, j * 3);
    const f = clamp(ss[j] / length, 0, 1) * (N - 1), i = Math.min(N - 2, Math.floor(f)), t = f - i;
    for (let k = 0; k < 3; k++) want[j * 3 + k] = facing[i * 3 + k] * (1 - t) + facing[i * 3 + 3 + k] * t;
  }
  const tangents = () => {
    for (let j = 0; j < M; j++) {
      const a = Math.max(0, j - 1) * 3, b = Math.min(M - 1, j + 1) * 3;
      let x = line[b] - line[a], y = line[b + 1] - line[a + 1], z = line[b + 2] - line[a + 2];
      const l = Math.hypot(x, y, z);
      if (l < 1e-9) { x = 0; y = -1; z = 0; } else { x /= l; y /= l; z /= l; }
      tan[j * 3] = x; tan[j * 3 + 1] = y; tan[j * 3 + 2] = z;
    }
  };
  // Rotation-minimising frames by double reflection (Wang et al. 2008, Table I), nudged to face the surface.
  const frames = (nudge) => {
    const orth = (o, vx, vy, vz) => {
      const d = vx * tan[o] + vy * tan[o + 1] + vz * tan[o + 2];
      vx -= d * tan[o]; vy -= d * tan[o + 1]; vz -= d * tan[o + 2];
      const l = Math.hypot(vx, vy, vz);
      return l > 1e-6 ? [vx / l, vy / l, vz / l] : null;
    };
    const first = orth(0, want[0], want[1], want[2]) ?? orth(0, 1, 0, 0) ?? [0, 0, 1];
    rr.set(first, 0);
    for (let j = 1; j < M; j++) {
      const o = j * 3, p = o - 3;
      const v1x = line[o] - line[p], v1y = line[o + 1] - line[p + 1], v1z = line[o + 2] - line[p + 2], c1 = v1x * v1x + v1y * v1y + v1z * v1z;
      let rx = rr[p], ry = rr[p + 1], rz = rr[p + 2], tx = tan[p], ty = tan[p + 1], tz = tan[p + 2];
      if (c1 > 1e-14) {
        const dr = 2 / c1 * (v1x * rx + v1y * ry + v1z * rz), dt = 2 / c1 * (v1x * tx + v1y * ty + v1z * tz);
        rx -= dr * v1x; ry -= dr * v1y; rz -= dr * v1z; tx -= dt * v1x; ty -= dt * v1y; tz -= dt * v1z;
      }
      const v2x = tan[o] - tx, v2y = tan[o + 1] - ty, v2z = tan[o + 2] - tz, c2 = v2x * v2x + v2y * v2y + v2z * v2z;
      if (c2 > 1e-14) { const d = 2 / c2 * (v2x * rx + v2y * ry + v2z * rz); rx -= d * v2x; ry -= d * v2y; rz -= d * v2z; }
      const face = orth(o, want[o], want[o + 1], want[o + 2]);
      const k = nudge(j);
      if (face && k > 0) { rx += (face[0] - rx) * k; ry += (face[1] - ry) * k; rz += (face[2] - rz) * k; }
      rr.set(orth(o, rx, ry, rz) ?? [rr[p], rr[p + 1], rr[p + 2]], o);
    }
  };
  // Along the coils the frame follows the axis (pure RMF): turning it
  // towards the surface there makes the helix, and the tube, kink.
  const nudge = j => 0.35 * (1 - (turns ? smooth(0, 0.004, curlRadius(lock, clamp(ss[j] / length, 0, 1))) : 0));
  tangents(); frames(nudge);
  if (turns) {
    // Curl (DFTL's rendering curl): a helix around the centre line in its frame.
    const phase = (lock.root.v[0] * 0.618) % 1 * TAU;
    for (let j = 0; j < M; j++) {
      const o = j * 3, u = clamp(ss[j] / length, 0, 1), a = curlRadius(lock, u), phi = TAU * turns * u + phase;
      const sx = tan[o + 1] * rr[o + 2] - tan[o + 2] * rr[o + 1], sy = tan[o + 2] * rr[o] - tan[o] * rr[o + 2], sz = tan[o] * rr[o + 1] - tan[o + 1] * rr[o];
      const c = Math.cos(phi) * a, sn = Math.sin(phi) * a;
      line[o] += rr[o] * c + sx * sn; line[o + 1] += rr[o + 1] * c + sy * sn; line[o + 2] += rr[o + 2] * c + sz * sn;
    }
    tangents(); frames(nudge);
  }
  const ring = sides + 1, count = M * ring + 1;
  const pos = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2), color = new Float32Array(count * 3);
  // Curls narrow the lock from where they start (ringlets are slimmer than a flat lock).
  const radii = ss.map(s => 0.5 * (turns ? w + (curlWidth(lock) - w) * curlIn(Math.max(0, s) / length) : w) * profile(lock, Math.max(0, s), length));
  const cosT = new Float32Array(ring), sinT = new Float32Array(ring);
  for (let k = 0; k <= sides; k++) { cosT[k] = Math.cos(k / sides * TAU); sinT[k] = Math.sin(k / sides * TAU); }
  // Cross-section axes per sample: R (thickness, facing the surface) and S
  // (width), turned by the twist.
  const RA = new Float32Array(M * 3), SA = new Float32Array(M * 3);
  for (let j = 0; j < M; j++) {
    const o = j * 3, u = clamp(ss[j] / length, 0, 1);
    const tx = tan[o], ty = tan[o + 1], tz = tan[o + 2], rx = rr[o], ry = rr[o + 1], rz = rr[o + 2];
    const sx = ty * rz - tz * ry, sy = tz * rx - tx * rz, sz = tx * ry - ty * rx;
    const angle = lock.twist * u, ca = Math.cos(angle), sa = Math.sin(angle);
    RA[o] = rx * ca + sx * sa; RA[o + 1] = ry * ca + sy * sa; RA[o + 2] = rz * ca + sz * sa;
    SA[o] = sx * ca - rx * sa; SA[o + 1] = sy * ca - ry * sa; SA[o + 2] = sz * ca - rz * sa;
  }
  // A swept section folds through itself where the axis curves tighter than
  // the section reaches towards the centre of curvature. For curvature k
  // (dt/ds) split along the width axis S and thickness axis R, the furthest
  // reach is sqrt((k·S a)² + (k·R b)²); where it passes 0.7 the section is
  // scaled down just enough (then smoothed along the lock). A flat lock
  // bending over its broad side (draped over a shoulder) is barely touched.
  const scale = new Float32Array(M).fill(1);
  for (let j = 0; j < M; j++) {
    const a = Math.max(0, j - 1), b = Math.min(M - 1, j + 1), o = j * 3;
    const ds = Math.hypot(line[b * 3] - line[a * 3], line[b * 3 + 1] - line[a * 3 + 1], line[b * 3 + 2] - line[a * 3 + 2]);
    if (ds < 1e-9) continue;
    const kx = (tan[b * 3] - tan[a * 3]) / ds, ky = (tan[b * 3 + 1] - tan[a * 3 + 1]) / ds, kz = (tan[b * 3 + 2] - tan[a * 3 + 2]) / ds;
    const vol = sectionVolume(lock, clamp(ss[j] / length, 0, 1));
    const ks = (kx * SA[o] + ky * SA[o + 1] + kz * SA[o + 2]) * radii[j], kr = (kx * RA[o] + ky * RA[o + 1] + kz * RA[o + 2]) * radii[j] * vol;
    const reach = Math.hypot(ks, kr);
    if (reach > 0.7) scale[j] = 0.7 / reach;
  }
  for (let pass = 0; pass < 3; pass++) for (let j = 1; j + 1 < M; j++) scale[j] = Math.min(scale[j], (scale[j - 1] + scale[j] + scale[j + 1]) / 3);
  const fit = radii.map((r, j) => r * scale[j]);
  let v = 0;
  for (let j = 0; j < M; j++) {
    const o = j * 3, u = clamp(ss[j] / length, 0, 1);
    const tx = tan[o], ty = tan[o + 1], tz = tan[o + 2];
    const rx = RA[o], ry = RA[o + 1], rz = RA[o + 2], sx = SA[o], sy = SA[o + 1], sz = SA[o + 2];
    const a = fit[j], b = fit[j] * sectionVolume(lock, u);
    // Slope of the radius along the lock tilts the normals (taper, rounded tip).
    const jp = Math.min(M - 1, j + 1), jm = Math.max(0, j - 1);
    const slope = (fit[jp] - fit[jm]) / Math.max(1e-6, ss[jp] - ss[jm]);
    const shade = 0.78 + 0.22 * smooth(0, 0.35, u);
    for (let k = 0; k <= sides; k++, v++) {
      const c = cosT[k], sn = sinT[k];
      const px = line[o] + sx * a * c + rx * b * sn, py = line[o + 1] + sy * a * c + ry * b * sn, pz = line[o + 2] + sz * a * c + rz * b * sn;
      let nx = sx * b * c + rx * a * sn, ny = sy * b * c + ry * a * sn, nz = sz * b * c + rz * a * sn;
      const nl = Math.hypot(nx, ny, nz);
      if (a < 1e-6 || nl < 1e-12) { nx = tx; ny = ty; nz = tz; } else {
        nx = nx / nl - tx * slope; ny = ny / nl - ty * slope; nz = nz / nl - tz * slope;
        const m = Math.hypot(nx, ny, nz); nx /= m; ny /= m; nz /= m;
      }
      pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
      normal[v * 3] = nx; normal[v * 3 + 1] = ny; normal[v * 3 + 2] = nz;
      uv[v * 2] = k / sides; uv[v * 2 + 1] = u;
      color[v * 3] = color[v * 3 + 1] = color[v * 3 + 2] = shade;
      vertex?.(px, py, pz);
    }
  }
  // Close the sunken root end.
  pos.set(line.subarray(0, 3), v * 3); normal.set([-tan[0], -tan[1], -tan[2]], v * 3); uv.set([0.5, 0], v * 2); color.set([0.78, 0.78, 0.78], v * 3);
  vertex?.(line[0], line[1], line[2]);
  const index = new Uint32Array((M - 1) * sides * 6 + sides * 3);
  let n = 0;
  for (let j = 0; j + 1 < M; j++) for (let k = 0; k < sides; k++) {
    const a = j * ring + k, b = a + 1, c = a + ring, d = c + 1;
    index[n++] = a; index[n++] = c; index[n++] = b; index[n++] = b; index[n++] = c; index[n++] = d;
  }
  for (let k = 0; k < sides; k++) { index[n++] = v; index[n++] = k; index[n++] = k + 1; }
  return { pos, normal, uv, color, index };
}

/** BufferGeometry from lockSurface data (several are merged). */
export function geometryFrom(parts, extra = null) {
  const vertices = parts.reduce((n, p) => n + p.pos.length / 3, 0), indices = parts.reduce((n, p) => n + p.index.length, 0);
  const pos = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), uv = new Float32Array(vertices * 2), color = new Float32Array(vertices * 3);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0, i = 0;
  for (const part of parts) {
    pos.set(part.pos, v * 3); normal.set(part.normal, v * 3); uv.set(part.uv, v * 2); color.set(part.color, v * 3);
    for (let k = 0; k < part.index.length; k++) index[i++] = part.index[k] + v;
    v += part.pos.length / 3;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
  if (extra) for (const [name, attribute] of Object.entries(extra)) geometry.setAttribute(name, attribute);
  geometry.setIndex(vertices > 65535 ? new Uint32BufferAttribute(index, 1) : new Uint16BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Refresh a geometry in place from lockSurface data when the vertex count is unchanged (no GPU reallocation). */
export function updateGeometry(geometry, part) {
  const position = geometry.getAttribute('position');
  if (!position || position.count * 3 !== part.pos.length || geometry.index?.count !== part.index.length) return false;
  for (const [name, data] of [['position', part.pos], ['normal', part.normal], ['uv', part.uv], ['color', part.color]]) {
    const attribute = geometry.getAttribute(name);
    attribute.array.set(data); attribute.needsUpdate = true;
  }
  geometry.index.array.set(part.index); geometry.index.needsUpdate = true;
  geometry.computeBoundingSphere();
  return true;
}

let grooves;
/**
 * Soft strand grooves for the lock surface (a tangent-space normal map that
 * varies around the lock): painted-hair finish without any transparency.
 */
export function lockNormalMap() {
  if (grooves) return grooves;
  if (typeof document === 'undefined') return null;
  const width = 256, height = 64, canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d'), image = g.createImageData(width, height);
  for (let x = 0; x < width; x++) {
    const u = x / width;
    const slope = 0.55 * Math.cos(u * TAU * 9) * 0.6 + 0.25 * Math.cos(u * TAU * 23 + 1.3) + 0.12 * Math.cos(u * TAU * 41 + 0.4);
    for (let y = 0; y < height; y++) {
      const ny = 0.04 * Math.sin((y / height) * TAU * 3 + u * 40);
      const nx = slope * 0.55, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)), o = (y * width + x) * 4;
      image.data[o] = Math.round((nx * 0.5 + 0.5) * 255); image.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      image.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255); image.data[o + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  grooves = new CanvasTexture(canvas);
  grooves.wrapS = grooves.wrapT = RepeatWrapping; grooves.repeat.set(2, 1);
  grooves.userData.shared = true;
  return grooves;
}

export function lockMaterial(color, { highlight = false } = {}) {
  const map = lockNormalMap();
  const material = new MeshStandardMaterial({ color, vertexColors: true, roughness: 0.46, metalness: 0, normalMap: map, normalScale: new Vector2(0.45, 0.45) });
  if (highlight) { material.emissive = new Color(0xf27a2e); material.emissiveIntensity = 0.22; }
  return material;
}

/** The game mesh for a locks hairstyle: every lock merged and skinned to the head. */
export function locksMesh(context, state, color) {
  const weightsFor = hairWeights(context.data, context.skeleton);
  const joints = [], weights = [], point = new Vector3();
  const parts = state.locks.map(lock => lockSurface(lock, state, {
    detail: context.lod === 'low' ? 0.45 : context.lod === 'medium' ? 0.65 : 0.85, sides: context.lod === 'low' ? 8 : context.lod === 'medium' ? 10 : SIDES,
    vertex: (x, y, z) => { const [j, w] = weightsFor(point.set(x, y, z)); joints.push(...j); weights.push(...w); },
  }));
  const geometry = geometryFrom(parts, { skinIndex: new Uint16BufferAttribute(joints, 4), skinWeight: new Float32BufferAttribute(weights, 4) });
  const mesh = new SkinnedMesh(geometry, lockMaterial(color));
  mesh.name = 'Hair';
  mesh.userData.style = 'locks';
  return mesh;
}

/**
 * Scalp tint under the roots, so gaps between locks read as hair, not skin:
 * near the roots and only inside the hairline (it fades in above it and
 * never reaches the forehead, brows or face).
 */
export function locksScalpColors(state) {
  const { positions, frame, field } = state, roots = state.locks.map(l => l.rootP);
  const alpha = new Float32Array(positions.length / 3);
  if (!roots.length || !state.scalp) return alpha;
  for (let v = 0; v < alpha.length; v++) {
    if (!frame.used[v] || frame.headWeight[v] < 0.3 || !(field[v] > 0)) continue;
    let best = Infinity;
    for (const r of roots) best = Math.min(best, (positions[v * 3] - r.x) ** 2 + (positions[v * 3 + 1] - r.y) ** 2 + (positions[v * 3 + 2] - r.z) ** 2);
    alpha[v] = (1 - smooth(0.035, 0.06, Math.sqrt(best))) * smooth(0, 0.06, field[v]);
  }
  return alpha;
}

/**
 * Underlay geometry from the body's rest geometry: the scalp quads under the
 * roots, lifted 1.2 mm, coloured a shade of the hair with per-vertex alpha.
 */
export function locksUnderlayGeometry(bodyGeometry, alpha, color) {
  const pos = bodyGeometry.getAttribute('position'), normals = bodyGeometry.getAttribute('normal');
  const joints = bodyGeometry.getAttribute('skinIndex'), weights = bodyGeometry.getAttribute('skinWeight');
  const baseIds = bodyGeometry.userData.baseIds, tint = new Color(color).multiplyScalar(0.7);
  const out = { pos: [], normal: [], joints: [], weights: [], color: [], index: [] };
  for (let quad = 0; quad < bodyGeometry.index.count; quad += 6) {
    const first = bodyGeometry.index.array[quad];
    const a = [0, 1, 2, 3].map(k => alpha[baseIds[first + k]] ?? 0);
    if (Math.max(...a) <= 0.01) continue;
    const at = out.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const v = first + k;
      out.pos.push(pos.getX(v) + normals.getX(v) * 0.0012, pos.getY(v) + normals.getY(v) * 0.0012, pos.getZ(v) + normals.getZ(v) * 0.0012);
      out.normal.push(normals.getX(v), normals.getY(v), normals.getZ(v));
      out.color.push(tint.r, tint.g, tint.b, a[k]);
      for (let j = 0; j < 4; j++) { out.joints.push(joints.getComponent(v, j)); out.weights.push(weights.getComponent(v, j)); }
    }
    out.index.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  if (!out.index.length) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(out.pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(out.normal, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(out.joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(out.weights, 4));
  geometry.setAttribute('color', new Float32BufferAttribute(out.color, 4));
  geometry.setIndex(out.index);
  return geometry;
}
export const underlayMaterial = () => new MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95 });

/**
 * Comb a new lock over the scalp, as groom tools lay hair on the head: from
 * the root the path follows the head surface in the combing direction
 * (re-aimed along the surface at every step) and only leaves it to fall
 * straight down past the widest part of the head (where the surface turns
 * downwards). Used by the hair brush and by the ready-made styles.
 */
export function combLock(state, root, comb, length, params = {}) {
  const lock = makeLock(state, root, null, params);
  const head = state.collider.head, C = state.frame.C, hit = {};
  const lift = 0.5 * lock.width * lock.volume * 0.45 + 0.0025;
  const h = length / 120, path = [lock.rootP.clone()];
  let p = lock.rootP.clone(), dir = null, falling = false, travelled = 0;
  const surface = q => head.closest(q.x, q.y, q.z, 0.06, hit) ? { point: new Vector3(hit.x, hit.y, hit.z), normal: new Vector3(hit.nx, hit.ny, hit.nz) } : null;
  while (travelled < length) {
    const s = surface(p);
    const n = s?.normal ?? p.clone().sub(C).normalize();
    if (!falling && n.y < -0.12) falling = true;
    const want = falling ? new Vector3(0, -1, 0) : comb.clone();
    if (!falling || (s && p.distanceTo(s.point) < lift * 1.5)) want.addScaledVector(n, -want.dot(n));
    if (want.lengthSq() < 1e-10) want.set(0, -1, 0);
    want.normalize();
    dir = dir ? dir.multiplyScalar(0.7).addScaledVector(want, 0.3).normalize() : want;
    p = p.clone().addScaledVector(dir, h);
    const t = surface(p);
    // On the scalp the path is held at the lock's thickness above the skin;
    // falling, it is only kept out of the body.
    if (t && (!falling || p.clone().sub(t.point).dot(t.normal) < lift)) p = t.point.clone().addScaledVector(t.normal, lift);
    path.push(p);
    travelled += h;
  }
  const dense = new Float32Array(path.length * 3);
  path.forEach((q, i) => dense.set(q.toArray(), i * 3));
  const total = path.reduce((sum, q, i) => i ? sum + q.distanceTo(path[i - 1]) : 0, 0);
  const points = resamplePolyline(dense, total);
  lock.x.set(points); lock.rest.set(points); lock.old.set(points); lock.seg = total / (N - 1);
  return lock;
}
