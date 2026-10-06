import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  Plane, Raycaster, RingGeometry, SphereGeometry, Vector2, Vector3,
} from 'three';
import {
  POINTS, HAIRLINE_POINTS, anglesOf, braidStart, buildCards, computeSections, growStrand, hairCardMaterial, hairlineAt,
  HairSim, prepareGroom, resampleStrand, sampleRoots, scalpField, serializeGroom,
} from './groom.mjs';

export const groomTools = ['select', 'pull', 'comb', 'cut', 'tie', 'part', 'hairline'];

/**
 * Interactive grooming on the rest pose. Guides are simulated live (gravity,
 * collision, clips); the hair cards are regenerated from them as you work.
 */
/** Clamp a target for strand point i to what the strand can reach from its root. */
function reachable(g, i, target) {
  const root = new Vector3().fromArray(g.points, 0), reach = g.segment * i * 0.995;
  const d = target.distanceTo(root);
  return d > reach ? root.addScaledVector(target.clone().sub(root), reach / d) : target;
}

export class GroomEditor {
  constructor(renderer) {
    this.renderer = renderer;
    this.raycaster = new Raycaster();
    this.settings = { tool: 'pull', radius: 40, strength: 0.6, gravity: true, pinOnRelease: false, lock: 0.025 };
    this.selected = new Set();
    this.state = null; this.undoStack = []; this.redoStack = [];
    this.onChange = () => {};
  }
  get active() { return Boolean(this.state); }
  /** Start editing the current character's groom (data may be null for a fresh one). */
  begin(human, groomData, color) {
    this.end();
    this.human = human; this.color = color;
    this.context = human.context;
    // Reuse the strands this character was just built with (already settled).
    this.state = !groomData && human.context.groomState ? human.context.groomState : prepareGroom(this.context, groomData, { settle: true });
    human.context.groomState = null;
    this.state.sim.gravity = this.settings.gravity ? -9.81 : 0;
    this.selected.clear();
    this.refreshSections();
    const scene = this.renderer.scene;
    const hairMesh = human.group.getObjectByName('Hair'); if (hairMesh) hairMesh.visible = false;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: true, transparent: true, opacity: 0.9 }));
    this.lines.renderOrder = 5;
    this.cards = new Mesh(new BufferGeometry(), hairCardMaterial(color));
    this.markers = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: 0xff3b6b, depthTest: false }));
    this.markers.renderOrder = 7;
    this.cursor = new Mesh(new RingGeometry(0.92, 1, 40), new MeshBasicMaterial({ color: 0xf27a2e, side: DoubleSide, depthTest: false, transparent: true }));
    this.cursor.renderOrder = 8; this.cursor.visible = false;
    this.scalp = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }));
    this.scalp.renderOrder = 4;
    this.handles = [];
    this.group = [this.lines, this.cards, this.markers, this.cursor, this.scalp];
    for (const object of this.group) scene.add(object);
    this.buildHandles();
    this.updateScalp();
    this.frame = 0;
    this.update(true);
  }
  end() {
    if (!this.state) return null;
    const result = serializeGroom(this.state);
    for (const object of [...(this.group ?? []), ...(this.handles ?? [])]) { object.removeFromParent(); object.geometry?.dispose(); object.material?.dispose?.(); }
    for (const name of ['Hair', 'ScalpUnderlay']) { const mesh = this.human?.group.getObjectByName(name); if (mesh) mesh.visible = true; }
    this.state = null;
    return result;
  }
  serialize() { return this.state ? serializeGroom(this.state) : null; }

  // ----------------------------------------------------------- history
  checkpoint() {
    this.undoStack.push(JSON.stringify(this.serialize()));
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }
  restore(json) {
    const data = JSON.parse(json);
    const keep = { ...this.settings };
    this.state = prepareGroom(this.context, data, { settle: false });
    this.settings = keep;
    this.state.sim.gravity = keep.gravity ? -9.81 : 0;
    this.selected.clear(); this.refreshSections(); this.buildHandles(); this.updateScalp(); this.update(true); this.onChange();
  }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.serialize())); this.restore(this.undoStack.pop()); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.serialize())); this.restore(this.redoStack.pop()); }

  // ------------------------------------------------------------- scalp
  refreshSections() {
    const s = this.state;
    s.sections = computeSections(s.frame, s.guides.map(g => new Vector3().fromArray(g.points, 0)), s.groom.partings, s.spacing);
  }
  updateScalp() {
    const s = this.state, { data, positions } = this.context;
    s.field = scalpField(s.frame, positions, s.groom.hairline);
    const pos = [], color = [], index = [];
    const base = new Color(0x3fbf7f), edge = new Color(0xffd166);
    for (const face of s.frame.faces) {
      const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
      if (ids.some(v => s.frame.headWeight[v] < 0.3)) continue;
      const values = ids.map(v => s.field[v]);
      if (values.every(v => v < -0.05)) continue;
      const at = pos.length / 3;
      ids.forEach((v, c) => {
        const n = s.normals;
        pos.push(positions[v * 3] + n[v * 3] * 0.0015, positions[v * 3 + 1] + n[v * 3 + 1] * 0.0015, positions[v * 3 + 2] + n[v * 3 + 2] * 0.0015);
        const tint = values[c] >= 0 ? base.clone().lerp(edge, Math.max(0, 1 - values[c] / 0.06)) : edge.clone().multiplyScalar(0.6);
        color.push(tint.r, tint.g, tint.b);
      });
      index.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
    this.scalp.geometry.dispose();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
    geometry.setIndex(index);
    this.scalp.geometry = geometry;
    this.scalp.visible = this.settings.tool === 'hairline' || this.settings.tool === 'part';
  }
  /** Where a hairline control point sits on the head surface. */
  handlePosition(k) {
    const s = this.state, theta = k / HAIRLINE_POINTS * Math.PI * 2, phi = s.groom.hairline[k];
    const dir = new Vector3(Math.sin(theta) * Math.cos(phi), Math.sin(phi), Math.cos(theta) * Math.cos(phi));
    this.raycaster.set(s.frame.C.clone().addScaledVector(dir, s.frame.R * 3), dir.clone().negate());
    const [hit] = this.raycaster.intersectObject(this.probe(), false);
    return hit ? hit.point.addScaledVector(dir, 0.003) : s.frame.C.clone().addScaledVector(dir, s.frame.R);
  }
  probe() {
    const body = this.human.body;
    this.bodyProbe ??= new Mesh(body.geometry, new MeshBasicMaterial({ side: DoubleSide }));
    this.bodyProbe.geometry = body.geometry;
    return this.bodyProbe;
  }
  buildHandles() {
    for (const h of this.handles ?? []) { h.removeFromParent(); h.geometry.dispose(); }
    this.handles = [];
    const geometry = new SphereGeometry(0.0065 * this.state.k, 12, 8);
    for (let k = 0; k < HAIRLINE_POINTS; k++) {
      const handle = new Mesh(geometry, new MeshBasicMaterial({ color: 0xffd166, depthTest: false }));
      handle.renderOrder = 9; handle.userData.index = k;
      handle.position.copy(this.handlePosition(k));
      handle.visible = this.settings.tool === 'hairline';
      this.renderer.scene.add(handle); this.handles.push(handle);
    }
  }
  /** Keep guides whose roots are still on the scalp; grow new ones where the scalp gained area. */
  syncRoots() {
    const s = this.state, { data, positions } = this.context;
    s.field = scalpField(s.frame, positions, s.groom.hairline);
    s.guides = s.guides.filter(g => {
      const face = s.frame.faces[g.f];
      return [0, 1, 2, 3].map(c => s.field[data.faces[face * 4 + c]]).reduce((a, b) => a + b, 0) / 4 >= -0.01;
    });
    const existing = s.guides.map(g => new Vector3().fromArray(g.points, 0));
    const { roots } = sampleRoots(data, positions, s.normals, s.frame, s.field, s.groom.density, s.groom.seed + this.undoStack.length + 1, existing);
    const fresh = [];
    for (const r of roots) {
      const strand = growStrand(r.p, r.n, s.frame, s.groom.length * s.k);
      fresh.push({ f: r.f, b: r.b, root: r.p, normal: r.n, ...strand, frozen: false, clips: new Map(), t: 0, cu: 0.5, w: 1, br: -1, velocity: new Float32Array(POINTS * 3) });
    }
    s.guides.push(...fresh);
    s.sim.guides = s.guides;
    // Let only the new strands fall into place.
    const frozen = s.guides.map(g => g.frozen);
    s.guides.forEach(g => { g.frozen = !fresh.includes(g); });
    s.sim.settle(60);
    s.guides.forEach((g, i) => { g.frozen = frozen[i]; });
    this.refreshSections(); this.selected.clear();
  }

  // ------------------------------------------------------------ update
  step(dt) {
    if (!this.state) return;
    const sim = this.state.sim;
    sim.gravity = this.settings.gravity ? -9.81 : 0;
    // Verlet needs a constant step (x - old is the last step's motion): a
    // varying frame time pumps energy into resting hair. Fixed 1/60 s steps
    // with an accumulator ("Fix Your Timestep"), at most two per frame.
    this.accumulator = Math.min((this.accumulator ?? 0) + (Number.isFinite(dt) ? dt : 1 / 60), 2 / 60);
    let stepped = false;
    while (this.accumulator >= 1 / 60) { sim.step(1 / 60); this.accumulator -= 1 / 60; stepped = true; }
    if (!stepped) return;
    this.frame++;
    this.update(this.frame % 3 === 0);
  }
  update(cards = true) {
    const s = this.state, pos = [], color = [];
    const normal = new Color(0xd8d2c8), chosen = new Color(0xf27a2e), frozen = new Color(0x5ab8ff), braided = new Color(0xc28bff);
    s.guides.forEach((g, n) => {
      const c = this.selected.has(n) ? chosen : g.br >= 0 ? braided : g.frozen ? frozen : normal;
      for (let i = 0; i + 1 < POINTS; i++) {
        pos.push(g.points[i * 3], g.points[i * 3 + 1], g.points[i * 3 + 2], g.points[i * 3 + 3], g.points[i * 3 + 4], g.points[i * 3 + 5]);
        color.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    });
    this.replace(this.lines, pos, color);
    this.lines.visible = this.settings.showGuides !== false;
    // Clips: small markers where locks are held.
    const marker = [], size = 0.004 * s.k;
    for (const g of s.guides) for (const target of g.clips.values()) {
      for (const [a, b] of [[[1, 0, 0], [-1, 0, 0]], [[0, 1, 0], [0, -1, 0]], [[0, 0, 1], [0, 0, -1]]]) {
        marker.push(target.x + a[0] * size, target.y + a[1] * size, target.z + a[2] * size, target.x + b[0] * size, target.y + b[1] * size, target.z + b[2] * size, target.x, target.y + size * 0.3, target.z);
      }
    }
    this.replace(this.markers, marker);
    if (cards) {
      const guides = s.guides.map(g => ({ ...g, braidStart: g.br >= 0 ? braidStart(g) : 2 }));
      const geometry = buildCards(guides, s.frame, { width: s.spacing * 1.6, weightsFor: () => [[0, 0, 0, 0], [1, 0, 0, 0]], ties: s.ties, k: s.k });
      this.cards.geometry.dispose(); this.cards.geometry = geometry;
      this.cards.material.color.set(this.color);
    }
  }
  replace(object, pos, color) {
    object.geometry.dispose();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    if (color) geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
    object.geometry = geometry;
  }
  setTool(tool) {
    this.settings.tool = tool;
    for (const h of this.handles) h.visible = tool === 'hairline';
    if (this.scalp) this.scalp.visible = tool === 'hairline' || tool === 'part';
  }

  // ----------------------------------------------------------- picking
  screen(point, camera) {
    const v = point.clone().project(camera), canvas = this.renderer.canvas;
    return new Vector2((v.x + 1) / 2 * canvas.clientWidth, (1 - v.y) / 2 * canvas.clientHeight);
  }
  /**
   * The strand under the cursor: a ray against the visible hair cards first
   * (each card vertex knows its guide and point), else the nearest guide point
   * on screen within maxPx.
   */
  pick(pixel, camera, maxPx = 24, ndc = null) {
    if (ndc && this.cards.geometry.userData.owner) {
      this.raycaster.setFromCamera(ndc, camera);
      const [hit] = this.raycaster.intersectObject(this.cards, false);
      const owner = this.cards.geometry.userData.owner;
      if (hit && owner[hit.face.a * 2] >= 0) {
        const guide = owner[hit.face.a * 2], index = Math.max(1, owner[hit.face.a * 2 + 1]);
        return { guide, index, point: hit.point.clone() };
      }
    }
    let best = null, distance = maxPx * maxPx;
    const p = new Vector3();
    this.state.guides.forEach((g, n) => {
      for (let i = 1; i < POINTS; i++) {
        p.fromArray(g.points, i * 3);
        const s = this.screen(p, camera), d = (s.x - pixel.x) ** 2 + (s.y - pixel.y) ** 2;
        if (d < distance) { distance = d; best = { guide: n, index: i, point: p.clone() }; }
      }
    });
    return best;
  }
  /** Guides passing within `radius` of a point. */
  lockAround(point, radius) {
    const r2 = radius * radius, out = [];
    this.state.guides.forEach((g, n) => {
      for (let i = 1; i < POINTS; i++) {
        const dx = g.points[i * 3] - point.x, dy = g.points[i * 3 + 1] - point.y, dz = g.points[i * 3 + 2] - point.z;
        if (dx * dx + dy * dy + dz * dz < r2) { out.push(n); return; }
      }
    });
    return out;
  }
  section(n) { const id = this.state.sections[n]; return this.state.guides.map((_, i) => i).filter(i => this.state.sections[i] === id); }
  headHit(ndc, camera) {
    this.raycaster.setFromCamera(ndc, camera);
    const [hit] = this.raycaster.intersectObject(this.probe(), false);
    return hit ?? null;
  }

  // ------------------------------------------------------------- tools
  pointerDown(ndc, pixel, camera, { shift = false, ctrl = false } = {}) {
    const s = this.state, tool = this.settings.tool;
    if (!s) return false;
    if (tool === 'select') {
      const hit = this.pick(pixel, camera, 24, ndc);
      if (!hit) { if (!shift) this.selected.clear(); this.update(false); this.onChange(); return true; }
      const lock = this.section(hit.guide);
      if (!shift && !ctrl) this.selected.clear();
      for (const n of lock) { if (ctrl) this.selected.delete(n); else this.selected.add(n); }
      this.update(false); this.onChange();
      return true;
    }
    if (tool === 'pull') {
      const hit = this.pick(pixel, camera, 30, ndc);
      if (!hit) return false;
      this.checkpoint();
      // As with grab brushes in XGen or Blender, the lock is the strands within
      // reach of the cursor, each held at its point nearest the grab; a lock
      // the user selected (a section) is pulled whole.
      const lock = this.selected.has(hit.guide) ? [...this.selected] : this.lockAround(hit.point, this.settings.lock * s.k);
      if (!lock.includes(hit.guide)) lock.push(hit.guide);
      this.selected = new Set(lock);
      const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), hit.point);
      const p = new Vector3();
      const grabbed = lock.map(n => {
        const g = s.guides[n];
        let index = Math.min(POINTS - 1, hit.index), best = Infinity;
        for (let i = 1; i < POINTS; i++) { const d = p.fromArray(g.points, i * 3).distanceToSquared(hit.point); if (d < best) { best = d; index = i; } }
        g.frozen = false;
        return { g, index, offset: new Vector3().fromArray(g.points, index * 3).sub(hit.point) };
      });
      this.drag = { tool, plane, grabbed, start: hit.point.clone() };
      this.update(false); this.onChange();
      return true;
    }
    if (tool === 'comb' || tool === 'cut') {
      const hit = this.pick(pixel, camera, this.settings.radius);
      if (!hit) return false;
      this.checkpoint();
      const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), hit.point);
      this.drag = { tool, plane, last: hit.point.clone(), pixel: pixel.clone() };
      this.brush(pixel, camera, null);
      return true;
    }
    if (tool === 'tie') {
      if (!this.selected.size) return false;
      const hit = this.headHit(ndc, camera);
      // Tie on the surface clicked, or in the air at the lock's depth.
      let point = hit?.point;
      if (!point) {
        const centre = new Vector3();
        for (const n of this.selected) centre.add(new Vector3().fromArray(s.guides[n].points, Math.floor(POINTS / 2) * 3));
        centre.divideScalar(this.selected.size);
        this.raycaster.setFromCamera(ndc, camera);
        point = this.raycaster.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), centre), new Vector3());
      } else point = point.clone().addScaledVector(point.clone().sub(s.frame.C).normalize(), 0.012 * s.k);
      if (!point) return false;
      this.checkpoint();
      this.tie(point);
      return true;
    }
    if (tool === 'part') {
      const hit = this.headHit(ndc, camera);
      if (!hit) return false;
      this.checkpoint();
      const a = anglesOf(s.frame, hit.point.x, hit.point.y, hit.point.z);
      this.drag = { tool, line: [[a.theta, a.phi]] };
      return true;
    }
    if (tool === 'hairline') {
      this.raycaster.setFromCamera(ndc, camera);
      const [hit] = this.raycaster.intersectObjects(this.handles, false);
      if (!hit) return false;
      this.checkpoint();
      this.drag = { tool, index: hit.object.userData.index };
      return true;
    }
    return false;
  }
  pointerMove(ndc, pixel, camera) {
    const s = this.state;
    if (!s) return;
    if (!this.drag) { this.hover(pixel, camera); return; }
    const drag = this.drag;
    if (drag.tool === 'pull') {
      this.raycaster.setFromCamera(ndc, camera);
      const point = this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      if (!point) return;
      // The lock gathers slightly as it is pulled, like hair held in a hand.
      // A lock can be pulled only as far as its length from the root reaches.
      for (const { g, index, offset } of drag.grabbed) g.grab = new Map([[index, reachable(g, index, point.clone().addScaledVector(offset, 0.55))]]);
      return;
    }
    if (drag.tool === 'comb' || drag.tool === 'cut') { this.brush(pixel, camera, ndc); return; }
    if (drag.tool === 'part') {
      const hit = this.headHit(ndc, camera);
      if (!hit) return;
      const a = anglesOf(s.frame, hit.point.x, hit.point.y, hit.point.z), last = drag.line.at(-1);
      if (Math.hypot(a.theta - last[0], a.phi - last[1]) > 0.02) drag.line.push([a.theta, a.phi]);
      return;
    }
    if (drag.tool === 'hairline') {
      const hit = this.headHit(ndc, camera);
      if (!hit) return;
      const a = anglesOf(s.frame, hit.point.x, hit.point.y, hit.point.z);
      s.groom.hairline[drag.index] = Math.max(-1.1, Math.min(1.1, a.phi));
      this.handles[drag.index].position.copy(this.handlePosition(drag.index));
      this.updateScalp();
    }
  }
  pointerUp({ pin = false } = {}) {
    const s = this.state, drag = this.drag;
    this.drag = null;
    if (!s || !drag) return;
    if (drag.tool === 'pull') {
      for (const { g } of drag.grabbed) {
        // Pinned on release (clip), otherwise let go and it falls.
        // The clip goes where the strand actually is: a target beyond its reach
        // is only approached, and clipping there would leave the clip floating.
        if ((pin || this.settings.pinOnRelease) && g.grab) for (const i of g.grab.keys()) g.clips.set(i, new Vector3().fromArray(g.points, i * 3));
        g.grab = null;
      }
      this.lastGrab = drag.grabbed;
    }
    if (drag.tool === 'part' && drag.line.length > 1) {
      s.groom.partings.push(drag.line);
      this.partPush(drag.line);
      this.refreshSections();
    }
    if (drag.tool === 'hairline') { this.syncRoots(); this.buildHandles(); this.updateScalp(); }
    this.update(true); this.onChange();
  }
  hover(pixel, camera) {
    const tool = this.settings.tool;
    if ((tool !== 'comb' && tool !== 'cut') || !this.state) { this.cursor.visible = false; return; }
    const hit = this.pick(pixel, camera, this.settings.radius);
    this.cursor.visible = Boolean(hit);
    if (!hit) return;
    // Show the screen radius as a ring at the depth of the hair under the cursor.
    const world = camera.position.distanceTo(hit.point) * Math.tan(camera.fov * Math.PI / 360) * 2 / this.renderer.canvas.clientHeight * this.settings.radius;
    this.cursor.position.copy(hit.point); this.cursor.lookAt(camera.position); this.cursor.scale.setScalar(world);
  }
  /** Comb moves strand points under the brush with the stroke; Cut trims strands where the brush touches. */
  brush(pixel, camera, ndc) {
    const s = this.state, drag = this.drag, r2 = this.settings.radius ** 2;
    let delta = null;
    if (ndc) {
      this.raycaster.setFromCamera(ndc, camera);
      const point = this.raycaster.ray.intersectPlane(drag.plane, new Vector3());
      if (!point) return;
      delta = point.clone().sub(drag.last); drag.last.copy(point);
    }
    const p = new Vector3();
    s.guides.forEach(g => {
      if (drag.tool === 'comb' && g.frozen) return;
      let combed = false;
      for (let i = 1; i < POINTS; i++) {
        p.fromArray(g.points, i * 3);
        const sc = this.screen(p, camera), d2 = (sc.x - pixel.x) ** 2 + (sc.y - pixel.y) ** 2;
        if (d2 > r2) continue;
        if (drag.tool === 'cut') {
          if (i < 2) continue;
          let length = 0;
          for (let j = 1; j <= i; j++) length += Math.hypot(g.points[j * 3] - g.points[j * 3 - 3], g.points[j * 3 + 1] - g.points[j * 3 - 2], g.points[j * 3 + 2] - g.points[j * 3 - 1]);
          const cut = resampleStrand(g.points, length);
          g.points.set(cut.points); g.segment = cut.segment; g.velocity.fill(0); HairSim.setRest(g);
          for (const key of [...g.clips.keys()]) if (key >= POINTS) g.clips.delete(key);
          break;
        }
        if (!delta) continue;
        const falloff = (1 - d2 / r2) * this.settings.strength;
        // Points further along a strand follow the comb more.
        const along = i / (POINTS - 1);
        for (let k = 0; k < 3; k++) g.points[i * 3 + k] += delta.getComponent(k) * falloff * (0.4 + 0.6 * along);
        combed = true;
      }
      // Combing sets the direction the hair leaves the scalp.
      if (combed) HairSim.setRest(g);
    });
  }
  /** Gather the selected locks at a point (ponytail / bun base): each is held where its length reaches the tie. */
  tie(point) {
    const s = this.state, axis = new Vector3();
    for (const n of this.selected) {
      const g = s.guides[n], root = new Vector3().fromArray(g.points, 0), reach = root.distanceTo(point) * 1.04;
      let length = 0, index = POINTS - 1;
      for (let i = 1; i < POINTS; i++) { length += g.segment; if (length >= reach) { index = i; break; } }
      const jitter = new Vector3(Math.sin(n * 12.9), Math.cos(n * 7.3), Math.sin(n * 3.1)).multiplyScalar(0.004 * s.k);
      g.clips.set(index, reachable(g, index, point.clone().add(jitter)));
      g.frozen = false;
      axis.add(root.clone().sub(point));
    }
    s.ties.push({ world: point.toArray(), axis: axis.normalize().toArray() });
    this.update(true); this.onChange();
  }
  /** A parting combs hair away from the line on each side. */
  partPush(line) {
    const s = this.state;
    for (const g of s.guides) {
      const root = new Vector3().fromArray(g.points, 0), a = anglesOf(s.frame, root.x, root.y, root.z);
      let best = Infinity, side = 0;
      for (let k = 0; k + 1 < line.length; k++) {
        const [t1, f1] = line[k], [t2, f2] = line[k + 1], dt = t2 - t1, df = f2 - f1, len2 = dt * dt + df * df || 1e-9;
        const t = Math.max(0, Math.min(1, ((a.theta - t1) * dt + (a.phi - f1) * df) / len2));
        const d = Math.hypot(a.theta - (t1 + dt * t), a.phi - (f1 + df * t));
        if (d < best) { best = d; side = Math.sign(dt * (a.phi - f1) - df * (a.theta - t1)) || 1; }
      }
      if (best > 0.25) continue;
      // Push away from the line, tangentially to the head, decaying with distance.
      const out = root.clone().sub(s.frame.C).normalize();
      const up = new Vector3(0, 1, 0), across = up.clone().cross(out).normalize();
      const dir = across.multiplyScalar(-side).addScaledVector(up, 0.2).normalize();
      const amount = (1 - best / 0.25) * 0.02 * s.k;
      for (let i = 1; i < POINTS; i++) for (let k = 0; k < 3; k++) g.points[i * 3 + k] += dir.getComponent(k) * amount * Math.min(1, i / 3);
    }
  }

  // ------------------------------------------------------- operations
  apply(fn) { this.checkpoint(); for (const n of this.selected) fn(this.state.guides[n], n); this.update(true); this.onChange(); }
  selectAll() { this.selected = new Set(this.state.guides.map((_, i) => i)); this.update(false); this.onChange(); }
  clearSelection() { this.selected.clear(); this.update(false); this.onChange(); }
  /** Clip the selection where it is now, at its middle (or where it was last pulled). */
  clip() {
    const indexFor = g => this.lastGrab?.find(item => item.g === g)?.index ?? Math.floor(POINTS * 0.55);
    this.apply(g => { const i = indexFor(g); g.clips.set(i, new Vector3().fromArray(g.points, i * 3)); });
  }
  release() { this.apply(g => { g.clips.clear(); g.frozen = false; g.grab = null; }); this.state.ties = this.state.ties.filter(() => false); }
  freeze(on) { this.apply(g => { g.frozen = on; g.velocity.fill(0); if (on) HairSim.setRest(g); }); }
  setLength(scale) { this.apply(g => { const r = resampleStrand(g.points, g.segment * (POINTS - 1) * scale); g.points.set(r.points); g.segment = r.segment; }); }
  setStyle(field, value) { this.apply(g => { g[field] = value; }); }
  braid(on) {
    const id = on ? Math.max(-1, ...this.state.guides.map(g => g.br)) + 1 : -1;
    this.apply(g => { g.br = id; g.frozen = false; });
  }
  /** Regrow the whole head with a new density and length (keeps hairline and partings). */
  regrow(density, length) {
    this.checkpoint();
    const groom = { ...serializeGroom(this.state), guides: null, ties: [], density, length };
    this.state = prepareGroom(this.context, groom);
    this.selected.clear(); this.refreshSections(); this.buildHandles(); this.updateScalp(); this.update(true); this.onChange();
  }
  /** Grow the selected strands outward for volume (backcombing). */
  volume(amount) {
    const s = this.state;
    this.apply(g => {
      const root = new Vector3().fromArray(g.points, 0);
      for (let i = 1; i < POINTS; i++) {
        const p = new Vector3().fromArray(g.points, i * 3), out = p.clone().sub(s.frame.C).normalize();
        p.addScaledVector(out, amount * 0.02 * s.k * Math.min(1, i / 4));
        g.points.set(p.toArray(), i * 3);
      }
      void root;
    });
  }
}
void hairlineAt;
