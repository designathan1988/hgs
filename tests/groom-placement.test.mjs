import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { createHuman } from '../src/human-three.mjs';

test('eyelash follicles sit at the eye/eyelid junction rather than the eyelid crease', async () => {
  const human = await createHuman({ seed: 42, gender: 0, ageYears: 28, heightMeters: 1.72 });
  human.group.updateMatrixWorld(true);
  const lashes = human.group.getObjectByName('Lashes').geometry;
  const p = lashes.getAttribute('position');
  const stride = lashes.userData.strandStride ?? 5;
  const ray = new Raycaster();
  const gaps = [];
  for (let i = 0; i < p.count; i += stride) {
    const root = new Vector3();
    for (let k = 0; k < 4; k++) root.add(new Vector3().fromBufferAttribute(p, i + k));
    root.multiplyScalar(0.25);
    ray.set(new Vector3(root.x, root.y, 1), new Vector3(0, 0, -1));
    const eye = ray.intersectObject(human.group.getObjectByName('Eyes'), false)[0];
    const lid = ray.intersectObject(human.body, false)[0];
    if (eye && lid) gaps.push(Math.abs(eye.point.z - lid.point.z));
  }
  assert.ok(gaps.length > 30, 'roots can be compared with the real eye and skin surfaces');
  const nearRim = gaps.filter(gap => gap < 0.0015).length / gaps.length;
  assert.ok(nearRim > 0.9, `${Math.round(nearRim * 100)}% of follicles are on the rim; expected >90%`);
  human.dispose();
});
