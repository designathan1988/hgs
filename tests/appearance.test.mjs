import test from 'node:test';
import assert from 'node:assert/strict';
import { createHuman, registerHairStyle, registerClothingStyle } from '../src/human-three.mjs';
import { Group } from 'three';

test('an adult can be dressed with fitted hair, eyes, clothing and shoes', async () => {
  const human = await createHuman({
    ageYears: 30, gender: 0.8,
    hair: { style: 'short01', length: 1.1, volume: 0.2 },
    clothing: { style: 'male_worksuit01', color: '#365372' },
    shoes: 'shoes01',
  });
  for (const name of ['Eyes', 'Brows', 'Lashes', 'Hair', 'Outfit', 'Shoes']) {
    assert.ok(human.group.getObjectByName(name)?.isSkinnedMesh, `${name} is rigged`);
  }
  // The MakeHuman eyes proxy is textured through its UV; the iris texture is made on the page (Node keeps its recipe).
  const eyes = human.group.getObjectByName('Eyes');
  assert.ok(eyes.geometry.getAttribute('uv'), 'eyes carry the proxy UV for the iris texture');
  assert.ok(Number.isFinite(eyes.material.userData.hgsEyeTexture?.color), 'iris colour is recorded for the texture');
  assert.ok(human.group.getObjectByName('IrisLeft'));
  assert.ok(human.group.getObjectByName('IrisRight'));
  const iris = human.group.getObjectByName('IrisLeft').geometry.getAttribute('position');
  let front = Infinity, back = -Infinity;
  for (let i = 0; i < iris.count; i++) { front = Math.min(front, iris.getZ(i)); back = Math.max(back, iris.getZ(i)); }
  assert.ok(back - front > 0.0002, 'iris follows the curved eyeball surface');
  human.dispose();
});

test('hair cards with gaps have a feathered scalp underlay', async () => {
  const human = await createHuman({ ageYears: 30, hair: { style: 'long01' } });
  const scalp = human.group.getObjectByName('ScalpUnderlay');
  assert.ok(scalp?.isSkinnedMesh);
  const color = scalp.geometry.getAttribute('color');
  assert.equal(color.itemSize, 4);
  const alphas = Array.from({ length: color.count }, (_, i) => color.getW(i));
  assert.ok(alphas.some(a => a > 0.9) && alphas.some(a => a < 0.1));
  human.dispose();
});

test('a child gets age-fitted garments without an adult outfit proxy', async () => {
  const human = await createHuman({ ageYears: 8, gender: 0.3 });
  assert.ok(human.group.getObjectByName('ChildTop')?.isSkinnedMesh);
  assert.ok(human.group.getObjectByName('ChildBottom')?.isSkinnedMesh);
  assert.equal(human.group.getObjectByName('Outfit'), undefined);
  human.dispose();
});

test('new hair and clothing models can be registered through code', async () => {
  registerHairStyle('test-braid', () => { const result = new Group(); result.name = 'CustomHair'; return result; });
  registerClothingStyle('test-coat', () => { const result = new Group(); result.name = 'CustomCoat'; return result; });
  const human = await createHuman({ hair: { style: 'test-braid' }, clothing: { style: 'test-coat' } });
  assert.ok(human.group.getObjectByName('CustomHair'));
  assert.ok(human.group.getObjectByName('CustomCoat'));
  human.dispose();
});

test('eyebrow color follows the chosen hair color', async () => {
  const dark = await createHuman({ hairColor: 0x2a1d16 });
  const light = await createHuman({ hairColor: 0xb98a56 });
  assert.notEqual(dark.group.getObjectByName('Brows').material.color.getHex(),
    light.group.getObjectByName('Brows').material.color.getHex());
  dark.dispose(); light.dispose();
});

test('hair length changes the ends without moving the hairline', async () => {
  const short = await createHuman({ hair: { style: 'toigo_curled_under_bob', length: 0.7 } });
  const long = await createHuman({ hair: { style: 'toigo_curled_under_bob', length: 1.5 } });
  const a = short.group.getObjectByName('Hair').geometry.getAttribute('position');
  const b = long.group.getObjectByName('Hair').geometry.getAttribute('position');
  let top = -Infinity, bottomA = Infinity, bottomB = Infinity;
  for (let i = 0; i < a.count; i++) {
    top = Math.max(top, a.getY(i));
    bottomA = Math.min(bottomA, a.getY(i)); bottomB = Math.min(bottomB, b.getY(i));
  }
  let hairlineMoved = false;
  for (let i = 0; i < a.count; i++) if (a.getY(i) > top - 0.03 && Math.abs(a.getY(i) - b.getY(i)) > 0.002) hairlineMoved = true;
  assert.equal(hairlineMoved, false);
  assert.ok(bottomB < bottomA - 0.02);
  short.dispose(); long.dispose();
});
