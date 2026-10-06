import test from 'node:test';
import assert from 'node:assert/strict';
import { createHuman } from '../src/human-three.mjs';

test('hair lighting remains continuous across duplicated UV seam vertices', async () => {
  const human = await createHuman({ hair: { style: 'toigo_curled_under_bob', length: 1.2 } });
  const geometry = human.group.getObjectByName('Hair').geometry;
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
  const seen = new Map();
  let checked = 0;
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e6)).join(',');
    if (seen.has(key)) {
      const j = seen.get(key);
      const gap = Math.hypot(n.getX(i) - n.getX(j), n.getY(i) - n.getY(j), n.getZ(i) - n.getZ(j));
      assert.ok(gap < 0.02, `normal discontinuity ${gap.toFixed(3)} at hair seam`);
      checked++;
    } else seen.set(key, i);
  }
  assert.ok(checked > 5, 'checked real texture seams');
  human.dispose();
});
