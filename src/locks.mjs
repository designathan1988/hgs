import {
  BufferGeometry, CatmullRomCurve3, Float32BufferAttribute,
  SkinnedMesh, Triangle, Uint16BufferAttribute, Uint32BufferAttribute, Vector3,
} from 'three';
import { defaultHairline, hairCollider, headFrame, scalpField, vertexNormals } from './scalp.mjs';
import { fusedHairSurface, hairFusionGroups, normalizeHairFusion } from './hair-fusion.mjs';
import { buildHairRig } from './hair-rig.mjs';
import { cardFromSweep, hairCardMaterial } from './hair-cards.mjs';

/**
 * Mesh hair locks ("mechas"): stylised hair built from solid, smooth locks,
 * each rooted on the scalp, the way chunky game hair (The Sims) is modelled.
 *
 * - A lock is a chain of LOCK_POINTS particles. Particle 0 is the root, held
 *   on a scalp triangle (base-mesh vertices + barycentric weights), so it
 *   follows any body change.
 * - Gravity is a grooming operator (LockShaper), not a simulation: each lock's
 *   hanging shape is computed in one pass from its design shape (`rest`), its
 *   firmness and what lies below it, so nothing ever moves by itself and
 *   applying it again changes nothing. Segment lengths stay exact (segments
 *   are turned, never stretched); skin, clothing and the locks laid before
 *   are kept out by the lock's own thickness.
 * - "Set as rest" (styled) keeps a lock's current shape against gravity.
 * - The game and editor mesh is a hair card per lock (hair-cards.mjs): a
 *   textured strip along the lock's centre line. The closed tube below is
 *   kept for the volume fusion and the tests. The tube is swept along a centripetal
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

export const lockDefaults = Object.freeze({ width: 0.05, volume: 0.18, taper: 0.85, curl: 0, turns: 4, twist: 0, stiffness: 0.35, bend: 0 });
export const lockLimits = Object.freeze({
  width: [0.001, 0.09], volume: [0.12, 1], taper: [0, 1], curl: [0, 1], turns: [0.5, 14], twist: [-TAU * 1.5, TAU * 1.5], stiffness: [0, 1], bend: [-1, 1],
  length: [0.015, 1.1],
});

// ------------------------------------------------------------- data model

/** Bounded, serialisable copy of a locks hairstyle (positions relative to each root, metres at head radius R). */
export function normalizeLocks(value) {
  const result = { format: 'hgs-locks', v: 1, R: 0.11, scalp: 1, locks: [], accessories: [] };
  if (!value || typeof value !== 'object') return result;
  const finite = (x, a, b, fallback) => Number.isFinite(x) ? clamp(x, a, b) : fallback;
  result.R = finite(value.R, 0.03, 0.4, 0.11);
  result.scalp = value.scalp === 0 || value.scalp === false ? 0 : 1;
  if (value.v >= 2 || value.fusion) { result.v = 2; result.fusion = normalizeHairFusion(value.fusion); }
  if (!Array.isArray(value.locks)) return result;
  const kept = new Map();
  for (const [index, lock] of value.locks.slice(0, 400).entries()) {
    if (!lock || typeof lock !== 'object') continue;
    const r = lock.r;
    if (!r || !Array.isArray(r.v) || r.v.length !== 3 || !r.v.every(Number.isInteger) || !Array.isArray(r.w) || r.w.length !== 3 || !r.w.every(Number.isFinite)) continue;
    const vec = a => Array.isArray(a) && a.length === N * 3 && a.every(Number.isFinite);
    if (!vec(lock.p)) continue;
    const w = r.w.map(x => clamp(x, 0, 1)), sum = w[0] + w[1] + w[2] || 1;
    const out = {
      // Already-normalised weights are kept as they are, so saving a loaded file gives the same file.
      r: { v: r.v.map(v => Math.max(0, v)), w: w.map(x => round(Math.abs(sum - 1) < 1e-5 ? x : x / sum, 1e6)) },
      // 1 nm (finer than the positions' own float precision) and the exact
      // segment length: gravity is applied to the saved shapes when a
      // hairstyle is loaded, and it must give back exactly the same hair.
      p: lock.p.map(x => round(clamp(x, -2, 2), 1e9)),
      q: vec(lock.q) ? lock.q.map(x => round(clamp(x, -2, 2), 1e9)) : null,
      sg: Number.isFinite(lock.sg) && lock.sg >= 1e-5 && lock.sg <= 0.1 ? lock.sg : null,
      sy: lock.sy ? 1 : 0,
      // Held against gravity ("Fixar forma"), apart from a kept shape (sy); older v1 files have neither.
      ...(lock.fx !== undefined ? { fx: Boolean(lock.fx) } : {}),
      pins: Array.isArray(lock.pins) ? lock.pins.filter(p => Array.isArray(p) && p.length === 4 && p.every(Number.isFinite) && p[0] >= 2 && p[0] < N).map(([i, x, y, z]) => [Math.round(i), round(x, 1e9), round(y, 1e9), round(z, 1e9)]) : [],
    };
    for (const [key, short] of [['width', 'w'], ['volume', 'vo'], ['taper', 'ta'], ['curl', 'cu'], ['turns', 'tu'], ['twist', 'tw'], ['stiffness', 'st'], ['bend', 'be']]) {
      out[short] = round(finite(lock[short], ...lockLimits[key], lockDefaults[key]), 1e4);
    }
    if (result.v >= 2) {
      out.id = typeof lock.id === 'string' && lock.id ? lock.id.slice(0, 64) : `lock-${result.locks.length}`;
      out.g = typeof lock.g === 'string' && result.fusion.groups.some(g => g.id === lock.g) ? lock.g : 'main';
      out.dn = finite(lock.dn, 0, 1, 1);
      out.ti = ['round', 'point', 'flat'].includes(lock.ti) ? lock.ti : 'round';
      out.fx = Boolean(lock.fx);
      out.bi = Boolean(lock.bi);
      out.rt = Boolean(lock.rt);
      out.rn = Array.isArray(lock.rn) && lock.rn.length === 3 && lock.rn.every(Number.isFinite) && Math.hypot(...lock.rn) > .000001 ? lock.rn.map(v => round(clamp(v, -1, 1), 1e6)) : null;
    }
    kept.set(index, result.locks.length);
    result.locks.push(out);
  }
  // Hair ties and holders (hair-accessories.mjs): type, colour, the pins each
  // holds as [lock, point] (locks renumbered as kept above), a band's direction.
  for (const acc of Array.isArray(value.accessories) ? value.accessories.slice(0, 32) : []) {
    if (!acc || !['tie', 'clip', 'barrette', 'band'].includes(acc.t)) continue;
    const h = (Array.isArray(acc.h) ? acc.h : []).filter(pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isInteger) && kept.has(pair[0]) && pair[1] >= 2 && pair[1] < N)
      .slice(0, 800).map(([lock, point]) => [kept.get(lock), point]);
    const out = { t: acc.t, c: Number.isInteger(acc.c) ? clamp(acc.c, 0, 0xffffff) : 0x262626, h };
    if (acc.t === 'band') {
      if (!Array.isArray(acc.d) || acc.d.length !== 3 || !acc.d.every(Number.isFinite) || Math.hypot(...acc.d) < 1e-6) continue;
      const length = Math.hypot(...acc.d);
      out.d = acc.d.map(v => round(v / length, 1e6)); out.s = acc.s === 'tiara' ? 'tiara' : 'band';
    } else if (!h.length) continue;
    result.accessories.push(out);
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
  const state = { frame, normals, field, collider, data, positions, locks: [], accessories: [], scalp: saved.scalp, sim: null, fusion: saved.fusion ? normalizeHairFusion(saved.fusion) : null };
  const scale = frame.R / saved.R, kept = new Map();
  if (state.fusion) { state.fusion.smoothness *= scale; state.fusion.resolution *= scale; }
  for (const [index, item] of saved.locks.entries()) {
    if (item.r.v.some(v => v * 3 + 2 >= positions.length)) continue;
    const lock = makeLock(state, item.r, null, {
      width: item.w * scale, volume: item.vo, taper: item.ta, curl: item.cu, turns: item.tu, twist: item.tw, stiffness: item.st, bend: item.be,
    });
    const root = lock.rootP;
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
      lock.x[i * 3 + k] = root.getComponent(k) + item.p[i * 3 + k] * scale;
      lock.rest[i * 3 + k] = root.getComponent(k) + (item.q ?? item.p)[i * 3 + k] * scale;
    }
    lock.x.set(root.toArray(), 0); lock.rest.set(root.toArray(), 0);
    // Rest and pose share the segment length; a file without it (older) is refitted.
    if (item.sg) lock.seg = item.sg * scale;
    else { lock.seg = segmentOf(lock.x); fitLengths(lock.rest, lock.seg); }
    lock.styled = Boolean(item.sy);
    if (saved.v >= 2) { lock.id = item.id; lock.group = item.g; lock.density = item.dn; lock.tipShape = item.ti; lock.fixed = item.fx; lock.bendEmbedded = item.bi; lock.rootTaper = item.rt; lock.ribbonNormal = item.rn ? [...item.rn] : null; }
    else lock.fixed = item.fx ?? lock.styled;
    for (const [i, x, y, z] of item.pins) lock.pins.set(i, new Vector3(x, y, z).multiplyScalar(scale).add(root));
    kept.set(index, lock);
    state.locks.push(lock);
  }
  // Each pin an accessory holds carries its id (`pin.holder`).
  for (const [n, acc] of saved.accessories.entries()) {
    const id = `acc-${n}`;
    let held = 0;
    for (const [l, i] of acc.h) { const pin = kept.get(l)?.pins.get(i); if (pin) { pin.holder = id; held++; } }
    if (!held && acc.t !== 'band') continue;
    state.accessories.push({ id, type: acc.t, color: acc.c, ...(acc.t === 'band' ? { style: acc.s, dir: [...acc.d] } : {}) });
  }
  state.sim = new LockShaper(state);
  return state;
}

export function serializeLocks(state) {
  const R = state.frame.R;
  return normalizeLocks({
    format: 'hgs-locks', v: state.fusion ? 2 : 1, R, scalp: state.scalp,
    ...(state.fusion ? { fusion: state.fusion } : {}),
    locks: state.locks.map(lock => {
      const root = lock.rootP, rel = a => Array.from(a, (x, j) => x - root.getComponent(j % 3));
      return {
        r: { v: [...lock.root.v], w: [...lock.root.w] }, p: rel(lock.x), q: rel(lock.rest), sg: lock.seg, sy: lock.styled ? 1 : 0, fx: Boolean(lock.fixed),
        w: lock.width, vo: lock.volume, ta: lock.taper, cu: lock.curl, tu: lock.turns, tw: lock.twist, st: lock.stiffness, be: lock.bend,
        pins: [...lock.pins].map(([i, p]) => [i, p.x - root.x, p.y - root.y, p.z - root.z]),
        ...(state.fusion ? { id: lock.id, g: lock.group ?? 'main', dn: lock.density ?? 1, ti: lock.tipShape ?? 'round', fx: Boolean(lock.fixed), bi: Boolean(lock.bendEmbedded), rt: Boolean(lock.rootTaper), rn: lock.ribbonNormal ? [...lock.ribbonNormal] : null } : {}),
      };
    }),
    accessories: (state.accessories ?? []).map(acc => ({
      t: acc.type, c: acc.color,
      h: state.locks.flatMap((lock, l) => [...lock.pins].filter(([, p]) => p.holder === acc.id).map(([i]) => [l, i])),
      ...(acc.type === 'band' ? { d: acc.dir, s: acc.style } : {}),
    })),
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
  // Rounded as a saved file stores them, so a lock is the same before and after saving.
  return { v: [...baseIds], w: w.map(x => round(x / sum, 1e6)) };
}

/** A new live lock; `points` (world, LOCK_POINTS) or a short sprout along the root normal. */
export function makeLock(state, root, points, params = {}) {
  const { p, n } = rootFrame(state, root);
  const lock = {
    root: { v: [...root.v], w: [...root.w] }, rootP: p, rootN: n,
    x: new Float32Array(N * 3), rest: new Float32Array(N * 3),
    seg: 0.002, styled: false, fixed: false, tipShape: 'round', pins: new Map(), grab: null, hold: null, facing: new Float32Array(N * 3),
    ...lockDefaults, ...params,
  };
  if (points) lock.x.set(points);
  else for (let i = 0; i < N; i++) lock.x.set(p.clone().addScaledVector(n, 0.02 * i / (N - 1)).toArray(), i * 3);
  lock.x.set(p.toArray(), 0);
  lock.seg = segmentOf(lock.x);
  lock.rest.set(lock.x);
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
  lock.pins.clear();
  for (const [s, p] of pins) {
    const i = Math.round(s / lock.seg);
    if (i >= 2 && i < N) lock.pins.set(i, p);
  }
}

/** Author a complete drawn path while retaining one root and LOCK_POINTS.
 * Arc resampling follows Blender's Snake Hook Curves model; root-led length
 * projection is the static FTL construction in Müller et al. (2012), §3.1.
 */
export function setLockShape(lock, points) {
  if (!points || points.length < 6 || points.length % 3 || !Array.from(points).every(Number.isFinite)) return false;
  const path = Float32Array.from(points); path.set(lock.rootP.toArray(), 0);
  let length = 0;
  for (let i = 3; i < path.length; i += 3) length += Math.hypot(path[i] - path[i - 3], path[i + 1] - path[i - 2], path[i + 2] - path[i - 1]);
  length = clamp(length, ...lockLimits.length);
  const sampled = resamplePolyline(path, length);
  lock.seg = length / (N - 1); fitLengths(sampled, lock.seg); lock.x.set(sampled); lock.rest.set(sampled);
  return true;
}

/** Project an edited pose onto root/pin/protected-point and length constraints.
 * FABRIK (Aristidou & Lasenby 2011) for intervals bounded at both ends, static
 * FTL (Müller et al. 2012) for the free tail; existing turnOut resolves contact
 * on each segment's length sphere. Lengths are never stretched: when held points
 * cannot be joined, the chain ends as near its target as it can.
 */
export function constrainLockPose(lock, state, { reference = Float32Array.from(lock.x), protectedPoints = new Map(), fixFollicle = true } = {}) {
  const fixed = new Map([[0, lock.rootP], ...(fixFollicle ? [[1, new Vector3().fromArray(reference, 3)]] : []), ...lock.pins, ...protectedPoints]);
  const anchors = [...fixed.keys()].filter(i => i >= 0 && i < N).sort((a, b) => a - b);
  const target = i => fixed.get(i).toArray();
  for (const i of anchors) lock.x.set(target(i), i * 3);
  const contact = i => { if (state?.sim) for (let pass = 0; pass < 3 && state.sim.turnOut(lock, i); pass++); };
  for (let k = 1; k < anchors.length; k++) {
    const a = anchors[k - 1], b = anchors[k], first = fixed.get(a), last = fixed.get(b), reach = (b - a) * lock.seg;
    if (b - a <= 1) continue;
    const distance = first.distanceTo(last);
    if (distance >= reach * (1 - 1e-6)) {
      for (let i = a + 1; i < b; i++) lock.x.set(first.clone().lerp(last, (i - a) / (b - a)).toArray(), i * 3);
      continue;
    }
    let error = Infinity;
    for (let pass = 0; pass < 32; pass++) {
      lock.x.set(target(b), b * 3);
      for (let i = b - 1; i > a; i--) place(lock.x, i, i + 1, lock.seg);
      lock.x.set(target(a), a * 3);
      for (let i = a + 1; i <= b; i++) { place(lock.x, i, i - 1, lock.seg); if (i < b) contact(i); }
      error = new Vector3().fromArray(lock.x, b * 3).distanceTo(last);
      if (error < lock.seg * 1e-4) break;
    }
    // Not joined at these lengths (around the body): a held point that has not
    // moved (pin, protected point) keeps the interval at its previous valid
    // pose; a moving one (a comb tooth, a pulled point) keeps the solved chain,
    // every length exact, its end as near the target as it got, as the groom's
    // held ends do. The next interval starts from where this one ends.
    if (error > lock.seg * .001) {
      if (new Vector3().fromArray(reference, b * 3).distanceTo(last) <= lock.seg * .001) lock.x.set(reference.subarray(a * 3, (b + 1) * 3), a * 3);
      fixed.set(b, new Vector3().fromArray(lock.x, b * 3));
      continue;
    }
    lock.x.set(target(b), b * 3);
  }
  for (let i = anchors.at(-1) + 1; i < N; i++) { place(lock.x, i, i - 1, lock.seg); contact(i); }
  return lock;
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
}

// --------------------------------------------------------------- physics

/**
 * Lock half-thickness at a chain point (the mesh's profile) plus half the
 * curl radius: the coils of a curl are sparse, so half their radius is kept
 * clear of the body. Shared with the editor's dynamics, so both keep the same clearance.
 */
export function collisionRadius(lock, i) {
  const u = i / (N - 1);
  const width = lock.curl > 0 ? lock.width + (curlWidth(lock) - lock.width) * curlIn(lock, u) : lock.width;
  return 0.5 * width * sectionVolume(lock, u) * profile(lock, u * lockLength(lock), lockLength(lock)) + 0.5 * curlRadius(lock, u) + 0.0012;
}

/**
 * How far gravity turns segment i (ending at point i) towards straight down,
 * 0..1, read from the design shape: the weight grows with the arc length from
 * the root (in head-radius units; firm hair starts later and turns more
 * slowly), and hair combed onto the head keeps its path there (the head holds
 * it, as a groom follows the skin contour), except past the widest point of
 * the head, where the surface faces down. Every switch is gradual, so a
 * slightly different input never gives a different shape. Shared by the
 * static groom (LockShaper.hang) and the editor's dynamics.
 */
export function gravityWeight(state, lock, i, force, hit = {}) {
  const rest = lock.rest, st = lock.stiffness, s = i * lock.seg * 0.11 / state.frame.R;
  const start = 0.01 + 0.04 * st, rate = 12 + 50 * (1 - st) ** 2, head = state.collider?.head;
  let hold = 0;
  if (head?.closest(rest[i * 3 - 3], rest[i * 3 - 2], rest[i * 3 - 1], 0.04, hit)) {
    const r = collisionRadius(lock, i);
    hold = smooth(-0.35, -0.1, hit.ny) * (1 - smooth(r + 0.008, r + 0.016, hit.distance));
  }
  return force * (1 - hold) * (1 - Math.exp(-rate * Math.max(0, s - start)));
}

/**
 * Half-thickness by which locks stack on each other: the flat band only. The
 * coils of curled locks interleave, so their curl does not add layers.
 */
function layerThickness(lock, i) {
  const u = i / (N - 1), L = lockLength(lock);
  return 0.5 * lock.width * lock.volume * (0.45 + 0.55 * smooth(0.04, 0.42, u)) * profile(lock, u * L, L);
}

/**
 * Hair gravity as a grooming operator, not a simulation (as Ornatrix's
 * Gravity operator and Resolve Collisions, or Houdini's Guide Process, shape
 * guides): the shape a lock hangs in is computed in one pass from its design
 * shape (`rest`). Nothing runs afterwards, so nothing can move by itself, and
 * applying it again gives exactly the same hair.
 *
 * - Root, follicle direction, pins and the point being pulled are held; the
 *   chain between held points is solved with FABRIK.
 * - Past the last held point every segment turns from its design direction
 *   towards straight down by a weight that grows with the distance from the
 *   root (Ornatrix's "force ramp"): soft hair hangs within a few centimetres,
 *   firm hair keeps its shape longer. A bend ("Curvar") is applied after
 *   gravity, as the next operator in a stack.
 * - A segment that would go into the skin, the clothing or a lock already laid
 *   is turned about its start point until it lies on that surface, so every
 *   length stays exact and a lock follows the skull.
 * - Locks are laid in a fixed order, the lowest roots first (nape, sides) and
 *   the crown and the parting last: a lock rests on those laid before it and
 *   never moves them.
 * - Locks with a set (styled) shape keep it and only support the others.
 */
export class LockShaper {
  constructor(state) {
    this.state = state;
    this.force = 1;
    this.fixed = new Uint8Array(N); this.target = new Float32Array(N * 3);
  }
  /** Held points: root, follicle direction, pins, the point being pulled. Returns the last one. */
  holds(lock) {
    const fixed = this.fixed, target = this.target, root = lock.rootP;
    fixed.fill(0);
    fixed[0] = 1; target[0] = root.x; target[1] = root.y; target[2] = root.z;
    // The follicle sets the direction the lock leaves the scalp.
    fixed[1] = 1; target[3] = lock.rest[3]; target[4] = lock.rest[4]; target[5] = lock.rest[5];
    for (const [i, p] of lock.pins) { fixed[i] = 1; target[i * 3] = p.x; target[i * 3 + 1] = p.y; target[i * 3 + 2] = p.z; }
    if (lock.grab) { const { index, point } = lock.grab; fixed[index] = 1; target.set(reach(lock, index, point).toArray(), index * 3); }
    let last = 0;
    for (let i = 0; i < N; i++) if (fixed[i]) last = i;
    return last;
  }
  /** Chains between consecutive held points: FABRIK passes, collision, then an exact pass from the leader. */
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
        // The held end (not the root) may end a few millimetres off its target instead of stretching.
        for (let i = a + 1; i < b; i++) place(x, i, i - 1, l);
        if (b > 1) place(x, b, b - 1, l);
      }
      a = b;
    }
  }
  collide(lock, i) {
    const collider = this.state.collider;
    if (!collider || i < 2) return false;
    return collider.resolve(lock.x, i * 3, Math.min(0.028, collisionRadius(lock, i)));
  }
  /**
   * Lay every lock (or recompute only `only`, keeping the others where they
   * are) in layer order. `force` 0 keeps the design shapes (out of the body).
   */
  apply({ only = null, force = this.force, still = null } = {}) {
    const state = this.state, grid = new Map();
    // Lowest roots first; roots at the same height (mirrored locks) in a fixed
    // order, so tiny differences never swap which one lies on top.
    const order = state.locks.map(lock => [Math.round(layer(state, lock) * 1e4), lock.rootP.x, lock]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , lock]) => lock);
    for (const lock of order) {
      // A lock with a set shape follows the hand when pulled, without falling;
      // so does a lock in `still` (shaped by hand with gravity held off).
      const free = !lock.styled || lock.grab;
      if (free && !lock.hold && (!only || only.has(lock))) this.hang(lock, grid, lock.styled || still?.has(lock) ? 0 : force);
      else if (lock.hold) lock.x.set(lock.hold);
      this.store(lock, grid);
    }
  }
  /** One lock: held part by FABRIK, then each segment turned by gravity and out of what is below. */
  hang(lock, grid, force) {
    const x = lock.x, rest = lock.rest, l = lock.seg, fixed = this.fixed, target = this.target;
    const last = this.holds(lock);
    x.set(rest.subarray(0, (last + 1) * 3));
    for (let i = 0; i <= last; i++) if (fixed[i]) x.set(target.subarray(i * 3, i * 3 + 3), i * 3);
    // The follicle gives the direction; the first segment keeps its exact length.
    if (!fixed[2] || last < 2) place(x, 1, 0, l);
    this.chains(lock);
    const C = this.state.frame.C;
    const d = new Vector3(), down = new Vector3(0, -1, 0), axis = new Vector3(), out = new Vector3();
    const hit = {};
    let bend = 0;
    for (let i = last + 1; i < N; i++) {
      d.set(rest[i * 3] - rest[i * 3 - 3], rest[i * 3 + 1] - rest[i * 3 - 2], rest[i * 3 + 2] - rest[i * 3 - 1]).normalize();
      const w = gravityWeight(this.state, lock, i, force, hit);
      const c = clamp(d.dot(down), -1, 1);
      if (w > 0 && c < 0.999999) {
        axis.crossVectors(d, down);
        // Straight up: tip over outwards.
        if (axis.lengthSq() < 1e-10) axis.crossVectors(d, out.set(x[i * 3 - 3] - C.x, 0, x[i * 3 - 1] - C.z));
        if (axis.lengthSq() > 1e-12) d.applyAxisAngle(axis.normalize(), w * Math.acos(c));
      }
      // Bend: turn about the lock's width axis (positive curls under, towards the head).
      if (lock.bend && !lock.bendEmbedded && i >= 2) {
        bend += lock.bend * 2.6 / (N - 2);
        out.set(x[i * 3 - 3] - C.x, x[i * 3 - 2] - C.y, x[i * 3 - 1] - C.z).normalize();
        axis.crossVectors(d, out);
        if (axis.lengthSq() > 1e-12) d.applyAxisAngle(axis.normalize(), -bend);
      }
      x[i * 3] = x[i * 3 - 3] + d.x * l; x[i * 3 + 1] = x[i * 3 - 2] + d.y * l; x[i * 3 + 2] = x[i * 3 - 1] + d.z * l;
      bendLimit(x, i, l);
      // Out of the body, onto the locks below (one bounded lift), out of the body again.
      for (let k = 0; k < 3 && this.turnOut(lock, i); k++);
      if (this.turnOffLocks(lock, i, grid)) for (let k = 0; k < 3 && this.turnOut(lock, i); k++);
    }
  }
  /** Turn segment i out of the skin or clothing (about point i-1). */
  turnOut(lock, i) {
    const collider = this.state.collider;
    if (!collider || i < 2) return false;
    const x = lock.x, o = i * 3, px = x[o], py = x[o + 1], pz = x[o + 2];
    if (!collider.resolve(x, o, Math.min(0.028, collisionRadius(lock, i)))) return false;
    const n = collider.normal;
    turn(x, i, lock.seg, px, py, pz, n[0], n[1], n[2], x[o], x[o + 1], x[o + 2]);
    return true;
  }
  /**
   * Turn segment i off the locks laid before, outwards from the head. Each
   * laid point stands for its slice of a flat band: half a segment along the
   * lock, half-width a across it, half-thickness b. The new point overlaps
   * it when it is within both (its own half-width counts in the direction it
   * spreads relative to that band).
   *
   * Locks are layered thinly, as stylised hair is built (strips overlap at
   * almost the same depth, not stacked by their full thickness): the upper
   * lock lies 0.4 of their thicknesses above the lower one. A point already
   * below the middle of a lock passes under it, and a point is lifted at most
   * a third of a segment, so a lock never steps out from the head.
   */
  turnOffLocks(lock, i, grid) {
    if (i < 2 || !grid.size) return false;
    const x = lock.x, o = i * 3, C = this.state.frame.C, L = lockLength(lock), s = i * lock.seg;
    const a = 0.5 * lock.width * profile(lock, s, L), b = layerThickness(lock, i);
    // Direction of this lock here.
    let ux = x[o] - x[o - 3], uy = x[o + 1] - x[o - 2], uz = x[o + 2] - x[o - 1];
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const cx = Math.floor(x[o] / CELL), cy = Math.floor(x[o + 1] / CELL), cz = Math.floor(x[o + 2] / CELL);
    let best = 0, nx = 0, ny = 0, nz = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const [P, j, aj, bj, sj, segj] of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        // The first centimetres of a lock pass under a lock that lies over its root.
        if (s < 0.02 && sj > s + 0.02) continue;
        const q = j * 3;
        let rx = P[q] - C.x, ry = P[q + 1] - C.y, rz = P[q + 2] - C.z;
        const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
        const ex = x[o] - P[q], ey = x[o + 1] - P[q + 1], ez = x[o + 2] - P[q + 2];
        const radial = ex * rx + ey * ry + ez * rz, need = 0.4 * (b + bj) + 0.0005;
        if (radial >= need || radial <= -need) continue;
        // That band's axis and width directions in the plane tangent to the head.
        const q0 = Math.max(0, j - 1) * 3, q1 = Math.min(N - 1, j + 1) * 3;
        let tx = P[q1] - P[q0], ty = P[q1 + 1] - P[q0 + 1], tz = P[q1 + 2] - P[q0 + 2];
        const tr = tx * rx + ty * ry + tz * rz; tx -= rx * tr; ty -= ry * tr; tz -= rz * tr;
        const tl = Math.hypot(tx, ty, tz);
        if (tl < 1e-9) continue;
        tx /= tl; ty /= tl; tz /= tl;
        const wx = ry * tz - rz * ty, wy = rz * tx - rx * tz, wz = rx * ty - ry * tx;
        const along = Math.abs(ex * tx + ey * ty + ez * tz), across = Math.abs(ex * wx + ey * wy + ez * wz);
        // How this lock's own width spreads along and across that band.
        const ua = Math.abs(ux * tx + uy * ty + uz * tz), uw = Math.abs(ux * wx + uy * wy + uz * wz), un = Math.hypot(ua, uw) || 1;
        const spanAcross = aj + a * (ua / un), spanAlong = 0.5 * segj + a * (uw / un);
        if (across >= 0.85 * spanAcross || along >= spanAlong) continue;
        // Full where the bands lie on each other, fading out at their edges,
        // at the ends of the slice, and for a point already under the lock
        // (it passes under rather than being lifted over).
        const push = (need - radial) * (1 - smooth(0.55, 0.85, across / spanAcross)) * (1 - smooth(0.75, 1, along / spanAlong)) * smooth(-need, -0.4 * need, radial);
        if (push > best) { best = push; nx = rx; ny = ry; nz = rz; }
      }
    }
    best = Math.min(best, 0.35 * lock.seg);
    if (best <= 1e-6) return false;
    turn(x, i, lock.seg, x[o], x[o + 1], x[o + 2], nx, ny, nz, x[o] + nx * best, x[o + 1] + ny * best, x[o + 2] + nz * best);
    return true;
  }
  /** Add a lock's points to the grid of laid locks. */
  store(lock, grid) {
    const L = lockLength(lock);
    for (let i = 2; i < N; i++) {
      const o = i * 3, k = `${Math.floor(lock.x[o] / CELL)},${Math.floor(lock.x[o + 1] / CELL)},${Math.floor(lock.x[o + 2] / CELL)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([lock.x, i, 0.5 * lock.width * profile(lock, i * lock.seg, L), layerThickness(lock, i), i * lock.seg, lock.seg]);
    }
  }
}

/** Grid cell for lock-lock contact: more than the widest footprint reach (0.75 × 2 × 4.5 cm). */
const CELL = 0.07;

/**
 * Put point i at its segment length from point i-1, as close as possible to
 * the direction towards (px,py,pz), on the outer side of the plane through q
 * with normal n: the segment is turned about its start, never stretched.
 */
function turn(x, i, l, px, py, pz, nx, ny, nz, qx, qy, qz) {
  const o = i * 3, cx = x[o - 3], cy = x[o - 2], cz = x[o - 1];
  let ex = px - cx, ey = py - cy, ez = pz - cz;
  const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
  // The segment end must satisfy e·n >= need to be on the outer side.
  const need = ((qx - cx) * nx + (qy - cy) * ny + (qz - cz) * nz) / l, en = ex * nx + ey * ny + ez * nz;
  if (need >= 1) { ex = nx; ey = ny; ez = nz; }
  else if (en < need) {
    let tx = ex - nx * en, ty = ey - ny * en, tz = ez - nz * en;
    let tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-9) { tx = ny; ty = -nx; tz = 0; tl = Math.hypot(tx, ty) || 1; if (tl < 1e-6) { tx = 1; ty = 0; tz = 0; tl = 1; } }
    const t = Math.max(need, -1), s = Math.sqrt(Math.max(0, 1 - t * t));
    ex = tx / tl * s + nx * t; ey = ty / tl * s + ny * t; ez = tz / tl * s + nz * t;
  } else {
    // Already on the outer side of the plane (a curved surface): head for the surface point.
    ex = qx - cx; ey = qy - cy; ez = qz - cz;
    const ql = Math.hypot(ex, ey, ez) || 1; ex /= ql; ey /= ql; ez /= ql;
  }
  x[o] = cx + ex * l; x[o + 1] = cy + ey * l; x[o + 2] = cz + ez * l;
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

/**
 * Curls grow in below the root, where the lock can leave the scalp: from 12%
 * of the length, but not within the first 7 cm (lying over the top of the
 * head the hair above flattens them), over the next 18%.
 */
const curlIn = (lock, u) => { const a = Math.min(0.6, Math.max(0.12, 0.07 / lockLength(lock))); return smooth(a, a + 0.18, u); };
/** Curled locks gather into narrower, rounder ringlets. */
function curlWidth(lock) { return lock.width * (1 - 0.5 * lock.curl); }
/**
 * Thickness / width along the lock: flatter near the root, where locks lie
 * stacked on the scalp (so their overlaps leave no steps), fuller below; curls
 * round it further.
 */
function sectionVolume(lock, u) {
  const flat = lock.volume * (0.45 + 0.55 * smooth(0.04, 0.42, u));
  return flat + (1 - flat) * 0.7 * lock.curl * curlIn(lock, u);
}

/** Radius profile along a lock (0 at the tip): slight root narrowing, taper to a soft point, rounded tip. */
const TAPER = 0.93;
function tipCap(lock, length) { return lock.tipShape === 'point' ? Math.max(.001, length * .065) : lock.tipShape === 'flat' ? .001 : Math.max(0.5 * lock.width * (1 - lock.taper * TAPER) * 1.2, 0.002, 0.02 * length); }
function profile(lock, s, length) {
  const u = clamp(s / length, 0, 1);
  const taper = 1 - lock.taper * TAPER * Math.pow(u, 1.25);
  const cap = tipCap(lock, length), d = length - s;
  const tip = lock.tipShape === 'flat' ? 1 : d >= cap ? 1 : lock.tipShape === 'point' ? Math.max(0, d / cap) : Math.sqrt(Math.max(0, 1 - (1 - d / cap) ** 2));
  // A lock emerges thin from the scalp and reaches full width a few centimetres on.
  const root = lock.rootTaper ? smooth(0, Math.min(.04, length * .3), s) : 0.5 + 0.5 * smooth(-0.002, Math.min(0.04, length * 0.3), s);
  return taper * tip * root;
}
/**
 * Helix radius of a curl at u. It stays larger than the lock's half-width
 * there, or the swept tube would fold through its own axis.
 */
function curlRadius(lock, u) {
  const half = 0.5 * curlWidth(lock) * (1 - lock.taper * TAPER * Math.pow(u, 1.25));
  return lock.curl * (half * 1.25 + 0.004) * curlIn(lock, u);
}

/**
 * Surface direction each chain point lies against: the nearest skin/clothing
 * normal, else away from the head centre. Reuse only the identical point:
 * approximate position caching makes collision, display and reopened meshes
 * disagree even when their current control points are exactly the same.
 */
function facings(lock, state) {
  const out = lock.facing, at = lock.facingAt ??= new Float32Array(N * 3).fill(Infinity), hit = {}, layers = state.collider?.head, C = state.frame.C;
  for (let i = 0; i < N; i++) {
    const o = i * 3, x = lock.x[o], y = lock.x[o + 1], z = lock.x[o + 2];
    if (x === at[o] && y === at[o + 1] && z === at[o + 2]) continue;
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
  if ((lock.density ?? 1) < 1) lock = { ...lock, width: lock.width * Math.sqrt(Math.max(0, lock.density)) };
  const { M, ss, line, tan, RA, SA, fit, length } = lockSweep(lock, state, { detail });
  const flatTip = lock.tipShape === 'flat', ring = sides + 1, count = M * ring + 1 + (flatTip ? 1 : 0);
  const pos = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2), color = new Float32Array(count * 3);
  const cosT = new Float32Array(ring), sinT = new Float32Array(ring);
  for (let k = 0; k <= sides; k++) { cosT[k] = Math.cos(k / sides * TAU); sinT[k] = Math.sin(k / sides * TAU); }
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
      vertex?.(px, py, pz, u);
    }
  }
  // Close the sunken root end.
  pos.set(line.subarray(0, 3), v * 3); normal.set([-tan[0], -tan[1], -tan[2]], v * 3); uv.set([0.5, 0], v * 2); color.set([0.78, 0.78, 0.78], v * 3);
  vertex?.(line[0], line[1], line[2], 0);
  if (flatTip) {
    pos.set(line.subarray((M - 1) * 3, M * 3), (v + 1) * 3); normal.set(tan.subarray((M - 1) * 3, M * 3), (v + 1) * 3); uv.set([.5, 1], (v + 1) * 2); color.set([1, 1, 1], (v + 1) * 3);
    vertex?.(line[(M - 1) * 3], line[(M - 1) * 3 + 1], line[(M - 1) * 3 + 2], 1);
  }
  const index = new Uint32Array((M - 1) * sides * 6 + sides * 3 + (flatTip ? sides * 3 : 0));
  let n = 0;
  for (let j = 0; j + 1 < M; j++) for (let k = 0; k < sides; k++) {
    const a = j * ring + k, b = a + 1, c = a + ring, d = c + 1;
    index[n++] = a; index[n++] = c; index[n++] = b; index[n++] = b; index[n++] = c; index[n++] = d;
  }
  for (let k = 0; k < sides; k++) { index[n++] = v; index[n++] = k; index[n++] = k + 1; }
  if (flatTip) for (let k = 0; k < sides; k++) { index[n++] = v + 1; index[n++] = (M - 1) * ring + k + 1; index[n++] = (M - 1) * ring + k; }
  return { pos, normal, uv, color, index };
}

/**
 * A lock as a hair card (hair-cards.mjs): the same centre line and frames as
 * the tube, a strip across its width facing out of the head.
 */
export function lockCard(lock, state, { detail = 1, vertex = null } = {}) {
  if ((lock.density ?? 1) < 1) lock = { ...lock, width: lock.width * Math.sqrt(Math.max(0, lock.density)) };
  const sweep = lockSweep(lock, state, { detail });
  // A card keeps most of its width to the tip (the strands in its texture thin out there, not the card),
  // and is half again as wide as the lock so neighbouring cards overlap and no scalp shows between them.
  const half = sweep.ss.map(s => {
    const u = clamp(s / sweep.length, 0, 1);
    return 0.75 * lock.width * (1 - 0.45 * lock.taper * Math.pow(u, 1.4)) * (0.75 + 0.25 * smooth(0, Math.min(0.03, sweep.length * 0.2), s));
  });
  const u = sweep.ss.map(s => clamp(s / sweep.length, 0, 1));
  return cardFromSweep({ M: sweep.M, line: sweep.line, tan: sweep.tan, side: sweep.SA, out: sweep.RA, half, u }, lock, { vertex });
}

/**
 * The swept centre line of a lock: arc-length samples `ss` (the first one
 * sunk into the scalp), points `line`, unit tangents `tan`, the thickness
 * axis `RA` (facing out of the surface) and width axis `SA`, turned by the
 * twist, and the tube's half-width `fit` per sample.
 */
function lockSweep(lock, state, { detail = 1 } = {}) {
  const length = lockLength(lock), w = lock.width;
  const sink = lock.rootTaper ? 0 : Math.max(0.002, 0.5 * w * lock.volume * 0.9);
  const ctrl = [lock.rootP.clone().addScaledVector(lock.rootN, -sink)];
  for (let i = lock.rootTaper ? 1 : 0; i < N; i++) ctrl.push(new Vector3().fromArray(lock.x, i * 3));
  // Centripetal Catmull-Rom, tabulated densely; arc length is read from the table.
  const curve = new CatmullRomCurve3(ctrl, false, 'centripetal');
  const T = (N + 1) * 7, table = new Float32Array((T + 1) * 3), cum = new Float32Array(T + 1), q = new Vector3();
  for (let k = 0; k <= T; k++) {
    curve.getPoint(k / T, q); table[k * 3] = q.x; table[k * 3 + 1] = q.y; table[k * 3 + 2] = q.z;
    if (k) cum[k] = cum[k - 1] + Math.hypot(q.x - table[k * 3 - 3], q.y - table[k * 3 - 2], q.z - table[k * 3 - 1]);
  }
  const total = cum[T], sinkLen = lock.rootTaper ? 0 : Math.max(1e-5, total - length);
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
  // New drawn ribbons retain their creation-view broadside. The stored vector
  // is the thickness axis in the head's rest frame; projection onto each local
  // tangent plane and existing rotation-minimising transport keep a solid
  // elliptical sweep. Presets without this optional v2 field keep scalp frames.
  const facing = lock.ribbonNormal ? Float32Array.from({ length: N * 3 }, (_, i) => lock.ribbonNormal[i % 3]) : facings(lock, state);
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
  // Curls narrow the lock from where they start (ringlets are slimmer than a flat lock).
  const radii = ss.map(s => 0.5 * (turns ? w + (curlWidth(lock) - w) * curlIn(lock, Math.max(0, s) / length) : w) * profile(lock, Math.max(0, s), length));
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
  return { M, ss, line, tan, RA, SA, fit, length };
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

/** The locks' material: hair cards (hair-cards.mjs). */
export const lockMaterial = hairCardMaterial;

/**
 * The game mesh for a locks hairstyle: every lock merged into one skinned
 * mesh. `rig` (hair-rig.mjs) weights each vertex: the part resting on the head
 * like the skin under it, the free part of long locks to the hair joints.
 * Without a rig (a mesh not attached to a character) only skin weights are used.
 */
// Hair vertex budget per detail level (MetaHuman hair-card guide: LOD0, LOD1, LOD3).
const HAIR_BUDGET = { high: 30000, medium: 15000, low: 3000 };

export function locksMesh(context, state, color, rig = buildHairRig(context, state, { joints: false })) {
  let joints = [], weights = [];
  const point = new Vector3();
  const groups = hairFusionGroups(state), fused = new Set(groups.flatMap(g => g.locks));
  const lod = context.lod ?? 'high';
  const sweep = detail => {
    joints = []; weights = [];
    return state.locks.filter(lock => !fused.has(lock) && (lock.density ?? 1) > 0).map(lock => lockCard(lock, state, {
      detail,
      vertex: (x, y, z, u) => { const [j, w] = rig.weightsFor(lock, u, point.set(x, y, z)); joints.push(...j); weights.push(...w); },
    }));
  };
  const detail = lod === 'low' ? 0.3 : lod === 'medium' ? 0.45 : 0.6;
  let parts = sweep(detail);
  // Rows along a card grow with `detail`; the sunken root row and the 9 rows
  // of the tip do not. Over the level's budget, sweep once more with the
  // along-the-lock rows scaled to fit.
  const swept = parts.reduce((n, part) => n + part.pos.length / 3, 0), budget = HAIR_BUDGET[lod] ?? HAIR_BUDGET.high;
  const fixed = parts.length * 10 * 3;
  if (swept > budget && swept > fixed) parts = sweep(detail * Math.max(0.05, (budget - fixed) / (swept - fixed)));
  for (const group of groups) {
    const part = fusedHairSurface(state, group.locks, lockSurface, { group: group.id });
    // Official Three.js SkinnedMesh contract: four joint indices and weights
    // for every extracted vertex, including newly generated fusion topology.
    for (let i = 0; i < part.pos.length; i += 3) { const [j, w] = rig.weightsAt(point.fromArray(part.pos, i)); joints.push(...j); weights.push(...w); }
    parts.push(part);
  }
  const geometry = geometryFrom(parts, { skinIndex: new Uint16BufferAttribute(joints, 4), skinWeight: new Float32BufferAttribute(weights, 4) });
  const mesh = new SkinnedMesh(geometry, lockMaterial(color));
  mesh.name = 'Hair';
  mesh.userData.style = 'locks';
  if (state.fusion?.enabled) mesh.userData.fusion = { groups: groups.flatMap(g => g.ids), surfaces: parts.filter(p => p.stats).map(p => p.stats) };
  return mesh;
}

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
    // falling, it is only kept out of the body. Only the height above the
    // surface is set (along its normal), so the path never slides back in a
    // hollow such as the nape.
    if (t) {
      const height = p.clone().sub(t.point).dot(t.normal);
      if (!falling || height < lift) p.addScaledVector(t.normal, lift - height);
    }
    path.push(p);
    travelled += h;
  }
  const dense = new Float32Array(path.length * 3);
  path.forEach((q, i) => dense.set(q.toArray(), i * 3));
  const total = path.reduce((sum, q, i) => i ? sum + q.distanceTo(path[i - 1]) : 0, 0);
  const points = resamplePolyline(dense, total);
  fitLengths(points, total / (N - 1));
  lock.x.set(points); lock.rest.set(points); lock.seg = total / (N - 1);
  return lock;
}
