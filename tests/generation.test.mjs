import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimationMixer } from 'three';
import { createHuman } from '../src/human-three.mjs';
import { blendshapeNames } from '../src/face-rig.mjs';

test('worker transport preserves the actual body, face shapes, rig and animation', async () => {
  const { packHuman, unpackHuman } = await import('../src/generation.mjs');
  const original = await createHuman({ seed: 42, heightMeters: 1.72, hair: { style: 'none' }, clothing: { style: 'none' }, shoes: 'none' });
  let restored;
  try {
    restored = await unpackHuman(structuredClone(packHuman(original)));
    assert.deepEqual(restored.body.geometry.getAttribute('position').array, original.body.geometry.getAttribute('position').array);
    assert.deepEqual(restored.body.geometry.getAttribute('skinIndex').array, original.body.geometry.getAttribute('skinIndex').array);
    assert.deepEqual(restored.body.geometry.userData.baseIds, original.body.geometry.userData.baseIds);
    assert.equal(restored.body.geometry.userData.baseIds.constructor, Uint16Array);
    assert.deepEqual(Object.keys(restored.body.morphTargetDictionary), blendshapeNames);
    assert.deepEqual(restored.body.geometry.morphAttributes.position[11].array, original.body.geometry.morphAttributes.position[11].array);
    assert.equal(restored.faceMeshes.length, original.faceMeshes.length);
    // Every clip crosses the worker (the motion library has grown past the 16 procedural clips).
    assert.equal(restored.animations.length, original.animations.length);
    assert.equal(restored.context.positions.unitScale, original.context.positions.unitScale);
    assert.deepEqual(restored.context.skeleton.heads.map(p => p.toArray()), original.context.skeleton.heads.map(p => p.toArray()));
    assert.equal(restored.context.skeleton.byName.get('head'), original.context.skeleton.byName.get('head'));
    assert.equal(restored.context.skeleton.bones[restored.context.skeleton.byName.get('head')], restored.body.skeleton.bones.find(b => b.name === 'head'));
    const mixer = new AnimationMixer(restored.group);
    mixer.clipAction(restored.animations[1]).play();
    mixer.update(0.3);
    assert.ok(restored.body.skeleton.bones.find(b => b.name === 'thigh_l').quaternion.angleTo(original.body.skeleton.bones.find(b => b.name === 'thigh_l').quaternion) > 0.01);
    mixer.stopAllAction(); mixer.uncacheRoot(restored.group);
  } finally { original.dispose(); restored?.dispose(); }
});

test('generation rejects a cancelled request before building a character', async () => {
  const { buildHumanInWorker } = await import('../src/generation.mjs');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildHumanInWorker({}, { signal: controller.signal }), { name: 'AbortError' });
});
