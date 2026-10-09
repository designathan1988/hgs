import { Euler, Mesh, MeshBasicMaterial, Plane, Quaternion, Raycaster, SphereGeometry, Vector3 } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { fromLocal, toLocal, mirrorPose, pelvisFromLocal, pelvisToLocal } from './motion.mjs';

const a = new Vector3(), b = new Vector3(), c = new Vector3(), t = new Vector3(), tmp = new Quaternion();
const angleBetween = (u, v) => Math.acos(Math.min(1, Math.max(-1, u.dot(v))));
const clampCos = x => Math.min(1, Math.max(-1, x));
const DEG = Math.PI / 180;

/**
 * Two-joint IK (D. Holden, "Simple Two Joint IK"; Unreal's Two Bone IK): the
 * root and middle joints bend in the plane set by `bend` (where the knee or
 * elbow points) so the chain spans the distance to the target (law of
 * cosines), then the root swings the chain onto the target. World axes go to
 * each joint's local space through the inverse of its world rotation, and the
 * rotations multiply local rotations on the right. `bend` keeps the bend axis
 * defined when the limb is straight.
 */
export function solveTwoBone(root, mid, end, target, bend, eps = 1e-4) {
  root.getWorldPosition(a); mid.getWorldPosition(b); end.getWorldPosition(c); t.copy(target);
  const lab = b.distanceTo(a), lcb = b.distanceTo(c);
  const lat = Math.min(Math.max(t.distanceTo(a), eps), lab + lcb - eps);
  const ca = c.clone().sub(a).normalize(), ba = b.clone().sub(a).normalize(), ab = a.clone().sub(b).normalize(), cb = c.clone().sub(b).normalize();
  const rootAngle0 = angleBetween(ca, ba), midAngle0 = angleBetween(ab, cb);
  const rootAngle1 = Math.acos(clampCos((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const midAngle1 = Math.acos(clampCos((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
  const axis0 = new Vector3().crossVectors(ca, bend);
  if (axis0.lengthSq() < 1e-12) return;
  axis0.normalize();
  const rootWorld = root.getWorldQuaternion(new Quaternion()), midWorld = mid.getWorldQuaternion(new Quaternion());
  root.quaternion.multiply(tmp.setFromAxisAngle(axis0.clone().applyQuaternion(rootWorld.clone().invert()), rootAngle1 - rootAngle0));
  mid.quaternion.multiply(tmp.setFromAxisAngle(axis0.clone().applyQuaternion(midWorld.invert()), midAngle1 - midAngle0));
  root.updateMatrixWorld(true);
  // Swing: the chain now spans the target's distance; turn the root so the end lands on it.
  end.getWorldPosition(c);
  const ct = c.clone().sub(a).normalize(), at = t.clone().sub(a).normalize(), axis1 = new Vector3().crossVectors(ct, at);
  if (axis1.lengthSq() > 1e-12) {
    root.getWorldQuaternion(rootWorld);
    root.quaternion.multiply(tmp.setFromAxisAngle(axis1.normalize().applyQuaternion(rootWorld.invert()), angleBetween(ct, at)));
    root.updateMatrixWorld(true);
  }
}

/** The bone with the largest skin weight summed over the corners of the hit triangle. */
export function boneUnder(hit) {
  const g = hit.object.geometry, index = g.getAttribute('skinIndex'), weight = g.getAttribute('skinWeight'), sum = new Map();
  if (!index || !weight || !hit.face) return null;
  for (const v of [hit.face.a, hit.face.b, hit.face.c]) for (let k = 0; k < 4; k++) {
    const j = index.getComponent(v, k);
    sum.set(j, (sum.get(j) ?? 0) + weight.getComponent(v, k));
  }
  let best = -1, most = 0;
  for (const [j, w] of sum) if (w > most) { most = w; best = j; }
  return best < 0 ? null : hit.object.skeleton.bones[best];
}

// IK chains: [root, middle, end, bend direction in the character's frame (+Z forward)]. Elbows point back, knees forward.
const chains = {
  hand_l: ['upperarm_l', 'lowerarm_l', 'hand_l', [0, 0, -1]], hand_r: ['upperarm_r', 'lowerarm_r', 'hand_r', [0, 0, -1]],
  foot_l: ['thigh_l', 'calf_l', 'foot_l', [0, 0, 1]], foot_r: ['thigh_r', 'calf_r', 'foot_r', [0, 0, 1]],
};
const opposite = name => name.endsWith('_l') ? `${name.slice(0, -2)}_r` : name.endsWith('_r') ? `${name.slice(0, -2)}_l` : name;

/**
 * Joint limits in degrees, per axis of the bone at rest (X bends, Y twists along the bone, Z leans
 * sideways), for the left side; the right side mirrors Y and Z. Measured on the rig: +X bends the
 * knee and the elbow, −X lifts the thigh forward, +X bends spine, neck and head forward, +Z raises
 * the left arm sideways and brings the left thigh in. Ranges follow the usual active ranges of
 * motion, a little wider so poses are not cut short.
 */
const LIMITS = {
  spine_01: [[-30, 45], [-35, 35], [-30, 30]], spine_02: [[-30, 45], [-35, 35], [-30, 30]], spine_03: [[-30, 45], [-35, 35], [-30, 30]],
  neck_01: [[-40, 50], [-60, 60], [-35, 35]], head: [[-40, 40], [-60, 60], [-35, 35]],
  clavicle: [[-25, 25], [-15, 15], [-15, 35]],
  upperarm: [[-70, 130], [-90, 90], [-45, 140]],
  lowerarm: [[-5, 150], [-90, 90], [-10, 10]],
  hand: [[-80, 80], [-30, 30], [-40, 40]],
  thigh: [[-130, 45], [-45, 45], [-50, 30]],
  calf: [[-5, 150], [-10, 10], [-5, 5]],
  foot: [[-45, 50], [-20, 20], [-30, 30]],
  ball: [[-60, 40], [-5, 5], [-5, 5]],
  thumb_01: [[-40, 60], [-40, 40], [-40, 40]], thumb_02: [[-20, 80], [-10, 10], [-15, 15]], thumb_03: [[-20, 90], [-10, 10], [-10, 10]],
  finger_01: [[-25, 95], [-10, 10], [-25, 25]], finger_02: [[-10, 110], [-5, 5], [-5, 5]], finger_03: [[-10, 90], [-5, 5], [-5, 5]],
};
export function jointLimits(name) {
  const m = /^(\w+?)_(?:(\d+)_)?([lr])$/.exec(name);
  let entry = LIMITS[name];
  if (!entry && m) {
    const part = m[1], n = m[2];
    entry = part === 'thumb' ? LIMITS[`thumb_${n}`] : ['index', 'middle', 'ring', 'pinky'].includes(part) ? LIMITS[`finger_${n}`] : LIMITS[part];
  }
  if (!entry) return null;
  if (m?.[3] !== 'r') return entry;
  return [entry[0], [-entry[1][1], -entry[1][0]], [-entry[2][1], -entry[2][0]]];
}
// Euler order of the limits: bend first, then the sideways lean, then the twist along the bone.
const ORDER = 'XZY';
/** Clamp an angle (radians) into [min, max]; outside, to the nearer end on the circle (Blender Limit Rotation). */
function clampAngle(value, min, max) {
  if (value >= min && value <= max) return value;
  const gap = end => { const d = Math.abs(value - end) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
  return gap(min) <= gap(max) ? min : max;
}

/**
 * Posing on the character in the scene: a click picks the bone under the cursor and a rotation
 * gizmo turns it (three.js TransformControls, local space); handles at the hands and feet move them
 * by two-joint IK, and the handle at the hips moves the whole body. Pinned hands and feet stay where
 * they are while the rest moves (the IK chain is solved back onto the pin). Joint limits keep every
 * rotation within the joint's range. Poses are read and written as { bone: D, $pelvis } (motion.mjs
 * convention), so they mirror and key the same way the clips do.
 */
export class PoseEditor {
  constructor(renderer) {
    this.renderer = renderer;
    this.active = false; this.symmetry = true; this.limits = true; this.selected = null; this.onCommit = null; this.onSelect = null;
    this.pins = new Set(); this.pinTargets = new Map();
    this.ray = new Raycaster();
    this.handles = new Map();
    // Direct drag of a handle (three.js DragControls): the plane facing the camera through the handle.
    this.dragPlane = new Plane(); this.dragOffset = new Vector3(); this.dragging = null;
  }
  get controls() {
    if (this._controls) return this._controls;
    const r = this.renderer, controls = new TransformControls(r.viewCamera, r.canvas);
    controls.setSpace('local'); controls.setSize(0.75);
    controls.addEventListener('objectChange', () => this.changed());
    controls.addEventListener('mouseUp', () => { this.capturePins(); this.commit(); });
    this._controls = controls;
    return controls;
  }
  /**
   * True when a press belongs to the gizmo. The app's pointerdown runs before the gizmo's, and the
   * gizmo only knows its axis after a hover test; it runs that test itself on pointerdown
   * (TransformControls onPointerDown: pointerHover, then pointerDown), so the same test runs here.
   */
  grabs(event) {
    const controls = this._controls;
    if (!controls?.object) return false;
    if (controls.dragging) return true;
    controls.pointerHover(controls._getPointer(event));
    return controls.axis !== null;
  }
  begin(human, pose) {
    this.human = human; this.active = true;
    this.renderer.scene.add(this.controls.getHelper());
    for (const name of [...Object.keys(chains), 'pelvis']) {
      if (this.handles.has(name)) continue;
      const hips = name === 'pelvis';
      const handle = new Mesh(new SphereGeometry(hips ? 0.035 : 0.025, 16, 12), new MeshBasicMaterial({ color: hips ? 0x4f8cff : 0xf27a2e, depthTest: false, transparent: true, opacity: 0.85 }));
      handle.renderOrder = 10; handle.name = `ik_${name}`;
      this.handles.set(name, handle);
    }
    for (const handle of this.handles.values()) this.renderer.scene.add(handle);
    this.apply(pose ?? {});
    if (this.selected?.isBone) this.select(this.bone(this.selected.name));
  }
  end() {
    if (!this.active) return;
    this.active = false; this.dragging = null;
    this._controls?.detach();
    this._controls?.getHelper().removeFromParent();
    for (const handle of this.handles.values()) handle.removeFromParent();
  }
  rig() { return this.human.context.skeleton; }
  bone(name) { const rig = this.rig(), i = rig.byName.get(name); return i === undefined ? null : rig.bones[i]; }
  /** Put the skeleton in `pose`: rest (bind) pose, then each listed bone's rotation and the pelvis offset. */
  apply(pose) {
    const human = this.human, rig = this.rig();
    human.body.skeleton.pose();
    this.pelvisRest = this.bone('pelvis')?.position.clone() ?? null;
    for (const [name, value] of Object.entries(pose)) {
      if (name === '$pelvis') { this.bone('pelvis')?.position.add(pelvisToLocal(rig, value)); continue; }
      const i = rig.byName.get(name);
      if (i !== undefined) toLocal(rig, i, new Quaternion(...value), rig.bones[i].quaternion);
    }
    human.group.updateMatrixWorld(true);
    this.capturePins();
    this.syncHandles();
  }
  /** The current pose (bones turned away from rest, pelvis offset in the character's axes). */
  read() {
    const rig = this.rig(), out = {}, D = new Quaternion();
    rig.bones.forEach((bone, i) => {
      fromLocal(rig, i, bone.quaternion, D);
      if (1 - Math.abs(D.w) > 1e-6) out[bone.name] = D.toArray().map(v => Math.round(v * 1e5) / 1e5);
    });
    const pelvis = this.bone('pelvis');
    if (pelvis && this.pelvisRest && pelvis.position.distanceToSquared(this.pelvisRest) > 1e-10) {
      out.$pelvis = pelvisFromLocal(rig, pelvis.position.clone().sub(this.pelvisRest)).map(v => Math.round(v * 1e4) / 1e4);
    }
    return out;
  }
  syncHandles() {
    for (const [name, handle] of this.handles) {
      if (handle === this.dragging || (this._controls?.object === handle && this._controls.dragging)) continue;
      this.bone(name)?.getWorldPosition(handle.position);
      handle.material.color.set(name === 'pelvis' ? 0x4f8cff : this.pins.has(name) ? 0xe2445c : 0xf27a2e);
    }
  }
  /** The gizmo on `target` (a bone: rotate in its own axes; a handle: move in world axes); null clears it. */
  select(target) {
    const controls = this.controls;
    this.selected = target ?? null;
    if (!target) controls.detach();
    else if (target.isBone) { controls.setMode('rotate'); controls.setSpace('local'); controls.attach(target); }
    else { controls.setMode('translate'); controls.setSpace('world'); controls.attach(target); }
    this.onSelect?.(this.selected);
  }
  /** Select a bone or a handle by name ('pelvis' with `move` selects the hips handle). */
  selectName(name, { move = false } = {}) {
    if (!this.active) return;
    if (move && this.handles.has(name)) this.select(this.handles.get(name));
    else this.select(this.bone(name));
  }
  /** The name of what the gizmo holds: a bone name, or a handle as `ik_<name>`. */
  get selectedName() { return this.selected?.name ?? null; }
  /** Click at `ndc`: a handle, else the bone under the cursor, gets the gizmo. Returns true when something was picked. */
  pick(ndc) {
    this.ray.setFromCamera(ndc, this.renderer.viewCamera);
    const handle = this.ray.intersectObjects([...this.handles.values()], false)[0]?.object;
    if (handle) { this.select(handle); return true; }
    const meshes = [];
    this.human.group.traverse(object => { if (object.isSkinnedMesh && object.visible) meshes.push(object); });
    const hit = this.ray.intersectObjects(meshes, false)[0];
    const bone = hit ? boneUnder(hit) : null;
    if (!bone || /^hair_/.test(bone.name)) { this.select(null); return false; }
    this.select(bone);
    return true;
  }
  /**
   * Press on a handle: it is picked and follows the cursor on the plane facing the camera
   * through it, keeping the offset of the grabbed point (DragControls, onPointerDown). True when grabbed.
   */
  grabHandle(ndc) {
    if (!this.active) return false;
    const camera = this.renderer.viewCamera;
    this.ray.setFromCamera(ndc, camera);
    const handle = this.ray.intersectObjects([...this.handles.values()], false)[0]?.object;
    if (!handle) return false;
    this.select(handle);
    this.dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(this.dragPlane.normal), handle.position);
    if (!this.ray.ray.intersectPlane(this.dragPlane, this.dragOffset)) return false;
    this.dragOffset.sub(handle.position);
    this.dragging = handle;
    return true;
  }
  /** Cursor moved while a handle is held: the handle goes there and the limb (or the body) follows. */
  dragHandle(ndc) {
    const handle = this.dragging;
    if (!handle) return;
    this.ray.setFromCamera(ndc, this.renderer.viewCamera);
    if (!this.ray.ray.intersectPlane(this.dragPlane, t)) return;
    handle.position.copy(t).sub(this.dragOffset);
    this.changed();
  }
  /** Release: the held handle returns to the hand or foot and the pose is recorded. */
  releaseHandle() {
    if (!this.dragging) return;
    this.dragging = null;
    this.capturePins();
    this.syncHandles();
    this.commit();
  }
  /** Pinned hands and feet keep their current place from now on. */
  capturePins() {
    this.pinTargets.clear();
    for (const name of this.pins) { const bone = this.bone(name); if (bone) this.pinTargets.set(name, bone.getWorldPosition(new Vector3())); }
  }
  togglePin(name) {
    if (this.pins.has(name)) this.pins.delete(name); else this.pins.add(name);
    this.capturePins(); this.syncHandles();
    return this.pins.has(name);
  }
  solveChain(name, target) {
    const [root, mid, end, bend] = chains[name].map((part, i) => i < 3 ? this.bone(part) : part);
    if (!root || !mid || !end) return [];
    const forward = new Vector3(...bend).applyQuaternion(this.human.group.getWorldQuaternion(new Quaternion()));
    solveTwoBone(root, mid, end, target, forward);
    return [root, mid];
  }
  /** Keep bone `bone` within its joint limits (in the axes of its rest pose). True when it was clamped. */
  clampBone(bone) {
    const limits = this.limits && jointLimits(bone.name);
    if (!limits) return false;
    const rig = this.rig(), i = rig.byName.get(bone.name), R = rig.rest[i];
    const local = R.clone().invert().multiply(fromLocal(rig, i, bone.quaternion)).multiply(R);
    const euler = new Euler().setFromQuaternion(local, ORDER);
    let changed = false;
    ['x', 'y', 'z'].forEach((axis, k) => {
      const value = clampAngle(euler[axis], limits[k][0] * DEG, limits[k][1] * DEG);
      if (value !== euler[axis]) { euler[axis] = value; changed = true; }
    });
    if (!changed) return false;
    local.setFromEuler(euler);
    toLocal(rig, i, R.clone().multiply(local).multiply(R.clone().invert()), bone.quaternion);
    return true;
  }
  /** Rotation of `name` in degrees about its own rest axes [bend X, twist Y, lean Z]. */
  angles(name) {
    const rig = this.rig(), i = rig.byName.get(name);
    if (i === undefined) return [0, 0, 0];
    const R = rig.rest[i], local = R.clone().invert().multiply(fromLocal(rig, i, rig.bones[i].quaternion)).multiply(R);
    const euler = new Euler().setFromQuaternion(local, ORDER);
    return [euler.x, euler.y, euler.z].map(v => Math.round(v / DEG * 10) / 10);
  }
  /** Set the rotation of `name` from degrees about its rest axes (clamped to its limits, mirrored with symmetry). */
  setAngles(name, degrees) {
    const rig = this.rig(), i = rig.byName.get(name);
    if (i === undefined) return;
    const R = rig.rest[i], local = new Quaternion().setFromEuler(new Euler(degrees[0] * DEG, degrees[1] * DEG, degrees[2] * DEG, ORDER));
    toLocal(rig, i, R.clone().multiply(local).multiply(R.clone().invert()), rig.bones[i].quaternion);
    this.after([rig.bones[i]]);
  }
  /** The gizmo moved its object: IK for a hand or foot handle, the body for the hips handle, else a turned bone. */
  changed() {
    const object = this._controls?.object;
    if (!object) return;
    const name = [...this.handles].find(([, handle]) => handle === object)?.[0];
    const touched = [];
    if (name === 'pelvis') {
      const pelvis = this.bone('pelvis');
      pelvis.position.copy(pelvis.parent.worldToLocal(object.position.clone()));
      pelvis.updateMatrixWorld(true);
    } else if (name) {
      touched.push(...this.solveChain(name, object.position));
      if (this.pins.has(name)) this.pinTargets.set(name, object.position.clone());
    } else touched.push(object);
    this.after(touched, name);
  }
  /** After `touched` bones changed: limits, the mirrored side, then pinned limbs back onto their pins. */
  after(touched, moving = null) {
    for (const bone of touched) this.clampBone(bone);
    const rig = this.rig();
    if (this.symmetry) {
      const D = new Quaternion();
      for (const bone of touched) {
        const other = this.bone(opposite(bone.name));
        if (!other || other === bone) continue;
        const i = rig.byName.get(bone.name), j = rig.byName.get(other.name);
        const mirrored = mirrorPose({ [bone.name]: fromLocal(rig, i, bone.quaternion, D).toArray() })[other.name];
        toLocal(rig, j, new Quaternion(...mirrored), other.quaternion);
      }
    }
    this.human.group.updateMatrixWorld(true);
    // A pinned limb whose own joints were not just turned goes back onto its pin.
    const turned = new Set(touched.flatMap(bone => [bone.name, opposite(bone.name)]));
    for (const [name, target] of this.pinTargets) {
      if (name === moving || chains[name].slice(0, 2).some(part => this.symmetry ? turned.has(part) : touched.some(bone => bone.name === part))) continue;
      for (const bone of this.solveChain(name, target)) this.clampBone(bone);
    }
    this.human.group.updateMatrixWorld(true);
    this.syncHandles();
  }
  commit() { this.onCommit?.(this.read()); }
  /** Rest the selected bone (or the whole body). */
  reset(all = false) {
    if (all) { this.apply({}); this.commit(); return; }
    const bone = this.selected?.isBone ? this.selected : null;
    const pose = this.read();
    if (!bone) { if (this.selected?.name === 'ik_pelvis') { delete pose.$pelvis; this.apply(pose); this.commit(); } return; }
    delete pose[bone.name];
    if (this.symmetry) delete pose[opposite(bone.name)];
    this.apply(pose); this.commit();
  }
  /** Copy one side onto the other ('l' copies the left side to the right). */
  mirrorSide(from = 'l') {
    const pose = this.read(), mirrored = mirrorPose(pose), out = {};
    for (const [name, value] of Object.entries(pose)) if (!name.endsWith(from === 'l' ? '_r' : '_l')) out[name] = value;
    for (const [name, value] of Object.entries(mirrored)) if (name.endsWith(from === 'l' ? '_r' : '_l')) out[name] = value;
    if (pose.$pelvis) out.$pelvis = pose.$pelvis;
    this.apply(out); this.commit();
  }
  /** The whole pose mirrored left ↔ right. */
  flip() { this.apply(mirrorPose(this.read())); this.commit(); }
}
