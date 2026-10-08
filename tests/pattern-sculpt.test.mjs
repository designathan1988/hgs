import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector2, Vector3 } from 'three';
import { createHuman } from '../src/human-three.mjs';
import { SculptSession } from '../src/sculpt.mjs';
import { createPatternTemplate } from '../src/patterns.mjs';
import { newGarment } from '../src/tailor.mjs';
import { normalizeCharacter, serializePreset, parsePreset } from '../src/state.mjs';

test('actual cloth brush captures panel coordinates that survive preset roundtrip and rebuilding', async () => {
  const garment = newGarment('tank'); garment.patternData = createPatternTemplate('tank', garment);
  garment.patternData.panels = garment.patternData.panels.slice(0, 1); garment.patternData.seams = [];
  const human = await createHuman({ clothing: { style: 'tailor', garments: [garment] }, hair: { style: 'none' }, shoes: 'none' });
  try {
    const session = new SculptSession({ scene: new Scene() });
    Object.assign(session.settings, { target: 'outfit', brush: 'inflate', radius: 0.08, strength: 0.5, symmetry: false });
    assert.equal(session.prepare(human), true);
    const geometry = session.target.mesh.geometry, sources = geometry.userData.patternSources;
    const vertex = sources.findIndex(source => source && source.uv[1] > 0.2);
    assert.ok(vertex >= 0);
    const center = new Vector3().fromBufferAttribute(geometry.getAttribute('position'), vertex);
    const camera = new PerspectiveCamera(); camera.position.set(0, 1, 3);
    session.begin({ point: center, face: { normal: new Vector3(0, 0, 1) } }, new Vector2(), camera);
    const target = session.end();
    assert.equal(typeof target.patternChanges, 'function');
    const edits = target.patternChanges(); assert.ok(edits.length > 0);
    assert.ok(edits.every(edit => edit.panel === garment.patternData.panels[0].id && edit.center.length === 2 && edit.delta.some(value => value !== 0)));
    const person = normalizeCharacter({ outfit: 4, garments: [{ ...garment, patternData: { ...garment.patternData, edits } }] });
    const restored = parsePreset(serializePreset(person));
    assert.deepEqual(restored.garments[0].patternData.edits, person.garments[0].patternData.edits);
    const rebuilt = await createHuman({ clothing: { style: 'tailor', garments: restored.garments }, hair: { style: 'none' }, shoes: 'none' });
    try { assert.notDeepEqual(rebuilt.group.getObjectByName('Outfit').geometry.getAttribute('position').array, target.built); }
    finally { rebuilt.dispose(); }
  } finally { human.dispose(); }
});
