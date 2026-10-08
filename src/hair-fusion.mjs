import { Vector3 } from 'three';
import { addIsosurface, smoothUnion } from './implicit.mjs';

// Geometry: Paul Bourke, Polygonising a Scalar Field Using Tetrahedrons (1997),
// https://paulbourke.net/geometry/polygonise/ . Reuse the project's six-tetrahedra
// extractor. Brush semantics refer to Blender's official manual (conceptual,
// not a port of Blender): spherical falloff, protected masks, guide clumping.
// https://docs.blender.org/manual/en/4.0/sculpt_paint/brush/falloff.html
// https://docs.blender.org/manual/en/5.1/modeling/geometry_nodes/hair/guides/clump_hair_curves.html
// Rendering attributes: https://threejs.org/docs/pages/BufferGeometry.html
// and https://threejs.org/docs/pages/SkinnedMesh.html .
export const hairBrushTools = Object.freeze(['smooth', 'volume', 'density', 'clump', 'mask']);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, a, b, fallback) => Number.isFinite(v) ? clamp(v, a, b) : fallback;
const text = (v, fallback) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : fallback;

export function normalizeHairFusion(value) {
  const input = value && typeof value === 'object' ? value : {};
  const groups = Array.isArray(input.groups) ? input.groups.slice(0, 64).filter(g => g && typeof g === 'object').map((g, i) => ({ id: text(g.id, `group-${i}`), name: text(g.name, `Grupo ${i + 1}`), fuse: g.fuse !== false })) : [];
  if (!groups.some(g => g.id === 'main')) groups.unshift({ id: 'main', name: 'Principal', fuse: true });
  const ids = new Set();
  const unique = groups.filter(g => !ids.has(g.id) && ids.add(g.id));
  const strokes = [];
  for (const s of Array.isArray(input.strokes) ? input.strokes.slice(-2048) : []) {
    if (!s || !hairBrushTools.includes(s.tool) || !Array.isArray(s.center) || s.center.length !== 3 || !s.center.every(Number.isFinite)) continue;
    strokes.push({ tool: s.tool, center: s.center.map(v => finite(v, -30, 30, 0)), radius: finite(s.radius, .005, 8, .4), strength: finite(s.strength, 0, 1, .5), falloff: ['smooth', 'linear', 'constant'].includes(s.falloff) ? s.falloff : 'smooth', symmetry: Boolean(s.symmetry), group: s.group == null ? null : text(s.group, 'main'), invert: Boolean(s.invert), ...(s.tool === 'mask' && s.clear ? { clear: true } : {}) });
  }
  return { enabled: Boolean(input.enabled), representation: ['strand', 'lock', 'volume'].includes(input.representation) ? input.representation : 'lock', smoothness: finite(input.smoothness, 0, .04, .006), resolution: finite(input.resolution, .001, .03, .005), groups: unique, strokes };
}

export function hairFusionGroups(state) {
  if (!state.fusion?.enabled) return [];
  const groups = state.fusion.groups.filter(g => g.fuse).map(g => ({ ...g, locks: state.locks.filter(l => (l.group ?? 'main') === g.id && (l.density ?? 1) > 0) })).filter(g => g.locks.length);
  return groups.length ? [{ id: '__fusion__', name: 'Volumes fundidos', ids: groups.map(g => g.id), groups, locks: groups.flatMap(g => g.locks) }] : [];
}

function localPoint(state, point) {
  const a = Array.isArray(point) || ArrayBuffer.isView(point) ? point : point.toArray();
  return a.map((v, k) => (v - state.frame.C.getComponent(k)) / state.frame.R);
}

export function hairBrushFalloff(distance, radius, falloff = 'smooth') {
  const t = clamp(distance / Math.max(1e-8, radius), 0, 1);
  if (t >= 1) return 0;
  if (falloff === 'constant') return 1;
  if (falloff === 'linear') return 1 - t;
  return 1 - t * t * (3 - 2 * t);
}

function strokeWeight(s, p) {
  const distance = Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]);
  const mirrored = s.symmetry ? Math.hypot(p[0] + s.center[0], p[1] - s.center[1], p[2] - s.center[2]) : Infinity;
  return hairBrushFalloff(Math.min(distance, mirrored), s.radius, s.falloff) * s.strength;
}

export function hairMaskAt(state, point, group = null) {
  const p = localPoint(state, point);
  let mask = 0;
  for (const s of state.fusion?.strokes ?? []) if (s.tool === 'mask' && (s.group == null || group == null || s.group === group)) mask = s.clear ? 0 : clamp(mask + strokeWeight(s, p) * (s.invert ? -1 : 1), 0, 1);
  return mask;
}

/** Persistent strokes use head-relative positions/radii, never mesh vertex IDs. */
export function applyHairBrush(state, point, options = {}) {
  state.fusion ??= normalizeHairFusion();
  const tool = options.tool ?? 'volume';
  if (!hairBrushTools.includes(tool)) return false;
  const input = { tool, center: localPoint(state, point), radius: finite(options.radius, .001, .8, .045) / state.frame.R, strength: finite(options.strength, 0, 1, .5), falloff: options.falloff, symmetry: options.symmetry ?? options.mirror, group: options.group ?? null, invert: options.invert };
  const stroke = normalizeHairFusion({ strokes: [input] }).strokes[0];
  if (!stroke || !stroke.strength) return false;
  // Source density is reversible visibility/coverage; zero-density guides are
  // retained for future edits and restoring density (no destructive removal).
  if (tool === 'density') {
    for (const lock of state.locks) {
      if (stroke.group != null && (lock.group ?? 'main') !== stroke.group) continue;
      const amount = strokeWeight(stroke, localPoint(state, lock.rootP)) * (1 - hairMaskAt(state, lock.rootP, lock.group));
      lock.density = clamp((lock.density ?? 1) + amount * (stroke.invert ? -1 : 1), 0, 1);
    }
    return true;
  }
  if (tool === 'clump') {
    // A designated nearby guide, separate per mirrored side. Blend along the
    // guide at equal arc fraction; roots, follicle direction and pins stay held.
    const snapshots = new Map(state.locks.map(l => [l, Float32Array.from(l.x)]));
    const centers = [stroke.center, ...(stroke.symmetry ? [[-stroke.center[0], stroke.center[1], stroke.center[2]]] : [])];
    for (const center of centers) {
      const distanceTo = lock => {
        let distance = Infinity;
        for (let i = 0; i < lock.x.length; i += 3) distance = Math.min(distance, Math.hypot(...localPoint(state, lock.x.subarray(i, i + 3)).map((v, k) => v - center[k])));
        return distance;
      };
      const candidates = state.locks.filter(l => (stroke.group == null || (l.group ?? 'main') === stroke.group) && hairBrushFalloff(distanceTo(l), stroke.radius, stroke.falloff) > 0);
      const guide = candidates.reduce((best, l) => {
        const distance = distanceTo(l);
        return !best || distance < best.distance ? { lock: l, distance } : best;
      }, null)?.lock;
      if (!guide) continue;
      for (const lock of candidates) {
        if (lock === guide) continue;
        const source = snapshots.get(lock), target = snapshots.get(guide), n = source.length / 3;
        for (let i = 2; i < n; i++) {
          if (lock.pins.has(i)) continue;
          const p = Array.from(source.subarray(i * 3, i * 3 + 3));
          const amount = strokeWeight({ ...stroke, center, symmetry: false }, localPoint(state, p)) * (1 - hairMaskAt(state, p, lock.group)) * i / (n - 1) * (stroke.invert ? -.5 : 1);
          for (let k = 0; k < 3; k++) lock.x[i * 3 + k] = source[i * 3 + k] + (target[i * 3 + k] - source[i * 3 + k]) * amount;
        }
        // Root-led length constraint, followed by the existing collision solver.
        for (let i = 2; i < n; i++) {
          const o = i * 3, prev = o - 3;
          const dx = lock.x[o] - lock.x[prev], dy = lock.x[o + 1] - lock.x[prev + 1], dz = lock.x[o + 2] - lock.x[prev + 2];
          const scale = lock.seg / (Math.hypot(dx, dy, dz) || 1);
          lock.x[o] = lock.x[prev] + dx * scale; lock.x[o + 1] = lock.x[prev + 1] + dy * scale; lock.x[o + 2] = lock.x[prev + 2] + dz * scale;
          if (state.sim) for (let pass = 0; pass < 3 && state.sim.turnOut(lock, i); pass++);
          else state.collider?.resolve(lock.x, o, .5 * lock.width * lock.volume + .0012);
        }
        lock.rest.set(lock.x);
      }
    }
    return true;
  }
  // Bound archival memory explicitly; refuse extra strokes instead of dropping
  // old masks/sculpt work invisibly.
  if (state.fusion.strokes.length >= 2048) return false;
  state.fusion.strokes.push(stroke);
  return true;
}

const spatialKey = (x, y, z) => `${x},${y},${z}`;

/** Build an implicit elliptical sweep from actual lockSurface cross-sections.
 * This preserves taper, curl, twist and existing rotation-minimising frames.
 * The field is an approximate distance (zero set exact on each section), not
 * a claim of exact Euclidean distance to an elliptical tube.
 */
export function createHairField(state, locks, surface, options = {}) {
  const resolution = options.resolution ?? state.fusion?.resolution ?? .005;
  const smoothness = options.smoothness ?? state.fusion?.smoothness ?? .006;
  const ids = [...new Set(locks.map(l => l.group ?? 'main'))];
  if (ids.length > 1) {
    // Apply each group's spatial edits and protection before the final union.
    // Original memberships persist even though the output is one surface.
    const fields = ids.map(id => createHairField(state, locks.filter(l => (l.group ?? 'main') === id), surface, { ...options, group: id }));
    const pad = smoothness * Math.log2(fields.length + 1);
    return {
      resolution, segments: fields.reduce((n, f) => n + f.segments, 0),
      min: [0, 1, 2].map(k => Math.min(...fields.map(f => f.min[k])) - pad), max: [0, 1, 2].map(k => Math.max(...fields.map(f => f.max[k])) + pad),
      sample(p) { let value = fields[0].sample(p); for (const field of fields.slice(1)) value = smoothness > 0 ? smoothUnion(value, field.sample(p), smoothness) : Math.min(value, field.sample(p)); return value; },
    };
  }
  const group = ids[0] ?? options.group ?? 'main';
  const strokes = (state.fusion?.strokes ?? []).filter(s => s.group == null || s.group === group);
  const maxInflation = strokes.reduce((n, s) => n + (s.tool === 'volume' && !s.invert ? s.radius * s.strength * state.frame.R * .22 : 0), 0);
  const pad = smoothness * Math.max(1, Math.log2(locks.length + 1)) + maxInflation + resolution * 2;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const segments = [], sides = 12, ring = sides + 1;
  for (const [id, lock] of locks.entries()) {
    if ((lock.density ?? 1) <= 0) continue;
    const part = surface(lock, state, { sides });
    const count = (part.pos.length / 3 - 1 - (lock.tipShape === 'flat' ? 1 : 0)) / ring;
    const sections = [];
    for (let j = 0; j < count; j++) {
      const at = j * ring * 3, opposite = at + sides / 2 * 3;
      const center = [0, 1, 2].map(k => (part.pos[at + k] + part.pos[opposite + k]) * .5);
      const width = [0, 1, 2].map(k => part.pos[at + k] - center[k]);
      const thickness = [0, 1, 2].map(k => part.pos[at + sides / 4 * 3 + k] - center[k]);
      const a = Math.hypot(...width), b = Math.hypot(...thickness);
      const widthAxis = width.map(v => v / (Math.hypot(...width) || 1)), thicknessAxis = thickness.map(v => v / (Math.hypot(...thickness) || 1));
      sections.push({ center, widthAxis, thicknessAxis, a, b });
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], center[k] - Math.max(a, b) - pad); max[k] = Math.max(max[k], center[k] + Math.max(a, b) + pad); }
    }
    for (let i = 1; i < sections.length; i++) {
      const first = sections[i - 1], last = sections[i];
      const span = last.center.map((v, k) => v - first.center[k]);
      const len2 = span.reduce((n, v) => n + v * v, 0);
      if (len2 < 1e-14 || Math.max(first.a, last.a) < 1e-7) continue;
      segments.push({ id, first, last, span, len2 });
    }
  }
  const cell = Math.max(resolution * 4, .025 * state.frame.R / .11), grid = new Map();
  for (const s of segments) {
    const radius = Math.max(s.first.a, s.first.b, s.last.a, s.last.b) + pad;
    const lo = s.first.center.map((v, k) => Math.floor((Math.min(v, s.last.center[k]) - radius) / cell));
    const hi = s.first.center.map((v, k) => Math.floor((Math.max(v, s.last.center[k]) + radius) / cell));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const key = spatialKey(x, y, z), list = grid.get(key) ?? [];
      if (!grid.has(key)) grid.set(key, list);
      list.push(s);
    }
  }
  const nearest = new Float64Array(locks.length);
  const far = Math.max(10, state.frame.R * 100);
  const raw = p => {
    const candidates = grid.get(spatialKey(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)));
    if (!candidates) return far;
    nearest.fill(Infinity);
    for (const s of candidates) {
      const rx = p[0] - s.first.center[0], ry = p[1] - s.first.center[1], rz = p[2] - s.first.center[2];
      const t = clamp((rx * s.span[0] + ry * s.span[1] + rz * s.span[2]) / s.len2, 0, 1);
      const x = rx - s.span[0] * t, y = ry - s.span[1] * t, z = rz - s.span[2] * t;
      const a = Math.max(1e-6, s.first.a + (s.last.a - s.first.a) * t), b = Math.max(1e-6, s.first.b + (s.last.b - s.first.b) * t);
      const along = (x * s.span[0] + y * s.span[1] + z * s.span[2]) / Math.sqrt(s.len2);
      const wa = s.first.widthAxis, wb = s.last.widthAxis, ta = s.first.thicknessAxis, tb = s.last.thicknessAxis;
      const u = x * (wa[0] + (wb[0] - wa[0]) * t) + y * (wa[1] + (wb[1] - wa[1]) * t) + z * (wa[2] + (wb[2] - wa[2]) * t);
      const v = x * (ta[0] + (tb[0] - ta[0]) * t) + y * (ta[1] + (tb[1] - ta[1]) * t) + z * (ta[2] + (tb[2] - ta[2]) * t);
      const d = (Math.hypot(u / a, v / b, along / Math.min(a, b)) - 1) * Math.min(a, b);
      nearest[s.id] = Math.min(nearest[s.id], d);
    }
    let result = Infinity;
    // Stable guide order keeps the smooth union deterministic under hash order.
    for (const d of nearest) if (Number.isFinite(d)) result = !Number.isFinite(result) ? d : smoothness > 0 ? smoothUnion(result, d, smoothness) : Math.min(result, d);
    return Number.isFinite(result) ? result : far;
  };
  const sample = p => {
    let value = raw(p), mask = 0;
    const local = localPoint(state, p);
    for (const s of strokes) {
      if (s.tool === 'mask' && s.clear) { mask = 0; continue; }
      const weight = strokeWeight(s, local);
      if (!weight) continue;
      if (s.tool === 'mask') { mask = clamp(mask + weight * (s.invert ? -1 : 1), 0, 1); continue; }
      const amount = weight * (1 - mask);
      if (s.tool === 'volume') value -= amount * s.radius * state.frame.R * .22 * (s.invert ? -1 : 1);
      if (s.tool === 'smooth') {
        const h = Math.min(s.radius * state.frame.R * .18, .012);
        let average = 0;
        for (let k = 0; k < 3; k++) for (const sign of [-1, 1]) { const q = [...p]; q[k] += sign * h; average += raw(q); }
        value += (average / 6 - raw(p)) * amount;
      }
    }
    return value;
  };
  return { sample, min, max, resolution, segments: segments.length };
}

export function fusedHairSurface(state, locks, surface, options = {}) {
  const field = createHairField(state, locks, surface, options);
  if (!field.segments) return { pos: new Float32Array(), normal: new Float32Array(), uv: new Float32Array(), color: new Float32Array(), index: new Uint32Array(), stats: { requestedResolution: field.resolution, resolution: field.resolution, cells: 0 } };
  const dims = field.max.map((v, k) => v - field.min[k]);
  const cellCount = step => dims.reduce((n, d) => n * Math.ceil(d / step), 1);
  let step = field.resolution;
  // A transparent sampling budget, surfaced to the UI in stats, prevents an
  // accidental high-resolution full-head operation monopolising the UI.
  while (cellCount(step) > 300000) step *= 1.15;
  // Sample once, then use trilinear reconstruction for the extractor's finite
  // difference gradients. Marching tetrahedra already assumes a sampled field;
  // this avoids thousands of repeated guide-distance queries per surface.
  const [nx, ny, nz] = dims.map(d => Math.ceil(d / step));
  const spacing = dims.map((d, k) => d / [nx, ny, nz][k]);
  const at = (x, y, z) => (z * (ny + 1) + y) * (nx + 1) + x;
  const values = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  for (let z = 0; z <= nz; z++) for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) values[at(x, y, z)] = field.sample([field.min[0] + x * spacing[0], field.min[1] + y * spacing[1], field.min[2] + z * spacing[2]]);
  const sampled = p => {
    const tx = clamp((p[0] - field.min[0]) / spacing[0], 0, nx), ty = clamp((p[1] - field.min[1]) / spacing[1], 0, ny), tz = clamp((p[2] - field.min[2]) / spacing[2], 0, nz);
    const x = Math.min(nx - 1, Math.floor(tx)), y = Math.min(ny - 1, Math.floor(ty)), z = Math.min(nz - 1, Math.floor(tz));
    const u = tx - x, v = ty - y, w = tz - z;
    let value = 0;
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) value += values[at(x + i, y + j, z + k)] * (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? w : 1 - w);
    return value;
  };
  const positions = [], normals = [], uv = [], colors = [];
  const sink = {
    triangles: 0,
    vertex(p, n) { positions.push(...p); normals.push(...n); uv.push(p[0] / Math.max(state.frame.R, 1e-6), p[1] / Math.max(state.frame.R, 1e-6)); const mask = options.showMask ? hairMaskAt(state, p, options.group) : 0; colors.push(1, 1 - mask * .5, 1 - mask * .45); },
  };
  addIsosurface(sink, sampled, field.min, field.max, step, [1, 1, 1], .46, 0, () => [0, 0, 1]);
  const part = { pos: Float32Array.from(positions), normal: Float32Array.from(normals), uv: Float32Array.from(uv), color: Float32Array.from(colors), index: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i), stats: { requestedResolution: field.resolution, resolution: step, cells: cellCount(step), triangles: sink.triangles } };
  // Keep the closed extracted topology while pushing collision vertices using
  // the shared body/clothing collider. Recompute affected triangle normals.
  let collided = false;
  for (let i = 0; i < part.pos.length; i += 3) if (state.collider?.resolve(part.pos, i, .0008)) collided = true;
  if (collided) {
    const welded = new Map(), sums = [];
    for (let i = 0; i < part.pos.length; i += 3) {
      const key = `${Math.round(part.pos[i] * 1e6)},${Math.round(part.pos[i + 1] * 1e6)},${Math.round(part.pos[i + 2] * 1e6)}`;
      if (!welded.has(key)) welded.set(key, new Vector3());
      sums.push(welded.get(key));
    }
    for (let i = 0; i < part.pos.length; i += 9) {
      const a = new Vector3().fromArray(part.pos, i), b = new Vector3().fromArray(part.pos, i + 3), c = new Vector3().fromArray(part.pos, i + 6);
      const normal = b.sub(a).cross(c.sub(a));
      for (let v = 0; v < 3; v++) sums[i / 3 + v].add(normal);
    }
    for (let i = 0; i < sums.length; i++) if (sums[i].lengthSq()) part.normal.set(sums[i].clone().normalize().toArray(), i * 3);
  }
  return part;
}
