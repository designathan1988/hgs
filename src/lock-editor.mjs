import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, Plane, QuadraticBezierCurve3, Raycaster, SphereGeometry, Vector3,
} from 'three';
import {
  LOCK_POINTS as N, arcLengthAt, bendLock, geometryFrom, lockLength, lockLimits, lockMaterial, lockSurface,
  locksScalpColors, locksUnderlayGeometry, makeLock, normalizeLocks, prepareLocks, resamplePolyline, rootFromHit,
  serializeLocks, setLockLength, underlayMaterial, updateGeometry, combLock,
} from './locks.mjs';

export const lockTools = ['brush', 'pull', 'select', 'grow', 'cut', 'pin'];
const SLOT_PREFIX = 'hgs.locks.';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const storage = {
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

/**
 * Interactive mesh-lock editor on the rest pose: pull locks out of the scalp,
 * select and shape them, cut, pin, simulate gravity and set the settled
 * result as the hairstyle's rest shape. Every lock is its own mesh while
 * editing (for picking); the game build merges them.
 */
export class LockEditor {
  constructor(renderer) {
    this.renderer = renderer;
    this.raycaster = new Raycaster();
    this.settings = { tool: 'brush', brushLength: 0.25, brushSpacing: 0.022, running: true, gravity: true, pinOnRelease: false, showScalp: false, mirror: false, width: 0.05, volume: 0.18, taper: 0.85 };
    this.selected = new Set();
    this.state = null; this.undoStack = []; this.redoStack = [];
    this.onChange = () => {};
  }
  get active() { return Boolean(this.state); }
  get locks() { return this.state?.locks ?? []; }

  begin(human, data, color) {
    this.end();
    this.human = human; this.context = human.context; this.color = color;
    this.state = prepareLocks(this.context, data);
    this.applySimSettings();
    this.rest();
    this.selected.clear();
    for (const name of ['Hair', 'ScalpUnderlay']) { const mesh = human.group.getObjectByName(name); if (mesh) mesh.visible = false; }
    const scene = this.renderer.scene;
    this.group = new Group(); this.group.name = 'LockEditor'; scene.add(this.group);
    this.materials = { normal: lockMaterial(color), selected: lockMaterial(color, { highlight: true }) };
    this.meshes = [];
    this.handleGeometry = new SphereGeometry(1, 10, 8);
    this.handles = new InstancedMesh(this.handleGeometry, new MeshBasicMaterial({ color: 0xffc27a, depthTest: false, transparent: true, opacity: 0.85 }), 400);
    this.handles.renderOrder = 9; this.handles.count = 0; this.handles.frustumCulled = false;
    this.pinMarks = new InstancedMesh(this.handleGeometry, new MeshBasicMaterial({ color: 0xff3b5c, depthTest: false }), 400);
    this.pinMarks.renderOrder = 10; this.pinMarks.count = 0; this.pinMarks.frustumCulled = false;
    this.scalpOverlay = new Mesh(this.scalpGeometry(), new MeshBasicMaterial({ color: 0x46d39a, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide }));
    this.scalpOverlay.renderOrder = 3;
    this.underlay = new Mesh(new BufferGeometry(), underlayMaterial());
    this.underlay.renderOrder = 2;
    this.hoverMark = new Mesh(this.handleGeometry, new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
    this.hoverMark.renderOrder = 11; this.hoverMark.visible = false;
    this.group.add(this.handles, this.pinMarks, this.scalpOverlay, this.underlay, this.hoverMark);
    this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers();
    this.accumulator = 0;
  }
  end() {
    if (!this.state) return null;
    const result = this.serialize();
    this.group?.traverse(object => { object.geometry?.dispose(); });
    this.group?.removeFromParent();
    for (const material of Object.values(this.materials ?? {})) material.dispose();
    for (const name of ['Hair', 'ScalpUnderlay']) { const mesh = this.human?.group.getObjectByName(name); if (mesh) mesh.visible = true; }
    this.state = null; this.meshes = []; this.drag = null;
    return result;
  }
  serialize() { return this.state ? serializeLocks(this.state) : null; }
  setColor(color) { this.color = color; this.materials?.normal.color.set(color); this.materials?.selected.color.set(color); this.updateUnderlay(); }
  applySimSettings() {
    const sim = this.state?.sim;
    if (!sim) return;
    sim.gravity = this.settings.gravity ? 9.81 : 0;
    sim.wake();
  }

  // ----------------------------------------------------------- history
  checkpoint() {
    this.revision = (this.revision ?? 0) + 1;
    this.undoStack.push(JSON.stringify(this.serialize()));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }
  restore(json, keepSelection = false) {
    const data = JSON.parse(json);
    const selection = [...this.selected];
    this.state = prepareLocks(this.context, data);
    this.applySimSettings();
    // A loaded or restored hairstyle is shown exactly as saved: it stays at
    // rest until something is edited (any edit wakes the simulation).
    this.rest();
    this.selected = new Set(keepSelection ? selection.filter(i => i < this.locks.length) : []);
    this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers(); this.onChange();
  }
  undo() { this.revision = (this.revision ?? 0) + 1; this.undoOnce(); }
  undoOnce() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.serialize())); this.restore(this.undoStack.pop(), true); }
  redo() { this.revision = (this.revision ?? 0) + 1; this.redoOnce(); }
  redoOnce() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.serialize())); this.restore(this.redoStack.pop(), true); }

  // ------------------------------------------------------------ scene
  scalpGeometry() {
    const { positions, field, frame, data } = this.state, n = this.state.normals;
    const pos = [], index = [];
    for (const face of frame.faces) {
      const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
      if (!ids.every(v => field[v] >= -0.06)) continue;
      const at = pos.length / 3;
      for (const v of ids) pos.push(positions[v * 3] + n[v * 3] * 0.0016, positions[v * 3 + 1] + n[v * 3 + 1] * 0.0016, positions[v * 3 + 2] + n[v * 3 + 2] * 0.0016);
      index.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
    return geometry;
  }
  updateUnderlay() {
    if (!this.underlay) return;
    this.underlay.geometry.dispose();
    this.underlay.geometry = locksUnderlayGeometry(this.human.body.geometry, locksScalpColors(this.state), this.color) ?? new BufferGeometry();
  }
  /** Rebuild lock meshes whose chain moved (or all). */
  syncMeshes(all = false) {
    const locks = this.locks;
    while (this.meshes.length > locks.length) { const mesh = this.meshes.pop(); mesh.geometry.dispose(); mesh.removeFromParent(); }
    while (this.meshes.length < locks.length) { const mesh = new Mesh(new BufferGeometry(), this.materials.normal); mesh.frustumCulled = false; this.group.add(mesh); this.meshes.push(mesh); }
    locks.forEach((lock, n) => {
      const mesh = this.meshes[n];
      mesh.userData.index = n;
      mesh.material = this.selected.has(n) ? this.materials.selected : this.materials.normal;
      const key = `${lock.width},${lock.volume},${lock.taper},${lock.curl},${lock.turns},${lock.twist}`;
      if (!all && lock.built && key === lock.builtKey && !moved(lock.built, lock.x)) return;
      lock.built = Float32Array.from(lock.x); lock.builtKey = key;
      const part = lockSurface(lock, this.state);
      if (!updateGeometry(mesh.geometry, part)) { mesh.geometry.dispose(); mesh.geometry = geometryFrom([part]); }
    });
  }
  updateHelpers() {
    if (!this.handles) return;
    const m = new Matrix4(), k = this.state.frame.R / 0.11;
    let h = 0, p = 0;
    this.locks.forEach((lock, n) => {
      if (this.selected.has(n)) for (let i = 2; i < N && h < 400; i++) {
        const s = 0.0042 * k;
        m.makeScale(s, s, s).setPosition(lock.x[i * 3], lock.x[i * 3 + 1], lock.x[i * 3 + 2]);
        this.handles.setMatrixAt(h++, m);
      }
      for (const [i] of lock.pins) if (p < 400) {
        const s = 0.0062 * k;
        m.makeScale(s, s, s).setPosition(lock.x[i * 3], lock.x[i * 3 + 1], lock.x[i * 3 + 2]);
        this.pinMarks.setMatrixAt(p++, m);
      }
    });
    this.handles.count = h; this.pinMarks.count = p;
    this.handles.instanceMatrix.needsUpdate = true; this.pinMarks.instanceMatrix.needsUpdate = true;
    this.scalpOverlay.visible = this.settings.tool === 'pull' && this.settings.showScalp;
  }
  /** Per frame: fixed 1/60 s steps (at most two), then refresh what moved. */
  step(dt) {
    if (!this.state) return;
    const sim = this.state.sim;
    let stepped = false;
    if (this.settings.running) {
      this.accumulator = Math.min(this.accumulator + (Number.isFinite(dt) ? dt : 1 / 60), 2 / 60);
      while (this.accumulator >= 1 / 60) { if (sim.step(1 / 60)) stepped = true; this.accumulator -= 1 / 60; }
    }
    if (stepped || this.dirty) {
      this.dirty = false;
      this.syncMeshes(); this.updateHelpers();
      const status = this.status();
      if (status !== this.lastStatus) { this.lastStatus = status; this.onChange(); }
    }
  }
  status() {
    if (!this.settings.running) return 'paused';
    return this.state?.sim.sleeping ? 'settled' : 'simulating';
  }
  /** Put every lock to sleep where it is (exactly the stored shape). */
  rest() {
    const sim = this.state.sim;
    for (const lock of this.state.locks) lock.calm = 12;
    sim.sleeping = true;
  }
  touch() { if (this.settings.running) this.state.sim.wake(); this.dirty = true; }

  // ----------------------------------------------------------- picking
  probe() {
    const body = this.human.body;
    this.bodyProbe ??= new Mesh(body.geometry, new MeshBasicMaterial({ side: DoubleSide }));
    this.bodyProbe.geometry = body.geometry;
    return this.bodyProbe;
  }
  pickLock(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const [hit] = this.raycaster.intersectObjects(this.meshes, false);
    return hit ? { index: hit.object.userData.index, point: hit.point.clone(), distance: hit.distance } : null;
  }
  pickScalp(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const [hit] = this.raycaster.intersectObject(this.probe(), false);
    if (!hit) return null;
    const baseIds = this.human.body.geometry.userData.baseIds;
    const root = rootFromHit(this.state, [hit.face.a, hit.face.b, hit.face.c].map(v => baseIds[v]), hit.point);
    return { root, point: hit.point.clone(), distance: hit.distance };
  }
  /**
   * The chain point nearest the cursor on screen (within ~20 px): on the
   * selected locks first (their points are drawn on top), else on the lock
   * under the cursor. Points need not be hit exactly.
   */
  pickPoint(ndc, camera) {
    const limit = 0.05, p = new Vector3();
    let best = null, bestD = limit * limit;
    const scan = n => {
      const lock = this.locks[n];
      for (let i = 2; i < N; i++) {
        p.fromArray(lock.x, i * 3).project(camera);
        if (p.z > 1) continue;
        const d = ((p.x - ndc.x) * camera.aspect) ** 2 + (p.y - ndc.y) ** 2;
        if (d < bestD) { bestD = d; best = { index: n, pointIndex: i, point: new Vector3().fromArray(lock.x, i * 3) }; }
      }
    };
    for (const n of this.selected) if (this.locks[n]) scan(n);
    if (best) return best;
    const hit = this.pickLock(ndc, camera);
    if (!hit) return null;
    return { index: hit.index, pointIndex: this.nearestIndex(this.locks[hit.index], hit.point), point: hit.point, distance: hit.distance };
  }
  /** Highlight the point the current tool would take. */
  hover(ndc, camera) {
    if (!this.state || this.drag) return;
    const tool = this.settings.tool, mark = this.hoverMark;
    const pick = ['pull', 'pin', 'grow'].includes(tool) ? this.pickPoint(ndc, camera) : null;
    mark.visible = Boolean(pick);
    if (!pick) return;
    const lock = this.locks[pick.index], i = tool === 'grow' ? N - 1 : pick.pointIndex, size = 0.0068 * this.state.frame.R / 0.11;
    mark.position.fromArray(lock.x, i * 3); mark.scale.setScalar(size);
  }
  nearestIndex(lock, point) {
    let best = Infinity, index = N - 1;
    for (let i = 2; i < N; i++) {
      const d = (lock.x[i * 3] - point.x) ** 2 + (lock.x[i * 3 + 1] - point.y) ** 2 + (lock.x[i * 3 + 2] - point.z) ** 2;
      if (d < best) { best = d; index = i; }
    }
    return index;
  }

  // ------------------------------------------------------------- tools
  setTool(tool) { this.settings.tool = tool; this.updateHelpers(); }
  pointerDown(ndc, camera, { shift = false, ctrl = false } = {}) {
    if (!this.state) return false;
    const tool = this.settings.tool;
    const lockHit = this.pickLock(ndc, camera);
    if (tool === 'select') {
      if (!lockHit) { if (!shift && !ctrl) this.clearSelection(); return true; }
      this.choose(lockHit.index, { shift, ctrl });
      return true;
    }
    if (tool === 'brush') {
      const scalpHit = this.pickScalp(ndc, camera);
      if (!scalpHit?.root) return false;
      this.checkpoint();
      if (!shift) this.selected.clear();
      this.drag = { tool, last: scalpHit.point.clone(), lastNdc: { x: ndc.x, y: ndc.y }, made: 0 };
      return true;
    }
    if (tool === 'pull') {
      const scalpHit = this.pickScalp(ndc, camera);
      const point = this.pickPoint(ndc, camera);
      // A lock point near the cursor is grabbed; bare scalp sprouts a new lock.
      if (point && (!scalpHit || point.distance === undefined || point.distance <= scalpHit.distance + 0.002)) return this.grab(point, camera, { shift, ctrl });
      if (scalpHit?.root) return this.sprout(scalpHit, camera, { shift });
      return false;
    }
    if (tool === 'grow') {
      if (!lockHit) return false;
      this.checkpoint();
      const lock = this.locks[lockHit.index];
      if (!this.selected.has(lockHit.index)) this.choose(lockHit.index, { shift, ctrl: false });
      const tip = new Vector3().fromArray(lock.x, (N - 1) * 3), before = new Vector3().fromArray(lock.x, (N - 2) * 3);
      const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), tip);
      this.raycaster.setFromCamera(ndc, camera);
      const start = this.raycaster.ray.intersectPlane(plane, new Vector3()) ?? tip.clone();
      this.drag = { tool, lock, plane, start, length: lockLength(lock), direction: tip.sub(before).normalize() };
      return true;
    }
    if (tool === 'cut') {
      if (!lockHit) return false;
      this.checkpoint();
      this.drag = { tool, cut: new Set(), last: { x: ndc.x, y: ndc.y } };
      this.cutAt(lockHit);
      return true;
    }
    if (tool === 'pin') {
      const pick = this.pickPoint(ndc, camera);
      if (!pick) return false;
      this.checkpoint();
      const lockHit = pick, lock = this.locks[pick.index], i = pick.pointIndex;
      const existing = [i - 1, i, i + 1].find(j => lock.pins.has(j));
      if (existing !== undefined) lock.pins.delete(existing);
      else lock.pins.set(i, new Vector3().fromArray(lock.x, i * 3));
      if (!this.selected.has(lockHit.index)) this.choose(lockHit.index, { shift: true });
      this.touch(); this.updateHelpers(); this.onChange();
      return true;
    }
    return false;
  }
  choose(index, { shift = false, ctrl = false } = {}) {
    if (!shift && !ctrl) this.selected.clear();
    if (ctrl && this.selected.has(index)) this.selected.delete(index); else this.selected.add(index);
    this.syncMeshes(); this.updateHelpers(); this.onChange();
  }
  /** Pull a new lock out of the scalp: it grows from the root to the cursor. */
  sprout(hit, camera, { shift = false } = {}) {
    this.checkpoint();
    const lock = makeLock(this.state, hit.root, null, { width: this.settings.width, volume: this.settings.volume, taper: this.settings.taper });
    this.locks.push(lock);
    const n = this.locks.length - 1;
    if (!shift) this.selected.clear();
    this.selected.add(n);
    const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), lock.rootP.clone().addScaledVector(lock.rootN, 0.01));
    // Mirror: the same lock on the other side of the head (the body is symmetric in x).
    const twinRoot = this.settings.mirror && Math.abs(lock.rootP.x) > 0.004 ? this.mirrorRoot(lock) : null;
    let twin = null;
    if (twinRoot) {
      twin = makeLock(this.state, twinRoot, null, { width: lock.width, volume: lock.volume, taper: lock.taper });
      this.locks.push(twin);
      this.selected.add(this.locks.length - 1);
    }
    this.drag = { tool: 'sprout', lock, twin, plane };
    this.shapeSprout(lock, lock.rootP.clone().addScaledVector(lock.rootN, 0.03));
    if (twin) this.shapeSprout(twin, twin.rootP.clone().addScaledVector(twin.rootN, 0.03));
    this.syncMeshes(); this.updateUnderlay(); this.updateHelpers(); this.onChange();
    return true;
  }
  /** Root mirrored across the body's mid-plane (x = 0), found on the scalp by a ray. */
  mirrorRoot(lock) {
    const p = lock.rootP.clone(), n = lock.rootN.clone();
    p.x = -p.x; n.x = -n.x;
    this.raycaster.set(p.clone().addScaledVector(n, 0.05), n.clone().negate());
    const [hit] = this.raycaster.intersectObject(this.probe(), false);
    if (!hit || hit.point.distanceTo(p) > 0.02) return null;
    const baseIds = this.human.body.geometry.userData.baseIds;
    return rootFromHit(this.state, [hit.face.a, hit.face.b, hit.face.c].map(v => baseIds[v]), hit.point);
  }
  /** Lay a sprouting lock along a curve that leaves the root along its normal and ends at the cursor. */
  shapeSprout(lock, target) {
    const root = lock.rootP, chord = target.clone().sub(root);
    let length = clamp(chord.length(), 0.02, lockLimits.length[1]);
    if (chord.lengthSq() < 1e-8) chord.copy(lock.rootN);
    chord.setLength(length);
    const end = root.clone().add(chord);
    // The lock leaves the scalp almost along it (hair grows at a low angle),
    // lifted just enough to clear the head, then heads for the cursor.
    const along = chord.clone().addScaledVector(lock.rootN, -chord.dot(lock.rootN));
    const control = root.clone().addScaledVector(along.lengthSq() > 1e-10 ? along.normalize() : lock.rootN, Math.min(0.04, length * 0.3)).addScaledVector(lock.rootN, Math.min(0.012, length * 0.12));
    const curve = new QuadraticBezierCurve3(root, control, end);
    const dense = new Float32Array(64 * 3);
    curve.getPoints(63).forEach((p, i) => dense.set(p.toArray(), i * 3));
    length = clamp(curve.getLength(), 0.02, lockLimits.length[1]);
    const points = resamplePolyline(dense, length);
    lock.x.set(points); lock.rest.set(points); lock.old.set(points);
    lock.seg = length / (N - 1);
    lock.hold = Float32Array.from(points);
  }
  grab(hit, camera, { shift = false, ctrl = false } = {}) {
    this.checkpoint();
    const lock = this.locks[hit.index], index = hit.pointIndex ?? this.nearestIndex(lock, hit.point);
    if (!this.selected.has(hit.index) || shift || ctrl) this.choose(hit.index, { shift: shift || this.selected.has(hit.index), ctrl: false });
    const at = new Vector3().fromArray(lock.x, index * 3);
    this.hoverMark.visible = false;
    const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), at);
    lock.grab = { index, point: at.clone() };
    this.drag = { tool: 'grab', lock, plane, offset: at.clone().sub(hit.point) };
    this.touch();
    return true;
  }
  cutAt(hit) {
    const lock = this.locks[hit.index];
    if (this.drag.cut.has(lock)) return;
    this.drag.cut.add(lock);
    setLockLength(lock, Math.max(lockLimits.length[0], arcLengthAt(lock, hit.point)));
    this.state.sim.pose(lock);
    this.touch(); this.onChange();
  }
  pointerMove(ndc, camera) {
    const drag = this.drag;
    if (!drag || !this.state) return;
    this.raycaster.setFromCamera(ndc, camera);
    if (drag.tool === 'sprout' || drag.tool === 'grab') {
      const point = this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      if (!point) return;
      if (drag.tool === 'sprout') {
        this.shapeSprout(drag.lock, point);
        if (drag.twin) this.shapeSprout(drag.twin, new Vector3(-point.x, point.y, point.z));
      } else {
        drag.lock.grab.point.copy(point.add(drag.offset));
        // Paused: the lock is shaped directly (no dynamics); running: physics follows.
        if (!this.settings.running) this.state.sim.pose(drag.lock);
      }
      this.touch();
      return;
    }
    if (drag.tool === 'brush') {
      // Every few centimetres along the stroke a lock is combed from the
      // scalp in the stroke's direction (and mirrored when asked).
      // The stroke is followed on screen in small steps, so a fast move
      // still plants locks all along it.
      const from = drag.lastNdc ?? { x: ndc.x, y: ndc.y }, n = Math.max(1, Math.ceil(Math.hypot(ndc.x - from.x, ndc.y - from.y) / 0.004));
      const params = { width: this.settings.width, volume: this.settings.volume, taper: this.settings.taper };
      for (let k = 1; k <= n; k++) {
        const hit = this.pickScalp({ x: from.x + (ndc.x - from.x) * k / n, y: from.y + (ndc.y - from.y) * k / n }, camera);
        if (!hit?.root) continue;
        const step = hit.point.clone().sub(drag.last);
        if (step.length() < this.settings.brushSpacing) continue;
        const lock = combLock(this.state, hit.root, step, this.settings.brushLength, params);
        this.locks.push(lock); this.selected.add(this.locks.length - 1);
        const twinRoot = this.settings.mirror && Math.abs(lock.rootP.x) > 0.004 ? this.mirrorRoot(lock) : null;
        if (twinRoot) { this.locks.push(combLock(this.state, twinRoot, new Vector3(-step.x, step.y, step.z), this.settings.brushLength, params)); this.selected.add(this.locks.length - 1); }
        drag.last.copy(hit.point); drag.made++;
      }
      drag.lastNdc = { x: ndc.x, y: ndc.y };
      this.touch(); this.syncMeshes(); this.updateHelpers();
      return;
    }
    if (drag.tool === 'grow') {
      // The drag along the tip's direction (on screen, in the plane at the tip) is added to the length.
      const point = this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      if (!point) return;
      const length = drag.length + point.sub(drag.start).dot(drag.direction) * 1.5;
      setLockLength(drag.lock, length);
      this.state.sim.pose(drag.lock);
      this.touch(); this.onChange();
      return;
    }
    if (drag.tool === 'cut') {
      // Scissors along the whole stroke, not only where pointer events land.
      const from = drag.last ?? { x: ndc.x, y: ndc.y }, steps = Math.max(1, Math.ceil(Math.hypot(ndc.x - from.x, ndc.y - from.y) / 0.006));
      for (let k = 1; k <= steps; k++) {
        const hit = this.pickLock({ x: from.x + (ndc.x - from.x) * k / steps, y: from.y + (ndc.y - from.y) * k / steps }, camera);
        if (hit) this.cutAt(hit);
      }
      drag.last = { x: ndc.x, y: ndc.y };
    }
  }
  pointerUp({ pin = false } = {}) {
    const drag = this.drag;
    // The panel shows the values the stroke ended with.
    this.revision = (this.revision ?? 0) + 1;
    this.drag = null;
    if (!drag || !this.state) return;
    const lock = drag.lock;
    if (drag.tool === 'sprout') {
      for (const l of [lock, drag.twin].filter(Boolean)) {
        l.hold = null;
        l.rest.set(l.x); l.old.set(l.x);
        if (!this.settings.running) this.state.sim.pose(l);
      }
    }
    if (drag.tool === 'grab') {
      const { index } = lock.grab;
      if (!this.settings.running) this.state.sim.pose(lock);
      if (pin || this.settings.pinOnRelease) lock.pins.set(index, new Vector3().fromArray(lock.x, index * 3));
      lock.grab = null;
      // Paused: what was shaped by hand is now the lock's shape.
      if (!this.settings.running) lock.rest.set(lock.x);
    }
    this.touch(); this.updateUnderlay(); this.updateHelpers(); this.onChange();
  }

  // ------------------------------------------------------- operations
  /** The selected locks (or every lock when `all`). */
  targets(all = false) { return all || !this.selected.size ? this.locks : [...this.selected].map(n => this.locks[n]).filter(Boolean); }
  edit(fn, { all = false, record = true } = {}) {
    if (!this.state) return;
    const list = this.targets(all);
    if (!list.length) return;
    if (record) this.checkpoint();
    for (const lock of list) fn(lock);
    if (!this.settings.running) for (const lock of list) this.state.sim.pose(lock);
    this.touch(); this.syncMeshes(); this.updateHelpers(); this.onChange();
  }
  setParam(key, value, record = false) { this.edit(lock => { lock[key] = clamp(value, ...lockLimits[key]); }, { record }); }
  scaleParam(key, factor) { this.edit(lock => { lock[key] = clamp(lock[key] * factor, ...lockLimits[key]); }); }
  setLength(value, record = false) { this.edit(lock => setLockLength(lock, value), { record }); }
  scaleLength(factor) { this.edit(lock => setLockLength(lock, lockLength(lock) * factor)); }
  /** Bend from the shape the selection had when the slider was grabbed. */
  beginBend() { this.checkpoint(); this.bendBase = new Map(this.targets().map(lock => [lock, { x: Float32Array.from(lock.x), rest: Float32Array.from(lock.rest) }])); }
  bend(amount) {
    if (!this.bendBase) this.beginBend();
    this.edit(lock => { const base = this.bendBase.get(lock); if (base) bendLock(lock, base, amount, this.state.frame); }, { record: false });
  }
  endBend() { this.bendBase = null; }
  /** The settled result becomes the styled rest shape (held against gravity). */
  setRest() { this.edit(lock => { lock.rest.set(lock.x); lock.styled = true; lock.old.set(lock.x); }, { all: !this.selected.size }); }
  /** Back to a free lock: only the root area keeps its shape, the rest falls. */
  releaseRest() { this.edit(lock => { lock.styled = false; }); }
  unpin() { this.edit(lock => lock.pins.clear()); }
  pinTip() { this.edit(lock => lock.pins.set(N - 1, new Vector3().fromArray(lock.x, (N - 1) * 3))); }
  deleteSelected() {
    if (!this.selected.size) return;
    this.checkpoint();
    const gone = new Set([...this.selected].map(n => this.locks[n]));
    this.state.locks = this.locks.filter(lock => !gone.has(lock));
    this.selected.clear();
    this.touch(); this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers(); this.onChange();
  }
  clearAll() { this.checkpoint(); this.state.locks = []; this.selected.clear(); this.touch(); this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers(); this.onChange(); }
  selectAll() { this.selected = new Set(this.locks.map((_, i) => i)); this.syncMeshes(); this.updateHelpers(); this.onChange(); }
  clearSelection() { this.selected.clear(); this.syncMeshes(); this.updateHelpers(); this.onChange(); }
  setRunning(on) { this.settings.running = on; if (on) this.state?.sim.wake(); this.dirty = true; this.onChange(); }
  setGravity(on) { this.settings.gravity = on; this.applySimSettings(); this.dirty = true; this.onChange(); }
  /** Simulate until everything is at rest (bounded), then show it. */
  settleNow() {
    if (!this.state) return 0;
    const steps = this.state.sim.settle(1200);
    this.syncMeshes(); this.updateHelpers(); this.onChange();
    return steps;
  }

  // ------------------------------------------------------ save / load
  static slots() { return storage.keys().filter(k => k.startsWith(SLOT_PREFIX)).map(k => k.slice(SLOT_PREFIX.length)).sort((a, b) => a.localeCompare(b)); }
  saveSlot(name) { return storage.set(SLOT_PREFIX + name, JSON.stringify(this.serialize())); }
  loadSlot(name) {
    const json = storage.get(SLOT_PREFIX + name);
    if (!json) return false;
    return this.load(json);
  }
  deleteSlot(name) { storage.remove(SLOT_PREFIX + name); }
  /** Load a saved hairstyle (JSON text); returns false if it is not one. */
  load(json) {
    let data;
    try { data = JSON.parse(json); } catch { return false; }
    if (!data || data.format !== 'hgs-locks') return false;
    this.checkpoint();
    this.restore(JSON.stringify(normalizeLocks(data)));
    return true;
  }
  /** Lock stats for the panel. */
  summary() {
    const locks = this.locks, sel = this.targets();
    return {
      count: locks.length, selected: this.selected.size, pins: locks.reduce((n, l) => n + l.pins.size, 0),
      styled: locks.filter(l => l.styled).length, first: sel[0] ?? null, status: this.status(),
    };
  }
}

const moved = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2e-5) return true; return false; };
