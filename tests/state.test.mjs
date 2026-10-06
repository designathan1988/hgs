import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCharacter, randomCharacter, normalizeCharacter, serializePreset, parsePreset, ageHeightReference } from '../src/state.mjs';

test('the same seed produces the same complete person', () => {
  const first = randomCharacter(1447);
  assert.deepEqual(first, randomCharacter(1447));
  assert.notDeepEqual(first, randomCharacter(1448));
  for (const key of ['age', 'height', 'build', 'skin', 'hairStyle', 'hairColor', 'eyeColor', 'outfit', 'expression']) {
    assert.ok(key in first, `${key} is generated`);
  }
});

test('imported presets are bounded and retain a usable character', () => {
  const imported = parsePreset(JSON.stringify({ name: 'Ada', height: 9, age: -10, skin: 999, hairStyle: 'bad', outfit: 3 }));
  assert.equal(imported.name, 'Ada');
  assert.equal(imported.height, 1.98);
  assert.equal(imported.age, 18);
  assert.equal(imported.skin, 7);
  assert.equal(imported.hairStyle, defaultCharacter.hairStyle);
  assert.equal(imported.outfit, 3);
  assert.deepEqual(parsePreset(serializePreset(normalizeCharacter(imported))), imported);
});

test('new ages and heights preserve old presets while allowing child proportions', () => {
  const child = normalizeCharacter({ ageYears: 8, heightMeters: 1.28 });
  assert.equal(child.ageYears, 8);
  assert.equal(child.heightMeters, 1.28);
  const old = parsePreset(JSON.stringify({ age: 32, height: 1.74 }));
  assert.equal(old.ageYears, 32);
  assert.equal(old.heightMeters, 1.74);
});

test('age-height reference keeps children and adults within plausible stature bands', () => {
  assert.ok(ageHeightReference(2, 0) > 0.8 && ageHeightReference(2, 0) < 0.96);
  assert.ok(ageHeightReference(8, 0) > 1.18 && ageHeightReference(8, 0) < 1.4);
  assert.ok(ageHeightReference(18, 0) > 1.5 && ageHeightReference(18, 0) < 1.8);
  assert.ok(ageHeightReference(8, 0) < ageHeightReference(18, 0));
});
