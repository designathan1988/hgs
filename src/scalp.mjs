import { Vector3 } from 'three';
import { SurfaceCollider } from './collision.mjs';

/**
 * Head and scalp of the morphed body, shared by the hair tools: the head
 * frame (centre and radius), smooth scalp normals, the scalp region above a
 * natural hairline, the hair collider (skin above the pelvis and the outfit)
 * and the head skin weights hair is bound with.
 */
const TAU = Math.PI * 2;
export const HAIRLINE_POINTS = 32;
const round = (v, digits = 1000) => Math.round(v * digits) / digits;

/**
 * Hairline landmarks, [azimuth from the front in degrees, elevation in
 * radians], the same on both sides: the frontal line, the temporal point,
 * the sideburn down the front of the ear to below the helix root, the ear
 * itself (excluded by its own mask, see headFrame), the postauricular line
 * dropping below the earlobe and the nape across the top of the neck. The
 * nape follows the lower edge of MakeHuman's artist-made short hair (short02,
 * modelled on this base mesh): about −0.93 rad from 150° to 180°. Below the
 * head the neck runs almost along a ray from the head centre, so the elevation
 * barely changes down it: at −1.05 the cap ran 4 cm further down the neck in
 * a narrow tongue that no short hair covered.
 */
const HAIRLINE_LANDMARKS = [[0, 0.42], [22.5, 0.39], [45, 0.3], [56, 0.12], [64, -0.3], [96, -0.3], [106, -0.55], [118, -0.85], [150, -0.92], [165, -0.93], [180, -0.93]];

/** A natural hairline (radians of elevation at HAIRLINE_POINTS azimuths). */
export function defaultHairline() {
  return Array.from({ length: HAIRLINE_POINTS }, (_, k) => {
    const deg = Math.abs((k / HAIRLINE_POINTS * 360 + 180) % 360 - 180);
    const j = HAIRLINE_LANDMARKS.findIndex(([a]) => a >= deg), [a1, e1] = HAIRLINE_LANDMARKS[j], [a0, e0] = HAIRLINE_LANDMARKS[Math.max(0, j - 1)];
    return round(a1 === a0 ? e1 : e0 + (e1 - e0) * (deg - a0) / (a1 - a0));
  });
}

/**
 * Head frame from the morphed body: centre C and radius R of the head, the
 * head-weighted vertices, and every body face (base-mesh order).
 */
export function headFrame(data, positions) {
  const count = positions.length / 3;
  const headBone = data.skeleton.bones.findIndex(bone => bone.name === 'head'), neckBone = data.skeleton.bones.findIndex(bone => bone.name === 'neck_01');
  const headWeight = new Float32Array(count), neckWeight = new Float32Array(count);
  for (let v = 0; v < count; v++) for (let k = 0; k < 4; k++) {
    if (data.joints[v * 4 + k] === headBone) headWeight[v] += data.weights[v * 4 + k] / 65535;
    if (data.joints[v * 4 + k] === neckBone) neckWeight[v] += data.weights[v * 4 + k] / 65535;
  }
  // The ears: the vertices MakeHuman's ear translation targets move whole
  // (the falloff ring around them moves less and stays skin).
  const ear = new Uint8Array(count), morpher = data.morpher;
  for (const side of ['l', 'r']) {
    const target = morpher?.localByName?.get(`ears/${side}-ear-trans-up`);
    if (!target) continue;
    const size = e => Math.hypot(morpher.lDelta[e * 3], morpher.lDelta[e * 3 + 1], morpher.lDelta[e * 3 + 2]);
    let most = 0;
    for (let e = target.start; e < target.start + target.count; e++) most = Math.max(most, size(e));
    for (let e = target.start; e < target.start + target.count; e++) if (size(e) >= most * 0.9) ear[morpher.lIdx[e]] = 1;
  }
  const bodyGroup = data.base.faceGroups.indexOf('body');
  const faces = [];
  for (let f = 0; f < data.faceGroup.length; f++) if (data.faceGroup[f] === bodyGroup) faces.push(f);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const used = new Uint8Array(count);
  for (const f of faces) for (let c = 0; c < 4; c++) used[data.faces[f * 4 + c]] = 1;
  for (let v = 0; v < count; v++) if (used[v] && headWeight[v] > 0.6) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[v * 3 + k]); max[k] = Math.max(max[k], positions[v * 3 + k]); }
  const R = (max[1] - min[1]) / 2;
  const C = new Vector3(0, (min[1] + max[1]) / 2 + R * 0.12, (min[2] + max[2]) / 2 - R * 0.08);
  return { C, R, headWeight, neckWeight, ear, faces, used };
}

export function anglesOf(frame, x, y, z) {
  const dx = x - frame.C.x, dy = y - frame.C.y, dz = z - frame.C.z;
  return { theta: Math.atan2(dx, dz), phi: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Hairline elevation at an azimuth: periodic Catmull-Rom through the control points. */
export function hairlineAt(hairline, theta) {
  const n = hairline.length, t = ((theta / TAU) % 1 + 1) % 1 * n;
  const i = Math.floor(t), f = t - i;
  const p = k => hairline[((i + k) % n + n) % n];
  const p0 = p(-1), p1 = p(0), p2 = p(1), p3 = p(2);
  return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/**
 * Signed scalp coverage per base vertex (radians above the hairline; −1 off
 * the scalp): head and upper-neck skin near the head (the nape hairline lies
 * on the neck), never the ears.
 */
export function scalpField(frame, positions, hairline) {
  const count = positions.length / 3, field = new Float32Array(count).fill(-1), { C, R } = frame;
  for (let v = 0; v < count; v++) {
    if (!frame.used[v] || frame.ear[v] || frame.headWeight[v] + frame.neckWeight[v] < 0.3) continue;
    if (Math.hypot(positions[v * 3] - C.x, positions[v * 3 + 1] - C.y, positions[v * 3 + 2] - C.z) > R * 1.6) continue;
    const { theta, phi } = anglesOf(frame, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    field[v] = phi - hairlineAt(hairline, theta);
  }
  return field;
}

/**
 * Hair collider: the exact skin above the pelvis (head, neck, shoulders,
 * back, chest and arms) and optionally the outfit surface, with a lazily
 * filled distance grid as broad phase.
 */
export function hairCollider(data, positions, normals, frame, skeleton, outfit = null) {
  const head = new SurfaceCollider(0.015);
  const pelvis = skeleton.heads[skeleton.byName.get('pelvis')]?.y ?? frame.C.y - 0.7;
  const index = [];
  for (const face of frame.faces) {
    const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
    if (ids.some(v => positions[v * 3 + 1] < pelvis)) continue;
    index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  head.add(positions, normals, index);
  if (outfit) head.add(outfit.positions, outfit.normals, outfit.index, { orient: true });
  const hit = {};
  // Broad phase: a cell whose centre is farther from every surface than the
  // thickness plus half its diagonal cannot hold a colliding point.
  const cell = 0.008, half = cell * Math.sqrt(3) / 2;
  const lo = [0, 1, 2].map(k => Math.min(...head.layers.map(l => l.min[k])) - 0.04);
  const hi = [0, 1, 2].map(k => Math.max(...head.layers.map(l => l.max[k])) + 0.04);
  const dims = [0, 1, 2].map(k => Math.ceil((hi[k] - lo[k]) / cell));
  const field = new Float32Array(dims[0] * dims[1] * dims[2]).fill(NaN);
  const clearance = (x, y, z) => {
    const i = Math.floor((x - lo[0]) / cell), j = Math.floor((y - lo[1]) / cell), k = Math.floor((z - lo[2]) / cell);
    if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return Infinity;
    const id = (k * dims[1] + j) * dims[0] + i;
    let d = field[id];
    if (Number.isNaN(d)) {
      d = Infinity;
      for (const layer of head.layers) if (layer.closest(lo[0] + (i + 0.5) * cell, lo[1] + (j + 0.5) * cell, lo[2] + (k + 0.5) * cell, 0.03, hit)) d = Math.min(d, hit.distance);
      field[id] = d;
    }
    return d;
  };
  return {
    head, normal: new Float32Array(3), depth: 0,
    /** Push p (array slice x,y,z at offset o) out to `thickness`; returns true if moved. */
    resolve(p, o, thickness) {
      if (clearance(p[o], p[o + 1], p[o + 2]) > thickness + half) return false;
      // The layer that most needs the point moved (skin or clothing).
      if (!head.deepest(p[o], p[o + 1], p[o + 2], 0.03, thickness, 0.03, hit) || hit.distance >= thickness) return false;
      const push = thickness - hit.distance;
      p[o] += hit.nx * push; p[o + 1] += hit.ny * push; p[o + 2] += hit.nz * push;
      this.normal[0] = hit.nx; this.normal[1] = hit.ny; this.normal[2] = hit.nz; this.depth = push;
      return true;
    },
  };
}

/** Smooth per-base-vertex normals of the body surface. */
export function vertexNormals(data, positions, frame) {
  const normals = new Float32Array(positions.length);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  for (const face of frame.faces) {
    const ids = [0, 1, 2, 3].map(k => data.faces[face * 4 + k]);
    a.fromArray(positions, ids[0] * 3); b.fromArray(positions, ids[1] * 3); c.fromArray(positions, ids[2] * 3);
    n.crossVectors(b.sub(a), c.sub(a));
    for (const id of ids) { normals[id * 3] += n.x; normals[id * 3 + 1] += n.y; normals[id * 3 + 2] += n.z; }
  }
  for (let v = 0; v < normals.length / 3; v++) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= l; normals[v * 3 + 1] /= l; normals[v * 3 + 2] /= l;
  }
  return normals;
}

/**
 * Skin weights for the part of the hair resting on the head: transferred from
 * the head and neck skin it lies on (Nearest Face Interpolated, Blender's Data
 * Transfer), so it moves exactly like that skin; beyond 15 cm, or with no head
 * skin near, the head bone. The free part of long hair is weighted to the hair
 * joint chains instead (hair-rig.mjs).
 */
export function hairSkinWeights(data, positions, normals, frame) {
  const names = data.skeleton.bones.map(bone => bone.name), head = names.indexOf('head'), neck = names.indexOf('neck_01');
  const index = [];
  for (const face of frame.faces) {
    const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]), influence = new Map();
    for (const v of ids) for (let k = 0; k < 4; k++) influence.set(data.joints[v * 4 + k], (influence.get(data.joints[v * 4 + k]) ?? 0) + data.weights[v * 4 + k]);
    const dominant = [...influence].sort((a, b) => b[1] - a[1])[0][0];
    if (dominant === head || dominant === neck) index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  const skin = new SurfaceCollider(0.015).add(positions, normals, index), hit = {};
  const weigh = p => {
    if (!skin.closest(p.x, p.y, p.z, 0.15, hit)) return [[head, 0, 0, 0], [1, 0, 0, 0]];
    const total = new Map();
    for (const [id, share] of [[hit.a, hit.u], [hit.b, hit.v], [hit.c, hit.w]]) for (let k = 0; k < 4; k++) {
      const w = data.weights[id * 4 + k] / 65535 * share;
      if (w > 0) total.set(data.joints[id * 4 + k], (total.get(data.joints[id * 4 + k]) ?? 0) + w);
    }
    const top = [...total].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    return [[0, 1, 2, 3].map(k => top[k]?.[0] ?? 0), [0, 1, 2, 3].map(k => (top[k]?.[1] ?? 0) / sum)];
  };
  weigh.skin = skin; // the head and neck skin surface, for telling which part of a lock rests on it
  return weigh;
}
