import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { createHuman } from '../src/human-three.mjs';
import { HairEditor } from '../src/hair-editor.mjs';
import { LOCK_POINTS as N, lockLength } from '../src/locks.mjs';

// The hair editor on the character the presets were made on: strokes are
// drawn on the guide (as the mouse would, through the camera), and the
// result is checked with measurable criteria.
const human = await createHuman({ seed: 42, gender: 0, ageYears: 28, heightMeters: 1.72, hair: { style: 'none' }, clothing: { style: 'female_casualsuit01' } });
const renderer = { scene: new Scene() };

function editor() {
  const e = new HairEditor(renderer);
  e.begin(human, null, 0x30231e);
  return e;
}
/** A camera looking at the head from a direction (yaw around the vertical). */
function camera(e, yaw = 0, pitch = 0.2) {
  const C = e.state.frame.C, cam = new PerspectiveCamera(36, 1, 0.01, 10);
  cam.position.set(C.x + Math.sin(yaw) * Math.cos(pitch) * 0.9, C.y + Math.sin(pitch) * 0.9, C.z + Math.cos(yaw) * Math.cos(pitch) * 0.9);
  cam.lookAt(C); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  return cam;
}
/** The screen position (NDC) of a world point. */
const ndcOf = (p, cam) => { const q = p.clone().project(cam); return { x: q.x, y: q.y }; };
/** Drag the pointer through world points, as the mouse would draw them. */
function drag(e, cam, points, options = {}) {
  const ok = e.pointerDown(ndcOf(points[0], cam), cam, options);
  for (const p of points.slice(1)) e.pointerMove(ndcOf(p, cam), cam);
  e.pointerUp();
  return ok;
}
/** Points over the head from the crown down one side (in front of the camera at yaw). */
function stroke(e, side = 1, drop = 0.18) {
  const C = e.state.frame.C, R = e.state.frame.R;
  const out = [];
  for (let k = 0; k <= 10; k++) {
    const a = k / 10;
    // Starting away from the centre line (a root on it has no mirror twin).
    out.push(new Vector3(C.x + side * R * (0.45 + 0.6 * a), C.y + R * 0.95 - a * (R + drop), C.z + R * 0.5));
  }
  return out;
}
const outsideHead = (e, lock) => {
  const hit = {};
  for (let i = 3; i < N; i++) {
    const p = new Vector3().fromArray(lock.x, i * 3);
    if (e.state.collider.head.closest(p.x, p.y, p.z, 0.02, hit) && hit.distance < -0.001) return false;
  }
  return true;
};

test('a brush stroke makes locks rooted on the scalp, outside the head, with their mirror', () => {
  const e = editor(), cam = camera(e);
  assert.ok(drag(e, cam, stroke(e, 1)));
  const K = e.settings.strands;
  assert.equal(e.locks.length, K * 2, 'the strands of the stroke and their mirror');
  for (const lock of e.locks) {
    assert.ok(e.state.field[lock.root.v[0]] >= -0.06, 'rooted on the scalp');
    assert.ok(lockLength(lock) > 0.08, `lock long enough (${lockLength(lock).toFixed(3)} m)`);
    assert.ok(outsideHead(e, lock), 'no point inside the head');
  }
  e.end();
});

test('a stroke over another is laid over it (no lock passes under one drawn before)', () => {
  const e = editor(), cam = camera(e);
  e.settings.mirror = false; e.settings.strands = 1;
  drag(e, cam, stroke(e, 1));
  const first = e.locks[0];
  drag(e, cam, stroke(e, 1));
  const second = e.locks[1];
  assert.ok(second, 'second lock made');
  const n = new Vector3();
  // Where the two cross, the second is farther from the guide's axis.
  let crossings = 0, under = 0;
  for (let i = 4; i < N; i++) {
    const p = new Vector3().fromArray(second.x, i * 3), hp = e.guide.frame(p, n);
    for (let j = 1; j < N; j++) {
      const q = new Vector3().fromArray(first.x, j * 3), d = q.clone().sub(p);
      d.addScaledVector(n, -d.dot(n));
      if (d.length() > 0.5 * (first.width + second.width)) continue;
      crossings++;
      if (hp + 0.0005 < e.guide.frame(q, new Vector3())) under++;
    }
  }
  assert.ok(crossings > 0, 'the strokes overlap');
  assert.equal(under, 0, 'the newer lock never passes under the older one');
  e.end();
});

test('fill plants evenly spaced locks under the circle; cut shortens, erase removes whole locks, undo restores', () => {
  const e = editor(), cam = camera(e, 0, 0.6);
  e.setTool('fill');
  const C = e.state.frame.C, top = new Vector3(C.x, C.y + e.state.frame.R * 0.95, C.z + 0.02);
  assert.ok(e.pointerDown(ndcOf(top, cam), cam, {})); e.pointerUp();
  const planted = e.locks.length;
  assert.ok(planted >= 4, `fill planted ${planted} locks`);
  for (let a = 0; a < planted; a++) for (let b = a + 1; b < planted; b++) {
    assert.ok(e.locks[a].rootP.distanceTo(e.locks[b].rootP) > e.settings.spacing * 0.5, 'roots keep the spacing');
  }
  // Cut through the middle of a lock: shorter, root kept.
  e.setTool('cut');
  const lock = e.locks[0], before = lockLength(lock), mid = ndcOf(new Vector3().fromArray(lock.x, 10 * 3), cam);
  // A scissors stroke across the lock, started off it (as the user swipes).
  assert.ok(e.pointerDown({ x: mid.x - 0.08, y: mid.y }, cam, {}));
  e.pointerMove({ x: mid.x + 0.08, y: mid.y }, cam); e.pointerUp();
  assert.ok(lockLength(lock) < before * 0.8, 'cut shortened the lock');
  // Erase removes whole locks: a small circle over one lock takes that lock only.
  e.setTool('erase'); e.settings.radius = 0.004;
  const other = ndcOf(new Vector3().fromArray(e.locks[1].x, 15 * 3), cam);
  assert.ok(e.pointerDown(other, cam, {})); e.pointerUp();
  assert.ok(e.locks.length < planted, 'the lock under the circle was erased');
  const erased = planted - e.locks.length;
  assert.equal(e.locks.length, planted - erased);
  e.undo();
  assert.equal(e.locks.length, planted, 'undo restored the erased lock');
  e.undo();
  assert.ok(Math.abs(lockLength(e.locks[0]) - before) < 1e-4, 'undo restored the cut length');
  e.end();
});

test('every ready-made part adds locks as its own group, outside the head and not standing up over it', () => {
  const e = editor();
  let headTop = -Infinity;
  for (const item of e.scalpIndex()) headTop = Math.max(headTop, item.p.y);
  for (const id of ['base', 'bangs', 'sidebangs', 'sides', 'backShort', 'backMid', 'backLong', 'ponytail', 'pigtails']) {
    const before = e.locks.length, made = e.addPart(id);
    assert.ok(made > 0, `${id} made locks`);
    const added = e.locks.slice(before);
    assert.ok(added.every(lock => lock.group.startsWith(`${id}-`)), `${id} is one group`);
    for (const lock of added) {
      let top = -Infinity;
      for (let i = 0; i < N; i++) top = Math.max(top, lock.x[i * 3 + 1]);
      assert.ok(top - headTop < 0.03, `${id}: a lock rises ${((top - headTop) * 100).toFixed(1)} cm over the head`);
    }
    e.removeGroup(e.locks.at(-1).group);
    assert.equal(e.locks.length, before, `${id} removed as a group`);
  }
  e.end();
});

test('a drawn hairstyle saves and loads unchanged', () => {
  const e = editor(), cam = camera(e);
  drag(e, cam, stroke(e, 1)); drag(e, cam, stroke(e, -1, 0.3));
  const data = e.serialize(), count = e.locks.length;
  e.end();
  const f = new HairEditor(renderer);
  f.begin(human, data, 0x30231e);
  assert.equal(f.locks.length, count);
  let off = 0;
  const saved = e.serialize ? data : null;
  f.locks.forEach((lock, k) => { for (let i = 0; i < N * 3; i++) off = Math.max(off, Math.abs(lock.x[i] - (saved.locks[k].p[i] + lock.rootP.getComponent(i % 3)))); });
  assert.ok(off < 5e-4, `loaded hair differs by ${(off * 1000).toFixed(2)} mm`);
  f.end();
});
