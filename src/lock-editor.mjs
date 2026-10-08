import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Line, LineBasicMaterial, Matrix4, Mesh,
  MeshBasicMaterial, Plane, QuadraticBezierCurve3, Quaternion, Raycaster, SphereGeometry, Vector3,
} from 'three';
import {
  LOCK_POINTS as N, arcLengthAt, geometryFrom, lockLength, lockLimits, lockMaterial, lockSurface,
  locksScalpColors, locksUnderlayGeometry, makeLock, normalizeLocks, prepareLocks, resamplePolyline, rootFromHit,
  serializeLocks, setLockLength, setLockShape, constrainLockPose, bendLock, underlayMaterial, updateGeometry, combLock, rootFrame, collisionRadius,
} from './locks.mjs';
import { applyHairBrush, fusedHairSurface, hairBrushFalloff, hairBrushTools, hairFusionGroups, hairMaskAt, normalizeHairFusion } from './hair-fusion.mjs';
import { accessoryColors, accessoryMaterial, accessoryParts, accessoryPins, bandAcross, barretteLocks, clipLocks, pruneAccessories, removeAccessory, tieGather, tieLocks } from './hair-accessories.mjs';
import { prepareWorkerModule } from './generation.mjs';
import { HairDynamics } from './hair-dynamics.mjs';

export const holderTools = ['tie', 'clip', 'barrette', 'band'];
export const lockTools = ['brush', 'comb', 'pull', 'move', 'select', 'grow', 'cut', 'pin', 'gel', ...holderTools, ...hairBrushTools];
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
 * select and shape them, cut, pin, and set a shape against gravity. Gravity is
 * an operator applied after each edit (LockShaper), never a running
 * simulation: when nothing is being edited nothing changes. Every lock is its
 * own mesh while editing (for picking); the game build merges them.
 */
export class LockEditor {
  constructor(renderer) {
    this.renderer = renderer;
    this.raycaster = new Raycaster();
    this.settings = { tool: 'brush', brushLength: 0.25, brushSpacing: 0.022, gravity: 1, gravityOn: false, pinOnRelease: false, fixOnRelease: false, showMidline: false, combRadius: 0.14, combStrength: 1, showScalp: false, mirror: false, width: 0.05, volume: 0.18, taper: 0.85 };
    this.selected = new Set();
    Object.assign(this.settings, { width: .025, volume: .24, taper: .9, curl: 0, turns: 2, twist: 0, brushRadius: .045, brushStrength: .5, brushFalloff: 'smooth', activeGroup: 'main', brushInvert: false, brushCreation: 'stroke', hairRepresentation: 'lock', combScope: 'brush', tipShape: 'point', autoSettle: false, holderColor: null, bandStyle: 'band' });
    this.state = null; this.undoStack = []; this.redoStack = [];
    this.bendBaselines = new WeakMap();
    this.onChange = () => {};
    this.onBusy = () => {}; this.onProgress = () => {};
    this.onPhysics = () => {}; this.physicsDefinition = 0;
  }
  get active() { return Boolean(this.state); }
  get locks() { return this.state?.locks ?? []; }

  begin(human, data, color) {
    this.end();
    this.human = human; this.context = human.context; this.color = color;
    this.state = prepareLocks(this.context, data);
    this.settings.hairRepresentation = this.state.fusion?.representation ?? 'lock';
    // Live dynamics starts from the current saved pose, never from q/design.
    this.state.fusion ??= normalizeHairFusion();
    this.selected.clear();
    for (const name of ['Hair', 'ScalpUnderlay', 'HairAccessories']) { const mesh = human.group.getObjectByName(name); if (mesh) mesh.visible = false; }
    const scene = this.renderer.scene;
    this.group = new Group(); this.group.name = 'LockEditor'; scene.add(this.group);
    // Locks set with gel (held shape) look wet: smoother, glossier surface.
    this.materials = { normal: lockMaterial(color), selected: lockMaterial(color, { highlight: true }), gel: Object.assign(lockMaterial(color), { roughness: 0.2 }) };
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
    // The head's centre line over the scalp: roots near it snap onto it.
    this.midline = new Line(this.midlineGeometry(), new LineBasicMaterial({ color: 0x46d39a, transparent: true, opacity: 0.95 }));
    this.midline.renderOrder = 4;
    // Ties, clips, barrettes and bands (hair-accessories.mjs), rebuilt from the points they hold.
    this.accessoryMesh = new Mesh(new BufferGeometry(), accessoryMaterial());
    this.accessoryMesh.frustumCulled = false;
    this.group.add(this.handles, this.pinMarks, this.scalpOverlay, this.underlay, this.hoverMark, this.midline, this.accessoryMesh);
    this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers();
  }
  end() {
    if (!this.state) return null;
    // Intermediate gravity poses roll back; authored fusion definitions remain
    // valid even when their derived preview worker has not finished yet.
    this.cancelGravity();
    this.physicsClient?.dispose(); this.physicsClient = null; this.physics = null; this.physicsDefinition++;
    const result = this.serialize();
    this.cancelFusion();
    this.fusionMeshes = [];
    this.group?.traverse(object => { object.geometry?.dispose(); });
    this.group?.removeFromParent();
    for (const material of Object.values(this.materials ?? {})) material.dispose();
    this.accessoryMesh?.material.dispose(); this.accessoryMesh = null;
    for (const name of ['Hair', 'ScalpUnderlay', 'HairAccessories']) { const mesh = this.human?.group.getObjectByName(name); if (mesh) mesh.visible = true; }
    this.state = null; this.meshes = []; this.drag = null;
    return result;
  }
  serialize() { return this.state ? serializeLocks(this.state) : null; }
  setColor(color) { this.color = color; for (const material of Object.values(this.materials ?? {})) material.color.set(color); this.updateUnderlay(); }
  /**
   * Hang the locks by gravity (all, or only `only` while a drag is under way,
   * the others staying put). Deterministic: unchanged locks come out identical.
   */
  relax(only = null) {
    if (!this.state) return;
    for (const lock of only ?? this.locks) {
      if (!lock.grab) continue;
      const reference = Float32Array.from(lock.x), point = lock.grab.point.clone(), max = lock.seg * lock.grab.index * .999;
      if (point.distanceTo(lock.rootP) > max) point.sub(lock.rootP).setLength(max).add(lock.rootP);
      lock.x.set(point.toArray(), lock.grab.index * 3);
      constrainLockPose(lock, this.state, { reference, protectedPoints: new Map([[lock.grab.index, point]]) });
    }
    this.invalidatePhysics();
    this.fusionDirty = true;
    this.dirty = true;
  }

  // ----------------------------------------------------------- history
  checkpoint() {
    this.invalidatePhysics();
    this.revision = (this.revision ?? 0) + 1;
    this.undoStack.push(JSON.stringify(this.serialize()));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }
  restore(json, keepSelection = false) {
    this.cancelOperation();
    this.physicsClient?.dispose(); this.physicsClient=null; this.physicsKey=null;this.physicsDefinition++;
    const data = JSON.parse(json);
    const selection = [...this.selected];
    // A loaded or restored hairstyle: free locks hang by gravity from their
    // saved shapes (the same result as when it was saved), set shapes as saved.
    this.state = prepareLocks(this.context, data);
    this.settings.hairRepresentation = this.state.fusion?.representation ?? 'lock';
    if (this.state.fusion && !this.state.fusion.groups.some(g => g.id === this.settings.activeGroup)) this.settings.activeGroup = 'main';
    this.physics = null; this.physicsDefinition++;
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
  /** Points of the scalp on the body's mid-plane (x = 0), from the front hairline over the crown to the nape. */
  midlineGeometry() {
    const C = this.state.frame.C, pos = [];
    for (let k = 0; k <= 160; k++) {
      const a = -0.3 + k / 160 * (Math.PI + 0.9), d = new Vector3(0, Math.sin(a), Math.cos(a));
      const hit = this.midlineHit(C.clone().addScaledVector(d, 0.4), d.clone().negate());
      if (hit?.root) pos.push(hit.point.x, hit.point.y + d.y * 0.0015, hit.point.z + d.z * 0.0015);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return geometry;
  }
  /** Scalp hit of a ray (from outside the head towards it). */
  midlineHit(origin, direction) {
    this.raycaster.set(origin, direction);
    const [hit] = this.raycaster.intersectObject(this.probe(), false);
    if (!hit) return null;
    const baseIds = this.human.body.geometry.userData.baseIds;
    return { root: rootFromHit(this.state, [hit.face.a, hit.face.b, hit.face.c].map(v => baseIds[v]), hit.point), point: hit.point.clone() };
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
      mesh.material = this.selected.has(n) ? this.materials.selected : lock.fixed ? this.materials.gel : this.materials.normal;
      if (this.state.fusion) { lock.group ??= 'main'; lock.id ??= this.nextLockId(); }
      const key = `${lock.width},${lock.volume},${lock.taper},${lock.curl},${lock.turns},${lock.twist},${lock.density ?? 1},${lock.tipShape ?? 'round'},${lock.ribbonNormal ?? ''},${lock.rootTaper}`;
      if (!all && lock.built && key === lock.builtKey && !moved(lock.built, lock.x)) return;
      lock.built = Float32Array.from(lock.x); lock.builtKey = key;
      const part = lockSurface(lock, this.state);
      if (!updateGeometry(mesh.geometry, part)) { mesh.geometry.dispose(); mesh.geometry = geometryFrom([part]); }
      this.fusionDirty = true;
    });
    this.syncFusion(all);
    this.syncAccessories();
  }
  /** Accessories follow the points they hold; one with nothing left to hold is gone. */
  syncAccessories() {
    if (!this.accessoryMesh) return;
    pruneAccessories(this.state);
    const parts = accessoryParts(this.state);
    this.accessoryMesh.geometry.dispose();
    this.accessoryMesh.geometry = parts.length ? geometryFrom(parts) : new BufferGeometry();
  }
  nextLockId() {
    const ids = new Set(this.locks.map(l => l.id));
    let id = 0;
    while (ids.has(`lock-${id}`)) id++;
    return `lock-${id}`;
  }
  /** Source meshes remain available to existing guide tools and ray picking. */
  syncFusion(all = false) {
    this.fusionMeshes ??= [];
    const groups = hairFusionGroups(this.state), sourceDrag = this.gravityRunning || this.physicsLive || (this.drag && !hairBrushTools.includes(this.drag.tool));
    const fused = new Set(groups.flatMap(g => g.locks));
    const ready = new Set(this.fusionMeshes.flatMap(m => m.userData.hairGroups ?? [m.userData.hairGroup]));
    this.meshes.forEach((mesh, i) => { mesh.visible = (this.locks[i]?.density ?? 1) > 0 && (!fused.has(this.locks[i]) || !ready.has(this.locks[i]?.group ?? 'main') || Boolean(sourceDrag)); });
    for (const mesh of this.fusionMeshes) mesh.visible = !sourceDrag && this.state.fusion?.enabled;
    if (this.drag || this.gravityRunning || this.physicsLive || (!all && !this.fusionDirty)) return;
    clearTimeout(this.fusionTimer); this.fusionTimer = null;
    if (typeof Worker !== 'undefined' && groups.length) { this.launchFusion(); return; }
    this.cancelFusion();
    this.installFusion(groups.map(group => ({ id: group.id, ids: group.ids, part: fusedHairSurface(this.state, group.locks, lockSurface, { showMask: true }) })));
  }
  installFusion(parts) {
    for (const mesh of this.fusionMeshes ?? []) { mesh.geometry.dispose(); mesh.removeFromParent(); }
    this.fusionMeshes = [];
    for (const { id, ids, part } of parts) {
      const mesh = new Mesh(geometryFrom([part]), this.materials.normal);
      mesh.name = `HairFusion-${id}`; mesh.userData.hairGroup = id; mesh.userData.hairGroups = ids; mesh.userData.fusionStats = part.stats; mesh.frustumCulled = false;
      this.group.add(mesh); this.fusionMeshes.push(mesh);
    }
    this.fusionDirty = false;
    this.syncFusion();
  }
  cancelFusion() {
    clearTimeout(this.fusionTimer); this.fusionTimer = null;
    this.fusionController?.abort(); this.fusionController = null;
    this.fusionWorker?.terminate(); this.fusionWorker = null;
    this.fusionRequest = (this.fusionRequest ?? 0) + 1;
    this.fusionDirty = false; this.fusionBusy = false;
    this.onBusy(Boolean(this.gravityRunning));
  }
  async launchFusion() {
    this.cancelFusion();
    const id = this.fusionRequest, revision = this.revision, state = this.state;
    const controller = new AbortController(); this.fusionController = controller;
    const hairstyle = this.serialize(), { data, positions, skeleton, outfitSurface } = this.context;
    const context = { data, positions, outfitSurface, skeleton: { heads: skeleton.heads.map(p => p.toArray()), byName: [...skeleton.byName] } };
    this.fusionBusy = true; this.fusionError = null; this.onBusy(true); this.onProgress('Preparando fusão do cabelo');
    try {
      const url = await prepareWorkerModule(new URL('./hair-fusion-worker.mjs', import.meta.url).href, { signal: controller.signal });
      if (controller.signal.aborted || state !== this.state || id !== this.fusionRequest) return;
      const worker = new Worker(url, { type: 'module' }); this.fusionWorker = worker;
      const finish = () => { worker.terminate(); if (this.fusionWorker === worker) this.fusionWorker = null; this.fusionBusy = false; this.onBusy(Boolean(this.gravityRunning)); };
      worker.onmessage = ({ data: message }) => {
        if (id !== this.fusionRequest || state !== this.state) return;
        if (message.type === 'progress') { this.onProgress(message.stage); return; }
        if (message.type === 'error') { this.fusionError = message.message; finish(); this.onChange(); return; }
        if (message.type !== 'result') return;
        finish();
        if (revision !== this.revision || this.drag) { this.fusionDirty = true; if (!this.drag) this.scheduleFusion(); return; }
        this.installFusion(message.parts); this.onChange();
      };
      worker.onerror = event => { if (id !== this.fusionRequest || state !== this.state) return; this.fusionError = event.message || 'Falha ao calcular fusão do cabelo'; finish(); this.onChange(); };
      worker.onmessageerror = () => { if (id !== this.fusionRequest || state !== this.state) return; this.fusionError = 'Não foi possível receber a geometria fundida'; finish(); this.onChange(); };
      worker.postMessage({ id, context, hairstyle });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.fusionError = error.message; this.fusionBusy = false; this.onBusy(Boolean(this.gravityRunning)); this.onChange();
    }
  }
  scheduleFusion() {
    this.fusionDirty = true;
    if (this.drag || this.fusionTimer) return;
    const state = this.state;
    this.fusionTimer = setTimeout(() => {
      this.fusionTimer = null;
      if (state !== this.state || this.drag) return;
      this.syncFusion(); this.onChange();
    }, 30);
  }
  updateHelpers() {
    if (!this.handles) return;
    const m = new Matrix4(), k = this.state.frame.R / 0.11;
    let h = 0, p = 0;
    this.locks.forEach((lock, n) => {
      if (this.selected.has(n) && ['select', 'pull', 'pin', 'move', 'grow'].includes(this.settings.tool)) for (let i = 2; i < N && h < 400; i++) {
        const s = 0.0028 * k;
        m.makeScale(s, s, s).setPosition(lock.x[i * 3], lock.x[i * 3 + 1], lock.x[i * 3 + 2]);
        this.handles.setMatrixAt(h++, m);
      }
      // Points held by an accessory show the accessory instead of a pin mark.
      for (const [i, pin] of lock.pins) if (p < 400 && !pin.holder) {
        const s = 0.0062 * k;
        m.makeScale(s, s, s).setPosition(lock.x[i * 3], lock.x[i * 3 + 1], lock.x[i * 3 + 2]);
        this.pinMarks.setMatrixAt(p++, m);
      }
    });
    this.handles.count = h; this.pinMarks.count = p;
    this.handles.instanceMatrix.needsUpdate = true; this.pinMarks.instanceMatrix.needsUpdate = true;
    this.scalpOverlay.visible = this.settings.tool === 'pull' && this.settings.showScalp;
    this.midline.visible = this.settings.showMidline && ['brush', 'pull', 'move'].includes(this.settings.tool);
  }
  /** Per frame: only rebuild what an edit changed (nothing runs on its own). */
  step() {
    if (!this.state || !this.dirty) return;
    this.dirty = false;
    this.syncMeshes(); this.updateHelpers();
  }

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
  pickHair(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const visible = [...(this.fusionMeshes ?? []), ...this.meshes].filter(m => m.visible);
    const [hit] = this.raycaster.intersectObjects(visible, false);
    if (!hit) return null;
    const [bodyHit] = this.raycaster.intersectObject(this.probe(), false);
    if (bodyHit && bodyHit.distance + .0015 < hit.distance) return null;
    let index = hit.object.userData.index, arc = hit.uv?.y;
    let group = this.locks[hit.object.userData.index]?.group ?? 'main';
    if (hit.object.userData.hairGroups) {
      let nearest = Infinity;
      for (const lock of this.locks) if (hit.object.userData.hairGroups.includes(lock.group ?? 'main')) for (let i = 0; i < N; i++) {
        const distance = hit.point.distanceToSquared(new Vector3().fromArray(lock.x, i * 3));
        if (distance < nearest) { nearest = distance; group = lock.group ?? 'main'; index = this.locks.indexOf(lock); arc = arcLengthAt(lock, hit.point) / lockLength(lock); }
      }
    }
    return { point: hit.point.clone(), group, distance: hit.distance, index, arc };
  }
  pickScalp(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const [hit] = this.raycaster.intersectObject(this.probe(), false);
    if (!hit) return null;
    const baseIds = this.human.body.geometry.userData.baseIds;
    const root = rootFromHit(this.state, [hit.face.a, hit.face.b, hit.face.c].map(v => baseIds[v]), hit.point);
    // Near the centre line the root snaps onto it (like a mirror's merge distance),
    // so mirrored hair meets in a closed parting.
    const C = this.state.frame.C, snap = 0.012 * this.state.frame.R / 0.11;
    if (root && Math.abs(hit.point.x) < snap) {
      const d = new Vector3(0, hit.point.y - C.y, hit.point.z - C.z).normalize();
      const mid = this.midlineHit(C.clone().addScaledVector(d, 0.4), d.clone().negate());
      if (mid?.root) return { root: mid.root, point: mid.point, distance: hit.distance, midline: true };
    }
    return { root, point: hit.point.clone(), distance: hit.distance };
  }
  /** A root on the centre line: mirroring gives a second lock from the same root, to the other side. */
  onMidline(lock) { return Math.abs(lock.rootP.x) < 0.001; }
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
    if (hairBrushTools.includes(tool)) {
      // Density plants on the scalp; its stroke may start on the hair or the
      // head and works where it crosses the scalp.
      const scalp = tool === 'density' ? this.pickScalp(ndc, camera) : null;
      const hit = scalp?.root ? scalp : this.pickHair(ndc, camera) ?? scalp;
      if (!hit) return false;
      // Surface brushes work on the fused volume: switch to it the way the
      // Volume representation does (with its lock thickness), never raw.
      if (['smooth', 'volume', 'mask'].includes(tool) && !this.state.fusion?.enabled) this.setRepresentation('volume');
      this.checkpoint();
      const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), hit.point);
      this.drag = { tool, plane, lastPoint: tool === 'density' && !scalp?.root ? null : hit.point.clone(), invert: ctrl || this.settings.brushInvert, group: this.settings.activeGroup };
      if (this.drag.lastPoint) this.brushAt(hit.point, { tool, invert: this.drag.invert, record: false });
      return true;
    }
    const lockHit = this.pickLock(ndc, camera);
    if (tool === 'select') {
      // Click a lock, or paint over several (Shift adds, Ctrl removes): the part to tie or style.
      if (!lockHit) { if (!shift && !ctrl) this.clearSelection(); }
      else this.choose(lockHit.index, { shift, ctrl });
      this.drag = { tool, last: { x: ndc.x, y: ndc.y }, remove: ctrl };
      return true;
    }
    if (tool === 'gel') {
      // Gel: the locks under the circle keep the shape they have now (Ctrl washes it out).
      if (!this.combTargets(ndc, camera, 'brush').length) return false;
      this.checkpoint();
      this.drag = { tool, invert: ctrl };
      this.applyGel(ndc, camera, ctrl);
      return true;
    }
    if (tool === 'tie') return this.beginTie(ndc, camera);
    if (holderTools.includes(tool)) return this.placeHolder(tool, ndc, camera);
    if (tool === 'brush') {
      const scalpHit = this.pickScalp(ndc, camera);
      if (this.settings.brushCreation === 'stroke') return scalpHit?.root ? this.beginStroke(scalpHit, camera, { shift, ndc }) : false;
      // Fill: the stroke may start on the hair or the head and plants where its circle covers the scalp.
      if (!scalpHit && !this.pickHair(ndc, camera)) return false;
      this.checkpoint();
      if (!shift) this.selected.clear();
      this.drag = { tool, lastNdc: { x: ndc.x, y: ndc.y }, created: new Set() };
      this.fillAt(ndc, camera, this.drag); this.step(); this.onChange();
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
    if (tool === 'comb') {
      // A comb takes hold of the hair it touches and pulls every lock along;
      // a stroke may start on the hair or the head (the scalp, among the roots).
      if (this.settings.combScope !== 'all' && !this.combTargets(ndc, camera).length && !this.pickScalp(ndc, camera)) return false;
      this.checkpoint();
      this.drag = { tool, last: { x: ndc.x, y: ndc.y }, caught: new Map(), released: new Set() };
      this.combCatch(this.drag, ndc, camera);
      return true;
    }
    if (tool === 'move') {
      // Reposition: grab a lock anywhere; its root slides over the scalp by
      // the cursor's movement from where the root is on screen.
      if (!lockHit) return false;
      this.checkpoint();
      if (!this.selected.has(lockHit.index)) this.choose(lockHit.index, { shift, ctrl: false });
      const lock = this.locks[lockHit.index], root = lock.rootP.clone().project(camera);
      this.drag = { tool, lock, start: { x: ndc.x, y: ndc.y }, rootNdc: { x: root.x, y: root.y } };
      return true;
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
      this.relax(); this.step(); this.onChange();
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
  creationParams() { return { width: this.settings.width, volume: this.settings.volume, taper: this.settings.taper, curl: this.settings.curl ?? 0, turns: this.settings.turns ?? 2, twist: this.settings.twist ?? 0, tipShape: this.settings.tipShape, group: this.settings.activeGroup }; }
  beginStroke(hit, camera, { shift = false, ndc = { x: 0, y: 0 } } = {}) {
    if (this.locks.length >= 400) return false;
    this.checkpoint(); this.state.fusion ??= normalizeHairFusion();
    const lock = makeLock(this.state, hit.root, null, { ...this.creationParams(), ribbonNormal: camera.getWorldDirection(new Vector3()).negate().toArray() }); this.locks.push(lock);
    if (!shift) this.selected.clear(); this.selected.add(this.locks.length - 1);
    const twinRoot = !this.settings.mirror ? null : this.onMidline(lock) ? lock.root : this.mirrorRoot(lock);
    const twin = twinRoot && this.locks.length < 400 ? makeLock(this.state, twinRoot, null, this.creationParams()) : null;
    if (twin) twin.ribbonNormal = [-lock.ribbonNormal[0], lock.ribbonNormal[1], lock.ribbonNormal[2]];
    if (twin) { this.locks.push(twin); this.selected.add(this.locks.length - 1); }
    const lifted = lock.rootP.clone().addScaledVector(lock.rootN, Math.max(.002, lock.width * lock.volume * .55));
    const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), lifted);
    this.drag = { tool: 'stroke', lock, twin, plane, path: [lock.rootP.clone(), lifted], lastNdc: { x: ndc.x, y: ndc.y }, created: new Set([lock, twin].filter(Boolean)) };
    this.updateStrokeShape(); this.syncMeshes(); this.updateHelpers(); this.onChange();
    return true;
  }
  updateStrokeShape() {
    const { lock, twin, path } = this.drag, center = this.state.frame.C;
    for (const target of [lock, twin].filter(Boolean)) {
      const points = new Float32Array(path.length * 3);
      path.forEach((p, i) => points.set(target === twin ? [2 * center.x - p.x, p.y, p.z] : p.toArray(), i * 3));
      points.set(target.rootP.toArray(), 0); setLockShape(target, points);
      constrainLockPose(target, this.state);
      target.rest.set(target.x); target.hold = Float32Array.from(target.x);
    }
    this.dirty = true;
  }
  sprout(hit, camera, { shift = false } = {}) {
    if (this.locks.length >= 400) return false;
    this.checkpoint();
    this.state.fusion ??= normalizeHairFusion();
    const lock = makeLock(this.state, hit.root, null, { ...this.creationParams(), ribbonNormal: camera.getWorldDirection(new Vector3()).negate().toArray() });
    this.locks.push(lock);
    const n = this.locks.length - 1;
    if (!shift) this.selected.clear();
    this.selected.add(n);
    const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), lock.rootP.clone().addScaledVector(lock.rootN, 0.01));
    // Mirror: the same lock on the other side of the head (the body is symmetric in x).
    const twinRoot = !this.settings.mirror ? null : this.onMidline(lock) ? lock.root : this.mirrorRoot(lock);
    let twin = null;
    if (twinRoot && this.locks.length < 400) {
      twin = makeLock(this.state, twinRoot, null, this.creationParams());
      twin.ribbonNormal = [-lock.ribbonNormal[0], lock.ribbonNormal[1], lock.ribbonNormal[2]];
      this.locks.push(twin);
      this.selected.add(this.locks.length - 1);
    }
    this.drag = { tool: 'sprout', lock, twin, plane };
    this.shapeSprout(lock, lock.rootP.clone().addScaledVector(lock.rootN, 0.03));
    if (twin) this.shapeSprout(twin, twin.rootP.clone().addScaledVector(twin.rootN, 0.03));
    this.syncMeshes(); this.updateUnderlay(); this.updateHelpers(); this.onChange();
    return true;
  }
  /**
   * Comb weight of a lock point (Blender's Comb Curves brush settings): the
   * brush is the circle drawn on screen (radius measured in screen space,
   * `combRadius` in units of half the view height), and, like Front Faces
   * Only, hair on the far side of the head is left alone.
   */
  combWeight(p, ndc, camera) {
    const s = this._combScreen ??= new Vector3();
    s.copy(p).project(camera);
    if (s.z > 1) return 0;
    const C = this.state.frame.C, R = this.state.frame.R, eye = camera.getWorldPosition(this._combEye ??= new Vector3());
    const offset = this._combOffset ??= new Vector3();
    offset.copy(p).sub(C);
    if (offset.length() < 1.6 * R && offset.normalize().dot(eye.sub(C).normalize()) < -0.25) return 0;
    return hairBrushFalloff(Math.hypot((s.x - ndc.x) * camera.aspect, s.y - ndc.y), this.settings.combRadius, this.settings.brushFalloff) * this.settings.combStrength;
  }
  /** Locks with a point inside the comb circle (with "selection" scope, only the selected ones). */
  combTargets(ndc, camera, scope = this.settings.combScope) {
    const p = new Vector3(), list = scope === 'selected' ? [...this.selected].map(i => this.locks[i]).filter(Boolean) : this.locks;
    return list.filter(lock => { for (let i = 2; i < N; i++) if (this.combWeight(p.fromArray(lock.x, i * 3), ndc, camera) > 0) return true; return false; });
  }
  /**
   * The comb takes hold of the locks it touches, as a real comb's teeth do:
   * each at its point nearest the comb's centre on screen ("Todo o cabelo":
   * every lock at once; Mirror: also the locks whose mirror image is under
   * the comb, moved the mirrored way).
   */
  combCatch(drag, ndc, camera) {
    const scope = this.settings.combScope ?? 'brush', C = this.state.frame.C, p = new Vector3(), q = new Vector3(), s = new Vector3();
    const list = scope === 'selected' ? [...this.selected].map(i => this.locks[i]).filter(Boolean) : this.locks;
    // The side of the head the comb is on ("Todo o cabelo" with Mirror).
    s.copy(C).project(camera); s.x = ndc.x; s.y = ndc.y;
    const side = Math.sign(s.unproject(camera).x - C.x) || 1;
    for (const lock of list) {
      if (drag.caught.has(lock) || drag.released.has(lock)) continue;
      let best = -1, near = Infinity, mirror = false;
      // Any point under the comb takes the lock, the roots included.
      for (let i = 1; i < N; i++) {
        p.fromArray(lock.x, i * 3);
        for (const flip of this.settings.mirror && scope !== 'all' ? [false, true] : [false]) {
          q.copy(p); if (flip) q.x = 2 * C.x - q.x;
          if (scope !== 'all' && this.combWeight(q, ndc, camera) <= 0) continue;
          s.copy(q).project(camera);
          const d = Math.hypot((s.x - ndc.x) * camera.aspect, s.y - ndc.y);
          if (d < near) { near = d; best = i; mirror = flip; }
        }
      }
      if (best < 0) continue;
      // The tooth holds the first point from there with a free segment on both
      // sides (past the follicle, off any pin or protected point).
      const fixedAt = i => lock.pins.has(i) || hairMaskAt(this.state, p.fromArray(lock.x, i * 3), lock.group ?? 'main') >= 1 - 1e-6;
      best = Math.max(3, best);
      while (best < N && (fixedAt(best - 1) || fixedAt(best) || (best + 1 < N && fixedAt(best + 1)))) best++;
      if (best >= N) continue;
      if (scope === 'all' && this.settings.mirror) mirror = (lock.x[best * 3] - C.x) * side < 0;
      drag.caught.set(lock, { index: best, tooth: new Vector3().fromArray(lock.x, best * 3), from: { x: ndc.x, y: ndc.y }, mirror });
    }
  }
  /**
   * One step of the comb. The tooth holding each lock moves with the cursor
   * (on screen, at the depth where it took the lock, kept out of the skin and
   * clothes) and pulls the whole lock after it. While the part before the
   * comb cannot reach the tooth, the comb slides along the lock towards the
   * tip (the hair runs through the teeth); past the tip the lock slips out,
   * pulled straight towards the comb. The part before the tooth is solved by
   * FABRIK between the held points and the part after trails behind it, each
   * point following the one before (FTL, as Snake Hook redistributes a
   * curve's points along the stroke), so a lock never stretches.
   */
  comb(drag, ndc, camera) {
    if (ndc.x === drag.last.x && ndc.y === drag.last.y) return;
    drag.last = { x: ndc.x, y: ndc.y };
    if ((this.settings.combScope ?? 'brush') !== 'all') this.combCatch(drag, ndc, camera);
    const k = this.settings.combStrength, C = this.state.frame.C, s = new Vector3(), m = new Vector3(), a = new Vector3();
    for (const [lock, hold] of drag.caught) {
      const dx = (ndc.x - hold.from.x) * k, dy = (ndc.y - hold.from.y) * k;
      let tooth;
      if (!hold.mirror) { s.copy(hold.tooth).project(camera); s.x += dx; s.y += dy; tooth = s.clone().unproject(camera); }
      else {
        m.copy(hold.tooth); m.x = 2 * C.x - m.x;
        s.copy(m).project(camera); s.x += dx; s.y += dy;
        const d = s.clone().unproject(camera).sub(m); d.x = -d.x;
        tooth = hold.tooth.clone().add(d);
      }
      // Pushed against the head the comb rides over it: a tooth inside the skin or
      // clothes goes to the nearest surface point, the lock's clearance above it.
      const clearance = Math.min(0.028, collisionRadius(lock, hold.index)), hit = this.combHit ??= {};
      if (this.state.collider?.head.closest(tooth.x, tooth.y, tooth.z, 0.2, hit) && hit.distance < clearance) tooth.set(hit.x + hit.nx * clearance, hit.y + hit.ny * clearance, hit.z + hit.nz * clearance);
      // Masked points keep their place like pins.
      const protectedPoints = new Map();
      for (let i = 2; i < N; i++) { const p = new Vector3().fromArray(lock.x, i * 3); if (hairMaskAt(this.state, p, lock.group ?? 'main') >= 1 - 1e-6) protectedPoints.set(i, p); }
      const anchor = i => { let b = 1; for (const j of [...lock.pins.keys(), ...protectedPoints.keys()]) if (j < i && j > b) b = j; return b; };
      const reaches = i => a.fromArray(lock.x, anchor(i) * 3).distanceTo(tooth) <= (i - anchor(i)) * lock.seg * 0.995;
      const fixedAt = i => lock.pins.has(i) || protectedPoints.has(i);
      const blocked = i => fixedAt(i - 1) || fixedAt(i) || fixedAt(i + 1);
      while (hold.index < N - 1 && (blocked(hold.index) || !reaches(hold.index))) hold.index++;
      if (blocked(hold.index)) { drag.caught.delete(lock); drag.released.add(lock); continue; }
      if (!reaches(hold.index)) {
        const from = new Vector3().fromArray(lock.x, anchor(hold.index) * 3);
        tooth.sub(from).setLength((hold.index - anchor(hold.index)) * lock.seg * 0.995).add(from);
        drag.caught.delete(lock); drag.released.add(lock);
      }
      const reference = Float32Array.from(lock.x);
      // Around the head the lock may need more than the straight distance: while
      // it ends farther than a quarter segment from the tooth, the comb slides on
      // towards the tip; past it the lock slips out, pulled as far as it got.
      let best = null;
      for (;;) {
        protectedPoints.set(hold.index, tooth);
        lock.x.set(reference);
        constrainLockPose(lock, this.state, { reference, protectedPoints });
        protectedPoints.delete(hold.index);
        const error = a.fromArray(lock.x, hold.index * 3).distanceTo(tooth);
        if (!best || error < best.error) best = { error, pose: Float32Array.from(lock.x) };
        if (error < lock.seg * 0.25) break;
        do hold.index++; while (hold.index < N - 1 && blocked(hold.index));
        if (hold.index > N - 1 || blocked(hold.index)) { lock.x.set(best.pose); drag.caught.delete(lock); drag.released.add(lock); break; }
      }
      lock.rest.set(lock.x); lock.styled = true;
    }
    this.invalidatePhysics(); this.dirty = true; this.fusionDirty = true; this.step();
  }
  /**
   * Root sites for Fill: a Fibonacci lattice over the head sphere (González
   * 2009: P = 2N + 1 points, latitude arcsin(2i / P), longitude 2πi / Φ, each
   * standing for almost the same area), as many as fit at the fill spacing.
   * A site is cast onto the scalp from the head centre when first needed. A
   * stroke plants on the sites it covers, so roots come out evenly spaced
   * whatever the stroke.
   */
  fillSites() {
    const spacing = this.settings.brushSpacing, R = this.state.frame.R;
    if (this.sites?.state === this.state && this.sites.spacing === spacing) return this.sites;
    const P = Math.max(3, Math.round(4 * Math.PI * R * R / (spacing * spacing * Math.sqrt(3) / 2))), half = Math.floor((P - 1) / 2), count = 2 * half + 1, phi = (1 + Math.sqrt(5)) / 2;
    const dirs = Array.from({ length: count }, (_, k) => {
      const i = k - half, y = 2 * i / count, r = Math.sqrt(1 - y * y), lon = 2 * Math.PI * i / phi;
      return new Vector3(Math.cos(lon) * r, y, Math.sin(lon) * r);
    });
    this.sites = { state: this.state, spacing, dirs, hits: new Array(count) };
    return this.sites;
  }
  fillSite(sites, k) {
    if (sites.hits[k] === undefined) {
      const C = this.state.frame.C, d = sites.dirs[k], hit = this.midlineHit(C.clone().addScaledVector(d, 0.5), d.clone().negate());
      sites.hits[k] = hit?.root ? hit : null;
    }
    return sites.hits[k];
  }
  /** Fill under the circle at `ndc` (Blender's Add brush with Density's minimum distance): every free site gets a lock. */
  fillAt(ndc, camera, drag) {
    const hit = this.pickScalp(ndc, camera) ?? this.pickHair(ndc, camera);
    if (!hit) return;
    const sites = this.fillSites(), C = this.state.frame.C, toward = hit.point.clone().sub(C).normalize(), spacing = this.settings.brushSpacing * 0.9;
    const free = point => !this.locks.some(lock => (lock.density ?? 1) > 0 && lock.rootP.distanceTo(point) < spacing);
    const add = lock => { this.locks.push(lock); this.selected.add(this.locks.length - 1); drag.created.add(lock); };
    for (let k = 0; k < sites.dirs.length && this.locks.length < 400; k++) {
      // A cheap cone around the cursor before casting a site onto the scalp.
      if (sites.dirs[k].dot(toward) < 0.4) continue;
      const site = this.fillSite(sites, k);
      if (!site || this.combWeight(site.point, ndc, camera) <= 0 || !free(site.point)) continue;
      const lock = this.fillLock(site.root, drag.created);
      add(lock);
      const twinRoot = !this.settings.mirror || this.locks.length >= 400 ? null : this.onMidline(lock) ? null : this.mirrorRoot(lock);
      if (twinRoot && free(rootFrame(this.state, twinRoot).p)) add(this.fillLock(twinRoot, drag.created));
    }
  }
  /**
   * A lock for Fill at `root`. Like the Add brush's Interpolate Shape and
   * Length, it follows the locks within three spacings that were there before
   * this stroke (`fresh`, the ones it planted, are left out): it leaves the
   * root in their average direction over the skin (each one's first fifth,
   * in the skin's plane) with their average length and the nearest one's
   * settings, and is laid over the head like them (combLock: along the skin,
   * falling where the head turns down). With none around, or with "Imitar as
   * vizinhas" off, it is combed with the chosen length and the creation
   * settings away from the parting to its own side and back, as the
   * ready-made styles are.
   */
  fillLock(root, fresh = new Set()) {
    const { p, n } = rootFrame(this.state, root), reach = this.settings.brushSpacing * 3;
    const near = this.settings.fillCopy === false ? [] : this.locks.filter(lock => !fresh.has(lock) && (lock.density ?? 1) > 0 && lock.rootP.distanceTo(p) < reach);
    if (!near.length) {
      const C = this.state.frame.C, front = Math.max(0, (p.z - C.z) / p.distanceTo(C));
      return combLock(this.state, root, new Vector3(p.x < C.x ? -1 : 1, -0.6, -0.25 - 0.95 * front), this.settings.brushLength, this.creationParams());
    }
    const direction = new Vector3(), v = new Vector3();
    let total = 0, length = 0, nearest = near[0];
    for (const lock of near) {
      const d = lock.rootP.distanceTo(p), w = 1 / (d + 1e-3);
      if (d < nearest.rootP.distanceTo(p)) nearest = lock;
      v.fromArray(lock.x, 4 * 3).sub(lock.rootP);
      v.addScaledVector(lock.rootN, -v.dot(lock.rootN));
      if (v.lengthSq() > 1e-10) direction.addScaledVector(v.normalize(), w);
      length += lockLength(lock) * w; total += w;
    }
    direction.addScaledVector(n, -direction.dot(n));
    if (direction.lengthSq() < 1e-10) direction.set(0, -1, 0);
    return combLock(this.state, root, direction.normalize(), length / total, {
      width: nearest.width, volume: nearest.volume, taper: nearest.taper, curl: nearest.curl, turns: nearest.turns, twist: nearest.twist, stiffness: nearest.stiffness,
      tipShape: nearest.tipShape, group: nearest.group ?? this.settings.activeGroup,
    });
  }
  /** Gel: the locks under the comb circle keep the shape they have now against gravity (invert: washed out, free again). */
  applyGel(ndc, camera, invert) {
    let changed = false;
    for (const lock of this.combTargets(ndc, camera, 'brush')) {
      if (Boolean(lock.fixed) === !invert) continue;
      lock.fixed = !invert;
      if (!invert) { lock.rest.set(lock.x); lock.styled = true; }
      changed = true;
    }
    if (changed) { this.invalidatePhysics(); this.syncMeshes(); this.onChange(); }
  }
  /** Put on a tie, clip, barrette or band where clicked; the locks it holds settle from their new holds (LockShaper.hang). */
  placeHolder(tool, ndc, camera) {
    const color = this.settings.holderColor ?? (tool === 'band' && this.settings.bandStyle === 'tiara' ? accessoryColors.tiara : accessoryColors[tool]);
    let result = null;
    if (tool === 'band' || tool === 'clip') {
      const hit = tool === 'band' ? this.pickScalp(ndc, camera) ?? this.pickHair(ndc, camera) : this.pickHair(ndc, camera) ?? this.pickScalp(ndc, camera);
      if (!hit) return false;
      this.checkpoint();
      result = tool === 'band' ? bandAcross(this.state, hit.point, { color, style: this.settings.bandStyle }) : clipLocks(this.state, this.locks, hit.point, { color });
    } else {
      // A tie or barrette gathers the selected locks, or the locks under the circle.
      const chosen = [...this.selected].map(i => this.locks[i]).filter(Boolean), locks = chosen.length ? chosen : this.combTargets(ndc, camera, 'brush');
      const point = locks.length ? this.holderPoint(ndc, camera, locks) : null;
      if (!point) return false;
      this.checkpoint();
      result = (tool === 'tie' ? tieLocks : barretteLocks)(this.state, locks, point, { color });
    }
    // Nothing it could hold (locks too short or none there): no step in the history.
    if (!result) { this.undoStack.pop(); this.onChange(); return true; }
    for (const lock of result.locks) { this.state.sim.hang(lock, new Map(), this.settings.gravity); lock.rest.set(lock.x); lock.styled = true; }
    this.invalidatePhysics(); this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers(); this.onChange();
    return true;
  }
  /**
   * Elastic. A drag starting on a tie pulls it; elsewhere it draws a loop on
   * screen round the hair to tie (released, each lock is held at its first
   * free point inside the loop, and the band goes round them). A click without
   * a loop ties the selection, or the locks under the circle, there.
   */
  beginTie(ndc, camera) {
    const near = this.tieNear(ndc, camera);
    if (near) {
      this.checkpoint();
      const held = accessoryPins(this.state, near.id);
      this.drag = { tool: 'tieMove', from: { x: ndc.x, y: ndc.y }, depth: near.depth, pins: held.flatMap(h => h.pins.map(([, p]) => [p, p.clone()])), locks: held.map(h => h.lock) };
      return true;
    }
    this.drag = { tool: 'lasso', camera, start: { x: ndc.x, y: ndc.y }, points: [{ x: ndc.x, y: ndc.y }] };
    this.updateLasso();
    return true;
  }
  /** The tie whose centre is within ~3 % of the view of the cursor. */
  tieNear(ndc, camera) {
    let best = null, limit = 0.06;
    for (const acc of this.state.accessories ?? []) {
      if (acc.type !== 'tie') continue;
      const held = accessoryPins(this.state, acc.id);
      if (!held.length) continue;
      const s = held.reduce((c, h) => c.add(h.pins[0][1]), new Vector3()).divideScalar(held.length).project(camera);
      const d = Math.hypot((s.x - ndc.x) * camera.aspect, s.y - ndc.y);
      if (d < limit) { limit = d; best = { id: acc.id, depth: s.z }; }
    }
    return best;
  }
  /** The loop being drawn, over everything. */
  updateLasso() {
    const drag = this.drag;
    if (!this.lassoLine) {
      this.lassoLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
      this.lassoLine.renderOrder = 12; this.lassoLine.frustumCulled = false; this.group.add(this.lassoLine);
    }
    const points = [...drag.points, drag.points[0]].map(p => new Vector3(p.x, p.y, 0.5).unproject(drag.camera).toArray()).flat();
    this.lassoLine.geometry.dispose(); this.lassoLine.geometry = new BufferGeometry();
    this.lassoLine.geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    this.lassoLine.visible = true;
  }
  /** Even-odd rule (a ray crossing the loop's edges an odd number of times starts inside); a vertex counts once. */
  static insideLoop(loop, x, y) {
    let inside = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i], b = loop[j];
      if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
    }
    return inside;
  }
  finishLasso(drag) {
    this.lassoLine.visible = false;
    const loop = drag.points, camera = drag.camera;
    let area = 0;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += (loop[j].x - loop[i].x) * (loop[j].y + loop[i].y);
    // A click (no loop): the selection, or the locks under the circle, are tied where clicked.
    if (loop.length < 3 || Math.abs(area) < 1e-4) { this.placeHolder('tie', drag.start, camera); return; }
    const picks = [], s = new Vector3(), free = (lock, i) => !lock.pins.has(i - 1) && !lock.pins.has(i) && !lock.pins.has(i + 1);
    for (const lock of this.locks) for (let i = 3; i < N - 1; i++) {
      s.fromArray(lock.x, i * 3).project(camera);
      if (s.z > 1 || !LockEditor.insideLoop(loop, s.x, s.y)) continue;
      if (free(lock, i)) { picks.push({ lock, k: i }); break; }
    }
    if (!picks.length) return;
    this.checkpoint();
    const result = tieGather(this.state, picks, null, { color: this.settings.holderColor ?? accessoryColors.tie });
    if (!result) { this.undoStack.pop(); return; }
    for (const lock of result.locks) { this.state.sim.hang(lock, new Map(), this.settings.gravity); lock.rest.set(lock.x); lock.styled = true; }
    this.invalidatePhysics(); this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers();
  }
  /** Pull a tie: its held points follow the cursor at the tie's depth and the locks settle from their roots again. */
  moveTie(drag, ndc, camera) {
    const a = new Vector3(drag.from.x, drag.from.y, drag.depth).unproject(camera), d = new Vector3(ndc.x, ndc.y, drag.depth).unproject(camera).sub(a);
    for (const [pin, start] of drag.pins) pin.copy(start).add(d);
    for (const lock of drag.locks) this.state.sim.hang(lock, new Map(), this.settings.gravity);
    this.invalidatePhysics(); this.dirty = true; this.step();
  }
  /** Where a tie or barrette goes: on the hair or head under the cursor, else in the plane through the chosen locks facing the view. */
  holderPoint(ndc, camera, locks) {
    const hit = this.pickHair(ndc, camera) ?? this.pickScalp(ndc, camera);
    if (hit) return hit.point;
    const centre = new Vector3();
    for (const lock of locks) for (let i = 0; i < N; i++) { centre.x += lock.x[i * 3]; centre.y += lock.x[i * 3 + 1]; centre.z += lock.x[i * 3 + 2]; }
    centre.divideScalar(locks.length * N);
    this.raycaster.setFromCamera(ndc, camera);
    return this.raycaster.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), centre), new Vector3());
  }
  /** Take an accessory off (the panel's list). */
  removeHolder(id) {
    if (!this.state?.accessories?.some(a => a.id === id)) return;
    this.checkpoint();
    removeAccessory(this.state, id);
    this.invalidatePhysics(); this.syncMeshes(true); this.updateHelpers(); this.onChange();
  }
  /**
   * Put a lock's root at another place on the scalp: its shape (drawn and
   * current) and pins go along, turned with the scalp from the old root's
   * normal to the new one.
   */
  moveRoot(lock, root) {
    const { p, n } = rootFrame(this.state, root), turn = new Quaternion().setFromUnitVectors(lock.rootN, n), v = new Vector3();
    for (const a of [lock.x, lock.rest]) for (let i = 0; i < N; i++) {
      v.fromArray(a, i * 3).sub(lock.rootP).applyQuaternion(turn).add(p);
      a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z;
    }
    for (const pin of lock.pins.values()) pin.sub(lock.rootP).applyQuaternion(turn).add(p);
    if (lock.ribbonNormal) lock.ribbonNormal = new Vector3(...lock.ribbonNormal).applyQuaternion(turn).toArray();
    lock.root = { v: [...root.v], w: [...root.w] }; lock.rootP = p; lock.rootN = n;
  }
  /**
   * Root mirrored across the body's mid-plane (x = 0): the scalp point met by
   * a ray from the head centre towards the mirrored root, so a twin is
   * always found, wherever the lock is.
   */
  mirrorRoot(lock) {
    const C = this.state.frame.C, p = lock.rootP.clone();
    p.x = -p.x;
    const d = p.sub(C).normalize();
    return this.midlineHit(C.clone().addScaledVector(d, 0.4), d.negate())?.root ?? null;
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
    lock.x.set(points); lock.rest.set(points);
    lock.seg = length / (N - 1);
    lock.hold = Float32Array.from(points);
    this.dirty = true;
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
    this.relax(new Set([lock]));
    return true;
  }
  cutAt(hit) {
    const lock = this.locks[hit.index];
    if (this.drag.cut.has(lock)) return;
    this.drag.cut.add(lock);
    setLockLength(lock, Math.max(lockLimits.length[0], arcLengthAt(lock, hit.point)));
    this.relax(this.drag.cut);
    this.onChange();
  }
  pointerMove(ndc, camera, { alt = false } = {}) {
    const drag = this.drag;
    if (!drag || !this.state) return;
    this.raycaster.setFromCamera(ndc, camera);
    if (drag.tool === 'stroke') {
      if (alt) {
        drag.widthBase ??= { value: this.settings.width, x: drag.lastNdc.x };
        this.setCreationWidth(drag.widthBase.value + (ndc.x - drag.widthBase.x) * this.state.frame.R * 2);
        return;
      }
      drag.widthBase = null;
      const scalpHit = this.pickScalp(ndc, camera);
      let point;
      if (scalpHit?.root) {
        const normal = rootFrame(this.state, scalpHit.root).n;
        point = scalpHit.point.clone().addScaledVector(normal, Math.max(.0015, drag.lock.width * drag.lock.volume * .55));
      } else {
        this.raycaster.setFromCamera(ndc, camera);
        point = this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      }
      if (!point || point.distanceTo(drag.path.at(-1)) < .001 * this.state.frame.R / .11) return;
      if (drag.path.length < 1024) drag.path.push(point);
      drag.lastNdc = { x: ndc.x, y: ndc.y }; this.updateStrokeShape(); this.step(); this.onChange();
      return;
    }
    if (hairBrushTools.includes(drag.tool)) {
      const hit = drag.tool === 'density' ? this.pickScalp(ndc, camera) : this.pickHair(ndc, camera);
      const point = drag.tool === 'density' ? (hit?.root ? hit.point : null) : hit?.point ?? this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      if (!point) return;
      if (!drag.lastPoint) { drag.lastPoint = point.clone(); this.brushAt(point, { tool: drag.tool, invert: drag.invert, record: false }); return; }
      if (point.distanceTo(drag.lastPoint) < this.settings.brushRadius * .15) return;
      const distance = point.distanceTo(drag.lastPoint), steps = Math.min(32, Math.max(1, Math.ceil(distance / (this.settings.brushRadius * .3))));
      const from = drag.lastPoint.clone();
      for (let i = 1; i <= steps; i++) this.brushAt(from.clone().lerp(point, i / steps), { tool: drag.tool, invert: drag.invert, record: false });
      drag.lastPoint.copy(point);
      return;
    }
    if (drag.tool === 'sprout' || drag.tool === 'grab') {
      const point = this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      if (!point) return;
      if (drag.tool === 'sprout') {
        this.shapeSprout(drag.lock, point);
        if (drag.twin) this.shapeSprout(drag.twin, new Vector3(-point.x, point.y, point.z));
      } else {
        // The pulled point follows the cursor; the rest of the lock hangs from it.
        drag.lock.grab.point.copy(point.add(drag.offset));
        this.relax(new Set([drag.lock]));
      }
      return;
    }
    if (drag.tool === 'brush') {
      // The circle is followed on screen in steps of half its radius, so a fast stroke covers its whole path.
      const from = drag.lastNdc ?? { x: ndc.x, y: ndc.y }, n = Math.max(1, Math.ceil(Math.hypot(ndc.x - from.x, ndc.y - from.y) / Math.max(0.01, this.settings.combRadius * 0.5)));
      for (let k = 1; k <= n; k++) this.fillAt({ x: from.x + (ndc.x - from.x) * k / n, y: from.y + (ndc.y - from.y) * k / n }, camera, drag);
      drag.lastNdc = { x: ndc.x, y: ndc.y };
      this.step(); this.onChange();
      return;
    }
    if (drag.tool === 'comb') {
      this.comb(drag, ndc, camera);
      return;
    }
    if (drag.tool === 'select') {
      // Painting over locks selects them (Ctrl: deselects), all along the stroke.
      const from = drag.last, steps = Math.max(1, Math.ceil(Math.hypot(ndc.x - from.x, ndc.y - from.y) / 0.006));
      let changed = false;
      for (let k = 1; k <= steps; k++) {
        const hit = this.pickLock({ x: from.x + (ndc.x - from.x) * k / steps, y: from.y + (ndc.y - from.y) * k / steps }, camera);
        if (!hit) continue;
        if (drag.remove ? this.selected.delete(hit.index) : !this.selected.has(hit.index) && this.selected.add(hit.index)) changed = true;
      }
      drag.last = { x: ndc.x, y: ndc.y };
      if (changed) { this.syncMeshes(); this.updateHelpers(); this.onChange(); }
      return;
    }
    if (drag.tool === 'gel') {
      this.applyGel(ndc, camera, drag.invert);
      return;
    }
    if (drag.tool === 'lasso') {
      const last = drag.points.at(-1);
      if (Math.hypot(ndc.x - last.x, ndc.y - last.y) > 0.004) { drag.points.push({ x: ndc.x, y: ndc.y }); this.updateLasso(); }
      return;
    }
    if (drag.tool === 'tieMove') {
      this.moveTie(drag, ndc, camera);
      return;
    }
    if (drag.tool === 'move') {
      const hit = this.pickScalp({ x: drag.rootNdc.x + ndc.x - drag.start.x, y: drag.rootNdc.y + ndc.y - drag.start.y }, camera);
      if (!hit?.root) return;
      this.moveRoot(drag.lock, hit.root);
      this.relax(new Set([drag.lock]));
      this.step(); this.updateUnderlay();
      return;
    }
    if (drag.tool === 'grow') {
      // The drag along the tip's direction (on screen, in the plane at the tip) is added to the length.
      const point = this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      if (!point) return;
      const length = drag.length + point.sub(drag.start).dot(drag.direction) * 1.5;
      setLockLength(drag.lock, length);
      this.relax(new Set([drag.lock]));
      this.onChange();
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
  pointerUp({ pin = false, fix = false } = {}) {
    const drag = this.drag;
    // The panel shows the values the stroke ended with.
    this.revision = (this.revision ?? 0) + 1;
    this.drag = null;
    if (!drag || !this.state) return;
    if (hairBrushTools.includes(drag.tool)) {
      this.scheduleFusion(); this.updateUnderlay(); this.updateHelpers(); this.onChange();
      return;
    }
    if (drag.tool === 'lasso') this.finishLasso(drag);
    // A pulled tie: the settled shapes become the locks' shapes.
    if (drag.tool === 'tieMove') for (const lock of drag.locks) { lock.rest.set(lock.x); lock.styled = true; }
    const lock = drag.lock;
    if (drag.tool === 'stroke') {
      for (const l of [lock, drag.twin].filter(Boolean)) { l.hold = null; l.rest.set(l.x); l.styled = fix || this.settings.fixOnRelease || !this.settings.autoSettle; l.fixed = Boolean(fix || this.settings.fixOnRelease); if (pin || this.settings.pinOnRelease) l.pins.set(N - 1, new Vector3().fromArray(l.x, (N - 1) * 3)); }
    }
    if (drag.tool === 'sprout') {
      // The drawn curve is the lock's design; gravity hangs it from there.
      for (const l of [lock, drag.twin].filter(Boolean)) { l.hold = null; l.rest.set(l.x); l.styled = fix || this.settings.fixOnRelease || !this.settings.autoSettle; l.fixed = Boolean(fix || this.settings.fixOnRelease); }
    }
    if (drag.tool === 'grab') {
      // The pulled shape becomes the lock's design; let go, it hangs from the
      // root (or from the pulled point when pinned there).
      const { index } = lock.grab;
      if (pin || this.settings.pinOnRelease) lock.pins.set(index, new Vector3().fromArray(lock.x, index * 3));
      lock.rest.set(lock.x);
      // Kept as released (F held or "keep shape on release"): gravity no longer moves it.
      if (fix || this.settings.fixOnRelease) { lock.styled = true; lock.fixed = true; }
      else if (!this.settings.autoSettle) lock.styled = true;
      lock.grab = null;
    }
    // Locks laid after the edited ones (higher layers) settle on them again.
    this.relax();
    this.step(); this.updateUnderlay(); this.onChange();
  }

  // ------------------------------------------------------- operations
  invalidatePhysics() {
    this.physicsDefinition = (this.physicsDefinition ?? 0) + 1;
    this.physics?.pause();
    if (this.state) this.physicsClient?.pause(this.serialize());
    this.physicsKey = null;
  }
  physicsSourceKey() {
    const saved = this.serialize();
    if (!saved) return '';
    for (const lock of saved.locks) { delete lock.p; delete lock.sy; }
    return JSON.stringify(saved);
  }
  tickPhysics(delta) {
    if (!this.state) return false;
    this.physicsLive = this.settings.gravityOn && !this.drag && !this.gravityRunning;
    if (!this.physicsLive) { this.physics?.pause(); return false; }
    const state = this.state;
    if (typeof Worker === 'undefined') {
      const previous=this.locks.map(lock=>({lock,x:Float32Array.from(lock.x),rootTaper:lock.rootTaper,styled:lock.styled}));
      this.physics ??= new HairDynamics(state, { maskAt: (lock, p) => hairMaskAt(state, p, lock.group ?? 'main') });
      const changed = this.physics.advance(delta, { on: true, strength: this.settings.gravity });
      if(changed&&this.physics.stats.validPose===false){for(const p of previous){p.lock.x.set(p.x);p.lock.rootTaper=p.rootTaper;p.lock.styled=p.styled;}this.physicsError=`${this.physics.stats.error} A pose anterior foi preservada.`;this.physicsStats={...this.physics.stats,error:this.physicsError};this.settings.gravityOn=false;this.physicsLive=false;this.onPhysics(this.physicsStats);this.onChange();return false;}
      if (changed) { this.physicsStats = this.physics.stats; for (const lock of this.locks) lock.styled = true; this.dirty = true; }
      return changed;
    }
    if (!this.physicsClient && !this.physicsLoading) {
      this.physicsLoading = true;
      import('./hair-physics-client.mjs').then(({ HairPhysicsClient }) => {
        if (state !== this.state) return;
        this.physicsClient = new HairPhysicsClient(this.context, {
          onResult: packet => {
            if (state !== this.state || !this.physicsLive || this.drag || packet.definition !== this.physicsDefinition) return;
            if(packet.stats.validPose===false){this.physicsError=`${packet.stats.error} A pose anterior foi preservada.`;this.physicsStats={...packet.stats,error:this.physicsError};this.settings.gravityOn=false;this.physicsLive=false;this.physicsClient?.pause(this.serialize());this.onPhysics(this.physicsStats);this.onChange();return;}
            if(packet.poses.length!==this.locks.length||packet.poses.some(p=>!this.locks[p.index]||(p.id&&p.id!==this.locks[p.index].id)||p.x.length!==this.locks[p.index].x.length))return;
            for (const pose of packet.poses) { const lock = this.locks[pose.index]; if (!lock || (pose.id && pose.id !== lock.id)) return; lock.x.set(pose.x); lock.rootTaper = true; lock.styled = true; }
            this.physicsError = null; this.physicsStats = packet.stats; this.dirty = true;
            const now = performance.now(); if (!this.lastPhysicsReport || now - this.lastPhysicsReport > 450) { this.lastPhysicsReport = now; this.onPhysics(packet.stats); }
          },
          onError: error => { this.physicsError = error.message ?? String(error); this.settings.gravityOn=false;this.physicsLive=false;this.physicsClient?.pause(this.serialize());this.onPhysics({ error: this.physicsError });this.onChange(); },
        });
        this.physicsKey = null;
      }).catch(error => { this.physicsError = error.message; this.onPhysics({ error: error.message }); }).finally(() => { this.physicsLoading = false; });
      return false;
    }
    if (!this.physicsClient) return false;
    const key = this.physicsSourceKey();
    if (key !== this.physicsKey) {
      this.physicsDefinition++;
      this.physicsError=null;
      this.physicsKey = key;
      this.physicsClient.replace(this.serialize(), this.physicsDefinition).catch(error => { this.physicsError = error.message; this.onPhysics({ error: error.message }); });
    }
    this.physicsClient.advance(delta, { on: true, strength: this.settings.gravity });
    return false;
  }
  setCreationWidth(value) {
    if (!Number.isFinite(Number(value))) return false;
    this.settings.width = clamp(Number(value), ...lockLimits.width);
    if (this.drag?.tool === 'stroke') for (const lock of [this.drag.lock, this.drag.twin].filter(Boolean)) lock.width = this.settings.width;
    this.dirty = true; this.step(); this.onChange();
  }
  setRepresentation(mode, { all = true } = {}) {
    if (!['strand', 'lock', 'volume'].includes(mode) || !this.state) return;
    this.checkpoint(); this.state.fusion ??= normalizeHairFusion();
    this.settings.hairRepresentation = mode; this.state.fusion.representation = mode; this.state.fusion.enabled = mode === 'volume';
    const preset = mode === 'strand' ? { width: .0018, volume: .95, taper: .96 } : mode === 'lock' ? { width: .025, volume: .24, taper: .9 } : { width: .045, volume: .65, taper: .82 };
    Object.assign(this.settings, preset);
    for (const lock of this.targets(all)) Object.assign(lock, preset);
    this.fusionDirty = true; this.syncMeshes(); this.updateHelpers(); this.onChange();
  }
  /** Straight, wavy or curly; `apply: false` only sets what new locks are made with. */
  setCurlPreset(kind, { all = true, apply = true } = {}) {
    const preset = kind === 'straight' ? { curl: 0, turns: 2, twist: 0 } : kind === 'wavy' ? { curl: .35, turns: 2, twist: .3 } : kind === 'curl' ? { curl: .8, turns: 5, twist: .1 } : null;
    if (!preset || !this.state) return;
    Object.assign(this.settings, preset);
    if (!apply) { this.onChange(); return; }
    this.checkpoint(); for (const lock of this.targets(all)) Object.assign(lock, preset);
    this.dirty = true; this.step(); this.onChange();
  }
  /** Round, pointed or flat tips; `apply: false` only sets what new locks are made with. */
  setTipShape(shape, { all = true, apply = true } = {}) {
    if (!['round', 'point', 'flat'].includes(shape) || !this.state) return;
    this.settings.tipShape = shape;
    if (!apply) { this.onChange(); return; }
    this.checkpoint(); this.state.fusion ??= normalizeHairFusion();
    for (const lock of this.targets(all)) lock.tipShape = shape;
    this.dirty = true; this.step(); this.onChange();
  }
  /** Explicit gravity frees styled poses but respects explicit shape locks.
   * Each stage uses the existing root/pin/length/collision operator against
   * the unchanged design; the final pose is saved separately from that design.
   * Browser stages yield a frame so the progression is visible and cancellable.
   */
  settleGravity({ strength = this.settings.gravity, steps = 6, all = true } = {}) {
    if (!this.state) return false;
    this.cancelGravity(); this.gravityCancelled = false;
    const list = this.targets(all).filter(lock => !lock.fixed);
    if (!list.length) return false;
    const snapshot = { state: this.state, fusion: this.state.fusion, undo: [...this.undoStack], redo: [...this.redoStack], locks: this.locks.map(lock => ({ lock, x: Float32Array.from(lock.x), rest: Float32Array.from(lock.rest), styled: lock.styled, fixed: lock.fixed, id: lock.id, group: lock.group })) };
    this.checkpoint(); snapshot.revision = this.revision; this.gravitySnapshot = snapshot; this.state.fusion ??= normalizeHairFusion();
    const state = this.state, revision = this.revision, generation = this.gravityGeneration, only = new Set(list), count = Number.isFinite(steps) ? Math.round(clamp(steps, 1, 24)) : 6;
    strength = Number.isFinite(strength) ? clamp(strength, 0, 1) : 1; this.settings.gravity = strength; this.gravityRunning = true; this.gravityCancelled = false;
    const stage = i => {
      if (generation !== this.gravityGeneration || !this.gravityRunning) return false;
      if (state !== this.state || revision !== this.revision) { this.cancelGravity(); return false; }
      for (const lock of list) lock.styled = false;
      try { state.sim.apply({ only, force: strength * i / count }); }
      finally { for (const lock of list) lock.styled = true; }
      this.dirty = true; this.fusionDirty = true; this.step(); this.onProgress(`Assentando cabelo ${Math.round(i / count * 100)}%`);
      return true;
    };
    const finish = () => { this.gravitySnapshot = null; this.gravityRunning = false; this.onBusy(Boolean(this.fusionBusy)); this.dirty = true; this.fusionDirty = true; this.step(); this.updateUnderlay(); this.onChange(); return true; };
    if (typeof window === 'undefined') {
      try { for (let i = 1; i <= count; i++) if (!stage(i)) return false; return finish(); }
      catch (error) { this.cancelGravity(); throw error; }
    }
    this.onBusy(true);
    return (async () => {
      try {
        for (let i = 1; i <= count; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          if (!stage(i)) return false;
        }
        return finish();
      } catch (error) { this.cancelGravity(); throw error; }
    })();
  }
  cancelGravity() {
    this.gravityGeneration = (this.gravityGeneration ?? 0) + 1;
    if (!this.gravityRunning) return;
    const snapshot = this.gravitySnapshot; this.gravitySnapshot = null; this.gravityRunning = false; this.gravityCancelled = true;
    if (snapshot && snapshot.state === this.state && snapshot.revision === this.revision) {
      this.state.fusion = snapshot.fusion;
      for (const item of snapshot.locks) { item.lock.x.set(item.x); item.lock.rest.set(item.rest); Object.assign(item.lock, { styled: item.styled, fixed: item.fixed, id: item.id, group: item.group }); }
      this.undoStack = snapshot.undo; this.redoStack = snapshot.redo;
      // Refresh source geometry while keeping the previous completed union.
      // Suppress a fresh worker launch during rollback, then restore visibility.
      this.gravityRunning = true;
      try { this.syncMeshes(true); this.updateHelpers(); this.updateUnderlay(); }
      finally { this.gravityRunning = false; this.fusionDirty = false; }
      this.syncFusion(); this.onChange();
    }
    this.onBusy(Boolean(this.fusionBusy));
  }
  cancelOperation() { this.cancelGravity(); this.cancelFusion(); }
  createGroup(name = 'Grupo') {
    if (!this.state) return null;
    this.checkpoint(); this.state.fusion ??= normalizeHairFusion();
    if (this.state.fusion.groups.length >= 64) return null;
    let n = 1;
    while (this.state.fusion.groups.some(g => g.id === `group-${n}`)) n++;
    const group = { id: `group-${n}`, name: String(name).trim().slice(0, 64) || 'Grupo', fuse: true };
    this.state.fusion.groups.push(group); this.settings.activeGroup = group.id; this.onChange();
    return group.id;
  }
  assignGroup(id) {
    if (!this.state?.fusion?.groups.some(g => g.id === id) || !this.selected.size) return false;
    this.checkpoint();
    for (const lock of this.targets()) lock.group = id;
    this.settings.activeGroup = id; this.fusionDirty = true; this.syncMeshes(); this.onChange();
    return true;
  }
  setGroupFusion(id, on) {
    const group = this.state?.fusion?.groups.find(g => g.id === id);
    if (!group) return false;
    this.checkpoint(); group.fuse = Boolean(on); this.fusionDirty = true; this.syncMeshes(); this.onChange();
    return true;
  }
  setFusionEnabled(on) {
    if (!this.state) return;
    this.checkpoint(); this.state.fusion ??= normalizeHairFusion(); this.state.fusion.enabled = Boolean(on);
    this.fusionDirty = true; this.syncMeshes(); this.onChange();
  }
  setFusionSettings(value, record = true) {
    if (!this.state) return;
    if (record) this.checkpoint();
    this.state.fusion = normalizeHairFusion({ ...(this.state.fusion ?? {}), ...value });
    this.scheduleFusion(); if (record) this.onChange();
  }
  clearMask() {
    if (!this.state?.fusion) return;
    if (this.state.fusion.strokes.length >= 2048) return;
    this.checkpoint();
    // A reset at this point in the stroke history releases the mask without
    // changing protection already applied to previous sculpt strokes.
    this.state.fusion.strokes.push({ tool: 'mask', center: [0, 0, 0], radius: 8, strength: 1, falloff: 'constant', symmetry: false, group: null, invert: true, clear: true });
    this.scheduleFusion(); this.onChange();
  }
  brushAt(point, options = {}) {
    if (!this.state) return false;
    if (options.record !== false) this.checkpoint();
    const tool = options.tool ?? this.settings.tool;
    const brush = { tool, radius: this.settings.brushRadius, strength: this.settings.brushStrength, falloff: this.settings.brushFalloff, symmetry: this.settings.mirror, group: this.settings.activeGroup, invert: this.settings.brushInvert, ...options };
    const before = tool === 'clump' || tool === 'density' ? this.locks.map(lock => ({ lock, x: Float32Array.from(lock.x), density: lock.density ?? 1 })) : null;
    if (!applyHairBrush(this.state, point, brush)) return false;
    if (tool === 'density' && !brush.invert) this.addDensityGuides(point, brush);
    if (tool === 'clump' || tool === 'density') { this.relax(); this.syncMeshes(); this.previewGuideChanges(before, brush); }
    else {
      // Spatial sculpt affects the implicit surface; enable its view on first
      // use, retaining the underlying mechas and group inclusion choices.
      this.state.fusion.enabled = true;
      this.previewHairBrush(point, brush);
    }
    this.scheduleFusion(); this.updateHelpers(); this.onChange();
    return true;
  }
  previewGuideChanges(before, brush) {
    const changed = before.filter(({ lock, x, density }) => (lock.group ?? 'main') === brush.group && (density !== (lock.density ?? 1) || moved(x, lock.x)));
    if (!changed.length) return;
    for (const mesh of this.fusionMeshes ?? []) {
      if (!(mesh.userData.hairGroups ?? [mesh.userData.hairGroup]).includes(brush.group)) continue;
      const position = mesh.geometry.getAttribute('position');
      for (let v = 0; v < position.count; v++) {
        const px = position.getX(v), py = position.getY(v), pz = position.getZ(v);
        let nearest = null, distance = Infinity;
        for (const entry of changed) for (let i = 2; i < N; i++) {
          const o = i * 3, x = entry.x[o], y = entry.x[o + 1], z = entry.x[o + 2], d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
          if (d < distance) { distance = d; nearest = { entry, o }; }
        }
        if (!nearest || distance > Math.max(.002, nearest.entry.lock.width ** 2 * 2)) continue;
        const { entry, o } = nearest, densityScale = Math.sqrt((entry.lock.density ?? 1) / Math.max(1e-5, entry.density));
        position.setXYZ(v, entry.lock.x[o] + (px - entry.x[o]) * densityScale, entry.lock.x[o + 1] + (py - entry.x[o + 1]) * densityScale, entry.lock.x[o + 2] + (pz - entry.x[o + 2]) * densityScale);
        this.state.collider?.resolve(position.array, v * 3, .0008);
      }
      position.needsUpdate = true; mesh.geometry.computeBoundingSphere();
    }
  }
  addDensityGuides(point, brush) {
    if (hairMaskAt(this.state, point, brush.group) >= 1 || this.locks.length >= 400) return;
    const donor = this.locks.filter(l => (l.group ?? 'main') === brush.group).reduce((best, l) => !best || l.rootP.distanceTo(point) < best.rootP.distanceTo(point) ? l : best, null);
    if (!donor) return;
    const normal = point.clone().sub(this.state.frame.C).normalize(), tangent = new Vector3(1, 0, 0).addScaledVector(normal, -normal.x).normalize(), bitangent = new Vector3().crossVectors(normal, tangent);
    // Goal distance between roots (Blender's Density "Distance Min"), shared with Fill.
    const spacing = this.settings.brushSpacing;
    for (let i = 0; i < 8 && this.locks.length < 400; i++) {
      const angle = i * Math.PI / 4, position = point.clone().addScaledVector(tangent, Math.cos(angle) * brush.radius * .55).addScaledVector(bitangent, Math.sin(angle) * brush.radius * .55);
      const d = position.sub(this.state.frame.C).normalize();
      const hit = this.midlineHit(this.state.frame.C.clone().addScaledVector(d, .5), d.negate());
      if (!hit?.root || hit.point.distanceTo(point) > brush.radius || hairMaskAt(this.state, hit.point, brush.group) >= 1 || this.locks.some(l => (l.density ?? 1) > 0 && l.rootP.distanceTo(hit.point) < spacing)) continue;
      const lock = makeLock(this.state, donor.root, donor.x, Object.fromEntries(Object.keys(lockLimits).filter(k => k !== 'length').map(k => [k, donor[k]])));
      lock.rest.set(donor.rest); lock.seg = donor.seg; lock.styled = donor.styled; lock.group = brush.group; lock.density = brush.strength;
      this.moveRoot(lock, hit.root); this.locks.push(lock);
    }
  }
  previewHairBrush(point, brush) {
    if (!['volume', 'mask', 'smooth'].includes(brush.tool)) return;
    const center = point.clone(), mirrored = point.clone(); mirrored.x = 2 * this.state.frame.C.x - mirrored.x;
    const p = new Vector3(), n = new Vector3();
    for (const mesh of this.fusionMeshes ?? []) {
      if (brush.group != null && !(mesh.userData.hairGroups ?? [mesh.userData.hairGroup]).includes(brush.group)) continue;
      const positions = mesh.geometry.getAttribute('position'), normals = mesh.geometry.getAttribute('normal'), colors = mesh.geometry.getAttribute('color');
      if (brush.tool === 'smooth') {
        // Weld only the preview's neighbor lookup, leaving extracted topology
        // untouched. Duplicated triangle corners move together, avoiding cracks.
        const map = new Map(), unique = [], vertexIds = [];
        for (let i = 0; i < positions.count; i++) {
          const key = `${Math.round(positions.getX(i) * 1e6)},${Math.round(positions.getY(i) * 1e6)},${Math.round(positions.getZ(i) * 1e6)}`;
          if (!map.has(key)) { map.set(key, unique.length); unique.push({ point: new Vector3().fromBufferAttribute(positions, i), neighbors: new Set(), vertices: [] }); }
          const id = map.get(key); vertexIds.push(id); unique[id].vertices.push(i);
        }
        for (let i = 0; i < vertexIds.length; i += 3) for (const a of [i, i + 1, i + 2]) for (const b of [i, i + 1, i + 2]) if (vertexIds[a] !== vertexIds[b]) unique[vertexIds[a]].neighbors.add(vertexIds[b]);
        const updated = unique.map(item => {
          const amount = hairBrushFalloff(Math.min(item.point.distanceTo(center), brush.symmetry ? item.point.distanceTo(mirrored) : Infinity), brush.radius, brush.falloff) * brush.strength * (1 - hairMaskAt(this.state, item.point, brush.group));
          const average = new Vector3();
          for (const id of item.neighbors) average.add(unique[id].point);
          if (item.neighbors.size) average.divideScalar(item.neighbors.size); else average.copy(item.point);
          return item.point.clone().lerp(average, amount * .5);
        });
        unique.forEach((item, id) => { for (const i of item.vertices) { const q = updated[id]; positions.setXYZ(i, q.x, q.y, q.z); this.state.collider?.resolve(positions.array, i * 3, .0008); } });
        positions.needsUpdate = true; mesh.geometry.computeBoundingSphere();
        continue;
      }
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i);
        const weight = hairBrushFalloff(Math.min(p.distanceTo(center), brush.symmetry ? p.distanceTo(mirrored) : Infinity), brush.radius, brush.falloff) * brush.strength;
        if (!weight) continue;
        const mask = hairMaskAt(this.state, p, brush.group);
        if (brush.tool === 'mask') colors.setXYZ(i, 1, 1 - mask * .5, 1 - mask * .45);
        else { n.fromBufferAttribute(normals, i); p.addScaledVector(n, weight * (1 - mask) * brush.radius * .22 * (brush.invert ? -1 : 1)); positions.setXYZ(i, p.x, p.y, p.z); this.state.collider?.resolve(positions.array, i * 3, .0008); }
      }
      positions.needsUpdate = true; colors.needsUpdate = true; mesh.geometry.computeBoundingSphere();
    }
  }
  /** The selected locks (or every lock when `all`). */
  targets(all = false) { return all || !this.selected.size ? this.locks : [...this.selected].map(n => this.locks[n]).filter(Boolean); }
  edit(fn, { all = false, record = true } = {}) {
    if (!this.state) return;
    const list = this.targets(all);
    if (!list.length) return;
    if (record) this.checkpoint();
    for (const lock of list) fn(lock);
    this.relax();
    this.step(); this.onChange();
  }
  /** The parameter transaction keeps an immutable curve baseline. Exact
   * comparisons with its last output also invalidate it when a source is
   * pulled, combed or resized without starting a different checkpoint.
   */
  authorBend(lock, value) {
    const equal = (a, b) => a?.length === b.length && a.every((v, i) => v === b[i]);
    let base = this.bendBaselines.get(lock);
    if (!base || base.revision !== this.revision || base.seg !== lock.seg || base.lastValue !== lock.bend || !equal(base.lastX, lock.x) || !equal(base.lastRest, lock.rest)) {
      base = { revision: this.revision, seg: lock.seg, value: lock.bend, embedded: Boolean(lock.bendEmbedded), x: Float32Array.from(lock.x), rest: Float32Array.from(lock.rest) };
      this.bendBaselines.set(lock, base);
    }
    this.state.fusion ??= normalizeHairFusion();
    bendLock(lock, base, value - base.value, this.state.frame);
    // Legacy be-only curves have an unbent design plus a post-gravity bend.
    // On authoring, migrate that design once to coordinates containing the
    // complete requested bend; the posed curve uses the relative change above.
    if (!base.embedded) {
      const design = { x: Float32Array.from(base.rest), rest: Float32Array.from(base.rest) };
      bendLock(design, { x: base.rest, rest: base.rest }, value, this.state.frame);
      lock.rest.set(design.rest);
    }
    const protectedPose = new Map(), protectedDesign = new Map();
    for (let i = 2; i < N; i++) {
      const pose = new Vector3().fromArray(base.x, i * 3), mask = hairMaskAt(this.state, pose, lock.group ?? 'main');
      if (!mask) continue;
      for (let k = 0; k < 3; k++) { lock.x[i * 3 + k] = base.x[i * 3 + k] + (lock.x[i * 3 + k] - base.x[i * 3 + k]) * (1 - mask); lock.rest[i * 3 + k] = base.rest[i * 3 + k] + (lock.rest[i * 3 + k] - base.rest[i * 3 + k]) * (1 - mask); }
      if (mask >= 1 - 1e-6) { protectedPose.set(i, pose); protectedDesign.set(i, new Vector3().fromArray(base.rest, i * 3)); }
    }
    if (value !== base.value) constrainLockPose(lock, this.state, { reference: base.x, protectedPoints: protectedPose });
    // Constrain the authored design independently, keeping the same public
    // source arrays and pin coordinates after the synchronous projection.
    if (value !== base.value || (!base.embedded && base.value !== 0)) {
      const pose = lock.x; lock.x = lock.rest;
      try { constrainLockPose(lock, this.state, { reference: base.rest, protectedPoints: protectedDesign }); }
      finally { lock.x = pose; }
    }
    lock.bend = value; lock.bendEmbedded = true; lock.styled = true;
    base.lastValue = value; base.lastX = Float32Array.from(lock.x); base.lastRest = Float32Array.from(lock.rest);
  }
  setParam(key, value, record = false) { this.edit(lock => { const next = clamp(value, ...lockLimits[key]); if (key === 'bend') this.authorBend(lock, next); else lock[key] = next; }, { record }); }
  scaleParam(key, factor) { this.edit(lock => { const next = clamp(lock[key] * factor, ...lockLimits[key]); if (key === 'bend') this.authorBend(lock, next); else lock[key] = next; }); }
  setLength(value, record = false) { this.edit(lock => setLockLength(lock, value), { record }); }
  scaleLength(factor) { this.edit(lock => setLockLength(lock, lockLength(lock) * factor)); }
  /** The current shape becomes the styled shape (held against gravity). */
  setRest() { this.edit(lock => { lock.rest.set(lock.x); lock.styled = true; lock.fixed = true; }, { all: !this.selected.size }); }
  /** Back to a free lock: gravity hangs it again from its shape. */
  releaseRest() { this.edit(lock => { lock.styled = false; lock.fixed = false; }); }
  unpin() { this.edit(lock => lock.pins.clear()); }
  pinTip() { this.edit(lock => lock.pins.set(N - 1, new Vector3().fromArray(lock.x, (N - 1) * 3))); }
  deleteSelected() {
    if (!this.selected.size) return;
    this.checkpoint();
    const gone = new Set([...this.selected].map(n => this.locks[n]));
    this.state.locks = this.locks.filter(lock => !gone.has(lock));
    this.selected.clear();
    // Locks that lay on the deleted ones fall onto what is left.
    this.relax();
    this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers(); this.onChange();
  }
  clearAll() { this.checkpoint(); this.state.locks = []; this.selected.clear(); this.syncMeshes(true); this.updateUnderlay(); this.updateHelpers(); this.onChange(); }
  selectAll() { this.selected = new Set(this.locks.map((_, i) => i)); this.syncMeshes(); this.updateHelpers(); this.onChange(); }
  clearSelection() { this.selected.clear(); this.syncMeshes(); this.updateHelpers(); this.onChange(); }
  /** Gravity strength (0: the locks keep their drawn shapes). */
  setGravity(force) { this.settings.gravity = clamp(force, 0, 1); this.relax(); this.step(); this.onChange(); }
  /** Gravity on or off (off: locks keep the shapes they are pulled into). */
  setGravityOn(on) { this.settings.gravityOn = Boolean(on); this.physicsLive = Boolean(on); this.invalidatePhysics(); if(on){this.physicsError=null;if(this.physicsStats)this.physicsStats={...this.physicsStats,error:null};} this.onChange(); }
  /** Set the selected locks' current shapes (nothing selected: nothing happens). */
  fixSelected() { if (this.selected.size) this.setRest(); }
  /** Hang every free lock again (gives the same hair when nothing changed). */
  applyGravity() { if (!this.state) return; this.checkpoint(); this.relax(); this.step(); this.updateUnderlay(); this.onChange(); }

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
    // A simulation failure described the previous hairstyle.
    this.physicsError = null; if (this.physicsStats) this.physicsStats = { ...this.physicsStats, error: null };
    this.restore(JSON.stringify(normalizeLocks(data)));
    return true;
  }
  /** Lock stats for the panel. */
  summary() {
    const locks = this.locks, sel = this.targets();
    return {
      count: locks.length, selected: this.selected.size, pins: locks.reduce((n, l) => n + l.pins.size, 0),
      styled: locks.filter(l => l.styled).length, first: sel[0] ?? null, gravityOn: this.settings.gravityOn,
      fixed: locks.filter(l => l.fixed).length,
      fusion: this.state?.fusion ?? null, fusionStats: (this.fusionMeshes ?? []).map(m => m.userData.fusionStats), activeGroup: this.settings.activeGroup,
      fusionBusy: Boolean(this.fusionBusy), fusionError: this.fusionError ?? null,
    };
  }
}

const moved = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2e-5) return true; return false; };
