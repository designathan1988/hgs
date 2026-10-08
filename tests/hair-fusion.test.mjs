import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import * as fusion from '../src/hair-fusion.mjs';
import { LOCK_POINTS, combLock, normalizeLocks, serializeLocks, lockSurface, locksMesh, prepareLocks, rootFromHit } from '../src/locks.mjs';
import { createHuman } from '../src/human-three.mjs';
import { LockEditor } from '../src/lock-editor.mjs';

function state() {
  const frame = { C: new Vector3(), R: 0.11 };
  const locks = [-0.012, 0.012].map((x, k) => {
    const p = Float32Array.from(Array.from({ length: LOCK_POINTS * 3 }, (_, i) => i % 3 === 0 ? x : i % 3 === 1 ? Math.floor(i / 3) * 0.006 : 0));
    return { id: `lock-${k}`, group: 'main', density: 1, root: { v: [0, 1, 2], w: [1, 0, 0] }, rootP: new Vector3(x, 0, 0), rootN: new Vector3(0, 0, 1), x: p, rest: Float32Array.from(p), seg: .006, width: .05, volume: .7, taper: .3, curl: 0, turns: 4, twist: 0, stiffness: .35, bend: 0, pins: new Map(), facing: new Float32Array(p.length), styled: true };
  });
  return { frame, locks, scalp: 1, fusion: fusion.normalizeHairFusion({ enabled: true, resolution: .006, smoothness: .008 }) };
}

test('v1 stays readable; v2 retains fusion groups and head-relative masks', () => {
  const s = state();
  fusion.applyHairBrush(s, new Vector3(0, .06, 0), { tool: 'mask', radius: .04, strength: .8 });
  const saved = serializeLocks(s), again = normalizeLocks(saved);
  assert.equal(saved.v, 2);
  assert.deepEqual(again, saved);
  assert.equal(again.fusion.strokes[0].tool, 'mask');
  assert.equal(again.locks[0].g, 'main');
  const old = normalizeLocks({ v: 1, format: 'hgs-locks', locks: saved.locks });
  assert.equal(old.v, 1);
});

test('union removes internal surfaces, produces finite outward normals, and keeps guides', () => {
  const s = state(), before = s.locks.map(l => [...l.x]);
  const field = fusion.createHairField(s, s.locks, lockSurface);
  assert.ok(field.sample([0, .06, 0]) < 0, 'overlapping locks have a single negative interior');
  const part = fusion.fusedHairSurface(s, s.locks, lockSurface);
  assert.ok(part.pos.length > 0);
  assert.equal(part.pos.length, part.normal.length);
  assert.ok([...part.pos, ...part.normal].every(Number.isFinite));
  for (let i = 0; i < part.normal.length; i += 3) assert.ok(Math.abs(Math.hypot(...part.normal.subarray(i, i + 3)) - 1) < .001);
  assert.deepEqual(s.locks.map(l => [...l.x]), before);
  assert.ok(part.index.length < s.locks.reduce((n, l) => n + lockSurface(l, s).index.length, 0) * 20);
});

test('group membership controls fusion; density hides without deleting a source', () => {
  const s = state();
  s.locks[1].group = 'fringe';
  s.fusion.groups.push({ id: 'fringe', name: 'Franja', fuse: false });
  const groups = fusion.hairFusionGroups(s);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].locks, [s.locks[0]]);
  fusion.applyHairBrush(s, s.locks[1].rootP, { tool: 'density', radius: .01, strength: 1, invert: true, group: 'fringe' });
  assert.equal(s.locks.length, 2);
  assert.equal(s.locks[1].density, 0);
  assert.equal(s.locks[0].density, 1);
});

test('all checked groups form one union while scoped protection remains independent', () => {
  const s = state(), p = new Vector3(.012, .06, 0);
  s.locks[1].group = 'fringe'; s.fusion.groups.push({ id: 'fringe', name: 'Franja', fuse: true });
  const groups = fusion.hairFusionGroups(s);
  assert.equal(groups.length, 1); assert.equal(groups[0].locks.length, 2);
  assert.deepEqual(groups[0].ids, ['main', 'fringe']);
  assert.ok(fusion.createHairField(s, groups[0].locks, lockSurface).sample([2, 2, 2]) > 0, 'empty space stays exterior after cross-group union');
  const before = fusion.createHairField(s, groups[0].locks, lockSurface).sample(p.toArray());
  fusion.applyHairBrush(s, p, { tool: 'mask', radius: .04, strength: 1, falloff: 'constant', group: 'main' });
  fusion.applyHairBrush(s, p, { tool: 'volume', radius: .04, strength: 1, group: 'fringe' });
  assert.equal(fusion.hairMaskAt(s, p, 'main'), 1); assert.equal(fusion.hairMaskAt(s, p, 'fringe'), 0);
  assert.ok(fusion.createHairField(s, groups[0].locks, lockSurface).sample(p.toArray()) < before);
  assert.deepEqual(serializeLocks(s).locks.map(l => l.g), ['main', 'fringe']);
});

test('mask protects subsequent volume brush, symmetry and falloff stay spatial', () => {
  const s = state(), p = new Vector3(.012, .06, 0);
  const before = fusion.createHairField(s, s.locks, lockSurface).sample(p.toArray());
  fusion.applyHairBrush(s, p, { tool: 'mask', radius: .025, strength: 1, falloff: 'constant', symmetry: true });
  assert.equal(fusion.hairMaskAt(s, p), 1);
  assert.equal(fusion.hairMaskAt(s, new Vector3(-p.x, p.y, p.z)), 1);
  fusion.applyHairBrush(s, p, { tool: 'volume', radius: .025, strength: 1 });
  const after = fusion.createHairField(s, s.locks, lockSurface).sample(p.toArray());
  assert.ok(Math.abs(after - before) < 1e-8, 'fully masked volume remains unchanged');
  assert.equal(fusion.hairMaskAt(s, new Vector3(.4, .4, .4)), 0);
});

test('sculpt and masks survive regenerated topology and translated/rescaled head frame', () => {
  const s = state(), p = new Vector3(.012, .06, 0);
  fusion.applyHairBrush(s, p, { tool: 'volume', radius: .03, strength: .6, symmetry: true });
  fusion.applyHairBrush(s, p, { tool: 'mask', radius: .02, strength: .7 });
  const first = fusion.fusedHairSurface(s, s.locks, lockSurface);
  s.fusion.resolution = .004;
  const second = fusion.fusedHairSurface(s, s.locks, lockSurface);
  assert.notEqual(first.pos.length, second.pos.length);
  const mask = fusion.hairMaskAt(s, p);
  s.frame.C.set(.3, .2, -.1); s.frame.R *= 1.5;
  const moved = p.clone().multiplyScalar(1.5).add(s.frame.C);
  assert.ok(Math.abs(fusion.hairMaskAt(s, moved) - mask) < 1e-9);
  assert.equal(s.fusion.strokes.length, 2);
});

test('clump acts on shafts, retains roots and source identities', () => {
  const s = state(), before = s.locks.map(l => [...l.x]);
  fusion.applyHairBrush(s, new Vector3(.012, .085, 0), { tool: 'clump', radius: .045, strength: .8 });
  assert.notDeepEqual([...s.locks[0].x], before[0]);
  for (const [i, l] of s.locks.entries()) { assert.deepEqual([...l.x.subarray(0, 6)], before[i].slice(0, 6)); assert.equal(l.id, `lock-${i}`); }
});

test('releasing a mask preserves protection of earlier sculpt strokes', () => {
  const s = state(), p = new Vector3(.012, .06, 0);
  const before = fusion.createHairField(s, s.locks, lockSurface).sample(p.toArray());
  fusion.applyHairBrush(s, p, { tool: 'mask', radius: .03, strength: 1, falloff: 'constant' });
  fusion.applyHairBrush(s, p, { tool: 'volume', radius: .03, strength: 1 });
  s.fusion.strokes.push({ tool: 'mask', center: [0, 0, 0], radius: 8, strength: 1, falloff: 'constant', symmetry: false, group: null, invert: true, clear: true });
  assert.equal(fusion.hairMaskAt(s, p), 0);
  assert.ok(Math.abs(fusion.createHairField(s, s.locks, lockSurface).sample(p.toArray()) - before) < 1e-8);
  fusion.applyHairBrush(s, p, { tool: 'volume', radius: .03, strength: .5 });
  assert.ok(fusion.createHairField(s, s.locks, lockSurface).sample(p.toArray()) < before);
});

test('real body fusion exports complete normalized skin weights and stays outside collision surfaces', async () => {
  const human = await createHuman({ seed: 42, hair: { style: 'none' } });
  const s = prepareLocks(human.context, null), ray = new Raycaster();
  ray.set(s.frame.C.clone().add(new Vector3(0, .6, .1)), new Vector3(0, -1, -.1).normalize());
  const hit = ray.intersectObject(human.body, false)[0], ids = human.body.geometry.userData.baseIds;
  const root = rootFromHit(s, [hit.face.a, hit.face.b, hit.face.c].map(v => ids[v]), hit.point);
  assert.ok(root);
  for (const x of [-1, 1]) s.locks.push(combLock(s, root, new Vector3(x, -.4, -.2), .12, { width: .035, volume: .5 }));
  s.sim.apply(); s.fusion = fusion.normalizeHairFusion({ enabled: true, resolution: .006 });
  const mesh = locksMesh(human.context, s, '#332211');
  const position = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  assert.ok(position.count > 0);
  assert.equal(indices.count, position.count); assert.equal(weights.count, position.count);
  for (let i = 0; i < weights.count; i++) assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 1e-5);
  const near = {};
  for (let i = 0; i < position.count; i += 17) if (s.collider.head.closest(position.getX(i), position.getY(i), position.getZ(i), .015, near)) assert.ok(near.distance >= -.001, `fused vertex is outside body: ${near.distance}`);
  const editor = new LockEditor({ scene: new Scene() });
  editor.begin(human, serializeLocks(s), '#332211');
  const preview = editor.fusionMeshes[0].geometry;
  const target = new Vector3().fromBufferAttribute(preview.getAttribute('position'), 0);
  const camera = new PerspectiveCamera(45, 1, .01, 10); camera.position.copy(target).add(new Vector3(0, 0, .5)); camera.lookAt(target); camera.updateMatrixWorld(true);
  editor.group.updateMatrixWorld(true);
  assert.ok(editor.pickHair({ x: 0, y: 0 }, camera), 'ray picks the visible fused surface');
  const original = editor.serialize();
  editor.brushAt(new Vector3().fromArray(editor.locks[0].x, 21), { tool: 'mask', strength: .8 });
  const painted = editor.serialize(); assert.notDeepEqual(painted, original);
  editor.undo(); assert.deepEqual(editor.serialize(), original);
  editor.redo(); assert.deepEqual(editor.serialize(), painted);
  editor.setTool('volume');
  assert.equal(editor.pointerDown({ x: 0, y: 0 }, camera), true);
  const during = editor.fusionMeshes[0].geometry;
  editor.pointerMove({ x: .1, y: .04 }, camera);
  assert.equal(editor.fusionMeshes[0].geometry, during, 'stroke previews retain cached topology instead of remeshing on pointermove');
  editor.pointerUp(); editor.cancelFusion();
  assert.equal(editor.fusionBusy, false);
  editor.end();
  mesh.geometry.dispose(); mesh.material.dispose();
});
