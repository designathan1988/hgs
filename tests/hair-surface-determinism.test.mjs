import test from 'node:test';
import assert from 'node:assert/strict';
import { createHuman } from '../src/human-three.mjs';
import { prepareLocks, lockSurface } from '../src/locks.mjs';
import { hairPresetData } from '../src/hair-presets.mjs';

test('the complete hairstyle surface depends on its current pose, not intermediate geometry evaluations', async () => {
  const human = await createHuman({ seed: 42, hair: { style: 'none' }, clothing: { style: 'none' } });
  try {
    const cached = prepareLocks(human.context, hairPresetData('chanel'));
    const fresh = prepareLocks(human.context, hairPresetData('chanel'));
    cached.sim.apply(); fresh.sim.apply();
    for (const lock of cached.locks) lockSurface(lock, cached);
    for (const state of [cached, fresh]) for (const lock of state.locks) {
      for (let i = 3; i < lock.x.length; i += 3) lock.x[i] += .0008;
    }
    let maximum = 0;
    for (let i = 0; i < cached.locks.length; i++) {
      const a = lockSurface(cached.locks[i], cached), b = lockSurface(fresh.locks[i], fresh);
      assert.equal(a.pos.length, b.pos.length);
      for (let v = 0; v < a.pos.length; v++) maximum = Math.max(maximum, Math.abs(a.pos[v] - b.pos[v]));
    }
    assert.ok(maximum < 1e-7, `Same authored pose produced different surfaces: ${maximum * 1000} mm`);
  } finally { human.dispose(); }
});
