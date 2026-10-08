import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import { createHuman } from '../src/human-three.mjs';
import { LockEditor } from '../src/lock-editor.mjs';
import { LOCK_POINTS as N, combLock, makeLock, lockLimits, lockSurface, prepareLocks, rootFromHit, serializeLocks } from '../src/locks.mjs';
import * as locks from '../src/locks.mjs';

const human = await createHuman({ seed: 42, hair: { style: 'none' } });
function setup() {
  const state = prepareLocks(human.context, null), ray = new Raycaster();
  ray.set(state.frame.C.clone().add(new Vector3(0, .6, .1)), new Vector3(0, -1, -.1).normalize());
  const hit = ray.intersectObject(human.body)[0], ids = human.body.geometry.userData.baseIds;
  const root = rootFromHit(state, [hit.face.a, hit.face.b, hit.face.c].map(v => ids[v]), hit.point);
  const editor = new LockEditor({ scene: new Scene() }); editor.begin(human, null, '#332211');
  const camera = new PerspectiveCamera(45, 1, .01, 10); camera.position.copy(hit.point).add(new Vector3(0, .12, .6)); camera.lookAt(hit.point); camera.updateMatrixWorld(true);
  return { editor, root, camera, hit };
}
const stretch = lock => Math.max(...Array.from({ length: N - 1 }, (_, i) => Math.abs(new Vector3().fromArray(lock.x, (i + 1) * 3).distanceTo(new Vector3().fromArray(lock.x, i * 3)) / lock.seg - 1)));

// Locks overlapping each other meet through the density grid (Müller et al.
// 2012 §3.5); only skin/clothing, stretching or pinned body contacts pause gravity.
test('live editor keeps gravity on for overlapping fixed locks and never moves them', () => {
  const { editor, root } = setup();
  for (let i = 0; i < 2; i++) {
    const lock = combLock(editor.state, root, new Vector3(1, .5, .3), .2);
    lock.fixed = true; lock.styled = true; editor.locks.push(lock);
  }
  const previous = editor.locks.map(lock => ({ x: [...lock.x], design: [...lock.rest] }));
  editor.setGravityOn(true);
  editor.tickPhysics(1 / 60);
  assert.equal(editor.settings.gravityOn, true);
  assert.equal(editor.physicsError, null);
  for (const [i, lock] of editor.locks.entries()) {
    assert.deepEqual([...lock.x], previous[i].x);
    assert.deepEqual([...lock.rest], previous[i].design);
  }
  editor.end();
});

test('drawing brush continues outside the scalp and preserves a curved freehand path', () => {
  const { editor, camera, hit } = setup();
  editor.settings.brushCreation = 'stroke'; editor.settings.width = .018; editor.settings.mirror = false;
  const start = hit.point.clone().project(camera);
  assert.equal(editor.pointerDown(start, camera), true);
  for (const p of [[.2, -.08], [.45, -.15], [.64, -.4], [.48, -.64]]) editor.pointerMove({ x: start.x + p[0], y: start.y + p[1] }, camera);
  editor.pointerUp();
  assert.equal(editor.locks.length, 1, 'one stroke makes one guide, rather than only scalp stamps');
  const lock = editor.locks[0];
  assert.equal(lock.width, .018);
  assert.ok(lock.x[(N - 1) * 3] > lock.rootP.x + .05);
  assert.ok(Math.max(...Array.from({ length: N }, (_, i) => lock.x[i * 3])) > lock.x[(N - 1) * 3] + .025, 'hook shape follows the stroke history, not only its endpoint');
  assert.ok(stretch(lock) < .002);
  assert.equal(lock.styled, true, 'drawn curve remains designed until explicitly settled');
  editor.end();
});

test('freehand ribbon exposes its real width to the drawing view and retains camera-facing orientation', () => {
  const { editor, camera, hit } = setup(), start = hit.point.clone().project(camera);
  editor.settings.brushCreation = 'stroke'; editor.settings.width = .005;
  editor.pointerDown(start, camera);
  for (const [x, y] of [[.2, .04], [.4, .1], [.7, .16]]) editor.pointerMove({ x: start.x + x, y: start.y + y }, camera);
  editor.pointerUp(); const lock = editor.locks[0], source = [...lock.x];
  assert.ok(Array.isArray(lock.ribbonNormal), 'a solid ribbon stores its view-facing thickness axis');
  const facing = camera.getWorldDirection(new Vector3()).negate(); assert.ok(new Vector3(...lock.ribbonNormal).dot(facing) > .999);
  const projectedSectionWidth = part => {
    const rings = (part.pos.length / 3 - 1) / 13, ring = Math.floor(rings * .4), centerAt = i => new Vector3().fromArray(part.pos, i * 39).add(new Vector3().fromArray(part.pos, i * 39 + 18)).multiplyScalar(.5).project(camera);
    const a = centerAt(ring - 1), b = centerAt(ring + 1), direction = new Vector3(-(b.y - a.y), b.x - a.x, 0).normalize();
    const values = Array.from({ length: 12 }, (_, i) => new Vector3().fromArray(part.pos, ring * 39 + i * 3).project(camera).dot(direction));
    return Math.max(...values) - Math.min(...values);
  };
  const narrow = projectedSectionWidth(lockSurface(lock, editor.state));
  editor.setParam('width', .03); const wide = projectedSectionWidth(lockSurface(lock, editor.state));
  assert.ok(wide / narrow > 5.5 && wide / narrow < 6.5, `5→30 mm visibly scales the same solid ribbon width: ${wide / narrow}`);
  assert.deepEqual([...lock.x], source); assert.deepEqual(editor.serialize().locks[0].rn, lock.ribbonNormal.map(v => Math.round(v * 1e6) / 1e6));
  assert.equal(editor.handles.count, 0, 'creation view shows hair instead of oversized source nodes'); editor.end();
});

test('strand, lock and volume representations reuse the same guide and root', () => {
  const { editor, root } = setup(); const lock = combLock(editor.state, root, new Vector3(1, -.5, -.1), .22); editor.locks.push(lock);
  const original = [...lock.x], anchor = { ...lock.root };
  assert.equal(lockLimits.width[0], .001);
  editor.setRepresentation('strand'); assert.ok(lock.width <= .003); assert.equal(editor.locks[0], lock); assert.deepEqual(lock.root, anchor);
  editor.setRepresentation('lock'); assert.ok(lock.width > .01); assert.deepEqual([...lock.x], original);
  editor.setRepresentation('volume'); assert.equal(editor.state.fusion.enabled, true); assert.deepEqual([...lock.x], original);
  assert.equal(editor.serialize().fusion.representation, 'volume');
  editor.end();
});

test('whole-hairstyle comb affects distant guides independently of current selection', () => {
  const { editor, root, camera } = setup();
  for (const side of [-1, 1]) { const lock = combLock(editor.state, root, new Vector3(side, -.3, -.2), .21); lock.styled = true; editor.locks.push(lock); }
  editor.syncMeshes(true); editor.selected.add(0); editor.settings.tool = 'comb'; editor.settings.combScope = 'all';
  const before = editor.locks.map(l => [...l.x]);
  assert.ok(editor.pointerDown({ x: -.8, y: 0 }, camera)); editor.pointerMove({ x: -.65, y: .05 }, camera); editor.pointerUp();
  for (const [i, lock] of editor.locks.entries()) { assert.notDeepEqual([...lock.x], before[i]); assert.deepEqual([...lock.x.subarray(0, 6)], before[i].slice(0, 6)); assert.ok(stretch(lock) < .002); }
  editor.end();
});

test('local comb requires a visible hair hit, moves neighboring guides and leaves distant hair alone', () => {
  const {editor,root,camera}=setup();
  for(const direction of [[1,.7,.4],[1,.73,.43],[-1,.7,.4]]) {
    const l=makeLock(editor.state,root,null,{width:.018,volume:.3});l.seg=.22/(N-1);const d=new Vector3(...direction).normalize();
    for(let i=0;i<N;i++)l.x.set(l.rootP.clone().addScaledVector(d,i*l.seg).toArray(),i*3);l.rest.set(l.x);l.styled=true;editor.locks.push(l);
  }
  editor.syncMeshes(true);editor.group.updateMatrixWorld(true);assert.equal(editor.settings.combScope,'brush');editor.settings.tool='comb';
  const before=editor.locks.map(l=>[...l.x]);if(editor.pointerDown({x:.85,y:-.85},camera)){editor.pointerMove({x:.9,y:-.8},camera);editor.pointerUp();}
  assert.deepEqual(editor.locks.map(l=>[...l.x]),before,'blank space cannot become global wind');
  const point=new Vector3().fromArray(editor.locks[0].x,30),ndc=point.project(camera);assert.ok(editor.pickHair(ndc,camera));
  assert.ok(editor.pointerDown({x:ndc.x-.06,y:ndc.y},camera));editor.pointerMove({x:ndc.x,y:ndc.y+.01},camera);editor.pointerUp();
  assert.notDeepEqual([...editor.locks[0].x],before[0]);assert.notDeepEqual([...editor.locks[1].x],before[1]);assert.deepEqual([...editor.locks[2].x],before[2]);editor.end();
});

test('explicit progressive gravity changes pose while preserving authored design and fixed locks', () => {
  const { editor, root } = setup();
  const lock = makeLock(editor.state, root, null, { width: .018, stiffness: .2 }), fixed = makeLock(editor.state, root, null, { width: .018 });
  const direction = new Vector3(1, .2, .4).normalize();
  for (const l of [lock, fixed]) { l.seg = .35 / (N - 1); for (let i = 0; i < N; i++) l.x.set(l.rootP.clone().addScaledVector(direction, i * l.seg).toArray(), i * 3); l.rest.set(l.x); l.styled = true; }
  fixed.fixed = true; lock.pins.set(9, new Vector3().fromArray(lock.x, 27));
  editor.locks.push(lock, fixed); editor.syncMeshes(true);
  const fixedBefore = [...fixed.x], pin = lock.pins.get(9).clone();
  const before = [...lock.x], rest = [...lock.rest];
  editor.settleGravity({ strength: .65, steps: 8 });
  assert.notDeepEqual([...lock.x], before); assert.deepEqual([...lock.rest], rest); assert.ok(stretch(lock) < .002);
  assert.ok(before.at(-2) - lock.x.at(-2) > .1, 'visible free tail drops over 10 cm');
  assert.ok(new Vector3().fromArray(lock.x, 27).distanceTo(pin) < .002); assert.deepEqual([...fixed.x], fixedBefore);
  const settled = editor.serialize(); editor.undo(); assert.deepEqual([...editor.locks[0].rest], rest); editor.redo(); assert.deepEqual(editor.serialize(), settled);
  editor.end();
});

test('tip shape changes the section end without altering source geometry', () => {
  const { editor, root } = setup(); const lock = combLock(editor.state, root, new Vector3(1, -.3, 0), .2); editor.locks.push(lock);
  const before = [...lock.x]; editor.setTipShape('point'); const point = lockSurface(lock, editor.state);
  assert.deepEqual([...lock.x], before); assert.equal(editor.serialize().locks[0].ti, 'point');
  editor.setTipShape('flat'); const flat = lockSurface(lock, editor.state);
  assert.notDeepEqual([...flat.pos], [...point.pos]); assert.ok([...flat.pos, ...flat.normal].every(Number.isFinite)); editor.end();
});

test('round, pointed and flat tips all keep the elliptical hair mesh closed', () => {
  const { editor, root } = setup(), lock = makeLock(editor.state, root, null, { width: .025, volume: .3, taper: .85 });
  lock.seg = .22 / (N - 1); const direction = new Vector3(1, .3, .2).normalize();
  for (let i = 0; i < N; i++) lock.x.set(lock.rootP.clone().addScaledVector(direction, i * lock.seg).toArray(), i * 3);
  lock.rest.set(lock.x);
  for (const shape of ['round', 'point', 'flat']) {
    lock.tipShape = shape; const part = lockSurface(lock, editor.state), vertices = [], edges = new Map();
    for (let i = 0; i < part.pos.length; i += 3) vertices.push(Array.from(part.pos.subarray(i, i + 3), v => Math.round(v * 1e7)).join(','));
    for (let i = 0; i < part.index.length; i += 3) {
      const triangle = Array.from(part.index.subarray(i, i + 3), v => vertices[v]);
      if (new Set(triangle).size !== 3) continue;
      for (let k = 0; k < 3; k++) { const edge = [triangle[k], triangle[(k + 1) % 3]].sort().join('|'); edges.set(edge, (edges.get(edge) ?? 0) + 1); }
    }
    assert.ok(edges.size > 100); assert.ok([...edges.values()].every(n => n === 2), `${shape} has exactly two faces per welded edge`);
  }
  editor.end();
});

test('comb scopes preserve explicit pins and protected spatial mask points', () => {
  const { editor, root, camera } = setup(), lock = combLock(editor.state, root, new Vector3(1, -.3, -.2), .25);
  lock.styled = true; editor.locks.push(lock); editor.syncMeshes(true);
  const pin = new Vector3().fromArray(lock.x, 21); lock.pins.set(7, pin.clone());
  const protectedPoint = new Vector3().fromArray(lock.x, 39);
  editor.brushAt(protectedPoint, { tool: 'mask', radius: .026, strength: 1, falloff: 'constant' });
  editor.settings.tool = 'comb'; editor.settings.combScope = 'all';
  assert.ok(editor.pointerDown({ x: 0, y: 0 }, camera)); editor.pointerMove({ x: .12, y: .06 }, camera); editor.pointerUp();
  assert.ok(new Vector3().fromArray(lock.x, 21).distanceTo(pin) < .00002);
  assert.ok(new Vector3().fromArray(lock.x, 39).distanceTo(protectedPoint) < .00002);
  assert.ok(stretch(lock) < .002); editor.end();
});

test('authored shape and settled pose remain separate after save and body adaptation', async () => {
  const { editor, root } = setup(), lock = combLock(editor.state, root, new Vector3(1, -.4, -.2), .2); editor.locks.push(lock);
  editor.settleGravity({ strength: .8, steps: 2 }); const saved = editor.serialize();
  const other = await createHuman({ seed: 42, heightMeters: 1.95, hair: { style: 'none' } }), restored = prepareLocks(other.context, saved);
  const scale = restored.frame.R / saved.R, loaded = restored.locks[0];
  assert.equal(loaded.styled, true); assert.equal(loaded.fixed, false);
  for (let i = 0; i < N * 3; i++) {
    assert.ok(Math.abs(loaded.x[i] - loaded.rootP.getComponent(i % 3) - saved.locks[0].p[i] * scale) < .000002);
    assert.ok(Math.abs(loaded.rest[i] - loaded.rootP.getComponent(i % 3) - saved.locks[0].q[i] * scale) < .000002);
  }
  editor.end(); other.dispose();
});

test('cancelling incremental gravity restores the last complete pose and history', () => {
  const { editor, root } = setup(), lock = makeLock(editor.state, root, null, { width: .018, stiffness: .2 });
  lock.seg = .3 / (N - 1); const direction = new Vector3(1, .3, .2).normalize();
  for (let i = 0; i < N; i++) lock.x.set(lock.rootP.clone().addScaledVector(direction, i * lock.seg).toArray(), i * 3);
  lock.rest.set(lock.x); editor.locks.push(lock); editor.syncMeshes(true);
  const before = editor.serialize(), history = [...editor.undoStack];
  editor.onProgress = () => editor.cancelOperation();
  assert.equal(editor.settleGravity({ strength: 1, steps: 6 }), false);
  assert.deepEqual(editor.serialize(), before, 'partial stage must never become a cancelled hairstyle commit');
  assert.deepEqual(editor.undoStack, history); assert.equal(editor.gravityRunning, false); assert.equal(editor.gravityCancelled, true); editor.end();
});

test('gravity cancellation never overwrites a later author edit', () => {
  const { editor, root } = setup(), lock = combLock(editor.state, root, new Vector3(1, -.4, -.2), .2); editor.locks.push(lock); editor.syncMeshes(true);
  editor.onProgress = () => { editor.setParam('width', .027, true); editor.cancelOperation(); };
  assert.equal(editor.settleGravity({ strength: 1, steps: 4 }), false);
  assert.equal(lock.width, .027); assert.equal(editor.gravityRunning, false); assert.equal(editor.gravityCancelled, true); editor.end();
});

test('leaving hair cancels only fusion compute and preserves completed authored definition', () => {
  const { editor, root } = setup(), lock = combLock(editor.state, root, new Vector3(1, -.4, -.2), .2); editor.locks.push(lock);
  editor.setRepresentation('volume');
  editor.brushAt(new Vector3().fromArray(lock.x, 27), { tool: 'volume', strength: .4, radius: .04 });
  assert.ok(editor.fusionTimer);
  const definition = editor.serialize(), returned = editor.end();
  assert.deepEqual(returned, definition); assert.equal(returned.fusion.representation, 'volume'); assert.equal(returned.fusion.strokes.length, 1);
});

test('Curvar directly authors a held curve, uses an absolute baseline and survives gravity/save', () => {
  const { editor, root } = setup(), lock = makeLock(editor.state, root, null, { width: .018, stiffness: .2 });
  lock.seg = .25 / (N - 1); const direction = new Vector3(1, .3, .4).normalize();
  for (let i = 0; i < N; i++) lock.x.set(lock.rootP.clone().addScaledVector(direction, i * lock.seg).toArray(), i * 3);
  lock.rest.set(lock.x); lock.styled = true; editor.locks.push(lock); editor.syncMeshes(true);
  const before = [...lock.x], design = [...lock.rest]; editor.checkpoint();
  editor.setParam('bend', .5);
  assert.notDeepEqual([...lock.x], before, 'held source responds immediately to Curvar');
  assert.ok(stretch(lock) < .002); assert.equal(editor.serialize().locks[0].bi, true);
  editor.setParam('bend', 0); assert.deepEqual([...lock.x], before); assert.deepEqual([...lock.rest], design);
  editor.setParam('bend', .4); const authored = [...lock.rest], saved = editor.serialize();
  editor.settleGravity({ strength: .8, steps: 2 }); assert.deepEqual([...lock.rest], authored, 'gravity never bakes the same bend twice');
  const loaded = prepareLocks(human.context, editor.serialize()); assert.equal(loaded.locks[0].bendEmbedded, true); assert.equal(loaded.locks[0].bend, .4);
  editor.undo(); assert.deepEqual(editor.serialize(), saved); editor.end();
});

test('Curvar preserves roots, pins, protected points and resets baseline after changing length', () => {
  const { editor, root } = setup(), lock = combLock(editor.state, root, new Vector3(1, -.3, -.2), .25); lock.styled = true; editor.locks.push(lock); editor.syncMeshes(true);
  const pin = new Vector3().fromArray(lock.x, 24); lock.pins.set(8, pin.clone());
  const protectedPoint = new Vector3().fromArray(lock.x, 39); editor.brushAt(protectedPoint, { tool: 'mask', radius: .021, strength: 1, falloff: 'constant' });
  editor.state.fusion.enabled = false; editor.syncMeshes(true); editor.checkpoint();
  editor.setParam('bend', -.4);
  assert.ok(new Vector3().fromArray(lock.x).distanceTo(lock.rootP) < .000001); assert.ok(new Vector3().fromArray(lock.x, 24).distanceTo(pin) < .00002); assert.ok(new Vector3().fromArray(lock.x, 39).distanceTo(protectedPoint) < .00002); assert.ok(stretch(lock) < .002);
  lock.pins.clear(); editor.clearMask(); editor.setParam('bend', 0); editor.setLength(.32); const length = lock.seg;
  editor.setParam('bend', .2); assert.equal(lock.seg, length); assert.ok(stretch(lock) < .002); editor.end();
});

test('Curvar invalidates a baseline after length/pull edits and retains embedded design on another body', async () => {
  const { editor, root } = setup(), lock = makeLock(editor.state, root, null, { width: .018 });
  lock.seg = .25 / (N - 1); const direction = new Vector3(1, .3, .4).normalize();
  for (let i = 0; i < N; i++) lock.x.set(lock.rootP.clone().addScaledVector(direction, i * lock.seg).toArray(), i * 3);
  lock.rest.set(lock.x); editor.locks.push(lock); editor.syncMeshes(true); editor.checkpoint();
  editor.setParam('bend', .4); assert.equal(lock.styled, true, 'free guides become directly authored instead of ignoring the parameter');
  editor.setLength(.32); const resized = [...lock.x], resizedDesign = [...lock.rest];
  editor.setParam('bend', .7); editor.setParam('bend', .4); assert.deepEqual([...lock.x], resized); assert.deepEqual([...lock.rest], resizedDesign);
  // A fresh pull can change the arrays within the same revision. It must also
  // become the next absolute baseline, independently of the segment count.
  const pulledDirection = new Vector3(.8, .4, .7).normalize();
  for (let i = 0; i < N; i++) lock.x.set(lock.rootP.clone().addScaledVector(pulledDirection, i * lock.seg).toArray(), i * 3);
  lock.rest.set(lock.x); const pulled = [...lock.x];
  editor.setParam('bend', .7); editor.setParam('bend', .4); assert.deepEqual([...lock.x], pulled);
  const saved = editor.serialize(), other = await createHuman({ seed: 42, heightMeters: 1.95, hair: { style: 'none' } }), adapted = prepareLocks(other.context, saved), loaded = adapted.locks[0];
  assert.equal(loaded.bendEmbedded, true); assert.equal(loaded.bend, .4);
  const scale = adapted.frame.R / saved.R;
  for (let i = 0; i < N * 3; i++) assert.ok(Math.abs(loaded.rest[i] - loaded.rootP.getComponent(i % 3) - saved.locks[0].q[i] * scale) < .000002);
  const legacy = prepareLocks(human.context, { ...saved, v: 1, fusion: undefined, locks: saved.locks.map(l => ({ ...l, sy: 0 })) });
  const embedded = prepareLocks(human.context, { ...saved, locks: saved.locks.map(l => ({ ...l, sy: 0 })) });
  assert.equal(Boolean(legacy.locks[0].bendEmbedded), false); legacy.sim.apply({ force: 0 }); embedded.sim.apply({ force: 0 });
  assert.ok(legacy.locks[0].x.some((v, i) => Math.abs(v - embedded.locks[0].x[i]) > .001), 'legacy be-only still runs its existing post-gravity bend');
  editor.end(); other.dispose();
});
