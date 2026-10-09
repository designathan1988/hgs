import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../src/state.mjs';
import { createHuman } from '../src/human-three.mjs';

test('guided variations preserve chosen face, body, authored hair and garments through preset roundtrip', () => {
  assert.equal(typeof state.varyCharacter, 'function');
  const source = state.normalizeCharacter({ ...state.defaultCharacter, name: 'Autoria', outfit: 4,
    colors: { hair: '#123456', eyes: '#654321' }, sculpt: { body: { 10: [0.01, 0, 0] } },
    garments: [{ type: 'dress', color: '#ff0000', paint: { 30: 1 } }] });
  const varied = state.varyCharacter(source, { body: true, face: true, hair: true, clothes: true }, 1234);
  assert.notEqual(varied.seed, source.seed);
  for (const key of ['heightMeters', 'gender', 'ageYears', 'nose', 'jaw', 'hairPreset', 'hairColor', 'outfit']) assert.deepEqual(varied[key], source[key]);
  assert.deepEqual(varied.garments, source.garments);
  assert.deepEqual(varied.sculpt, source.sculpt);
  assert.deepEqual(varied.colors, source.colors);
  assert.deepEqual(state.parsePreset(state.serializePreset(varied)), varied);
  assert.deepEqual(source.garments[0].paint, { 30: 1 });
});

test('unlocked variation changes appearance deterministically while keeping presentation', () => {
  assert.equal(typeof state.varyCharacter, 'function');
  const source = state.normalizeCharacter({ animation: 5, lighting: 3, name: 'Original' });
  const first = state.varyCharacter(source, {}, 5678);
  assert.deepEqual(first, state.varyCharacter(source, {}, 5678));
  assert.notDeepEqual(first, state.varyCharacter(source, {}, 8765));
  assert.equal(first.animation, source.animation);
  assert.equal(first.lighting, source.lighting);
  // Another person gets another name; with the body and the face kept it is the same person, and keeps it.
  assert.notEqual(first.name, source.name);
  assert.equal(state.varyCharacter(source, { body: true, face: true }, 5678).name, source.name);
});

test('creation preferences survive normalizing and loading legacy presets', () => {
  const person = state.normalizeCharacter({ creation: { locks: { face: true, hair: true } } });
  assert.equal(person.creation?.locks.face, true);
  assert.equal(person.creation?.locks.body, false);
  assert.deepEqual(state.parsePreset(state.serializePreset(person)).creation, person.creation);
  assert.equal(state.parsePreset('{"name":"Antigo"}').creation?.locks.clothes, false);
});

test('a hairstyle saved as card locks becomes the nearest artist hair mesh and survives saving', () => {
  const person = state.normalizeCharacter({ hairPreset: 'chanel', locks: { format: 'hgs-locks', v: 1, R: 0.11, locks: [] } });
  assert.equal(person.locks, null);
  assert.equal(person.hairMesh.style, 'toigo_blunt_bob');
  assert.deepStrictEqual(state.parsePreset(state.serializePreset(person)).hairMesh, person.hairMesh);
  // Bald stays bald after saving.
  const bald = state.normalizeCharacter({ ...person, hairMesh: null });
  assert.equal(state.parsePreset(state.serializePreset(bald)).hairMesh, null);
});

test('already cancelled character generation rejects before building geometry', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createHuman({}, { signal: controller.signal }), { name: 'AbortError' });
});

test('generation reports stages and respects cancellation without publishing a partial human', async () => {
  const controller = new AbortController(), stages = [];
  await assert.rejects(createHuman({}, { signal: controller.signal, onProgress: stage => {
    stages.push(stage); if (stage === 'Corpo') controller.abort();
  } }), { name: 'AbortError' });
  assert.deepEqual(stages.slice(0, 2), ['Assets', 'Corpo']);
});
