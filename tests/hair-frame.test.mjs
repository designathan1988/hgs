import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { lockSurface, LOCK_POINTS as N } from '../src/locks.mjs';

test('a tiny direction change near the scalp normal cannot rotate the whole curl to the opposite side', () => {
  const state = { frame: { C: new Vector3(), R: .11 }, collider: null };
  const surface = epsilon => {
    const rootP = new Vector3(0, .3, 0), direction = new Vector3(epsilon, 1, 0).normalize(), designed = new Vector3(1, .2, 0).normalize();
    const x = new Float32Array(N * 3), rest = new Float32Array(N * 3), seg = .2 / (N - 1);
    for (let i = 0; i < N; i++) {
      x.set(rootP.clone().addScaledVector(direction, i * seg).toArray(), i * 3);
      rest.set(rootP.clone().addScaledVector(designed, i * seg).toArray(), i * 3);
    }
    return lockSurface({ rootP, rootN: new Vector3(0, 1, 0), root: { v: [0, 1, 2], w: [1, 0, 0] }, x, rest, seg, facing: new Float32Array(N * 3), width: .012, volume: .3, taper: .8, curl: 1, turns: 3, twist: 0, tipShape: 'point', rootTaper: true }, state);
  };
  const a = surface(-.00001), b = surface(.00001);
  assert.equal(a.pos.length, b.pos.length);
  let difference = 0;
  for (let i = 0; i < a.pos.length; i++) difference = Math.max(difference, Math.abs(a.pos[i] - b.pos[i]));
  assert.ok(difference < .0001, `4 micrometres of guide movement changed the curl by ${difference * 1000} mm`);
});
