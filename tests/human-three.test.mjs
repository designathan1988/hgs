import test from 'node:test';
import assert from 'node:assert/strict';
import { clipNames } from '../src/motion.mjs';
import { createHuman } from '../src/human-three.mjs';

test('creates a continuous, rigged human body with a human height', async () => {
  const human = await createHuman({ seed: 42, ageYears: 30, gender: 0.5 });
  assert.ok(human.body.isSkinnedMesh);
  assert.ok(human.body.geometry.getAttribute('position').count > 10000);
  assert.ok(human.body.geometry.getAttribute('skinIndex'));
  assert.ok(human.body.geometry.getAttribute('skinWeight'));
  assert.ok(human.body.geometry.index.count > 30000);
  assert.ok(human.metrics.height > 1.3 && human.metrics.height < 2.2);
  assert.deepEqual(human.animations.map(clip => clip.name), clipNames);
  assert.ok(human.animations.every(clip => clip.validate()));
  const idleArm = human.animations[0].tracks.find(track => track.name === 'upperarm_l.quaternion');
  assert.ok(idleArm);
  assert.ok(Math.abs(idleArm.values[2]) > 0.05);
  human.dispose();
});

test('the same seed and parameters produce the same geometry', async () => {
  const spec = { seed: 12, ageYears: 8, gender: 0.25, features: { 'nose-scale-depth-decr-incr': 0.5 } };
  const a = await createHuman(spec);
  const b = await createHuman(spec);
  assert.deepEqual(a.body.geometry.getAttribute('position').array, b.body.geometry.getAttribute('position').array);
  a.dispose();
  b.dispose();
});

test('different seeds create different body and face geometry', async () => {
  const a = await createHuman({ seed: 101, ageYears: 30 });
  const b = await createHuman({ seed: 102, ageYears: 30 });
  const left = a.body.geometry.getAttribute('position').array;
  const right = b.body.geometry.getAttribute('position').array;
  assert.ok(left.some((value, i) => Math.abs(value - right[i]) > 1e-5));
  a.dispose();
  b.dispose();
});
