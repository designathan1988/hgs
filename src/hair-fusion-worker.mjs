import { Vector3 } from 'three';
import { prepareLocks, lockSurface } from './locks.mjs';
import { fusedHairSurface, hairFusionGroups } from './hair-fusion.mjs';

// Three.js imports are resolved by the application's module-worker preparation
// helper because page import maps do not apply to dedicated workers.
// https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap
// https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate
self.onmessage = ({ data: { id, context, hairstyle } }) => {
  try {
    self.postMessage({ type: 'progress', id, stage: 'Preparando volumes do cabelo' });
    context.skeleton = { heads: context.skeleton.heads.map(p => new Vector3(...p)), byName: new Map(context.skeleton.byName) };
    const state = prepareLocks(context, hairstyle);
    const parts = hairFusionGroups(state).map(group => ({ id: group.id, ids: group.ids, part: fusedHairSurface(state, group.locks, lockSurface, { showMask: true }) }));
    const transfer = [];
    for (const { part } of parts) for (const key of ['pos', 'normal', 'uv', 'color', 'index']) transfer.push(part[key].buffer);
    self.postMessage({ type: 'result', id, parts }, transfer);
  } catch (error) { self.postMessage({ type: 'error', id, name: error.name, message: error.message }); }
};
