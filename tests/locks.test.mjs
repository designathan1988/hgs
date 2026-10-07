import test from 'node:test';
import assert from 'node:assert/strict';
import { QuadraticBezierCurve3, Raycaster, Vector3 } from 'three';
import { createHuman } from '../src/human-three.mjs';
import {
  LOCK_POINTS as N, lockLength, lockSurface, makeLock, normalizeLocks, prepareLocks, resamplePolyline, rootFromHit,
  serializeLocks, setLockLength,
} from '../src/locks.mjs';

const human = await createHuman({ seed: 42, gender: 0, ageYears: 28, heightMeters: 1.72, hair: { style: 'none' } });
const baseIds = human.body.geometry.userData.baseIds;

/** A lock pulled from the scalp the way the editor does: from the root along the scalp towards a target. */
function pull(state, direction, flow, length) {
  const C = state.frame.C, ray = new Raycaster(), d = direction.clone().normalize();
  ray.set(C.clone().addScaledVector(d, 0.6), d.clone().negate());
  const hit = ray.intersectObject(human.body, false)[0];
  if (!hit) return null;
  const root = rootFromHit(state, [hit.face.a, hit.face.b, hit.face.c].map(v => baseIds[v]), hit.point);
  if (!root) return null;
  const lock = makeLock(state, root, null);
  const n = lock.rootN, f = flow.clone().addScaledVector(n, -flow.dot(n)).normalize();
  const end = lock.rootP.clone().addScaledVector(f, length).addScaledVector(n, 0.01);
  const control = lock.rootP.clone().addScaledVector(f, Math.min(0.04, length * 0.3)).addScaledVector(n, 0.012);
  const curve = new QuadraticBezierCurve3(lock.rootP, control, end), dense = new Float32Array(64 * 3);
  curve.getPoints(63).forEach((p, i) => dense.set(p.toArray(), i * 3));
  const points = resamplePolyline(dense, curve.getLength());
  lock.x.set(points); lock.rest.set(points); lock.old.set(points); lock.seg = curve.getLength() / (N - 1);
  state.locks.push(lock);
  return lock;
}

/** Centre parting combed to both sides, the back pulled down, curls on some locks. */
function hairstyle() {
  const state = prepareLocks(human.context, null);
  const V = (x, y, z) => new Vector3(x, y, z);
  for (const side of [1, -1]) {
    for (let k = 0; k < 7; k++) { const a = 0.55 + k / 6 * (Math.PI - 1.25); pull(state, V(0.1 * side, Math.sin(a), Math.cos(a)), V(side, -0.35, 0), 0.28); }
    for (let k = 0; k < 4; k++) { const th = Math.PI * (0.55 + 0.45 * (k + 0.5) / 4) * side; pull(state, V(Math.sin(th) * 0.9, 0.4, Math.cos(th) * 0.9), V(0.15 * side, -1, -0.25), 0.26); }
  }
  return state;
}
const settle = (state, max = 1500) => { let steps = 0; while (!state.sim.sleeping && steps < max) { state.sim.step(); steps++; } return steps; };
const maxStretch = state => {
  let worst = 0;
  for (const l of state.locks) for (let i = 1; i < N; i++) worst = Math.max(worst, Math.abs(Math.hypot(l.x[i * 3] - l.x[i * 3 - 3], l.x[i * 3 + 1] - l.x[i * 3 - 2], l.x[i * 3 + 2] - l.x[i * 3 - 1]) / l.seg - 1));
  return worst;
};

test('gravity settles a hairstyle onto the head: no stretching, nothing inside the body, at rest in bounded time', () => {
  const state = hairstyle();
  assert.ok(state.locks.length >= 20, `${state.locks.length} locks pulled`);
  const steps = settle(state);
  assert.ok(state.sim.sleeping, `asleep after ${steps} steps`);
  assert.ok(steps < 900, `settled in ${steps} steps (< 15 s)`);
  assert.ok(maxStretch(state) < 1e-3, `segment length error ${(maxStretch(state) * 100).toFixed(3)}%`);
  const hit = {};
  for (const l of state.locks) for (let i = 2; i < N; i++) {
    if (!state.collider.head.closest(l.x[i * 3], l.x[i * 3 + 1], l.x[i * 3 + 2], 0.05, hit)) continue;
    assert.ok(hit.distance > 0, `lock point ${i} is outside the body (${hit.distance.toFixed(4)} m)`);
  }
  // Roots stay where they were pulled from.
  for (const l of state.locks) assert.ok(new Vector3().fromArray(l.x, 0).distanceTo(l.rootP) < 1e-6);
});

test('curled locks also come to rest (no endless trembling)', () => {
  const state = hairstyle();
  settle(state);
  state.locks.forEach((l, k) => { if (k % 3 === 0) { l.curl = 0.85; l.turns = 5; } });
  state.sim.wake();
  const steps = settle(state);
  assert.ok(state.sim.sleeping, `curled hairstyle asleep after ${steps} steps`);
  assert.ok(maxStretch(state) < 1e-3);
});

test('the settled shape set as rest holds against gravity and springs back after a pull', () => {
  const state = hairstyle();
  settle(state);
  for (const l of state.locks) { l.rest.set(l.x); l.styled = true; }
  const snapshot = state.locks.map(l => Float32Array.from(l.x));
  state.sim.wake(); settle(state);
  let drift = 0;
  state.locks.forEach((l, k) => { for (let i = 0; i < N * 3; i++) drift = Math.max(drift, Math.abs(l.x[i] - snapshot[k][i])); });
  assert.ok(drift < 0.002, `styled hairstyle drifted ${(drift * 1000).toFixed(2)} mm`);
  const lock = state.locks[3];
  for (let i = 2; i < N; i++) lock.x[i * 3] += 0.04 * i / N;
  state.sim.wake(); settle(state);
  let back = 0;
  for (let i = 0; i < N * 3; i++) back = Math.max(back, Math.abs(lock.x[i] - snapshot[3][i]));
  assert.ok(back < 0.003, `returned within ${(back * 1000).toFixed(2)} mm`);
});

test('cut and lengthen keep the root, the segment count and exact lengths', () => {
  const state = hairstyle();
  settle(state);
  const lock = state.locks[0], root = new Vector3().fromArray(lock.x, 0);
  setLockLength(lock, 0.12);
  assert.ok(Math.abs(lockLength(lock) - 0.12) < 1e-6);
  setLockLength(lock, 0.4);
  assert.ok(Math.abs(lockLength(lock) - 0.4) < 1e-6);
  assert.ok(new Vector3().fromArray(lock.x, 0).distanceTo(root) < 1e-9);
  assert.ok(maxStretch({ locks: [lock] }) < 1e-4);
});

test('save and load preserve geometry, roots and settings', () => {
  const state = hairstyle();
  settle(state);
  Object.assign(state.locks[1], { width: 0.041, volume: 0.55, taper: 0.4, curl: 0.6, turns: 6, twist: 1.2, stiffness: 0.7, styled: true });
  state.locks[2].pins.set(10, new Vector3().fromArray(state.locks[2].x, 30));
  const saved = JSON.parse(JSON.stringify(serializeLocks(state)));
  const loaded = prepareLocks(human.context, normalizeLocks(saved));
  assert.equal(loaded.locks.length, state.locks.length);
  loaded.locks.forEach((l, k) => {
    const o = state.locks[k];
    assert.deepEqual(l.root.v, o.root.v);
    for (let i = 0; i < N * 3; i++) assert.ok(Math.abs(l.x[i] - o.x[i]) < 2e-5, 'pose kept');
    for (const key of ['width', 'volume', 'taper', 'curl', 'turns', 'twist', 'stiffness']) assert.ok(Math.abs(l[key] - o[key]) < 1e-3, key);
    assert.equal(l.styled, o.styled);
    assert.equal(l.pins.size, o.pins.size);
  });
  // Saving the loaded hairstyle gives the same file (within the 0.01 mm storage rounding).
  const again = serializeLocks(loaded);
  again.locks.forEach((l, k) => {
    const o = saved.locks[k];
    assert.deepEqual(l.r, o.r);
    for (const key of ['p', 'q']) l[key].forEach((v, i) => assert.ok(Math.abs(v - o[key][i]) < 3e-5, key));
    for (const key of ['w', 'vo', 'ta', 'cu', 'tu', 'tw', 'st', 'sy']) assert.equal(l[key], o[key], key);
    assert.deepEqual(l.pins.map(p => p[0]), o.pins.map(p => p[0]));
  });
});

test('lock meshes are closed, smooth tubes whose faces point outwards', () => {
  const state = hairstyle();
  settle(state);
  state.locks[0].curl = 0.8; state.locks[1].twist = 3;
  for (const lock of state.locks.slice(0, 6)) {
    const s = lockSurface(lock, state);
    let good = 0, bad = 0;
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
    for (let t = 0; t < s.index.length; t += 3) {
      a.fromArray(s.pos, s.index[t] * 3); b.fromArray(s.pos, s.index[t + 1] * 3); c.fromArray(s.pos, s.index[t + 2] * 3);
      const face = b.sub(a).cross(c.sub(a));
      if (face.lengthSq() < 1e-16) continue;
      n.fromArray(s.normal, s.index[t] * 3).add(new Vector3().fromArray(s.normal, s.index[t + 1] * 3)).add(new Vector3().fromArray(s.normal, s.index[t + 2] * 3));
      if (face.dot(n) > 0) good++; else bad++;
    }
    // Only the few faces buried at the root (inside the scalp) may disagree.
    assert.ok(bad / (good + bad) < 0.012, `${bad} of ${good + bad} faces inverted`);
    assert.ok(s.pos.every(Number.isFinite) && s.normal.every(Number.isFinite));
  }
});
