import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clipNames } from '../src/motion.mjs';
import { createHuman, exportHumanGLB } from '../src/human-three.mjs';

// GLTFExporter uses the browser FileReader for Blob bytes; Node supplies Blob.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend(); });
  }
};

test('exported GLB loads in Three.js with skin and every animation clip', async () => {
  const human = await createHuman({ ageYears: 30, gender: 0.5 });
  const glb = await exportHumanGLB(human);
  assert.ok(glb instanceof ArrayBuffer);
  const loaded = await new GLTFLoader().parseAsync(glb, '');
  let skinned = 0;
  loaded.scene.traverse(object => { if (object.isSkinnedMesh) skinned++; });
  assert.ok(skinned >= 2);
  assert.deepEqual(loaded.animations.map(clip => clip.name), clipNames);
  human.dispose();
});
