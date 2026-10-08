import { Vector3 } from 'three';
import { loadHumanData } from './parametric.mjs';
import { prepareLocks } from './locks.mjs';
import { hairMaskAt } from './hair-fusion.mjs';
import { HairDynamics } from './hair-dynamics.mjs';

let context, state, dynamics, epoch = -1, definition;
const assets = loadHumanData();

function snapshot(request, type, advanced = false) {
  const poses = state.locks.map((lock, index) => ({ id: lock.id ?? null, index, x: Float32Array.from(lock.x), rootTaper: Boolean(lock.rootTaper) }));
  self.postMessage({ type, request, epoch, definition, poses, stats: { ...dynamics.stats }, advanced }, poses.map(pose => pose.x.buffer));
}

self.onmessage = async ({ data: message }) => {
  try {
    if (message.type === 'replace' || message.type === 'pause') {
      if (message.epoch < epoch) throw new Error('Hair physics received an obsolete definition');
      if (message.context) {
        const saved = message.context, data = await assets;
        const positions = Float32Array.from(saved.positions);
        positions.unitScale = saved.unitScale;
        context = {
          data, positions, height: saved.height, lod: saved.lod, outfitSurface: saved.outfitSurface,
          skeleton: { heads: saved.heads.map(p => new Vector3(...p)), byName: new Map(saved.byName) },
        };
      }
      if (!context) throw new Error('Hair physics has no body context');
      state = prepareLocks(context, message.locks);
      if (state.locks.length !== message.locks.locks.length) throw new Error('Hair physics cannot bind every authored lock to this body');
      // prepareLocks loads CURRENT p and design q. Never invoke the static
      // grooming operator: replacing or pausing must not reset p to q.
      dynamics = new HairDynamics(state, {
        fixedStep: 1 / 120, iterations: 20,
        maskAt: (lock, point) => hairMaskAt(state, point, lock.group ?? 'main'),
      });
      dynamics.pause();
      epoch = message.epoch; definition = message.definition;
      snapshot(message.request, 'ready');
      return;
    }
    if (message.type !== 'advance') throw new Error(`Unknown hair physics request: ${message.type}`);
    if (!dynamics || message.epoch !== epoch) throw new Error('Hair physics step does not match its current definition');
    const advanced = dynamics.advance(message.dt, message.options);
    snapshot(message.request, 'pose', advanced);
  } catch (error) {
    self.postMessage({ type: 'error', request: message.request, epoch: message.epoch, name: error.name, message: error.message, stack: error.stack });
  }
};
