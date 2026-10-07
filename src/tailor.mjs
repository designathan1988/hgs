import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshStandardMaterial, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { SurfaceCollider, resolvePenetration } from './collision.mjs';
import { drapeCloth } from './cloth.mjs';

/**
 * Made-to-measure clothing, cut from the body and draped by simulation.
 *
 * 1. Pattern: each garment defines a continuous coverage field over the body
 *    surface (signed distances in metres: to the neckline, along the arm to
 *    the sleeve end, to the hem...), plus anything painted with the cloth
 *    brush. Triangles are clipped exactly on the field's zero contour, so
 *    edges follow smooth curves instead of the mesh's faces.
 * 2. Drape: the cut panel is simulated with XPBD cloth (see cloth.mjs) under
 *    gravity with tension or slack from the fit, colliding with the body and
 *    with every garment beneath it at a fixed thickness, like layered
 *    garments in a cloth simulator. Nothing passes through skin or another
 *    layer in the rest pose; skinning comes from the body under each point.
 * 3. Finish: open edges get a folded hem so the fabric has visible thickness.
 * All garments share one mesh and one vertex-coloured material, and skin that
 * is fully covered is removed, so an outfit is one draw call with no overdraw.
 */
export const garmentTypes = ['tshirt', 'longsleeve', 'tank', 'hoodie', 'pants', 'shorts', 'skirt', 'dress', 'socks', 'gloves', 'paint'];
export const garmentLabels = { tshirt: 'Camiseta', longsleeve: 'Manga longa', tank: 'Regata', hoodie: 'Moletom', pants: 'Calça', shorts: 'Bermuda', skirt: 'Saia', dress: 'Vestido', socks: 'Meias', gloves: 'Luvas', paint: 'Livre (pintada)' };
export const garmentPatterns = ['solid', 'stripes', 'pinstripe', 'checks', 'gradient'];
const defaults = {
  tshirt: { sleeve: 0.3, length: 0.85, neckline: 0.25, fit: 0.3, color: '#3c5a78' },
  longsleeve: { sleeve: 0.96, length: 0.85, neckline: 0.2, fit: 0.3, color: '#7a3b3b' },
  tank: { sleeve: 0, length: 0.8, neckline: 0.5, fit: 0.15, color: '#d9d4c7' },
  hoodie: { sleeve: 1, length: 0.95, neckline: 0.1, fit: 0.75, color: '#4b5340' },
  pants: { leg: 1, rise: 0.5, fit: 0.35, color: '#2f3640' },
  shorts: { leg: 0.32, rise: 0.5, fit: 0.4, color: '#806a52' },
  skirt: { length: 0.45, flare: 0.4, rise: 0.55, fit: 0.3, color: '#5b2f45' },
  dress: { sleeve: 0, length: 0.7, neckline: 0.45, flare: 0.5, fit: 0.2, color: '#284f63' },
  socks: { leg: 0.25, fit: 0.05, color: '#e8e4dc' },
  gloves: { fit: 0.05, color: '#1f1f22' },
  paint: { fit: 0.2, color: '#9a8f7d' },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export function newGarment(type = 'tshirt') {
  return normalizeGarment({ type, ...defaults[type] });
}

export function normalizeGarment(value = {}) {
  const type = garmentTypes.includes(value.type) ? value.type : 'tshirt';
  const base = defaults[type];
  const number = (key, fallback, min = 0, max = 1) => Number.isFinite(value[key]) ? Math.round(clamp(value[key], min, max) * 1000) / 1000 : fallback;
  const color = (key, fallback) => typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key]) ? value[key].toLowerCase() : fallback;
  // Painted coverage per body vertex: +1 adds cloth, -1 erases it.
  const paint = {};
  if (value.paint && typeof value.paint === 'object') {
    for (const [key, weight] of Object.entries(value.paint)) {
      const v = Number(key);
      if (Number.isInteger(v) && v >= 0 && v < 100000 && Number.isFinite(weight) && Math.abs(weight) >= 0.05) paint[v] = Math.round(clamp(weight, -1, 1) * 20) / 20;
    }
  }
  return {
    type,
    sleeve: number('sleeve', base.sleeve ?? 0), length: number('length', base.length ?? 0.5), neckline: number('neckline', base.neckline ?? 0.2),
    leg: number('leg', base.leg ?? 1), rise: number('rise', base.rise ?? 0.5), flare: number('flare', base.flare ?? 0.3),
    fit: number('fit', base.fit ?? 0.2), roughness: number('roughness', 0.85),
    color: color('color', base.color), color2: color('color2', '#e9e4da'),
    pattern: garmentPatterns.includes(value.pattern) ? value.pattern : 'solid', scale: number('scale', 0.5),
    paint,
  };
}

/** Body landmarks and per-vertex coordinates (base-mesh order) for cutting patterns. */
export function bodyLayout(context) {
  if (context.tailorLayout) return context.tailorLayout;
  const { data, positions } = context;
  const count = positions.length / 3;
  const heads = context.skeleton.heads, at = name => heads[context.skeleton.byName.get(name)];
  const boneNames = data.skeleton.bones.map(bone => bone.name);
  const bodyGroup = data.base.faceGroups.indexOf('body');
  const faces = [];
  for (let face = 0; face < data.faceGroup.length; face++) if (data.faceGroup[face] === bodyGroup) faces.push(face);
  // Smooth vertex normals from the body geometry, shared across UV seams.
  const normals = new Float32Array(count * 3);
  const geometry = context.body.geometry, normal = geometry.getAttribute('normal'), baseIds = geometry.userData.baseIds;
  for (let i = 0; i < baseIds.length; i++) normals.set([normal.getX(i), normal.getY(i), normal.getZ(i)], baseIds[i] * 3);
  const height = geometry.boundingBox.max.y - geometry.boundingBox.min.y, k = height / 1.7;
  const kind = name => /^(upperarm)/.test(name) ? 'upper' : /^lowerarm/.test(name) ? 'lower' : /^(hand|thumb|index|middle|ring|pinky)/.test(name) ? 'hand'
    : /^thigh/.test(name) ? 'thigh' : /^calf/.test(name) ? 'calf' : /^(foot|ball)/.test(name) ? 'foot' : /^(head|neck)/.test(name) ? 'head' : 'torso';
  const chain = (side, a, b, c) => {
    const A = at(`${a}_${side}`), B = at(`${b}_${side}`), C = at(`${c}_${side}`);
    const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
    return { A, B, C, l1, l2, u1: B.clone().sub(A).normalize(), u2: C.clone().sub(B).normalize(), length: l1 + l2 };
  };
  const arms = { l: chain('l', 'upperarm', 'lowerarm', 'hand'), r: chain('r', 'upperarm', 'lowerarm', 'hand') };
  const legs = { l: chain('l', 'thigh', 'calf', 'foot'), r: chain('r', 'thigh', 'calf', 'foot') };
  const along = (c, p, part) => {
    if (part === 0) return p.clone().sub(c.A).dot(c.u1);
    if (part === 1) return c.l1 + p.clone().sub(c.B).dot(c.u2);
    return c.l1 + c.l2 + p.clone().sub(c.C).dot(c.u2);
  };
  // Per vertex: weight per body region and distance along the arm and leg chains,
  // blended by skin weights so the fields are continuous across joints.
  const arm = new Float32Array(count), leg = new Float32Array(count), armW = new Float32Array(count), legW = new Float32Array(count), headW = new Float32Array(count);
  const p = new Vector3();
  for (let v = 0; v < count; v++) {
    p.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    const side = p.x >= 0 ? 'l' : 'r';
    let sumArm = 0, sumLeg = 0, total = 0;
    for (let j = 0; j < 4; j++) {
      const w = data.weights[v * 4 + j] / 65535;
      if (!w) continue;
      const part = kind(boneNames[data.joints[v * 4 + j]]);
      total += w;
      if (part === 'upper' || part === 'lower' || part === 'hand') armW[v] += w;
      if (part === 'thigh' || part === 'calf' || part === 'foot') legW[v] += w;
      if (part === 'head') headW[v] += w;
      // Skin driven by the torso never counts as "along" a limb: in the rest
      // pose the arms angle down, and the lower torso would read as forearm.
      const armPart = part === 'lower' ? 1 : part === 'hand' ? 2 : 0;
      const legPart = part === 'calf' ? 1 : part === 'foot' ? 2 : 0;
      const onArm = part === 'upper' || part === 'lower' || part === 'hand', onLeg = part === 'thigh' || part === 'calf' || part === 'foot';
      sumArm += w * (onArm ? along(arms[side], p, armPart) : Math.min(0, along(arms[side], p, 0)));
      sumLeg += w * (onLeg ? along(legs[side], p, legPart) : Math.min(0, along(legs[side], p, 0)));
    }
    total ||= 1;
    arm[v] = sumArm / total; leg[v] = sumLeg / total;
    armW[v] /= total; legW[v] /= total; headW[v] /= total;
  }
  context.tailorLayout = {
    faces, normals, arm, leg, armW, legW, headW, arms, legs, height, k,
    hipY: at('thigh_l').y, waistY: at('spine_01').y, chestY: at('spine_03').y, neckY: at('neck_01').y,
    frontZ: at('spine_03').z,
  };
  return context.tailorLayout;
}

/** Signed coverage (metres, positive inside the garment) at body vertex v. */
function coverage(garment, v, layout, positions) {
  const { type } = garment, k = layout.k;
  const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
  const armLength = layout.arms.l.length, legLength = layout.legs.l.length;
  let s = -1;
  if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'dress'].includes(type)) {
    // Hem from a crop under the chest (0) to below the hips (1); arms are exempt.
    // A top ends on a level line no lower than the hip joints; below that the
    // body splits into legs and the cloth would follow the crotch.
    // A dress's bodice ends just inside its skirt (sewn to it at the waist);
    // its length is the skirt's.
    const hemY = type === 'dress' ? dressWaist(layout) - 0.04 * k : layout.chestY - (layout.chestY - layout.hipY - 0.015 * k) * garment.length;
    const hem = y - hemY + layout.armW[v] * 0.6;
    // Sleeveless: the armhole follows where the arm takes over the skin.
    const sleeve = garment.sleeve > 0.02 ? garment.sleeve * armLength - layout.arm[v] : 0.02 * k * (1 - layout.armW[v] * 1.6) - Math.max(0, layout.arm[v]);
    const neckBand = layout.neckY - 0.006 * k - y;
    // Neckline: an ellipsoid opening centred at the front of the neck base.
    const n = garment.neckline;
    const cy = layout.neckY + 0.012 * k, cz = layout.frontZ + 0.035 * k;
    const rx = (0.055 + 0.05 * n) * k, ry = (0.03 + 0.14 * n) * k, rz = (0.075 + 0.02 * n) * k;
    const scoop = (Math.hypot(x / rx, (y - cy) / ry, (z - cz) / rz) - 1) * Math.min(rx, ry, rz);
    s = Math.min(hem, sleeve, neckBand, scoop, (0.4 - layout.legW[v]) * 0.25, (0.4 - layout.headW[v]) * 0.25);
  } else if (type === 'pants' || type === 'shorts') {
    const band = layout.hipY + (layout.waistY - layout.hipY) * (0.35 + garment.rise * 0.9);
    s = Math.min(band - y, garment.leg * legLength - layout.leg[v], (0.35 - layout.armW[v]) * 0.25);
  } else if (type === 'socks') {
    s = Math.min(layout.leg[v] - (1 - garment.leg) * legLength, (0.35 - layout.armW[v]) * 0.25);
  } else if (type === 'gloves') {
    s = layout.arm[v] - (armLength - 0.012 * k);
  }
  // Painted cloth: +1 adds, -1 erases, over nearly the whole brush circle
  // (only its faint rim is left out), blended over a few centimetres.
  const painted = garment.paint[v];
  if (painted > 0) s = Math.max(s, (painted - 0.2) * 0.05 * k);
  if (painted < 0) s = Math.min(s, (0.2 + painted) * 0.05 * k);
  return s;
}

/**
 * The garment's coverage at every body vertex (metres, > 0 inside), for
 * previewing its edges on the body without cutting and draping it. Skirts and
 * dresses include their waist-to-hem tube.
 */
export function garmentField(context, garment) {
  const layout = bodyLayout(context), positions = context.positions, k = layout.k, out = new Float32Array(positions.length / 3);
  let tube = null;
  if (garment.type === 'skirt' || garment.type === 'dress') {
    const top = garment.type === 'dress' ? dressWaist(layout) : layout.hipY + (layout.waistY - layout.hipY) * (0.35 + garment.rise * 0.9);
    tube = { top, hem: layout.hipY - (0.06 + garment.length * 0.62) * k };
  }
  for (let v = 0; v < out.length; v++) {
    let s = garment.type === 'skirt' ? -1 : coverage(garment, v, layout, positions);
    if (tube && layout.armW[v] < 0.3 && layout.headW[v] < 0.3) { const y = positions[v * 3 + 1]; s = Math.max(s, Math.min(tube.top - y, y - tube.hem)); }
    out[v] = s;
  }
  return out;
}

/**
 * Which edge of the garment a point of the body belongs to, for dragging it:
 * the sleeve on an arm, the neckline near the neck, the waistband at the
 * waist, the legs' ends on the legs, else the hem; with the direction that
 * makes it longer when dragged down (the waistband rises when dragged up).
 */
export function garmentEdgeAt(context, garment, v) {
  const layout = bodyLayout(context), y = context.positions[v * 3 + 1], t = garment.type, k = layout.k;
  if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'dress'].includes(t)) {
    if (layout.armW[v] > 0.5) return { key: 'sleeve', label: 'Manga', sign: 1 };
    if (y > (layout.chestY + layout.neckY) / 2) return { key: 'neckline', label: 'Decote', sign: 1 };
    return { key: 'length', label: t === 'dress' ? 'Barra' : 'Comprimento', sign: 1 };
  }
  if (t === 'pants' || t === 'shorts') return y < layout.hipY - 0.03 * k ? { key: 'leg', label: 'Perna', sign: 1 } : { key: 'rise', label: 'Cintura', sign: -1 };
  if (t === 'skirt') return y < layout.hipY ? { key: 'length', label: 'Barra', sign: 1 } : { key: 'rise', label: 'Cintura', sign: -1 };
  if (t === 'socks') return { key: 'leg', label: 'Altura', sign: 1 };
  return null;
}

/** Height where a dress's skirt is sewn to its bodice. */
function dressWaist(layout) { return layout.hipY + (layout.waistY - layout.hipY) * 0.9; }

function patternColor(garment, p, k) {
  const a = new Color(garment.color), b = new Color(garment.color2);
  const period = (0.015 + garment.scale * 0.09) * k;
  switch (garment.pattern) {
    case 'stripes': return Math.floor(p.y / period) % 2 ? b : a;
    case 'pinstripe': return (((p.x + p.z * 0.3) / (period * 0.6)) % 1 + 1) % 1 < 0.14 ? b : a;
    case 'checks': return (Math.floor(p.y / period) + Math.floor((p.x + p.z) / period)) % 2 ? a.clone().lerp(b, 0.75) : a;
    case 'gradient': return a.clone().lerp(b, smooth((1.45 * k - p.y) / (0.9 * k)));
    default: return a;
  }
}

/** A piece of cloth being built: welded vertices with body-derived attributes. */
class Panel {
  constructor() { this.pos = []; this.normal = []; this.uv = []; this.joints = []; this.weights = []; this.keys = []; this.origins = []; this.index = []; this.map = new Map(); }
  vertex(key, make) {
    if (this.map.has(key)) return this.map.get(key);
    const at = this.pos.length / 3;
    const v = make();
    this.pos.push(...v.pos); this.normal.push(...v.normal); this.uv.push(...v.uv); this.joints.push(...v.joints); this.weights.push(...v.weights); this.keys.push(v.key);
    // The body vertex this cloth point was cut from (-1 for generated tubes).
    this.origins.push(v.origin ?? -1);
    this.map.set(key, at);
    return at;
  }
}

function skinOf(data, v) {
  const joints = [], weights = [];
  let sum = 0;
  for (let j = 0; j < 4; j++) { joints.push(data.joints[v * 4 + j]); const w = data.weights[v * 4 + j] / 65535; weights.push(w); sum += w; }
  if (sum < 1e-6) return { joints: [0, 0, 0, 0], weights: [1, 0, 0, 0] };
  return { joints, weights: weights.map(w => w / sum) };
}
function blendSkin(a, b, t) {
  const total = new Map();
  for (let j = 0; j < 4; j++) {
    total.set(a.joints[j], (total.get(a.joints[j]) ?? 0) + a.weights[j] * (1 - t));
    total.set(b.joints[j], (total.get(b.joints[j]) ?? 0) + b.weights[j] * t);
  }
  const top = [...total].sort((p, q) => q[1] - p[1]).slice(0, 4);
  const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
  return { joints: Array.from({ length: 4 }, (_, j) => top[j]?.[0] ?? 0), weights: Array.from({ length: 4 }, (_, j) => (top[j]?.[1] ?? 0) / sum) };
}

/** Clip the body surface to the garment's coverage field (exact zero contour). */
function cutPanel(context, garment, layout, layer) {
  const { data, positions } = context;
  const values = new Float32Array(positions.length / 3).fill(NaN);
  const field = v => (Number.isNaN(values[v]) ? (values[v] = coverage(garment, v, layout, positions)) : values[v]);
  // Snap the contour onto a vertex when it passes within 8% of an edge's end,
  // so the cut never leaves sliver triangles (bad for shading and for GPUs).
  const snapped = v => {
    let s = field(v);
    if (s < 0) for (const u of neighbours[v] ?? []) {
      const su = field(u);
      if (su > 0 && -s / (su - s) < 0.08) { s = 0; break; }
    }
    return s;
  };
  const neighbours = [];
  for (const face of layout.faces) for (let c = 0; c < 4; c++) {
    const a = data.faces[face * 4 + c], b = data.faces[face * 4 + (c + 1) % 4];
    (neighbours[a] ??= []).push(b); (neighbours[b] ??= []).push(a);
  }
  const panel = new Panel();
  const uvs = data.uvs, faceUvs = data.faceUvs;
  const base = (v, uvIndex) => panel.vertex(`v${v}`, () => {
    const skin = skinOf(data, v);
    return { pos: [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]], normal: [layout.normals[v * 3], layout.normals[v * 3 + 1], layout.normals[v * 3 + 2]],
      uv: [uvs[uvIndex * 2], uvs[uvIndex * 2 + 1]], ...skin, key: layer * 100000 + v, origin: v };
  });
  const cut = (a, b, ua, ub) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return panel.vertex(`e${lo}:${hi}`, () => {
      const sa = snapped(a), sb = snapped(b), t = sa / (sa - sb);
      const lerp = (arr, stride, i, j) => Array.from({ length: stride }, (_, c) => arr[i * stride + c] * (1 - t) + arr[j * stride + c] * t);
      const normal = lerp(layout.normals, 3, a, b); const length = Math.hypot(...normal) || 1;
      return { pos: lerp(positions, 3, a, b), normal: normal.map(c => c / length), uv: [uvs[ua * 2] * (1 - t) + uvs[ub * 2] * t, uvs[ua * 2 + 1] * (1 - t) + uvs[ub * 2 + 1] * t],
        ...blendSkin(skinOf(data, a), skinOf(data, b), t), key: -1, origin: t < 0.5 ? a : b };
    });
  };
  const covered = new Set();
  layout.faces.forEach((face, f) => {
    const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
    const uvIds = [0, 1, 2, 3].map(c => faceUvs[face * 4 + c]);
    const s = ids.map(snapped);
    if (s.every(value => value < 0)) return;
    // Hide skin only well inside the garment: draping moves the cloth a little,
    // and skin near an edge must stay to be seen past it.
    if (s.every(value => value >= 0.025 * layout.k)) covered.add(f);
    for (const tri of [[0, 1, 2], [0, 2, 3]]) {
      // Sutherland–Hodgman clip of the triangle against s >= 0.
      const polygon = [];
      for (let e = 0; e < 3; e++) {
        const i = tri[e], j = tri[(e + 1) % 3];
        const inI = s[i] >= 0, inJ = s[j] >= 0;
        if (inI) polygon.push(base(ids[i], uvIds[i]));
        if (inI !== inJ) polygon.push(cut(ids[i], ids[j], uvIds[i], uvIds[j]));
      }
      const unique = polygon.filter((v, q) => v !== polygon[(q + 1) % polygon.length]);
      for (let q = 1; q + 1 < unique.length; q++) if (unique[0] !== unique[q] && unique[q] !== unique[q + 1]) panel.index.push(unique[0], unique[q], unique[q + 1]);
    }
  });
  // Painted cloth stays where it was painted (like a mask extracted from the
  // body surface): those points are held, so a patch on a leg cannot slide down.
  if (Object.keys(garment.paint).length) {
    panel.pinned = new Uint8Array(panel.pos.length / 3);
    panel.origins.forEach((v, i) => { if (v >= 0 && garment.paint[v] > 0.2) panel.pinned[i] = 1; });
  }
  // Elastic bands: trouser and skirt waistbands, and the cuffs and hem of a sweater.
  panel.elastic = new Uint8Array(panel.pos.length / 3);
  for (const [key, at] of panel.map) {
    const v = key[0] === 'v' ? Number(key.slice(1)) : Number(key.slice(1).split(':')[0]);
    const y = positions[v * 3 + 1], k = layout.k;
    if (['pants', 'shorts'].includes(garment.type)) {
      const band = layout.hipY + (layout.waistY - layout.hipY) * (0.35 + garment.rise * 0.9);
      if (band - y < 0.025 * k) panel.elastic[at] = 1;
    } else if ((garment.type === 'hoodie' || garment.type === 'dress') && field(v) < 0.02 * k) panel.elastic[at] = 1;
  }
  return { panel, covered };
}

/** Waist-to-hem tube for skirts and dresses, enclosing the legs at every height. */
function skirtPanel(context, garment, layout, layer) {
  const { data, positions } = context, k = layout.k;
  const top = garment.type === 'dress' ? dressWaist(layout) : layout.hipY + (layout.waistY - layout.hipY) * (0.35 + garment.rise * 0.9);
  const hem = layout.hipY - (0.06 + garment.length * 0.62) * k;
  const lower = [];
  for (let v = 0; v < positions.length / 3; v++) if (layout.armW[v] < 0.3 && layout.headW[v] < 0.3 && positions[v * 3 + 1] < top + 0.03 * k && positions[v * 3 + 1] > hem - 0.05 * k) lower.push(v);
  const section = y => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const v of lower) {
      if (Math.abs(positions[v * 3 + 1] - y) > 0.015 * k) continue;
      minX = Math.min(minX, positions[v * 3]); maxX = Math.max(maxX, positions[v * 3]);
      minZ = Math.min(minZ, positions[v * 3 + 2]); maxZ = Math.max(maxZ, positions[v * 3 + 2]);
    }
    return { rx: (maxX - minX) / 2, rz: (maxZ - minZ) / 2, cz: (maxZ + minZ) / 2 };
  };
  const waist = section(top), hips = section(layout.hipY - 0.02 * k);
  const enclosing = (y, cz) => {
    let reach = 0;
    for (const v of lower) if (Math.abs(positions[v * 3 + 1] - y) < 0.02 * k) reach = Math.max(reach, Math.hypot(positions[v * 3] / hips.rx, (positions[v * 3 + 2] - cz) / hips.rz));
    return reach;
  };
  const bones = data.skeleton.bones.map(bone => bone.name);
  const pelvis = bones.indexOf('pelvis'), thighL = bones.indexOf('thigh_l'), thighR = bones.indexOf('thigh_r');
  const panel = new Panel(), rows = 16, columns = 48, offset = (0.004 + layer * 0.0035) * k;
  // A skirt hangs from the pelvis and swings with both thighs, not with the skin under it.
  panel.ownWeights = true;
  let widest = 0;
  for (let r = 0; r <= rows; r++) {
    const s = r / rows, y = top + (hem - top) * s;
    const hipBlend = smooth(s * 3), flare = 1 + garment.flare * 0.55 * s * s;
    const cz = waist.cz + (hips.cz - waist.cz) * hipBlend;
    const rx0 = (waist.rx + (hips.rx - waist.rx) * hipBlend) * flare;
    const needed = enclosing(y, cz);
    widest = Math.max(widest, needed);
    const scale = Math.max(rx0 / hips.rx, (y < layout.hipY ? widest : needed) * 1.03);
    const rx = hips.rx * scale + offset, rz = hips.rz * scale + offset;
    for (let c = 0; c < columns; c++) {
      const angle = c / columns * Math.PI * 2;
      const px = Math.sin(angle) * rx, pz = cz + Math.cos(angle) * rz;
      const side = smooth((px / Math.max(1e-3, rx) + 1) / 2), legs = 0.75 * s;
      panel.vertex(`s${r}:${c}`, () => ({ pos: [px, y, pz], normal: [Math.sin(angle), 0, Math.cos(angle)], uv: [c / columns, s],
        joints: [pelvis, thighL, thighR, 0], weights: [1 - legs, legs * side, legs * (1 - side), 0], key: 9000000 + layer * 10000 + r * columns + c }));
      if (r < rows) {
        const a = r * columns + c, b = r * columns + (c + 1) % columns;
        panel.index.push(a, a + columns, b, b, a + columns, b + columns);
      }
    }
  }
  // The waistband is sewn: to the bodice of a dress, or to the band resting on the hips.
  panel.pinned = new Uint8Array(panel.pos.length / 3);
  for (let c = 0; c < columns; c++) panel.pinned[c] = 1;
  panel.skirt = { top, hem };
  return panel;
}

/** Barycentric skin-weight transfer from the closest body point (body collider vertices are base-mesh ids). */
function transferWeights(context, points, panel, skin) {
  const { data } = context, hit = {};
  for (let v = 0; v < points.length / 3; v++) {
    const facing = [panel.normal[v * 3], panel.normal[v * 3 + 1], panel.normal[v * 3 + 2]];
    if (!skin.closest(points[v * 3], points[v * 3 + 1], points[v * 3 + 2], 0.08, hit, facing)) continue;
    const total = new Map();
    for (const [id, share] of [[hit.a, hit.u], [hit.b, hit.v], [hit.c, hit.w]]) for (let j = 0; j < 4; j++) {
      const w = data.weights[id * 4 + j] / 65535 * share;
      if (w > 0) total.set(data.joints[id * 4 + j], (total.get(data.joints[id * 4 + j]) ?? 0) + w);
    }
    const top = [...total].sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0);
    if (!sum) continue;
    for (let j = 0; j < 4; j++) { panel.joints[v * 4 + j] = top[j]?.[0] ?? 0; panel.weights[v * 4 + j] = (top[j]?.[1] ?? 0) / sum; }
  }
}

/** Taubin smoothing (Taubin 1995): alternate shrink (λ) and inflate (μ) Laplacian steps. Open edges stay put. */
function taubinSmooth(points, index, iterations, lambda = 0.5, mu = -0.53) {
  const count = points.length / 3, neighbours = Array.from({ length: count }, () => new Set()), edgeUse = new Map();
  for (let i = 0; i < index.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = index[i + e], b = index[i + (e + 1) % 3];
    neighbours[a].add(b); neighbours[b].add(a);
    const key = a < b ? a * 4194304 + b : b * 4194304 + a;
    edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
  }
  const fixed = new Uint8Array(count);
  for (const [key, used] of edgeUse) if (used === 1) { fixed[Math.floor(key / 4194304)] = 1; fixed[key % 4194304] = 1; }
  const next = new Float32Array(points.length);
  for (let i = 0; i < iterations * 2; i++) {
    const factor = i % 2 ? mu : lambda;
    for (let v = 0; v < count; v++) {
      const list = neighbours[v];
      if (fixed[v] || !list.size) { next[v * 3] = points[v * 3]; next[v * 3 + 1] = points[v * 3 + 1]; next[v * 3 + 2] = points[v * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (const u of list) { x += points[u * 3]; y += points[u * 3 + 1]; z += points[u * 3 + 2]; }
      const n = list.size;
      next[v * 3] = points[v * 3] + factor * (x / n - points[v * 3]);
      next[v * 3 + 1] = points[v * 3 + 1] + factor * (y / n - points[v * 3 + 1]);
      next[v * 3 + 2] = points[v * 3 + 2] + factor * (z / n - points[v * 3 + 2]);
    }
    points.set(next);
  }
}

/** Fold every open edge under by `depth` so cut fabric shows a hem, not a paper edge. */
function addHems(panel, depth) {
  const count = panel.pos.length / 3, edges = new Map();
  for (let i = 0; i < panel.index.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = panel.index[i + e], b = panel.index[i + (e + 1) % 3];
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const entry = edges.get(key);
    if (entry) entry.count++; else edges.set(key, { a, b, count: 1 });
  }
  const folded = new Map();
  const fold = v => {
    if (folded.has(v)) return folded.get(v);
    const at = panel.pos.length / 3;
    for (let c = 0; c < 3; c++) panel.pos.push(panel.pos[v * 3 + c] - panel.normal[v * 3 + c] * depth);
    panel.normal.push(-panel.normal[v * 3], -panel.normal[v * 3 + 1], -panel.normal[v * 3 + 2]);
    panel.uv.push(panel.uv[v * 2], panel.uv[v * 2 + 1]);
    panel.joints.push(...panel.joints.slice(v * 4, v * 4 + 4)); panel.weights.push(...panel.weights.slice(v * 4, v * 4 + 4));
    panel.keys.push(-1); panel.origins.push(panel.origins[v]);
    folded.set(v, at);
    return at;
  };
  for (const { a, b, count: used } of edges.values()) {
    if (used !== 1 || a >= count || b >= count) continue;
    const fa = fold(a), fb = fold(b);
    panel.index.push(a, fb, b, a, fa, fb);
  }
}

/**
 * Build every garment, inner to outer, into one skinned mesh. Draped garments
 * are added to `collider`, so whatever is layered on top (hair, the next
 * garment) rests on them. Returns the mesh and the body faces it fully covers.
 */
export function tailorOutfit(context, garments, sculptOffsets, collider) {
  const layout = bodyLayout(context);
  const skin = bodyCollider(context);
  const k = layout.k, height = context.height ?? 1.7;
  const meshData = { pos: [], color: [], uv: [], joints: [], weights: [], index: [], keys: [], garment: [] };
  const covered = new Set(), finished = [];
  garments.forEach((garment, layer) => {
    // Inner parts first: a dress's bodice is draped before its skirt, which
    // then hangs over the bodice's hem (sewn at the waist), not under it.
    const panels = [];
    if (garment.type !== 'skirt') {
      const { panel, covered: faces } = cutPanel(context, garment, layout, layer);
      if (panel.index.length) panels.push(panel);
      for (const f of faces) covered.add(f);
    }
    if (garment.type === 'skirt' || garment.type === 'dress') panels.push(skirtPanel(context, garment, layout, layer));
    for (const panel of panels) {
      // Start just above the surface beneath, then drape.
      const lift = (0.0035 + layer * 0.0035) * k;
      for (let v = 0; v < panel.pos.length / 3; v++) for (let c = 0; c < 3; c++) panel.pos[v * 3 + c] += panel.normal[v * 3 + c] * lift;
      const points = Float32Array.from(panel.pos);
      // The pattern is drafted from a smoothed body (Taubin λ|μ filtering
      // removes nipples, navel and ribs without shrinking the torso), so the
      // cloth has less area than the skin around small bumps and spans them.
      // Looser garments are drafted from a smoother body, so they fall straight
      // from the chest and shoulder blades instead of following every curve.
      taubinSmooth(points, panel.index, Math.round(30 + garment.fit * 150));
      const pattern = points.slice();
      resolvePenetration(points, panel.index, collider, { thickness: 0.004 * k, depth: 0.03 * k, smoothing: 6, normals: panel.normal });
      drapeCloth(points, panel.index, collider, {
        thickness: 0.004 * k, slack: 0.96 + garment.fit * 0.14, frames: 30, substeps: 5, friction: 0.9, radius: 0.05 * k,
        bendCompliance: 3e-6, elastic: panel.elastic, normals: panel.normal, rest: pattern, pinned: panel.pinned,
      });
      // Sculpted cloth edits apply after draping.
      if (sculptOffsets) panel.keys.forEach((key, v) => {
        const d = key >= 0 && sculptOffsets[key];
        if (d) { points[v * 3] += d[0] * height; points[v * 3 + 1] += d[1] * height; points[v * 3 + 2] += d[2] * height; }
      });
      // Exact final pass: nothing may end inside the skin or a lower layer.
      resolvePenetration(points, panel.index, collider, { thickness: 0.0035 * k, depth: 0.03 * k, smoothing: 2, normals: panel.normal });
      // Skin weights come from the body surface now under each point, so the
      // cloth moves with the skin it rests on in every pose.
      if (!panel.ownWeights) transferWeights(context, points, panel, skin);
      panel.pos = Array.from(points);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3)); geometry.setIndex(panel.index); geometry.computeVertexNormals();
      panel.normal = Array.from(geometry.getAttribute('normal').array);
      collider.add(points, geometry.getAttribute('normal').array, panel.index);
      geometry.dispose();
      addHems(panel, 0.0016 * k);
      finished.push({ panel, garment, layer });
    }
  });
  // Parts of an inner layer fully covered by an outer one are tucked in, so
  // they are removed like covered skin: never visible, and nothing can show
  // through. A skirt or dress tube covers what lies between its band and hem.
  const outerCovers = (layer, v) => garments.some((outer, j) => {
    if (j <= layer || v < 0) return false;
    const y = context.positions[v * 3 + 1];
    if (outer.type === 'skirt' || outer.type === 'dress') {
      const tube = finished.find(item => item.layer === j && item.panel.skirt)?.panel.skirt;
      if (tube && y < tube.top - 0.03 * k && y > tube.hem + 0.04 * k) return true;
      if (outer.type === 'skirt') return false;
    }
    return coverage(outer, v, layout, context.positions) >= 0.03 * k;
  });
  for (const { panel, garment, layer } of finished) {
    const hidden = panel.origins.map(v => outerCovers(layer, v));
    const offset = meshData.pos.length / 3;
    for (let v = 0; v < panel.pos.length / 3; v++) {
      const p = new Vector3(panel.pos[v * 3], panel.pos[v * 3 + 1], panel.pos[v * 3 + 2]);
      const color = patternColor(garment, p, k);
      meshData.pos.push(p.x, p.y, p.z); meshData.color.push(color.r, color.g, color.b);
    }
    meshData.uv.push(...panel.uv); meshData.joints.push(...panel.joints); meshData.weights.push(...panel.weights); meshData.keys.push(...panel.keys);
    for (let v = 0; v < panel.pos.length / 3; v++) meshData.garment.push(layer);
    for (let i = 0; i < panel.index.length; i += 3) {
      const a = panel.index[i], b = panel.index[i + 1], c = panel.index[i + 2];
      if (hidden[a] && hidden[b] && hidden[c]) continue;
      meshData.index.push(a + offset, b + offset, c + offset);
    }
  }
  if (!meshData.index.length) return { mesh: null, covered };
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(meshData.pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(meshData.uv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(meshData.color, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(meshData.joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(meshData.weights, 4));
  geometry.setIndex(meshData.index);
  geometry.computeVertexNormals();
  geometry.userData.sculptKeys = Int32Array.from(meshData.keys);
  geometry.userData.proxyVertexCount = meshData.keys.length;
  // Which garment (its index in the outfit) each vertex belongs to, for picking a piece by clicking it.
  geometry.userData.garmentOf = Int8Array.from(meshData.garment);
  const roughness = garments.reduce((sum, g) => sum + g.roughness, 0) / Math.max(1, garments.length);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness, side: DoubleSide }));
  mesh.name = 'Outfit';
  mesh.userData.style = 'tailor';
  mesh.userData.tailor = true;
  context.group.add(mesh);
  mesh.bind(context.body.skeleton, context.body.bindMatrix);
  return { mesh, covered };
}

/** Remove body faces (in body-face order) from the rendered skin. */
export function hideBodyFaces(geometry, faces) {
  if (!faces.size) return;
  const old = geometry.index.array, kept = [];
  for (let i = 0; i < old.length; i += 6) if (!faces.has(Math.floor(old[i] / 4))) for (let k = 0; k < 6; k++) kept.push(old[i + k]);
  geometry.setIndex(kept);
}

/** Collider over every body face, including skin later hidden under clothes. */
export function bodyCollider(context) {
  const { data, positions } = context;
  const layout = bodyLayout(context);
  const index = [];
  for (const face of layout.faces) {
    const [a, b, c, d] = [0, 1, 2, 3].map(k => data.faces[face * 4 + k]);
    index.push(a, b, c, a, c, d);
  }
  return new SurfaceCollider(0.012 * layout.k).add(positions, layout.normals, index);
}
