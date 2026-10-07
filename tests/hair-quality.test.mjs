import test from 'node:test';
import assert from 'node:assert/strict';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { createHuman } from '../src/human-three.mjs';
import { hairPresets } from '../src/hair-presets.mjs';
import { LOCK_POINTS as N, geometryFrom, lockSurface, prepareLocks } from '../src/locks.mjs';

// The ready-made styles, checked on the character and outfit they were
// authored on (tools/author-hair-presets.mjs) with measurable criteria
// instead of by eye. They are loaded the way the studio loads them: gravity
// hangs the free locks on this body.
const human = await createHuman({ seed: 42, gender: 0, ageYears: 28, heightMeters: 1.72, hair: { style: 'none' }, clothing: { style: 'female_casualsuit01' } });
const styles = hairPresets.filter(p => p.data);

function load(preset) {
  const state = prepareLocks(human.context, preset.data);
  state.sim.apply();
  const parts = state.locks.map(lock => lockSurface(lock, state));
  const mesh = new Mesh(geometryFrom(parts), new MeshBasicMaterial({ side: DoubleSide }));
  return { state, parts, mesh };
}

test('every style is at rest: loads as saved, applying gravity again changes nothing, lengths exact, nothing inside the body', () => {
  for (const preset of styles) {
    const { state } = load(preset);
    // Loading hangs the saved design: the same hair as when it was saved (to the file's 0.01 mm rounding).
    const saved = prepareLocks(human.context, preset.data);
    let off = 0;
    state.locks.forEach((l, k) => { for (let i = 0; i < N * 3; i++) off = Math.max(off, Math.abs(l.x[i] - saved.locks[k].x[i])); });
    assert.ok(off < 2e-4, `${preset.id}: loaded hair differs from the saved by ${(off * 1000).toFixed(3)} mm`);
    const before = state.locks.map(l => Float32Array.from(l.x));
    state.sim.apply();
    state.locks.forEach((l, k) => { for (let i = 0; i < N * 3; i++) assert.equal(l.x[i], before[k][i], `${preset.id}: gravity moved a lock`); });
    for (const l of state.locks) for (let i = 1; i < N; i++) {
      const d = Math.hypot(l.x[i * 3] - l.x[i * 3 - 3], l.x[i * 3 + 1] - l.x[i * 3 - 2], l.x[i * 3 + 2] - l.x[i * 3 - 1]);
      // 0.1%, or the 0.01 mm the file stores each coordinate to (short segments).
      assert.ok(Math.abs(d - l.seg) < Math.max(1e-3 * l.seg, 2e-5), `${preset.id}: segment stretched ${((d / l.seg - 1) * 100).toFixed(3)}%`);
    }
    const hit = {};
    for (const l of state.locks) for (let i = 2; i < N; i++) {
      if (!state.collider.head.closest(l.x[i * 3], l.x[i * 3 + 1], l.x[i * 3 + 2], 0.05, hit)) continue;
      assert.ok(hit.distance > 0, `${preset.id}: lock point inside the body (${(hit.distance * 1000).toFixed(1)} mm)`);
    }
  }
});

test('every style covers the scalp: rays towards it meet hair first (no gaps, no open parting)', () => {
  const ray = new Raycaster();
  for (const preset of styles) {
    const { state, mesh } = load(preset);
    const { positions: P, normals: n, field } = state;
    let total = 0, covered = 0;
    for (let v = 0; v < field.length; v++) {
      if (!(field[v] > 0.05)) continue;
      const p = new Vector3().fromArray(P, v * 3), dir = new Vector3().fromArray(n, v * 3);
      ray.set(p.clone().addScaledVector(dir, 0.25), dir.clone().negate());
      ray.far = 0.25 - 0.0005;
      total++;
      if (ray.intersectObject(mesh, false).length) covered++;
    }
    assert.ok(covered / total >= 0.97, `${preset.id}: ${(covered / total * 100).toFixed(1)}% of the scalp covered`);
  }
});

test('no style hangs over the face (between the chin and the eyebrows)', () => {
  for (const preset of styles) {
    const { state, parts } = load(preset);
    const { C } = state.frame;
    let inside = 0;
    for (const part of parts) for (let k = 0; k < part.pos.length; k += 3) {
      const x = part.pos[k], y = part.pos[k + 1] - C.y, z = part.pos[k + 2] - C.z;
      if (Math.abs(x) < 0.045 && y > -0.12 && y < 0.005 && z > 0.06) inside++;
    }
    assert.equal(inside, 0, `${preset.id}: ${inside} hair vertices in front of the face`);
  }
});

test('every style lies close to the head at the temples (no mushroom)', () => {
  for (const preset of styles) {
    const { state, parts } = load(preset);
    const { C } = state.frame, hit = {}, limit = preset.id === 'cacheado' || preset.id === 'ondulado' ? 0.07 : 0.045;
    let worst = 0;
    for (const part of parts) for (let k = 0; k < part.pos.length; k += 3) {
      const y = part.pos[k + 1] - C.y;
      if (y < -0.02 || y > 0.06) continue;
      if (!state.collider.head.closest(part.pos[k], part.pos[k + 1], part.pos[k + 2], 0.12, hit)) { worst = Infinity; continue; }
      worst = Math.max(worst, hit.distance);
    }
    assert.ok(worst <= limit, `${preset.id}: hair ${(worst * 100).toFixed(1)} cm from the head at the temples (limit ${limit * 100} cm)`);
  }
});
