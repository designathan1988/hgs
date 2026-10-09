import { Mesh, MeshBasicMaterial, Plane, Raycaster, RingGeometry, Vector2, Vector3, DoubleSide } from 'three';

/**
 * Brush sculpting on the character's rest pose, in the spirit of Blender's
 * sculpt brushes: Draw moves along the average normal under the brush,
 * Inflate along each vertex normal, Grab drags the vertices caught at the start
 * of the stroke, Smooth relaxes towards neighbours, Flatten pulls onto the
 * brush plane. Hair adds Pin (protect) and Cut (trim below the brush).
 *
 * Edits are stored as sparse per-vertex offsets, divided by body height so
 * they survive height changes: body offsets on base-mesh vertices (so clothes,
 * hair and the face rig refit to them) and wearable offsets on proxy vertices.
 */
export const brushes = ['draw', 'inflate', 'grab', 'smooth', 'flatten', 'pinch', 'pin', 'unpin', 'cut'];
// Cloth brushes paint garment coverage onto body faces instead of moving vertices.
export const clothBrushes = ['clothAdd', 'clothErase'];
export const sculptTargets = { body: 'Body', hair: 'Hair', outfit: 'Outfit' };

const smoothstep = t => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const falloff = (distance, radius) => 1 - smoothstep(distance / radius);

/** Sculpt data kept in presets; bounded so a bad preset cannot explode a mesh. */
export function normalizeSculpt(value) {
  const result = { body: {}, hair: {}, outfit: {}, pins: {} };
  if (!value || typeof value !== 'object') return result;
  const offsets = source => {
    const out = {};
    if (!source || typeof source !== 'object') return out;
    for (const [key, delta] of Object.entries(source)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > 10000000 || !Array.isArray(delta) || delta.length !== 3) continue;
      if (!delta.every(Number.isFinite)) continue;
      const d = delta.map(x => Math.round(Math.max(-0.3, Math.min(0.3, x)) * 1e5) / 1e5);
      if (d.some(Boolean)) out[index] = d;
    }
    return out;
  };
  result.body = offsets(value.body);
  for (const kind of ['hair', 'outfit']) {
    for (const [style, edits] of Object.entries(value[kind] ?? {})) if (/^[a-z0-9_]+$/i.test(style)) {
      const clean = offsets(edits); if (Object.keys(clean).length) result[kind][style] = clean;
    }
  }
  for (const [style, list] of Object.entries(value.pins ?? {})) if (/^[a-z0-9_]+$/i.test(style) && Array.isArray(list)) {
    const clean = [...new Set(list.filter(i => Number.isInteger(i) && i >= 0 && i < 500000))].sort((a, b) => a - b);
    if (clean.length) result.pins[style] = clean;
  }
  return result;
}

/** Add stored offsets to positions (body: base vertex order; wearables: proxy order). */
export function applyOffsets(positions, offsets, height) {
  if (!offsets) return positions;
  for (const [key, [dx, dy, dz]] of Object.entries(offsets)) {
    const i = Number(key) * 3;
    if (i + 2 >= positions.length) continue;
    positions[i] += dx * height; positions[i + 1] += dy * height; positions[i + 2] += dz * height;
  }
  return positions;
}

function mirrorMap(points, count) {
  const cell = 0.004, grid = new Map(), key = (x, y, z) => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  for (let i = 0; i < count; i++) {
    const k = key(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const map = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    const x = -points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    let best = -1, distance = (cell * 1.5) ** 2;
    const cx = Math.round(x / cell), cy = Math.round(y / cell), cz = Math.round(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const j of grid.get(`${cx + a},${cy + b},${cz + c}`) ?? []) {
        const d = (points[j * 3] - x) ** 2 + (points[j * 3 + 1] - y) ** 2 + (points[j * 3 + 2] - z) ** 2;
        if (d < distance) { distance = d; best = j; }
      }
    }
    map[i] = best;
  }
  return map;
}

/**
 * The editable vertices of one mesh. Body geometry repeats each base vertex at
 * every face corner, so it is edited per base vertex ("units"); wearables are
 * edited per geometry vertex, and only the first `stored` vertices (the proxy's
 * own, before hair refinement) are saved.
 */
class EditTarget {
  constructor(kind, mesh, { units, stored, height }) {
    this.kind = kind; this.mesh = mesh; this.height = height;
    const geometry = mesh.geometry, position = geometry.getAttribute('position');
    this.position = position;
    this.unitOf = units ?? Int32Array.from({ length: position.count }, (_, i) => i);
    let unitCount = 0;
    for (const unit of this.unitOf) unitCount = Math.max(unitCount, unit + 1);
    this.corners = Array.from({ length: unitCount }, () => []);
    this.unitOf.forEach((unit, i) => this.corners[unit].push(i));
    this.points = new Float32Array(unitCount * 3);
    for (let u = 0; u < unitCount; u++) {
      const i = this.corners[u][0];
      if (i === undefined) continue;
      this.points[u * 3] = position.getX(i); this.points[u * 3 + 1] = position.getY(i); this.points[u * 3 + 2] = position.getZ(i);
    }
    this.built = this.points.slice();
    // Generated meshes (tailored clothes) name their vertices with stable keys.
    this.keys = units ? null : geometry.userData.sculptKeys ?? null;
    this.stored = stored ?? unitCount;
    this.unitCount = unitCount;
    this.neighbours = Array.from({ length: unitCount }, () => new Set());
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = this.unitOf[index[i + k]], b = this.unitOf[index[i + (k + 1) % 3]];
      if (a !== b) { this.neighbours[a].add(b); this.neighbours[b].add(a); }
    }
    this.normals = new Float32Array(unitCount * 3);
    this.updateNormals();
    this._mirror = null;
    this.pinned = new Set();
  }
  get mirror() { return this._mirror ??= mirrorMap(this.built, this.unitCount); }
  updateNormals() {
    const normal = this.mesh.geometry.getAttribute('normal');
    this.normals.fill(0);
    if (!normal) return;
    for (let i = 0; i < this.unitOf.length; i++) {
      const u = this.unitOf[i];
      this.normals[u * 3] += normal.getX(i); this.normals[u * 3 + 1] += normal.getY(i); this.normals[u * 3 + 2] += normal.getZ(i);
    }
    for (let u = 0; u < this.unitCount; u++) {
      const l = Math.hypot(this.normals[u * 3], this.normals[u * 3 + 1], this.normals[u * 3 + 2]) || 1;
      this.normals[u * 3] /= l; this.normals[u * 3 + 1] /= l; this.normals[u * 3 + 2] /= l;
    }
  }
  near(center, radius) {
    const found = [];
    for (let u = 0; u < this.unitCount; u++) {
      const d = Math.hypot(this.points[u * 3] - center.x, this.points[u * 3 + 1] - center.y, this.points[u * 3 + 2] - center.z);
      if (d < radius && !this.pinned.has(u)) found.push([u, falloff(d, radius)]);
    }
    return found;
  }
  /** Vertices below the point within a vertical cylinder of the radius. */
  below(center, radius) {
    const found = [];
    for (let u = 0; u < this.unitCount; u++) {
      if (this.points[u * 3 + 1] >= center.y || this.pinned.has(u)) continue;
      const d = Math.hypot(this.points[u * 3] - center.x, this.points[u * 3 + 2] - center.z);
      if (d < radius) found.push([u, falloff(d, radius)]);
    }
    return found;
  }
  write(units) {
    for (const u of units) for (const i of this.corners[u]) this.position.setXYZ(i, this.points[u * 3], this.points[u * 3 + 1], this.points[u * 3 + 2]);
    this.position.needsUpdate = true;
    this.smoothNormals(units);
  }
  /**
   * Smooth normals per editable vertex: the area-weighted normals of the faces around it, written to
   * every corner. computeVertexNormals averages only corners shared in the index, and the body repeats
   * a base vertex at each face corner, so it would shade every face flat. `units` limits the update to
   * those vertices and their neighbours (a stroke); without it the whole mesh is redone.
   */
  smoothNormals(units = null) {
    const normal = this.mesh.geometry.getAttribute('normal');
    if (!normal) return;
    const index = this.mesh.geometry.index.array, unitOf = this.unitOf, p = this.points;
    this.faceUnits ??= Array.from({ length: this.unitCount }, () => []);
    if (!this.facesBuilt) { for (let f = 0; f < index.length; f += 3) for (let k = 0; k < 3; k++) this.faceUnits[unitOf[index[f + k]]].push(f); this.facesBuilt = true; }
    let set;
    if (units) { set = new Set(); for (const u of units) { set.add(u); for (const v of this.neighbours[u]) set.add(v); } }
    const list = set ?? Array.from({ length: this.unitCount }, (_, u) => u);
    for (const u of list) {
      let nx = 0, ny = 0, nz = 0;
      for (const f of this.faceUnits[u]) {
        const a = unitOf[index[f]] * 3, b = unitOf[index[f + 1]] * 3, c = unitOf[index[f + 2]] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx;
      }
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) continue;
      nx /= l; ny /= l; nz /= l;
      this.normals[u * 3] = nx; this.normals[u * 3 + 1] = ny; this.normals[u * 3 + 2] = nz;
      for (const i of this.corners[u]) normal.setXYZ(i, nx, ny, nz);
    }
    normal.needsUpdate = true;
  }
  finish() {
    this.smoothNormals();
    this.mesh.geometry.computeBoundingSphere();
    this.mesh.geometry.computeBoundingBox();
  }
  /** Offsets moved since the mesh was built, in height units, keyed by stored vertex. */
  changes() {
    const out = new Map();
    for (let u = 0; u < Math.min(this.stored, this.unitCount); u++) {
      if (this.keys && this.keys[u] < 0) continue;
      const dx = this.points[u * 3] - this.built[u * 3], dy = this.points[u * 3 + 1] - this.built[u * 3 + 1], dz = this.points[u * 3 + 2] - this.built[u * 3 + 2];
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-7) out.set(this.keys ? this.keys[u] : u, [dx / this.height, dy / this.height, dz / this.height]);
    }
    return out;
  }
  /** Spatial authoring samples on a pattern's metre coordinates, independent of vertex/layer ordering. */
  patternChanges() {
    const sources = this.mesh.geometry.userData.patternSources, out = [];
    if (!sources) return out;
    for (let u = 0; u < this.unitCount; u++) {
      const source = sources[this.corners[u][0]];
      if (!source) continue;
      const delta = [0, 1, 2].map(k => (this.points[u * 3 + k] - this.built[u * 3 + k]) / this.height);
      if (delta.every(value => Math.abs(value) < 1e-7)) continue;
      let nearest = Infinity;
      for (const neighbour of this.neighbours[u]) {
        const other = sources[this.corners[neighbour][0]];
        if (other?.panel === source.panel && other.garment === source.garment) {
          const distance = Math.hypot(source.uv[0] - other.uv[0], source.uv[1] - other.uv[1]);
          if (distance > 1e-6) nearest = Math.min(nearest, distance);
        }
      }
      out.push({ garment: source.garment, pattern: source.pattern, panel: source.panel, center: [...source.uv], radius: Math.max(0.002, Number.isFinite(nearest) ? nearest * 0.4 : 0.02), delta });
    }
    return out;
  }
}

export class SculptSession {
  constructor(renderer) {
    this.renderer = renderer;
    this.raycaster = new Raycaster();
    // 6 cm: the game body has a vertex every 1.5–2 cm, so a smaller brush moves only a handful of them.
    this.settings = { target: 'body', brush: 'draw', radius: 0.06, strength: 0.5, symmetry: true, invert: false };
    this.target = null; this.stroke = null;
    this.cursor = new Mesh(new RingGeometry(0.92, 1, 48), new MeshBasicMaterial({ color: 0xf27a2e, side: DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
    this.cursor.renderOrder = 999; this.cursor.visible = false;
    renderer.scene.add(this.cursor);
  }
  /** Build the editable view of the current character's mesh for the target. */
  prepare(human, info) {
    this.target = null;
    const name = sculptTargets[this.settings.target];
    const mesh = human?.group.getObjectByName(name);
    if (!mesh) return false;
    const height = human.metrics.height;
    if (this.settings.target === 'body') this.target = new EditTarget('body', mesh, { units: Int32Array.from(mesh.geometry.userData.baseIds), height });
    else this.target = new EditTarget(this.settings.target, mesh, { stored: mesh.geometry.userData.proxyVertexCount, height });
    for (const u of info?.pins ?? []) this.target.pinned.add(u);
    this.target.style = mesh.userData.style;
    this.extraHits = this.settings.target === 'body' ? [human.group.getObjectByName('Outfit')].filter(Boolean) : [];
    return true;
  }
  hit(ndc, camera) {
    if (!this.target) return null;
    this.raycaster.setFromCamera(ndc, camera);
    // Rest pose: the skinned mesh renders at its geometry positions.
    // Sculpting or painting the body also accepts hits on the clothes over it
    // (the skin under them is removed); the stroke acts on the body beneath.
    const meshes = this.settings.target === 'body' ? [this.target.mesh, ...this.extraHits] : [this.target.mesh];
    const probes = meshes.map(mesh => { const probe = new Mesh(mesh.geometry, mesh.material); probe.matrixWorld.copy(mesh.matrixWorld); return probe; });
    const [first] = this.raycaster.intersectObjects(probes, false);
    return first ?? null;
  }
  showCursor(hit, camera) {
    if (!hit) { this.cursor.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.position.copy(hit.point);
    const normal = hit.face ? hit.face.normal.clone() : camera.position.clone().sub(hit.point).normalize();
    this.cursor.lookAt(hit.point.clone().add(normal));
    this.cursor.scale.setScalar(this.settings.radius);
  }
  begin(hit, ndc, camera) {
    if (!this.target || !hit) return false;
    const center = hit.point.clone();
    const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()).negate(), center);
    this.stroke = { center, plane, last: center.clone(), start: center.clone(), caught: null, touched: new Set(), paint: new Map() };
    if (this.settings.brush === 'grab') {
      const caught = this.target.near(center, this.settings.radius);
      this.stroke.caught = caught.map(([u, w]) => [u, w, this.target.points.slice(u * 3, u * 3 + 3)]);
      if (this.settings.symmetry) {
        const mirror = this.target.mirror;
        this.stroke.mirrored = caught.map(([u, w]) => [mirror[u], w]).filter(([m]) => m >= 0 && !caught.some(([u]) => u === m))
          .map(([m, w]) => [m, w, this.target.points.slice(m * 3, m * 3 + 3)]);
      }
    } else this.dab(center, hit.face?.normal);
    return true;
  }
  move(ndc, camera) {
    if (!this.stroke) return;
    if (this.settings.brush === 'grab') {
      this.raycaster.setFromCamera(ndc, camera);
      const point = this.raycaster.ray.intersectPlane(this.stroke.plane, new Vector3());
      if (!point) return;
      const delta = point.sub(this.stroke.start).multiplyScalar(0.4 + this.settings.strength * 0.6);
      const apply = (list, flip) => {
        for (const [u, w, origin] of list) {
          this.target.points[u * 3] = origin[0] + delta.x * w * (flip ? -1 : 1);
          this.target.points[u * 3 + 1] = origin[1] + delta.y * w;
          this.target.points[u * 3 + 2] = origin[2] + delta.z * w;
          this.stroke.touched.add(u);
        }
      };
      apply(this.stroke.caught, false);
      if (this.stroke.mirrored) apply(this.stroke.mirrored, true);
      this.target.write(this.stroke.touched);
      return;
    }
    const hit = this.hit(ndc, camera);
    if (!hit) return;
    // Dabs a fifth of the radius apart along the whole stroke (also between
    // pointer events far apart, as a fast stroke delivers them), so a stroke
    // leaves a continuous band, not separate spots.
    const spacing = this.settings.radius * 0.2, from = this.stroke.last.clone(), gap = hit.point.distanceTo(from);
    if (gap < spacing) return;
    const steps = Math.min(64, Math.floor(gap / spacing));
    for (let k = 1; k <= steps; k++) this.dab(k === steps ? hit.point : from.clone().lerp(hit.point, k / steps), hit.face?.normal);
    this.stroke.last.copy(hit.point);
  }
  dab(center, faceNormal) {
    const t = this.target, s = this.settings, sign = s.invert ? -1 : 1;
    if (clothBrushes.includes(s.brush)) {
      // Paint a soft per-vertex coverage weight on the body (base-mesh vertices);
      // the garment edge follows the 0.5 contour, so it stays smooth.
      const mirror = s.symmetry ? t.mirror : null;
      for (const [u, w] of t.near(center, s.radius)) {
        const weight = Math.min(1, w * 1.6);
        for (const id of [u, mirror?.[u] ?? -1]) if (id >= 0) this.stroke?.paint.set(id, Math.max(this.stroke.paint.get(id) ?? 0, weight));
      }
      return;
    }
    const centres = [[center, false]];
    if (s.symmetry && Math.abs(center.x) > s.radius * 0.25) centres.push([new Vector3(-center.x, center.y, center.z), true]);
    const touched = new Set();
    for (const [c] of centres) {
      // Cut works like scissors: everything under the brush, down to the ends.
      const found = s.brush === 'cut' ? t.below(c, s.radius) : t.near(c, s.radius);
      if (!found.length) continue;
      if (s.brush === 'pin' || s.brush === 'unpin') {
        for (const [u, w] of found) if (w > 0.3) { if (s.brush === 'pin') t.pinned.add(u); }
        if (s.brush === 'unpin') for (let u = 0; u < t.unitCount; u++) {
          const d = Math.hypot(t.points[u * 3] - c.x, t.points[u * 3 + 1] - c.y, t.points[u * 3 + 2] - c.z);
          if (d < s.radius) t.pinned.delete(u);
        }
        continue;
      }
      const amount = s.strength * s.radius * 0.12;
      const average = new Vector3();
      for (const [u, w] of found) average.x += t.normals[u * 3] * w, average.y += t.normals[u * 3 + 1] * w, average.z += t.normals[u * 3 + 2] * w;
      if (average.lengthSq() < 1e-12 && faceNormal) average.copy(faceNormal);
      average.normalize();
      let planePoint = null;
      if (s.brush === 'flatten') {
        planePoint = new Vector3(); let total = 0;
        for (const [u, w] of found) { planePoint.x += t.points[u * 3] * w; planePoint.y += t.points[u * 3 + 1] * w; planePoint.z += t.points[u * 3 + 2] * w; total += w; }
        planePoint.divideScalar(total);
      }
      const next = new Map();
      for (const [u, w] of found) {
        const p = new Vector3(t.points[u * 3], t.points[u * 3 + 1], t.points[u * 3 + 2]);
        if (s.brush === 'draw') p.addScaledVector(average, sign * amount * w);
        else if (s.brush === 'inflate') p.add(new Vector3(t.normals[u * 3], t.normals[u * 3 + 1], t.normals[u * 3 + 2]).multiplyScalar(sign * amount * w));
        else if (s.brush === 'smooth') {
          const mean = new Vector3(); let n = 0;
          for (const v of t.neighbours[u]) { mean.x += t.points[v * 3]; mean.y += t.points[v * 3 + 1]; mean.z += t.points[v * 3 + 2]; n++; }
          if (n) p.lerp(mean.divideScalar(n), Math.min(1, s.strength * w * 0.9));
        } else if (s.brush === 'flatten') {
          const distance = p.clone().sub(planePoint).dot(average);
          p.addScaledVector(average, -distance * Math.min(1, s.strength * w * 0.6));
        } else if (s.brush === 'pinch') {
          p.lerp(c, sign * Math.min(0.5, s.strength * w * 0.12));
        } else if (s.brush === 'cut') {
          // Fold what hangs below the cut line up to just under it.
          p.y = c.y - (c.y - p.y) * (1 - Math.min(0.92, w * (0.4 + s.strength)));
        }
        next.set(u, p);
      }
      for (const [u, p] of next) { t.points[u * 3] = p.x; t.points[u * 3 + 1] = p.y; t.points[u * 3 + 2] = p.z; touched.add(u); }
    }
    if (touched.size) { t.write(touched); for (const u of touched) this.stroke?.touched.add(u); }
  }
  end() {
    if (!this.stroke) return null;
    const { paint } = this.stroke;
    this.stroke = null;
    if (clothBrushes.includes(this.settings.brush)) return { paint: { mode: this.settings.brush, weights: paint } };
    this.target?.finish();
    return this.target;
  }
}

export const sculptNdc = (event, canvas) => {
  const rect = canvas.getBoundingClientRect();
  return new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
};
