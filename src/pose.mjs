import { Mesh, MeshBasicMaterial, Quaternion, Raycaster, SphereGeometry, Vector3 } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { fromLocal, toLocal, mirrorPose } from './motion.mjs';

const a = new Vector3(), b = new Vector3(), c = new Vector3(), t = new Vector3(), tmp = new Quaternion();
const angleBetween = (u, v) => Math.acos(Math.min(1, Math.max(-1, u.dot(v))));
const clampCos = x => Math.min(1, Math.max(-1, x));

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
 * Posing on the character in the scene: a click picks the bone under the
 * cursor and a rotation gizmo turns it (three.js TransformControls, local
 * space); handles at the hands and feet move them by two-joint IK. Poses are
 * read and written as { bone: D, $pelvis } (motion.mjs convention), so they
 * mirror and key the same way the clips do.
 */
export class PoseEditor {
  constructor(renderer) {
    this.renderer = renderer;
    this.active = false; this.symmetry = true; this.selected = null; this.onCommit = null;
    this.ray = new Raycaster();
    this.handles = new Map();
  }
  get controls() {
    if (this._controls) return this._controls;
    const r = this.renderer, controls = new TransformControls(r.viewCamera, r.canvas);
    controls.setSpace('local'); controls.setSize(0.75);
    controls.addEventListener('objectChange', () => this.changed());
    controls.addEventListener('mouseUp', () => this.commit());
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
    this.apply(pose ?? {});
    for (const name of Object.keys(chains)) {
      if (this.handles.has(name)) continue;
      const handle = new Mesh(new SphereGeometry(0.025, 16, 12), new MeshBasicMaterial({ color: 0xf27a2e, depthTest: false, transparent: true, opacity: 0.85 }));
      handle.renderOrder = 10; handle.name = `ik_${name}`;
      this.handles.set(name, handle);
    }
    for (const handle of this.handles.values()) this.renderer.scene.add(handle);
    this.syncHandles();
  }
  end() {
    if (!this.active) return;
    this.active = false; this.selected = null;
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
      if (name === '$pelvis') { this.bone('pelvis')?.position.add(new Vector3(...value)); continue; }
      const i = rig.byName.get(name);
      if (i !== undefined) toLocal(rig, i, new Quaternion(...value), rig.bones[i].quaternion);
    }
    human.group.updateMatrixWorld(true);
    this.syncHandles();
  }
  /** The current pose (bones turned away from rest, pelvis offset). */
  read() {
    const rig = this.rig(), out = {}, D = new Quaternion();
    rig.bones.forEach((bone, i) => {
      fromLocal(rig, i, bone.quaternion, D);
      if (1 - Math.abs(D.w) > 1e-6) out[bone.name] = D.toArray().map(v => Math.round(v * 1e5) / 1e5);
    });
    const pelvis = this.bone('pelvis');
    if (pelvis && this.pelvisRest && pelvis.position.distanceToSquared(this.pelvisRest) > 1e-10) out.$pelvis = pelvis.position.clone().sub(this.pelvisRest).toArray();
    return out;
  }
  syncHandles() {
    for (const [name, handle] of this.handles) {
      if (this._controls?.object === handle && this._controls.dragging) continue;
      this.bone(name)?.getWorldPosition(handle.position);
    }
  }
  /** Click at `ndc`: an IK handle, else the bone under the cursor, gets the gizmo. Returns true when something was picked. */
  pick(ndc) {
    this.ray.setFromCamera(ndc, this.renderer.viewCamera);
    const handle = this.ray.intersectObjects([...this.handles.values()], false)[0]?.object;
    if (handle) { this.selected = handle; this.controls.setMode('translate'); this.controls.setSpace('world'); this.controls.attach(handle); return true; }
    const meshes = [];
    this.human.group.traverse(object => { if (object.isSkinnedMesh && object.visible) meshes.push(object); });
    const hit = this.ray.intersectObjects(meshes, false)[0];
    const bone = hit ? boneUnder(hit) : null;
    if (!bone || /^hair_/.test(bone.name)) { this.controls.detach(); this.selected = null; return false; }
    this.selected = bone; this.controls.setMode('rotate'); this.controls.setSpace('local'); this.controls.attach(bone);
    return true;
  }
  /** The gizmo moved its object: IK for a handle, mirrored copy with symmetry on. */
  changed() {
    const object = this._controls?.object;
    if (!object) return;
    const name = [...this.handles].find(([, handle]) => handle === object)?.[0];
    const touched = [];
    if (name) {
      const [root, mid, end, bend] = chains[name].map((part, i) => i < 3 ? this.bone(part) : part);
      if (!root || !mid || !end) return;
      const forward = new Vector3(...bend).applyQuaternion(this.human.group.getWorldQuaternion(new Quaternion()));
      solveTwoBone(root, mid, end, object.position, forward);
      touched.push(root, mid);
    } else touched.push(object);
    if (this.symmetry) {
      const rig = this.rig(), D = new Quaternion();
      for (const bone of touched) {
        const other = this.bone(opposite(bone.name));
        if (!other || other === bone) continue;
        const i = rig.byName.get(bone.name), j = rig.byName.get(other.name);
        const mirrored = mirrorPose({ [bone.name]: fromLocal(rig, i, bone.quaternion, D).toArray() })[other.name];
        toLocal(rig, j, new Quaternion(...mirrored), other.quaternion);
      }
      this.human.group.updateMatrixWorld(true);
    }
    this.syncHandles();
  }
  commit() { this.onCommit?.(this.read()); }
  /** Rest the selected bone (or the whole body). */
  reset(all = false) {
    if (all) { this.apply({}); this.commit(); return; }
    const bone = this.selected?.isBone ? this.selected : null;
    if (!bone) return;
    const pose = this.read();
    delete pose[bone.name];
    if (this.symmetry) delete pose[opposite(bone.name)];
    this.apply(pose); this.commit();
  }
  /** Copy one side onto the other ('l' copies the left side to the right). */
  mirrorSide(from = 'l') {
    const pose = this.read(), mirrored = mirrorPose(pose), out = {};
    for (const [name, value] of Object.entries(pose)) if (!name.endsWith(from === 'l' ? '_r' : '_l')) out[name] = value;
    for (const [name, value] of Object.entries(mirrored)) if (name.endsWith(from === 'l' ? '_r' : '_l')) out[name] = value;
    this.apply(out); this.commit();
  }
}
