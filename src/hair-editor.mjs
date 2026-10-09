import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector3,
} from 'three';
import {
  LOCK_POINTS as N, arcLengthAt, bendLock, capGeometry, combLock, geometryFrom, lockCard, lockLength, lockLimits, locksCap, makeLock, normalizeLocks, prepareLocks,
  resamplePolyline, rootFrame, rootFromHit, serializeLocks, setLockLength, setLockShape, updateGeometry,
} from './locks.mjs';
import { hairCapMaterial, hairCardMaterial } from './hair-cards.mjs';
import { HairGuide } from './hair-guide.mjs';
import { normalizeHairFusion } from './hair-fusion.mjs';
import { hairParts, makePart } from './hair-parts.mjs';
import { accessoryMaterial, accessoryParts, pruneAccessories, removeAccessory } from './hair-accessories.mjs';

/**
 * The hair editor (VRoid-style): hair is drawn, not simulated.
 *
 * - Brush: a stroke is projected on the guide (hair-guide.mjs) around the
 *   head; it becomes one or more locks rooted on the scalp where it starts,
 *   each laid over the hair already there (layers), so new hair never passes
 *   through older hair.
 * - Fill: plants locks on the scalp under the circle, combed like their
 *   neighbours (or away from the parting), at an even spacing.
 * - Retouch: re-trace over locks to change their shape from where the stroke
 *   starts; starting at a tip lengthens (VRoid's Retouch).
 * - Cut, Erase (whole locks, Blender's Delete Curves), Volume (lift off the
 *   head; Ctrl flattens) and Select.
 * Nothing moves by itself: a stroke is the shape. Every lock is a hair card
 * (hair-cards.mjs), the same as the game mesh, one mesh per lock while
 * editing (for picking); the character build merges them.
 */
export const hairTools = ['brush', 'fill', 'retouch', 'cut', 'erase', 'volume', 'select'];
const SLOT_PREFIX = 'hgs.locks.';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const storage = {
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};
/** Screen distance (NDC, height units) a stroke point must travel before it is kept: a light stabilizer. */
const STROKE_STEP = 0.012;
const LAYER_GAP = 0.0025;
const forms = { straight: { curl: 0, turns: 3 }, wavy: { curl: 0.35, turns: 3 }, curl: { curl: 0.85, turns: 6 } };

export class HairEditor {
  constructor(renderer) {
    this.renderer = renderer;
    this.raycaster = new Raycaster();
    this.settings = {
      tool: 'brush', width: 0.025, strands: 3, volume: 0.22, taper: 0.55, form: 'straight', radius: 0.12, strength: 0.5,
      spacing: 0.02, length: 0.14, imitate: true, mirror: true, activeGroup: 'main',
      guideVolume: 0.008, guideLength: 0.6, showGuide: true,
    };
    this.selected = new Set(); this.state = null; this.undoStack = []; this.redoStack = []; this.revision = 0;
    this.meshes = []; this.drag = null; this.dirty = false;
    // Callbacks kept for the interface (no background work: busy never turns on).
    this.onChange = () => {}; this.onBusy = () => {}; this.onProgress = () => {}; this.onPhysics = () => {};
  }
  get active() { return Boolean(this.state); }
  get locks() { return this.state?.locks ?? []; }

  // ---------------------------------------------------------------- lifecycle
  begin(human, data, color) {
    this.end();
    this.human = human; this.context = human.context; this.color = color;
    this.state = prepareLocks(this.context, data);
    // Version 2 files keep groups, ids and card settings.
    this.state.fusion ??= normalizeHairFusion();
    // Free locks hang as the character build hangs them: the editor shows the final hair.
    this.state.sim.apply();
    for (const lock of this.locks) lock.group ??= 'main';
    this.selected.clear();
    for (const name of ['Hair', 'HairCap', 'ScalpUnderlay', 'HairAccessories']) { const mesh = human.group.getObjectByName(name); if (mesh) mesh.visible = false; }
    this.group = new Group(); this.group.name = 'HairEditor';
    this.renderer.scene.add(this.group);
    this.materials = { normal: hairCardMaterial(color), selected: hairCardMaterial(color, { highlight: true }), cap: hairCapMaterial(color) };
    // A ready-made base stays visible and is wrapped by the guide, so new locks are drawn over it.
    const base = human.group.getObjectByName('HairBase');
    this.overBase = Boolean(base);
    // Over a base the guide lies close on it (locks rest on that hair, not standing off it).
    if (base) this.settings.guideVolume = Math.min(this.settings.guideVolume, 0.003);
    this.guide = new HairGuide(this.state, { volume: this.settings.guideVolume, length: this.settings.guideLength, outline: base?.geometry.getAttribute('position').array ?? null });
    this.hoverMark = new Mesh(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    this.hoverMark.visible = false; this.hoverMark.renderOrder = 11;
    this.strokeLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0xf27a2e, depthTest: false, transparent: true, opacity: 0.95 }));
    this.strokeLine.renderOrder = 12; this.strokeLine.frustumCulled = false;
    this.accessoryMesh = new Mesh(new BufferGeometry(), accessoryMaterial());
    this.accessoryMesh.frustumCulled = false;
    this.capMesh = new Mesh(new BufferGeometry(), this.materials.cap);
    this.capMesh.frustumCulled = false;
    this.group.add(this.guide.wire, this.hoverMark, this.strokeLine, this.accessoryMesh, this.capMesh);
    this.scalpVertices = null; this.sites = null;
    this.syncMeshes(true); this.updateCap(); this.updateHelpers();
  }
  /** Rebuild the hair cap from the locks' current combing (after an edit, not during a drag). */
  updateCap() {
    if (!this.capMesh) return;
    const part = locksCap(this.state);
    this.capMesh.geometry.dispose();
    this.capMesh.geometry = part ? capGeometry(part) : new BufferGeometry();
  }
  /** The hair cap on or off (saved with the hairstyle). */
  setScalp(on) { this.checkpoint(); this.state.scalp = on ? 1 : 0; this.updateCap(); this.onChange(); }
  end() {
    if (!this.state) return null;
    const result = this.serialize();
    this.group?.traverse(object => { if (object !== this.guide?.wire) object.geometry?.dispose(); });
    this.group?.removeFromParent();
    this.guide?.dispose(); this.guide = null;
    for (const material of Object.values(this.materials ?? {})) material.dispose();
    this.accessoryMesh?.material.dispose(); this.accessoryMesh = null;
    for (const name of ['Hair', 'HairCap', 'ScalpUnderlay', 'HairAccessories']) { const mesh = this.human?.group.getObjectByName(name); if (mesh) mesh.visible = true; }
    this.state = null; this.meshes = []; this.drag = null;
    return result;
  }
  serialize() { return this.state ? serializeLocks(this.state) : null; }
  setColor(color) {
    this.color = color;
    for (const [key, material] of Object.entries(this.materials ?? {})) {
      // The cap shares the cards' colour and highlight tint.
      const fresh = hairCardMaterial(color, { highlight: key === 'selected' });
      material.color.copy(fresh.color); material.specularColor.copy(fresh.specularColor); fresh.dispose();
    }
  }
  /** Kept for the renderer's frame loop and the UI: there is no simulation to run or cancel. */
  tickPhysics() {}
  cancelGravity() {}
  cancelOperation() {}
  step() { if (this.dirty) { this.dirty = false; this.syncMeshes(); } }

  // ------------------------------------------------------------------ history
  checkpoint() {
    this.revision++;
    this.undoStack.push(JSON.stringify(this.serialize()));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  restore(json, keepSelection = false) {
    const selection = [...this.selected];
    this.state = prepareLocks(this.context, JSON.parse(json));
    this.state.fusion ??= normalizeHairFusion();
    this.state.sim.apply();
    for (const lock of this.locks) lock.group ??= 'main';
    if (this.guide) this.guide.state = this.state;
    this.scalpVertices = null; this.sites = null;
    this.selected = new Set(keepSelection ? selection.filter(i => i < this.locks.length) : []);
    this.syncMeshes(true); this.updateCap(); this.updateHelpers(); this.onChange();
  }
  undo() { if (!this.undoStack.length) return; this.revision++; this.redoStack.push(JSON.stringify(this.serialize())); this.restore(this.undoStack.pop(), true); }
  redo() { if (!this.redoStack.length) return; this.revision++; this.undoStack.push(JSON.stringify(this.serialize())); this.restore(this.redoStack.pop(), true); }

  // -------------------------------------------------------------------- scene
  /** Rebuild the cards of locks that changed (or all). */
  syncMeshes(all = false) {
    const locks = this.locks;
    while (this.meshes.length > locks.length) { const mesh = this.meshes.pop(); mesh.geometry.dispose(); mesh.removeFromParent(); }
    while (this.meshes.length < locks.length) { const mesh = new Mesh(new BufferGeometry(), this.materials.normal); mesh.frustumCulled = false; this.group.add(mesh); this.meshes.push(mesh); }
    locks.forEach((lock, n) => {
      const mesh = this.meshes[n];
      mesh.userData.index = n;
      mesh.visible = !lock.erased && !lock.hidden;
      mesh.material = this.selected.has(n) ? this.materials.selected : this.materials.normal;
      const key = `${lock.width},${lock.volume},${lock.taper},${lock.curl},${lock.turns},${lock.twist},${lock.density ?? 1}`;
      if (!all && mesh.userData.lock === lock && lock.built && key === lock.builtKey && !moved(lock.built, lock.x)) return;
      mesh.userData.lock = lock;
      lock.built = Float32Array.from(lock.x); lock.builtKey = key;
      const part = lockCard(lock, this.state, { detail: 0.6 });
      if (!updateGeometry(mesh.geometry, part)) { mesh.geometry.dispose(); mesh.geometry = geometryFrom([part]); }
    });
    this.syncAccessories();
  }
  syncAccessories() {
    if (!this.accessoryMesh) return;
    pruneAccessories(this.state);
    const parts = accessoryParts(this.state);
    this.accessoryMesh.geometry.dispose();
    this.accessoryMesh.geometry = parts.length ? geometryFrom(parts) : new BufferGeometry();
  }
  /** The guide cage shows while drawing or retouching. */
  updateHelpers() {
    if (!this.guide) return;
    this.guide.wire.visible = this.settings.showGuide && ['brush', 'retouch'].includes(this.settings.tool);
  }
  setTool(tool) { this.settings.tool = hairTools.includes(tool) ? tool : 'brush'; this.updateHelpers(); }
  /** Rebuild the guide for a new volume or length. */
  setGuide({ volume = this.settings.guideVolume, length = this.settings.guideLength } = {}) {
    this.settings.guideVolume = volume; this.settings.guideLength = length;
    this.guide?.build(volume, length); this.updateHelpers();
  }

  // ------------------------------------------------------------------ picking
  probe() {
    const body = this.human.body;
    this.bodyProbe ??= new Mesh(body.geometry, new MeshBasicMaterial({ side: DoubleSide }));
    this.bodyProbe.geometry = body.geometry;
    return this.bodyProbe;
  }
  pickScalp(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const [hit] = this.raycaster.intersectObject(this.probe(), false);
    if (!hit) return null;
    const baseIds = this.human.body.geometry.userData.baseIds;
    const root = rootFromHit(this.state, [hit.face.a, hit.face.b, hit.face.c].map(v => baseIds[v]), hit.point);
    return root ? { root, point: hit.point.clone(), distance: hit.distance } : null;
  }
  pickGuide(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const [hit] = this.raycaster.intersectObject(this.guide.mesh, false);
    return hit ? hit.point.clone() : null;
  }
  /** The lock card under the cursor (not behind the body). */
  pickLock(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const [hit] = this.raycaster.intersectObjects(this.meshes.filter(m => m.visible), false);
    if (!hit) return null;
    const [body] = this.raycaster.intersectObject(this.probe(), false);
    if (body && body.distance + 0.0015 < hit.distance) return null;
    return { index: hit.object.userData.index, point: hit.point.clone(), distance: hit.distance };
  }
  /** Scalp vertices (inside the hairline) and, for each, a face to root on. */
  scalpIndex() {
    if (this.scalpVertices) return this.scalpVertices;
    const { field, frame, data, positions } = this.state, face = new Map();
    for (const f of frame.faces) for (let c = 0; c < 4; c++) {
      const v = data.faces[f * 4 + c];
      if (!face.has(v)) face.set(v, [v, data.faces[f * 4 + (c + 1) % 4], data.faces[f * 4 + (c + 2) % 4]]);
    }
    const list = [];
    for (const [v, tri] of face) if (field[v] >= 0) list.push({ v, tri, p: new Vector3().fromArray(positions, v * 3) });
    this.scalpVertices = list;
    return list;
  }
  /**
   * The root for a point over the head: the scalp directly under it (seen
   * from the head centre), so a lock starts below where its stroke starts
   * and never climbs to it; past the hairline, the nearest scalp point.
   */
  nearestRoot(point) {
    const C = this.state.frame.C, d = point.clone().sub(C).normalize(), v = new Vector3();
    let under = null, bestDot = -Infinity, near = null, bestD = Infinity;
    for (const item of this.scalpIndex()) {
      const dot = v.copy(item.p).sub(C).normalize().dot(d);
      if (dot > bestDot) { bestDot = dot; under = item; }
      const dist = item.p.distanceToSquared(point);
      if (dist < bestD) { bestD = dist; near = item; }
    }
    // Within ~4° of a scalp vertex the point is over the scalp.
    const best = bestDot > Math.cos(0.07) ? under : near;
    return best ? rootFromHit(this.state, best.tri, best.p) : null;
  }
  mirrorPoint(p) { const C = this.state.frame.C; return new Vector3(2 * C.x - p.x, p.y, p.z); }

  // -------------------------------------------------------------- lock making
  creationParams() {
    const s = this.settings;
    return { width: s.width, volume: s.volume, taper: s.taper, ...forms[s.form] ?? forms.straight, group: s.activeGroup };
  }
  /** A lock from `root` along a path (world points), held in that shape. */
  lockAlong(root, path, params = this.creationParams()) {
    const { p, n } = rootFrame(this.state, root);
    const points = [p.x, p.y, p.z, p.x + n.x * 0.004, p.y + n.y * 0.004, p.z + n.z * 0.004];
    // Points closer to the root than the lift are dropped (the stroke starts on the scalp).
    for (const q of path) if (q.distanceTo(p) > 0.006) points.push(q.x, q.y, q.z);
    if (points.length < 9) return null;
    const lock = makeLock(this.state, root, null, params);
    lock.group = params.group ?? 'main';
    // Drawn over a ready-made base, a lock grows out of that hair: its root narrows to nothing (no card edge on top).
    if (this.overBase) lock.rootTaper = true;
    if (!setLockShape(lock, points)) return null;
    this.keepOut(lock);
    lock.styled = true; lock.rest.set(lock.x);
    return lock;
  }
  /** Keep a lock's points off the skin and clothes by its thickness. */
  keepOut(lock) {
    const collider = this.state.collider, thickness = Math.max(0.003, 0.5 * lock.width * lock.volume);
    for (let i = 2; i < N; i++) collider.resolve(lock.x, i * 3, thickness);
  }
  /**
   * Lay `lock` over the hair already there: where its card would pass under
   * another lock's card (overlapping across, at a smaller height from the
   * guide's axis) it is lifted just above it. `skip` are locks made in the
   * same stroke (side by side, not stacked).
   */
  layer(lock, skip = new Set()) {
    const others = this.locks.filter(other => other !== lock && !skip.has(other) && !other.erased);
    if (!others.length) return;
    const guide = this.guide, p = new Vector3(), q = new Vector3(), n = new Vector3(), m = new Vector3(), d = new Vector3();
    const lift = new Float32Array(N);
    for (let i = 2; i < N; i++) {
      p.fromArray(lock.x, i * 3);
      const h = guide.frame(p, n);
      let need = 0;
      for (const other of others) {
        const reach = 0.75 * (lock.width + other.width);
        if (other.rootP.distanceTo(p) > lockLength(other) + reach) continue;
        for (let j = 1; j < N; j++) {
          q.fromArray(other.x, j * 3);
          d.copy(q).sub(p);
          const along = d.dot(n);
          // Only hair right there: close along the outward direction too, and facing the same way.
          if (Math.abs(along) > 0.03 || d.addScaledVector(n, -along).lengthSq() > reach * reach) continue;
          const hq = guide.frame(q, m);
          if (m.dot(n) < 0.6) continue;
          if (hq + LAYER_GAP > h + need) need = hq + LAYER_GAP - h;
        }
      }
      lift[i] = need;
    }
    // Lifts are smoothed along the lock (no kinks) and never undone near the root.
    for (let pass = 0; pass < 3; pass++) for (let i = N - 2; i >= 2; i--) lift[i] = Math.max(lift[i], (lift[i - 1] + lift[i + 1]) * 0.5 * 0.9);
    let moved = false;
    for (let i = 2; i < N; i++) {
      if (lift[i] <= 0) continue;
      p.fromArray(lock.x, i * 3); guide.frame(p, n);
      p.addScaledVector(n, Math.min(lift[i], 0.05)); lock.x.set(p.toArray(), i * 3); moved = true;
    }
    if (moved) { setLockShape(lock, Array.from(lock.x)); lock.rest.set(lock.x); }
  }
  /** Lateral copies of a stroke path, side by side across its width (on the guide). */
  spread(path, offset) {
    if (!offset) return path.map(p => p.clone());
    const n = new Vector3(), t = new Vector3(), side = new Vector3();
    return path.map((p, j) => {
      t.copy(path[Math.min(path.length - 1, j + 1)]).sub(path[Math.max(0, j - 1)]).normalize();
      this.guide.frame(p, n);
      side.crossVectors(n, t).normalize();
      return p.clone().addScaledVector(side, offset);
    });
  }
  /** The locks of one brush stroke: `strands` side by side, and their mirror. */
  strokeLocks(path, startRoot) {
    const s = this.settings, K = clamp(Math.round(s.strands), 1, 7), made = [];
    const rootP = rootFrame(this.state, startRoot).p;
    const make = (points, root) => { const lock = root ? this.lockAlong(root, points) : null; if (lock) made.push(lock); return lock; };
    for (let k = 0; k < K; k++) {
      const offset = (k - (K - 1) / 2) * s.width * 0.8;
      const points = this.spread(path, offset);
      const root = K === 1 ? startRoot : this.nearestRoot(this.spread([rootP, path[Math.min(1, path.length - 1)]], offset)[0]);
      const lock = make(points, root);
      // Outer strands a little shorter, so a stroke ends in a natural point.
      if (lock && K > 1) setLockLength(lock, lockLength(lock) * (1 - 0.1 * Math.abs(k - (K - 1) / 2) / ((K - 1) / 2)));
      if (lock) lock.rest.set(lock.x);
      if (s.mirror && lock && Math.abs(lock.rootP.x - this.state.frame.C.x) > 0.006) {
        const twin = this.nearestRoot(this.mirrorPoint(lock.rootP));
        make(points.map(p => this.mirrorPoint(p)), twin);
      }
    }
    return made;
  }
  /** Add made locks, laid over the older hair (left unselected: the hair is seen as it is). */
  addLocks(made) {
    const fresh = new Set(made);
    for (const lock of made) this.layer(lock, fresh);
    for (const lock of made) this.locks.push(lock);
  }

  // ------------------------------------------------------------------- fill
  /** Roots on an even lattice over the scalp (Fibonacci sphere directions cast onto the scalp vertices). */
  fillSites() {
    const spacing = this.settings.spacing, { C, R } = this.state.frame;
    if (this.sites?.spacing === spacing) return this.sites;
    const count = Math.max(8, Math.round(4 * Math.PI * R * R / (spacing * spacing * 0.866))), golden = Math.PI * (3 - Math.sqrt(5));
    const sites = [], used = new Set(), scalp = this.scalpIndex(), q = new Vector3();
    for (let k = 0; k < count; k++) {
      const y = 1 - (k + 0.5) / count * 2, r = Math.sqrt(1 - y * y), a = k * golden;
      q.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(R * 1.6).add(C);
      let best = null, bestD = Infinity;
      for (const item of scalp) {
        const dx = item.p.x - C.x, dy = item.p.y - C.y, dz = item.p.z - C.z, l = Math.hypot(dx, dy, dz) || 1;
        const dot = (dx * (q.x - C.x) + dy * (q.y - C.y) + dz * (q.z - C.z)) / (l * R * 1.6);
        const dd = 1 - dot;
        if (dd < bestD) { bestD = dd; best = item; }
      }
      // A site only where the scalp is (its direction lands close to a scalp vertex), once per vertex.
      if (!best || bestD > (spacing / R) ** 2 || used.has(best.v)) continue;
      used.add(best.v);
      sites.push({ root: rootFromHit(this.state, best.tri, best.p), p: best.p });
    }
    this.sites = { spacing, list: sites };
    return this.sites;
  }
  /** A lock for Fill at `root`: combed like the locks around it, else away from the parting and back. */
  fillLock(root, fresh) {
    const { p, n } = rootFrame(this.state, root), s = this.settings, reach = s.spacing * 3;
    const near = s.imitate ? this.locks.filter(lock => !fresh.has(lock) && !lock.erased && lock.rootP.distanceTo(p) < reach) : [];
    let direction, length = s.length, params = this.creationParams();
    if (near.length) {
      direction = new Vector3(); length = 0;
      let total = 0, nearest = near[0];
      const v = new Vector3();
      for (const lock of near) {
        const dist = lock.rootP.distanceTo(p), w = 1 / (dist + 1e-3);
        if (dist < nearest.rootP.distanceTo(p)) nearest = lock;
        v.fromArray(lock.x, 4 * 3).sub(lock.rootP); v.addScaledVector(lock.rootN, -v.dot(lock.rootN));
        if (v.lengthSq() > 1e-10) direction.addScaledVector(v.normalize(), w);
        length += lockLength(lock) * w; total += w;
      }
      length /= total;
      params = { width: nearest.width, volume: nearest.volume, taper: nearest.taper, curl: nearest.curl, turns: nearest.turns, twist: nearest.twist, group: nearest.group ?? s.activeGroup };
      direction.addScaledVector(n, -direction.dot(n));
    }
    if (!direction || direction.lengthSq() < 1e-10) {
      // Combed back from the face and a little to its own side: a base that frames the face and falls behind the ears.
      const C = this.state.frame.C;
      direction = new Vector3((p.x < C.x ? -1 : 1) * 0.35, -0.45, -1);
    }
    const lock = combLock(this.state, root, direction.normalize(), length, params);
    lock.group = params.group ?? 'main';
    this.keepOut(lock);
    lock.styled = true; lock.rest.set(lock.x);
    return lock;
  }
  fillAt(ndc, camera) {
    // `radius` is the circle's radius in NDC height units (main.mjs draws it `radius` × viewport height across).
    const drag = this.drag, radius = this.settings.radius, spacing = this.settings.spacing * 0.85, q = new Vector3();
    const free = point => !this.locks.some(lock => !lock.erased && lock.rootP.distanceTo(point) < spacing) && !drag.made.some(lock => lock.rootP.distanceTo(point) < spacing);
    const made = [];
    for (const site of this.fillSites().list) {
      if (!site.root) continue;
      q.copy(site.p).project(camera);
      if (q.z > 1 || ((q.x - ndc.x) * camera.aspect) ** 2 + (q.y - ndc.y) ** 2 > radius ** 2) continue;
      // Only the side of the head facing the camera.
      if (site.p.clone().sub(this.state.frame.C).dot(camera.position.clone().sub(site.p)) < 0) continue;
      if (!free(site.p)) continue;
      const lock = this.fillLock(site.root, new Set(drag.made));
      made.push(lock); drag.made.push(lock);
      if (this.settings.mirror && Math.abs(site.p.x - this.state.frame.C.x) > 0.006) {
        const twin = this.nearestRoot(this.mirrorPoint(site.p));
        const at = twin && rootFrame(this.state, twin).p;
        if (at && free(at)) { const other = this.fillLock(twin, new Set(drag.made)); made.push(other); drag.made.push(other); }
      }
    }
    if (!made.length) return;
    const fresh = new Set(drag.made);
    for (const lock of made) { this.layer(lock, fresh); this.locks.push(lock); }
    this.dirty = true;
  }

  // -------------------------------------------------------------- brushes on hair
  /** Locks with a point inside the circle on screen, each with its nearest point. */
  locksUnder(ndc, camera, { from = 1 } = {}) {
    const radius = this.settings.radius, q = new Vector3(), out = [];
    this.locks.forEach((lock, index) => {
      if (lock.erased || lock.hidden) return;
      let best = -1, bestD = radius * radius;
      for (let i = from; i < N; i++) {
        q.fromArray(lock.x, i * 3).project(camera);
        if (q.z > 1) continue;
        const d = ((q.x - ndc.x) * camera.aspect) ** 2 + (q.y - ndc.y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) out.push({ lock, index, i: best, weight: 1 - Math.sqrt(bestD) / radius });
    });
    return out;
  }
  volumeAt(ndc, camera, invert) {
    const strength = this.settings.strength * 0.004, p = new Vector3(), n = new Vector3(), q = new Vector3();
    const radius = this.settings.radius;
    for (const { lock } of this.locksUnder(ndc, camera, { from: 2 })) {
      for (let i = 2; i < N; i++) {
        q.fromArray(lock.x, i * 3).project(camera);
        const d = Math.sqrt(((q.x - ndc.x) * camera.aspect) ** 2 + (q.y - ndc.y) ** 2);
        if (d >= radius) continue;
        const w = (1 - d / radius) ** 2 * Math.min(1, i / 4);
        p.fromArray(lock.x, i * 3); this.guide.frame(p, n);
        p.addScaledVector(n, (invert ? -1 : 1) * strength * w);
        lock.x.set(p.toArray(), i * 3);
      }
      this.keepOut(lock);
      const length = lockLength(lock);
      setLockShape(lock, Array.from(lock.x)); setLockLength(lock, length); lock.styled = true; lock.rest.set(lock.x);
      this.dirty = true;
      if (this.drag) this.drag.changed = true;
    }
  }
  /** Retouch: from where each lock was caught, the lock follows the stroke; past the stroke its old tail continues. */
  retouch() {
    const drag = this.drag, stroke = drag.points;
    if (stroke.length < 2) return;
    for (const target of drag.targets) {
      const { lock, i0, base, length0, offset } = target;
      const prefix = [];
      for (let i = 0; i <= i0; i++) prefix.push(new Vector3().fromArray(base, i * 3));
      const traced = stroke.map(p => p.clone().add(offset));
      const path = [...prefix, ...traced.slice(1)];
      const arc = pts => pts.reduce((s, p, k) => k ? s + p.distanceTo(pts[k - 1]) : 0, 0);
      const done = arc(path);
      if (done < length0) {
        // The rest of the old lock, moved to start where the stroke ends.
        const tail = resamplePolyline(base, length0), at = Math.min(N - 1, Math.ceil(done / length0 * (N - 1)));
        const start = new Vector3().fromArray(tail, at * 3), shift = path.at(-1).clone().sub(start);
        for (let i = at + 1; i < N; i++) path.push(new Vector3().fromArray(tail, i * 3).add(shift));
      }
      setLockShape(lock, path.flatMap(p => [p.x, p.y, p.z]));
      this.keepOut(lock);
      lock.styled = true; lock.rest.set(lock.x);
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------- pointer input
  pointerDown(ndc, camera, { shift = false, ctrl = false } = {}) {
    if (!this.state) return false;
    const tool = this.settings.tool;
    if (tool === 'brush') {
      // A stroke may start beside the head: it begins where the cursor first reaches the guide.
      const scalp = this.pickScalp(ndc, camera), start = this.pickGuide(ndc, camera);
      this.drag = { tool, root: scalp?.root ?? null, last: { x: ndc.x, y: ndc.y }, points: [], lastHit: null };
      if (start || scalp) this.drag.points.push(start ?? scalp.point);
      this.showStroke();
      return true;
    }
    // Fill, Cut, Erase and Volume start anywhere and act where the stroke passes over the hair.
    if (tool === 'fill') {
      this.checkpoint();
      this.drag = { tool, made: [] };
      if (!shift) this.selected.clear();
      this.fillAt(ndc, camera); this.step(); this.onChange();
      return true;
    }
    if (tool === 'retouch') {
      const caught = this.locksUnder(ndc, camera, { from: 1 });
      if (!caught.length) return false;
      const start = this.pickGuide(ndc, camera) ?? new Vector3().fromArray(caught[0].lock.x, caught[0].i * 3);
      this.checkpoint();
      this.drag = {
        tool, last: { x: ndc.x, y: ndc.y }, points: [start],
        targets: caught.map(({ lock, i }) => ({ lock, i0: Math.max(1, i), base: Float32Array.from(lock.x), length0: lockLength(lock), offset: new Vector3().fromArray(lock.x, Math.max(1, i) * 3).sub(start) })),
      };
      this.showStroke();
      return true;
    }
    if (tool === 'cut' || tool === 'erase') {
      this.checkpoint();
      this.drag = { tool, done: new Set(), last: { x: ndc.x, y: ndc.y } };
      this.cutOrErase(this.drag.last, ndc, camera); this.step();
      return true;
    }
    if (tool === 'volume') {
      this.checkpoint();
      this.drag = { tool, invert: ctrl, changed: false };
      this.volumeAt(ndc, camera, ctrl); this.step();
      return true;
    }
    if (tool === 'select') {
      const hit = this.pickLock(ndc, camera);
      if (!hit) { if (!shift && !ctrl && this.selected.size) { this.selected.clear(); this.syncMeshes(); this.onChange(); } return false; }
      if (!shift && !ctrl) this.selected.clear();
      this.drag = { tool, remove: ctrl };
      this.selectHit(hit);
      return true;
    }
    return false;
  }
  pointerMove(ndc, camera) {
    const drag = this.drag;
    if (!drag || !this.state) return;
    if (drag.tool === 'brush' || drag.tool === 'retouch') {
      if (Math.hypot((ndc.x - drag.last.x) * camera.aspect, ndc.y - drag.last.y) < STROKE_STEP) return;
      const hit = this.pickGuide(ndc, camera);
      if (!hit) return;
      drag.last = { x: ndc.x, y: ndc.y }; drag.lastHit = hit;
      if (!drag.points.length) { drag.points.push(hit); this.showStroke(); return; }
      // Lazy follow: each kept point moves part of the way to the cursor (a light stroke stabilizer).
      const previous = drag.points.at(-1);
      drag.points.push(previous.clone().lerp(hit, 0.65));
      this.showStroke();
      if (drag.tool === 'retouch') { this.retouch(); this.step(); }
      return;
    }
    if (drag.tool === 'fill') { this.fillAt(ndc, camera); this.step(); return; }
    if (drag.tool === 'volume') { this.volumeAt(ndc, camera, drag.invert); this.step(); return; }
    if (drag.tool === 'cut' || drag.tool === 'erase') { this.cutOrErase(drag.last, ndc, camera); drag.last = { x: ndc.x, y: ndc.y }; this.step(); return; }
    const hit = this.pickLock(ndc, camera);
    if (!hit) return;
    if (drag.tool === 'select') this.selectHit(hit);
  }
  pointerUp() {
    const drag = this.drag;
    this.drag = null;
    this.hideStroke();
    if (!drag || !this.state) return;
    if (drag.tool === 'brush') {
      const path = drag.points;
      // The stroke ends where the cursor was released (the stabilizer lags behind it).
      if (drag.lastHit && path.length && drag.lastHit.distanceTo(path.at(-1)) > 1e-4) path.push(drag.lastHit);
      const span = path.reduce((s, p, k) => k ? s + p.distanceTo(path[k - 1]) : 0, 0);
      if (path.length < 2 || span < 0.01) return;
      const root = drag.root ?? this.nearestRoot(path[0]);
      if (!root) return;
      this.checkpoint();
      const made = this.strokeLocks(path, root);
      if (!made.length) { this.undoStack.pop(); return; }
      this.addLocks(made);
    }
    if (drag.tool === 'retouch') {
      const moved = new Set(drag.targets.map(t => t.lock));
      for (const lock of moved) this.layer(lock, moved);
    }
    if (drag.tool === 'fill' && !drag.made.length) this.undoStack.pop();
    if (drag.tool === 'volume' && !drag.changed) this.undoStack.pop();
    if ((drag.tool === 'cut' || drag.tool === 'erase') && !drag.done.size) this.undoStack.pop();
    if (drag.tool === 'erase') this.purge();
    this.syncMeshes();
    if (drag.tool !== 'select') this.updateCap();
    this.onChange();
  }
  /**
   * The stroke went from `a` to `b` (NDC). Cut: every lock whose card, seen on screen, crosses that
   * stretch is cut where it crosses (front and back hair alike, as scissors through a lock of hair).
   * Erase: every lock with a segment inside the circle goes whole (Blender's Delete Curves).
   */
  cutOrErase(a, b, camera) {
    const erase = this.drag.tool === 'erase', aspect = camera.aspect, radius = this.settings.radius;
    const ax = a.x * aspect, ay = a.y, bx = b.x * aspect, by = b.y, q = new Vector3(), p = new Float32Array(N * 3);
    // Distance from the screen point (x, y) to the stroke stretch, and where on the stretch.
    const toStroke = (x, y) => {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const s = l2 > 1e-12 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
      return Math.hypot(x - (ax + s * dx), y - (ay + s * dy));
    };
    this.locks.forEach((lock, index) => {
      if (lock.erased || lock.hidden || this.drag.done.has(lock)) return;
      let front = true;
      for (let i = 0; i < N; i++) { q.fromArray(lock.x, i * 3).project(camera); if (q.z > 1) front = false; p[i * 3] = q.x * aspect; p[i * 3 + 1] = q.y; }
      if (!front) return;
      if (erase) {
        for (let i = 1; i < N; i++) if (toStroke(p[i * 3], p[i * 3 + 1]) < radius) {
          lock.erased = true; this.drag.done.add(lock);
          if (this.meshes[index]) this.meshes[index].visible = false;
          return;
        }
        return;
      }
      // First crossing from the root: segment (i, i+1) against the stroke stretch (a, b).
      for (let i = 1; i < N - 1; i++) {
        const px = p[i * 3], py = p[i * 3 + 1], rx = p[i * 3 + 3] - px, ry = p[i * 3 + 4] - py;
        const sx = bx - ax, sy = by - ay, den = rx * sy - ry * sx;
        let t = -1;
        if (Math.abs(den) > 1e-12) {
          const u = ((ax - px) * sy - (ay - py) * sx) / den, v = ((ax - px) * ry - (ay - py) * rx) / den;
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1) t = u;
        }
        // A click without movement cuts the lock passing under the cursor.
        if (t < 0 && sx * sx + sy * sy < 1e-10) {
          const l2 = rx * rx + ry * ry, u = l2 > 1e-12 ? clamp(((ax - px) * rx + (ay - py) * ry) / l2, 0, 1) : 0;
          if (Math.hypot(ax - (px + u * rx), ay - (py + u * ry)) < 0.008) t = u;
        }
        if (t < 0) continue;
        const at = new Vector3().fromArray(lock.x, i * 3).lerp(q.fromArray(lock.x, (i + 1) * 3), t);
        setLockLength(lock, Math.max(lockLimits.length[0], arcLengthAt(lock, at)));
        lock.styled = true; lock.rest.set(lock.x);
        this.drag.done.add(lock); this.dirty = true;
        return;
      }
    });
  }
  /** Remove erased locks (their meshes go with them; the selection is renumbered). */
  purge() {
    if (!this.locks.some(lock => lock.erased)) return;
    const keep = [], selection = new Set();
    this.locks.forEach((lock, i) => { if (lock.erased) return; if (this.selected.has(i)) selection.add(keep.length); keep.push(lock); });
    this.state.locks = keep; this.selected = selection;
    this.syncMeshes(true);
  }
  selectHit(hit) {
    if (this.drag.remove) this.selected.delete(hit.index); else this.selected.add(hit.index);
    if (this.meshes[hit.index]) this.meshes[hit.index].material = this.selected.has(hit.index) ? this.materials.selected : this.materials.normal;
  }
  hover() {}
  showStroke() {
    const points = this.drag?.points ?? [];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points.flatMap(p => [p.x, p.y, p.z]), 3));
    this.strokeLine.geometry.dispose(); this.strokeLine.geometry = geometry; this.strokeLine.visible = true;
  }
  hideStroke() { if (this.strokeLine) this.strokeLine.visible = false; }

  // -------------------------------------------------------------------- parts
  /** Add a ready-made part (hair-parts.mjs) as its own group, laid over the hair there; returns the locks made. */
  addPart(id, options) {
    const made = makePart(this, id, options);
    if (!made.length) return 0;
    this.checkpoint();
    const used = new Set(this.locks.map(lock => lock.group));
    let n = 1;
    while (used.has(`${id}-${n}`)) n++;
    for (const lock of made) lock.group = `${id}-${n}`;
    this.addLocks(made);
    this.syncMeshes(); this.updateCap(); this.onChange();
    return made.length;
  }
  /** The parts in the hair: group id, part kind and lock count (the hand-drawn hair is 'main'). */
  partGroups() {
    const counts = new Map();
    for (const lock of this.locks) { const g = lock.group ?? 'main'; counts.set(g, (counts.get(g) ?? 0) + 1); }
    return [...counts].map(([group, count]) => ({ group, kind: hairParts.find(p => group.startsWith(`${p.id}-`))?.id ?? null, count }));
  }
  removeGroup(group) {
    this.checkpoint();
    for (const lock of this.locks) if ((lock.group ?? 'main') === group) lock.erased = true;
    this.selected.clear(); this.purge(); this.syncMeshes(true); this.updateCap(); this.onChange();
  }
  selectGroup(group) {
    this.selected = new Set(this.locks.map((lock, i) => (lock.group ?? 'main') === group ? i : -1).filter(i => i >= 0));
    this.syncMeshes(); this.onChange();
  }

  // ----------------------------------------------------------- adjust locks
  targets() { const chosen = [...this.selected].map(i => this.locks[i]).filter(Boolean); return chosen.length ? chosen : this.locks; }
  setParam(key, value) { for (const lock of this.targets()) lock[key] = value; this.dirty = true; this.onChange(); }
  setLength(length) { for (const lock of this.targets()) { setLockLength(lock, length); lock.styled = true; lock.rest.set(lock.x); } this.dirty = true; this.onChange(); }
  scaleLength(factor) {
    this.checkpoint();
    for (const lock of this.targets()) { setLockLength(lock, lockLength(lock) * factor); lock.styled = true; lock.rest.set(lock.x); }
    this.dirty = true; this.onChange();
  }
  /**
   * Gravity as a one-pass groom operator (LockShaper, as Ornatrix's Gravity): the chosen locks
   * (or all) hang from their current shape and settle on the head, shoulders, clothes and the hair
   * below them, then keep that shape as their rest (nothing moves afterwards).
   */
  settle() {
    const chosen = new Set(this.targets().filter(lock => !lock.erased));
    if (!chosen.size) return;
    this.checkpoint();
    for (const lock of chosen) { lock.rest.set(lock.x); lock.styled = false; }
    this.state.sim.apply({ only: chosen });
    for (const lock of chosen) { lock.styled = true; lock.rest.set(lock.x); }
    this.dirty = true; this.step(); this.updateCap(); this.onChange();
  }
  /** Curvar: the chosen locks bend from the shape they had when the slider was taken (bendLock), lengths kept, out of the body. */
  beginBend() { this.checkpoint(); this.bendFrom = new Map(this.targets().map(lock => [lock, { x: Float32Array.from(lock.x), rest: Float32Array.from(lock.rest) }])); }
  bendTo(amount) {
    if (!this.bendFrom) this.beginBend();
    for (const [lock, base] of this.bendFrom) {
      bendLock(lock, base, amount, this.state.frame);
      this.keepOut(lock);
      lock.styled = true; lock.rest.set(lock.x);
    }
    this.dirty = true; this.step();
  }
  endBend() { this.bendFrom = null; this.updateCap(); this.onChange(); }
  setForm(form) { const values = forms[form] ?? forms.straight; for (const lock of this.targets()) Object.assign(lock, values); this.dirty = true; this.onChange(); }
  formOf(lock) { return lock.curl > 0.6 ? 'curl' : lock.curl > 0 ? 'wavy' : 'straight'; }
  deleteSelected() {
    if (!this.selected.size) return;
    this.checkpoint();
    for (const i of this.selected) if (this.locks[i]) this.locks[i].erased = true;
    this.selected.clear(); this.purge(); this.syncMeshes(true); this.updateCap(); this.onChange();
  }
  selectAll() { this.selected = new Set(this.locks.map((_, i) => i)); this.syncMeshes(); this.onChange(); }
  clearSelection() { this.selected.clear(); this.syncMeshes(); this.onChange(); }
  clearAll() { this.checkpoint(); this.state.locks = []; this.state.accessories = []; this.selected.clear(); this.syncMeshes(true); this.updateCap(); this.onChange(); }
  removeHolder(id) { this.checkpoint(); removeAccessory(this.state, id); this.syncMeshes(true); this.onChange(); }
  summary() {
    const first = this.targets()[0] ?? null;
    return { count: this.locks.length, selected: this.selected.size, first, fixed: 0 };
  }

  // ------------------------------------------------------------------- files
  static slots() { return storage.keys().filter(k => k.startsWith(SLOT_PREFIX)).map(k => k.slice(SLOT_PREFIX.length)).sort((a, b) => a.localeCompare(b)); }
  saveSlot(name) { return storage.set(SLOT_PREFIX + name, JSON.stringify(this.serialize())); }
  loadSlot(name) { const json = storage.get(SLOT_PREFIX + name); return json ? this.load(json) : false; }
  deleteSlot(name) { storage.remove(SLOT_PREFIX + name); }
  /** Load a saved hairstyle (JSON text); false if it is not one. */
  load(json) {
    let data;
    try { data = JSON.parse(json); } catch { return false; }
    if (!data || data.format !== 'hgs-locks') return false;
    this.checkpoint();
    // The scalp base is the user's choice, kept when another hairstyle is loaded.
    this.restore(JSON.stringify({ ...normalizeLocks(data), scalp: this.state.scalp }));
    return true;
  }
}

const moved = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2e-5) return true; return false; };
