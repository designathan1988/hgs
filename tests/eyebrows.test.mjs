import test from 'node:test';
import assert from 'node:assert/strict';
import { createHuman } from '../src/human-three.mjs';
import { defaultCharacter, parsePreset, serializePreset } from '../src/state.mjs';
import { studioSpec } from '../src/renderer-three.mjs';

test('eyebrow settings survive presets and reach the generation API', () => {
  const fields = { browAngle: 18, browShape: 3, browArch: 0.4, browThickness: 1.6,
    browWidth: 1.2, browHeight: 0.5, browDensity: 0.7 };
  const restored = parsePreset(serializePreset({ ...defaultCharacter, ...fields }));
  for (const [name, value] of Object.entries(fields)) assert.equal(restored[name], value);
  assert.deepEqual(studioSpec(restored).eyebrows, {
    angle: 18, shape: 'angled', arch: 0.4, thickness: 1.6, width: 1.2, height: 0.5, density: 0.7,
  });
  const legacy = parsePreset('{"name":"Legacy","age":40}');
  assert.equal(legacy.browAngle, 0);
  assert.equal(legacy.browThickness, 1);
});

function roots(human) {
  const geometry = human.group.getObjectByName('Brows').geometry;
  const p = geometry.getAttribute('position'), stride = geometry.userData.strandStride;
  const out = [];
  for (let i = 0; i < p.count; i += stride) {
    let x = 0, y = 0;
    for (let k = 0; k < 4; k++) { x += p.getX(i + k); y += p.getY(i + k); }
    out.push([x / 4, y / 4]);
  }
  return out;
}

test('inclination raises the outer ends on both sides without changing eyes or body', async () => {
  const spec = { seed: 42, gender: 0, ageYears: 28 };
  const base = await createHuman(spec), tilted = await createHuman({ ...spec, eyebrows: { angle: 20 } });
  const a = roots(base), b = roots(tilted);
  for (const sign of [-1, 1]) {
    const ids = a.map((p, i) => Math.sign(p[0]) === sign ? i : -1).filter(i => i >= 0);
    const xs = ids.map(i => Math.abs(a[i][0]));
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const outer = ids.filter(i => Math.abs(a[i][0]) > mid + 0.006);
    const inner = ids.filter(i => Math.abs(a[i][0]) < mid - 0.006);
    const meanDelta = ids => ids.reduce((sum, i) => sum + b[i][1] - a[i][1], 0) / ids.length;
    assert.ok(meanDelta(outer) > meanDelta(inner) + 0.003, 'outer ends tilt upward');
  }
  assert.deepEqual(base.body.geometry.attributes.position.array, tilted.body.geometry.attributes.position.array);
  assert.deepEqual(base.group.getObjectByName('Eyes').geometry.attributes.position.array,
    tilted.group.getObjectByName('Eyes').geometry.attributes.position.array);
  assert.notDeepEqual(base.group.getObjectByName('BrowCoverage').geometry.attributes.position.array,
    tilted.group.getObjectByName('BrowCoverage').geometry.attributes.position.array);
  base.dispose(); tilted.dispose();
});

test('thickness spreads brow follicles and density can remove eyebrows entirely', async () => {
  const spec = { seed: 42, gender: 0, ageYears: 28 };
  const thin = await createHuman({ ...spec, eyebrows: { thickness: 0.4, shape: 'straight' } });
  const thick = await createHuman({ ...spec, eyebrows: { thickness: 1.8, shape: 'straight' } });
  const spread = human => {
    const points = roots(human).filter(p => p[0] > 0.028 && p[0] < 0.038);
    const ys = points.map(p => p[1]);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(spread(thick) > spread(thin) * 2, 'thickness changes the follicle distribution');
  const none = await createHuman({ ...spec, eyebrows: { density: 0 } });
  assert.equal(none.group.getObjectByName('Brows'), undefined);
  assert.equal(none.group.getObjectByName('BrowCoverage'), undefined);
  assert.ok(none.group.getObjectByName('Lashes'));
  thin.dispose(); thick.dispose(); none.dispose();
});
