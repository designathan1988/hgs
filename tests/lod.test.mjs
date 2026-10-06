import test from 'node:test';
import assert from 'node:assert/strict';
import { clipNames } from '../src/motion.mjs';
import { createHuman } from '../src/human-three.mjs';

test('medium and low detail keep the rig while reducing actual triangles', async () => {
  const spec = { ageYears: 30, gender: 0.5, seed: 7 };
  const high = await createHuman({ ...spec, lod: 'high' });
  const medium = await createHuman({ ...spec, lod: 'medium' });
  const low = await createHuman({ ...spec, lod: 'low' });
  assert.ok(high.metrics.triangles > medium.metrics.triangles);
  assert.ok(medium.metrics.triangles > low.metrics.triangles);
  assert.ok(low.body.geometry.getAttribute('skinWeight'));
  assert.ok(low.body.geometry.getAttribute('uv'));
  assert.deepEqual(low.animations.map(clip => clip.name), clipNames);
  let lowDraws = 0;
  low.group.traverse(object => { if (object.isMesh) lowDraws++; });
  assert.ok(lowDraws <= 5, `low LOD uses ${lowDraws} draw calls`);
  high.dispose(); medium.dispose(); low.dispose();
});
