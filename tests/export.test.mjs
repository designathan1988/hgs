import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHuman, exportHumanGLB, mixamoName } from '../src/human-three.mjs';
import { newGarment } from '../src/tailor.mjs';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend(); }); }
};

test('Mixamo naming covers the humanoid bones and fingers', () => {
  assert.equal(mixamoName('pelvis'), 'mixamorig:Hips');
  assert.equal(mixamoName('upperarm_l'), 'mixamorig:LeftArm');
  assert.equal(mixamoName('lowerarm_r'), 'mixamorig:RightForeArm');
  assert.equal(mixamoName('index_02_l'), 'mixamorig:LeftHandIndex2');
  assert.equal(mixamoName('ball_r'), 'mixamorig:RightToeBase');
});

test('a game export can rename bones, drop morphs and keep animations working', async () => {
  const human = await createHuman({ ageYears: 30, gender: 0.6, seed: 9 });
  const bytes = await exportHumanGLB(human, { skeleton: 'mixamo', blendshapes: false, cosmetic: false });
  const loaded = await new GLTFLoader().parseAsync(bytes, '');
  assert.ok(loaded.scene.getObjectByName('mixamorigLeftForeArm') || loaded.scene.getObjectByName('mixamorig:LeftForeArm'));
  assert.equal(loaded.scene.getObjectByName('IrisLeft'), undefined, 'cosmetic eye layers are left out');
  let morphs = 0;
  loaded.scene.traverse(object => { if (object.morphTargetDictionary) morphs++; });
  assert.equal(morphs, 0);
  const walk = loaded.animations.find(clip => clip.name === 'walk');
  assert.ok(walk.tracks.every(track => /^mixamorig/.test(track.name)), 'clip tracks follow the renamed bones');
  // The live character is untouched by the export.
  assert.equal(human.body.skeleton.bones.find(bone => bone.name === 'lowerarm_l')?.name, 'lowerarm_l');
  assert.ok(human.body.morphTargetDictionary.jawOpen !== undefined);
  human.dispose();
});

test('tailored garments replace the covered skin and export as one mesh', async () => {
  const human = await createHuman({ ageYears: 30, gender: 0.2, clothing: { style: 'tailor', garments: [newGarment('tshirt'), newGarment('skirt')] } });
  const outfit = human.group.getObjectByName('Outfit');
  assert.ok(outfit.isSkinnedMesh && outfit.geometry.getAttribute('color'));
  const bare = await createHuman({ ageYears: 30, gender: 0.2, clothing: { style: 'none' }, shoes: 'none' });
  assert.ok(human.body.geometry.index.count < bare.body.geometry.index.count * 0.97, "skin well inside the shirt is removed");
  human.dispose(); bare.dispose();
});
