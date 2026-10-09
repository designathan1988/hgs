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
  const ray = new Raycaster(), eyes = human.group.getObjectByName('Eyes');
  const roots = [];
  for (let i = 0; i < p.count; i += stride) {
    const root = new Vector3();
    for (let k = 0; k < 4; k++) root.add(new Vector3().fromBufferAttribute(p, i + k));
    roots.push(root.multiplyScalar(0.25));
  }
  // Lashes grow from the lid margin, where the skin meets the eye (AAO: the mucocutaneous margin). A root
  // is there when it sits on the skin and, 1 mm further towards the middle of the eye, the eye is
  // already uncovered. (The lid's own thickness, 1.6–2.5 mm in the base mesh, is not the lash's business.)
  const hit = (x, y, object) => { ray.set(new Vector3(x, y, 1), new Vector3(0, 0, -1)); return ray.intersectObject(object, false)[0]?.point; };
  let measured = 0, onRim = 0;
  for (const side of [1, -1]) {
    const own = roots.filter(root => Math.sign(root.x) === side), middle = own.reduce((sum, root) => sum + root.y, 0) / own.length;
    for (const root of own) {
      const skin = hit(root.x, root.y, human.body);
      if (!skin) continue;
      measured++;
      const y = root.y + (root.y > middle ? -0.001 : 0.001), eye = hit(root.x, y, eyes), lid = hit(root.x, y, human.body);
      if (Math.abs(root.z - skin.z) < 0.0005 && eye && (!lid || lid.z < eye.z + 0.0002)) onRim++;
    }
  }
  assert.ok(measured > 30, 'roots can be compared with the real eye and skin surfaces');
  assert.ok(onRim / measured > 0.9, `${Math.round(onRim / measured * 100)}% of follicles are on the lid margin; expected >90%`);
  human.dispose();
});
