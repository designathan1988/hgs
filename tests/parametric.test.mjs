import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHumanData, shapeHuman } from '../src/parametric.mjs';

const assets = await loadHumanData();
const adult = { ageYears: 30, gender: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, features: {} };

test('real mesh is deterministic and changes with a nose parameter', () => {
  const first = shapeHuman(assets, adult);
  const repeated = shapeHuman(assets, adult);
  const changed = shapeHuman(assets, {
    ...adult, features: { 'nose-scale-depth-decr-incr': 0.8 },
  });
  assert.equal(first.length, 19158 * 3);
  assert.deepEqual(first, repeated);
  assert.ok(first.every(Number.isFinite));
  assert.ok(changed.some((value, i) => Math.abs(value - first[i]) > 1e-5));
});

test('age and stature produce distinct human proportions', () => {
  const child = shapeHuman(assets, { ...adult, ageYears: 8 });
  const tall = shapeHuman(assets, { ...adult, height: 0.9 });
  assert.ok(child.some((value, i) => Math.abs(value - tall[i]) > 1e-4));
  const range = positions => {
    let low = Infinity, high = -Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      low = Math.min(low, positions[i]);
      high = Math.max(high, positions[i]);
    }
    return high - low;
  };
  assert.ok(range(child) < range(tall));
});

test('requested adult and child heights are measured from the body surface', () => {
  for (const [ageYears, heightMeters] of [[30, 1.72], [8, 1.28]]) {
    const positions = shapeHuman(assets, { ageYears, heightMeters });
    let low = Infinity, high = -Infinity;
    for (const [a, b] of assets.bodyRange) for (let v = a; v <= b; v++) {
      low = Math.min(low, positions[v * 3 + 1]);
      high = Math.max(high, positions[v * 3 + 1]);
    }
    assert.ok(Math.abs(high - low - heightMeters) < 0.005);
  }
});
