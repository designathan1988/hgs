// Builds the ready-made hairstyles (src/hair-presets.mjs) with the same lock
// tools the editor uses: locks combed over the scalp on one direction field
// (mirrored across the parting), hung by the gravity operator, cut level and
// hung again. They are saved free (not set), so they hang on any body.
// Run with: node tools/author-hair-presets.mjs
import { writeFileSync } from 'node:fs';
import { QuadraticBezierCurve3, Raycaster, Vector3 } from 'three';
import { createHuman } from '../src/human-three.mjs';
import { LOCK_POINTS as N, combLock, makeLock, prepareLocks, resamplePolyline, rootFromHit, serializeLocks, setLockLength } from '../src/locks.mjs';

// The studio's default character and outfit: hair that reaches the shoulders lies on the clothes.
const human = await createHuman({ seed: 42, gender: 0, ageYears: 28, heightMeters: 1.72, hair: { style: 'none' }, clothing: { style: 'female_casualsuit01' } });
const baseIds = human.body.geometry.userData.baseIds;
const V = (x, y, z) => new Vector3(x, y, z);

function rootAt(state, direction) {
  const C = state.frame.C, d = direction.clone().normalize(), ray = new Raycaster();
  ray.set(C.clone().addScaledVector(d, 0.6), d.clone().negate());
  const hit = ray.intersectObject(human.body, false)[0];
  if (!hit) return null;
  return rootFromHit(state, [hit.face.a, hit.face.b, hit.face.c].map(v => baseIds[v]), hit.point);
}

/** One lock pulled from the root under `direction` towards `flow` (as the editor's Pull tool lays it out). */
function pullOne(state, direction, flow, length, params) {
  const root = rootAt(state, direction);
  if (!root) return null;
  const lock = makeLock(state, root, null, params);
  const n = lock.rootN, f = flow.clone().normalize();
  f.addScaledVector(n, -f.dot(n)).normalize();
  const end = lock.rootP.clone().addScaledVector(f, length).addScaledVector(n, 0.01);
  const chord = end.clone().sub(lock.rootP), along = chord.clone().addScaledVector(n, -chord.dot(n)).normalize();
  const control = lock.rootP.clone().addScaledVector(along, Math.min(0.04, length * 0.3)).addScaledVector(n, Math.min(0.012, length * 0.12));
  const curve = new QuadraticBezierCurve3(lock.rootP, control, end), dense = new Float32Array(64 * 3);
  curve.getPoints(63).forEach((p, i) => dense.set(p.toArray(), i * 3));
  const total = curve.getLength(), points = resamplePolyline(dense, total);
  lock.x.set(points); lock.rest.set(points); lock.seg = total / (N - 1);
  state.locks.push(lock);
  return lock;
}
/** Comb a lock from the root under `direction` (the hair brush's own combing). */
function combOne(state, direction, flow, length, params) {
  const root = rootAt(state, direction);
  if (!root) return null;
  const lock = combLock(state, root, flow, length, params);
  state.locks.push(lock);
  return lock;
}
/** Comb a lock and its mirror image across the parting. */
function comb(state, direction, flow, length, params = {}, options = {}, mirror = true) {
  const made = [combOne(state, direction, flow, length, params, options)];
  if (mirror && Math.abs(direction.x) > 1e-3) made.push(combOne(state, V(-direction.x, direction.y, direction.z), V(-flow.x, flow.y, flow.z), length, params, options));
  return made.filter(Boolean);
}

/** Pull a lock and its mirror image across the parting (x = 0). */
function pull(state, direction, flow, length, params = {}, mirror = true) {
  const made = [pullOne(state, direction, flow, length, params)];
  if (mirror && Math.abs(direction.x) > 1e-3) made.push(pullOne(state, V(-direction.x, direction.y, direction.z), V(-flow.x, flow.y, flow.z), length, params));
  return made.filter(Boolean);
}
/** Gravity (one pass, lowest roots laid first). */
const settle = state => state.sim.apply();
/** Scissors along a horizontal plane: every lock (of `which`) is cut where it first goes below y. */
function cutBelow(state, y, which = state.locks) {
  for (const lock of which) {
    for (let i = 1; i < N; i++) {
      const a = lock.x[i * 3 - 2], b = lock.x[i * 3 + 1];
      if (b >= y) continue;
      const t = a > y ? (a - y) / (a - b) : 0;
      setLockLength(lock, Math.max(0.03, (i - 1 + t) * lock.seg));
      break;
    }
  }
}

/**
 * Centre parting: two rows per side combed to that side (the first right
 * at the parting, so it closes into a thin line), the back pulled down and
 * the front hairline swept back. Thin, wide locks overlap like shingles.
 */
const base = { width: 0.055, volume: 0.12, stiffness: 0.5 };
/**
 * One combing direction field for the whole head, so neighbouring locks run
 * almost parallel (no weave): away from the parting to the side, down, and
 * further back the nearer the root is to the face (around the temples to
 * behind the ears).
 */
function flowAt(d, side) {
  const front = Math.max(0, d.z / d.length());
  return V(side, -0.6, -0.25 - 0.95 * front);
}
function parted(state, length, extra = {}) {
  const params = { ...base, ...extra };
  // The parting: from each point on the midline one lock is combed to each
  // side, so the two halves meet with no open valley between them.
  for (let k = 0; k < 10; k++) {
    const t = k / 9, a = 0.48 + t * (Math.PI - 1.1), d = V(0, Math.sin(a), Math.cos(a));
    for (const side of [1, -1]) comb(state, d, flowAt(d, side), length, params, {}, false);
  }
  for (let k = 0; k < 9; k++) {
    const t = k / 8, a = 0.62 + t * (Math.PI - 1.37), d = V(0.33, Math.sin(a), Math.cos(a));
    comb(state, d, flowAt(d, 1), length * 0.97, params);
  }
  for (const [el, count] of [[0.5, 4], [0.15, 4]]) for (let k = 0; k < count; k++) {
    const th = Math.PI * (0.58 + 0.42 * (k + 0.5) / count);
    comb(state, V(Math.sin(th) * Math.cos(el), Math.sin(el), Math.cos(th) * Math.cos(el)), V(0.15, -1, -0.3), length * 0.92, params);
  }
  for (const el of [0.6, 0.33, 0.06]) comb(state, V(0, Math.sin(el), -Math.cos(el)), V(0, -1, -0.3), length * 0.92, params, {}, false);
  // Front hairline, on the same field (back over the temples).
  for (const th of [0.3, 0.55, 0.8]) {
    const d = V(Math.sin(th) * Math.cos(0.42), Math.sin(0.42), Math.cos(th) * Math.cos(0.42));
    comb(state, d, flowAt(d, 1), length * 0.86, params);
  }
}

const presets = [];
function save(id, name, build) {
  const state = prepareLocks(human.context, null);
  build(state);
  const data = serializeLocks(state);
  presets.push({ id, name, data });
  console.log(id.padEnd(10), `${state.locks.length} mechas`);
}
const C = (() => prepareLocks(human.context, null).frame.C)();

save('longo', 'Longo', state => {
  // Wide to the tips, so the long locks close into one sheet.
  parted(state, 0.34, { taper: 0.7 });
  settle(state); cutBelow(state, C.y - 0.33); settle(state);
});
save('chanel', 'Chanel', state => {
  parted(state, 0.24, { taper: 0.75 });
  settle(state); cutBelow(state, C.y - 0.125); settle(state);
});
save('franja', 'Franja', state => {
  parted(state, 0.24, { taper: 0.75 });
  settle(state); cutBelow(state, C.y - 0.125);
  // Bangs: locks from the front of the head combed forward over the forehead.
  const bangs = [];
  for (const [x, a] of [[0.05, 0.62], [0.2, 0.62], [0.35, 0.58], [0.1, 0.8], [0.3, 0.78]]) {
    bangs.push(...comb(state, V(x, Math.sin(a), Math.cos(a)), V(0.2 * Math.sign(x), -0.4, 1), 0.16, { ...base, width: 0.045, taper: 0.7 }));
  }
  // Cut just above the eyebrows.
  settle(state); cutBelow(state, C.y + 0.014, bangs); settle(state);
});
save('curto', 'Curto', state => {
  // Combed back over the scalp; every row covers the roots behind it.
  const params = { ...base, taper: 0.9, stiffness: 0.85 };
  // The last rows cover the nape (roots exist only on the scalp, so they start behind the ears).
  for (const [el, count, length] of [[1.3, 6, 0.17], [0.98, 12, 0.15], [0.7, 16, 0.12], [0.44, 20, 0.1], [0.16, 20, 0.075], [-0.14, 18, 0.06], [-0.36, 14, 0.05]]) {
    for (let k = 0; k < count; k++) {
      const th = (k + (el > 1 ? 0.5 : 0)) / count * Math.PI * 2;
      const d = V(Math.sin(th) * Math.cos(el), Math.sin(el), Math.cos(th) * Math.cos(el));
      const front = Math.cos(th) > 0.45;
      const flow = el > 0.75 || front ? V(Math.sin(th) * 0.25, front ? 0.4 : -0.2, -1) : V(Math.sin(th) * 0.3, -1, -0.6);
      comb(state, d, flow, length, params, {}, false);
    }
  }
  settle(state);
});
save('ondulado', 'Ondulado', state => {
  parted(state, 0.3, { curl: 0.35, turns: 2.5 });
  settle(state); cutBelow(state, C.y - 0.24); settle(state);
});
save('cacheado', 'Cacheado', state => {
  parted(state, 0.32, { curl: 0.85, turns: 4.5, volume: 0.16 });
  settle(state);
});
presets.push({ id: 'careca', name: 'Careca', data: null });

const body = presets.map(p => `  { id: '${p.id}', name: '${p.name}', data: ${p.data ? JSON.stringify(p.data) : 'null'} },`).join('\n');
writeFileSync(new URL('../src/hair-presets.mjs', import.meta.url), `// Ready-made mesh-lock hairstyles. Generated by tools/author-hair-presets.mjs
// (locks combed over the scalp, hung by gravity and cut; gravity is applied
// again wherever they are loaded, so they rest on any body and outfit);
// regenerate with \`node tools/author-hair-presets.mjs\` instead of editing.
export const hairPresets = [
${body}
];
export const hairPresetIds = hairPresets.map(p => p.id);
/** Saved locks data of a preset (null for bald or an unknown id). */
export const hairPresetData = id => hairPresets.find(p => p.id === id)?.data ?? null;
`);
console.log('src/hair-presets.mjs written');
