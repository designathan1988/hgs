import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHuman, exportHumanGLB, blendshapeNames, faceWeights } from '../src/human-three.mjs';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend(); }); }
};

test('the face carries ARKit-named blendshapes that move the skin, mouth and grooms', async () => {
  const human = await createHuman({ ageYears: 30, gender: 0.3, seed: 3 });
  const names = ['Body', 'Mouth', 'Brows', 'Lashes'];
  for (const name of names) {
    const mesh = human.group.getObjectByName(name);
    assert.deepEqual(Object.keys(mesh.morphTargetDictionary), blendshapeNames, `${name} has every blendshape`);
  }
  const body = human.body.geometry;
  const largest = name => {
    const delta = body.morphAttributes.position[blendshapeNames.indexOf(name)].array;
    let max = 0; for (const value of delta) max = Math.max(max, Math.abs(value)); return max;
  };
  assert.ok(largest('jawOpen') > 0.01, 'the jaw opens by more than a centimetre');
  assert.ok(largest('eyeBlinkLeft') > 0.006, 'the upper lid travels over the eye');
  assert.ok(largest('mouthSmileLeft') > 0.003);
  // Left shapes move only the character's left side (+x).
  const blink = body.morphAttributes.position[blendshapeNames.indexOf('eyeBlinkLeft')];
  const position = body.getAttribute('position');
  for (let i = 0; i < blink.count; i++) if (Math.abs(blink.getY(i)) > 1e-5) assert.ok(position.getX(i) > 0);
  // Brows do not follow the eyelids.
  const brows = human.group.getObjectByName('Brows').geometry.morphAttributes.position[blendshapeNames.indexOf('eyeBlinkLeft')];
  assert.ok(brows.array.every(value => value === 0));
  human.dispose();
});

test('expressions are blendshape weights and survive GLB export with facial clips', async () => {
  assert.ok(faceWeights(3, 1).mouthSmileLeft > 0.5);
  assert.equal(faceWeights(3, 0.5).mouthSmileLeft, faceWeights(3, 1).mouthSmileLeft / 2);
  assert.equal(faceWeights(0, 1, { jawOpen: 0.4 }).jawOpen, 0.4);
  const human = await createHuman({ ageYears: 30, gender: 0.7, seed: 5, faceWeights: faceWeights(4, 1) });
  assert.ok(human.body.morphTargetInfluences[human.body.morphTargetDictionary.jawOpen] > 0.4);
  const loaded = await new GLTFLoader().parseAsync(await exportHumanGLB(human), '');
  // Game export moves the blendshapes onto a separate Head mesh.
  // A mesh of several primitives loads as a Group of Meshes (GLTFLoader): the dictionary is on its parts.
  const withMorphs = node => { let found = null; node?.traverse(object => { if (!found && object.morphTargetDictionary) found = object; }); return found; };
  const head = withMorphs(loaded.scene.getObjectByName('Head'));
  assert.deepEqual(Object.keys(head.morphTargetDictionary), blendshapeNames);
  assert.equal(withMorphs(loaded.scene.getObjectByName('Body')), null);
  const talk = loaded.animations.find(clip => clip.name === 'talk');
  assert.ok(talk.tracks.some(track => track.name.includes('morphTargetInfluences')), 'talking animates the face');
  human.dispose();
});
