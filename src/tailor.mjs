import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshPhysicalMaterial, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { SurfaceCollider, resolvePenetration } from './collision.mjs';
import { drapeCloth } from './cloth.mjs';
import { normalizePattern } from './patterns.mjs';
import { buildPatternPanels, projectPanelContacts, coveredPatternFaces, layeredCollider } from './pattern-cloth.mjs';
import { fabrics, normalizeFabric, fabricMaterialParameters } from './fabrics.mjs';

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
export const garmentTypes = ['tshirt', 'longsleeve', 'tank', 'hoodie', 'pants', 'shorts', 'skirt', 'dress', 'socks', 'gloves', 'paint',
  'bikini_top', 'bikini_bottom', 'swimsuit', 'armband', 'anklet', 'fringe', 'backpiece', 'headdress', 'crown', 'sneakers', 'boots', 'sandals'];
/** Shoes cut on the foot, with a flat sole; with one of them worn the ready-made shoes are left off. */
export const footwearTypes = ['sneakers', 'boots', 'sandals'];
export const garmentLabels = { tshirt: 'Camiseta', longsleeve: 'Manga longa', tank: 'Regata', hoodie: 'Moletom', pants: 'Calça', shorts: 'Bermuda', skirt: 'Saia', dress: 'Vestido', socks: 'Meias', gloves: 'Luvas', paint: 'Livre (pintada)',
  bikini_top: 'Top de biquíni', bikini_bottom: 'Calcinha / tanga', swimsuit: 'Maiô / body', armband: 'Braçadeiras', anklet: 'Tornozeleiras',
  fringe: 'Saia de franjas', backpiece: 'Costeiro de plumas', headdress: 'Cabeça de plumas', crown: 'Coroa / tiara',
  sneakers: 'Tênis', boots: 'Botas', sandals: 'Sandálias' };
export const garmentPatterns = ['solid', 'stripes', 'pinstripe', 'checks', 'gradient'];
/** Carnival pieces: cut on the body (tight), or built as plumes, fringe and crowns (costume.mjs). */
export const costumeTypes = ['bikini_top', 'bikini_bottom', 'swimsuit', 'armband', 'anklet', 'fringe', 'backpiece', 'headdress', 'crown'];
/** Most pieces worn at once (a full carnival costume is seven; a garment index fits an Int8). */
export const MAX_GARMENTS = 12;
/** Pieces with nothing cut from the body: only their accessory mesh (costume.mjs). */
export const accessoryOnly = new Set(['backpiece', 'headdress', 'crown']);
const defaults = {
  tshirt: { sleeve: 0.3, length: 0.85, neckline: 0.25, fit: 0.3, color: '#3c5a78' },
  longsleeve: { sleeve: 0.96, length: 0.85, neckline: 0.2, fit: 0.3, color: '#7a3b3b' },
  tank: { sleeve: 0, length: 0.8, neckline: 0.5, fit: 0.15, color: '#d9d4c7' },
  hoodie: { sleeve: 1, length: 0.95, neckline: 0.1, fit: 0.75, color: '#4b5340', fabric: 'knit' },
  pants: { leg: 1, rise: 0.5, fit: 0.35, color: '#2f3640', fabric: 'denim' },
  shorts: { leg: 0.32, rise: 0.5, fit: 0.4, color: '#806a52' },
  skirt: { length: 0.45, flare: 0.4, rise: 0.55, fit: 0.3, color: '#5b2f45' },
  dress: { sleeve: 0, length: 0.7, neckline: 0.45, flare: 0.5, fit: 0.2, color: '#284f63' },
  socks: { leg: 0.25, fit: 0.05, color: '#e8e4dc', fabric: 'knit' },
  gloves: { fit: 0.05, color: '#1f1f22', fabric: 'leather' },
  paint: { fit: 0.2, color: '#9a8f7d' },
  // Carnival: tight pieces in sequins and rhinestones, plumes and fringe that swing on spring joints.
  bikini_top: { length: 0.5, neckline: 0.5, fit: 0, color: '#d4a63a', fabric: 'sequin', roughness: 0.18 },
  bikini_bottom: { rise: 0.35, leg: 0.35, fit: 0, color: '#d4a63a', fabric: 'sequin', roughness: 0.18 },
  swimsuit: { neckline: 0.55, leg: 0.4, fit: 0, color: '#b0123c', fabric: 'rhinestone', roughness: 0.3 },
  armband: { sleeve: 0.15, length: 0.4, fit: 0, color: '#d4a63a', fabric: 'sequin', roughness: 0.18 },
  anklet: { leg: 0.85, length: 0.35, fit: 0, color: '#d4a63a', fabric: 'sequin', roughness: 0.18 },
  fringe: { rise: 0.35, length: 0.6, flare: 0.6, fit: 0, color: '#e8c25a', color2: '#ffffff', fabric: 'sequin', roughness: 0.18 },
  // Same sequin roughness as the other pieces: one material (one draw call) for all of them.
  backpiece: { length: 0.7, flare: 0.75, fit: 0, color: '#f2f2f2', color2: '#e0b03a', fabric: 'sequin', roughness: 0.18 },
  headdress: { length: 0.55, flare: 0.6, fit: 0, color: '#f2f2f2', color2: '#e0b03a', fabric: 'sequin', roughness: 0.18 },
  crown: { length: 0.45, fit: 0, color: '#e0b03a', fabric: 'rhinestone', roughness: 0.3 },
  // Shoes: `color` the upper, `color2` the sole; boots' height in `leg`.
  sneakers: { fit: 0.08, color: '#2b2f3a', color2: '#f2f2f2', fabric: 'cotton' },
  boots: { leg: 0.5, fit: 0.1, color: '#3a2a22', color2: '#17130f', fabric: 'leather', roughness: 0.48 },
  sandals: { fit: 0.02, color: '#d4a63a', color2: '#7a5a34', fabric: 'lame', roughness: 0.32 },
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
    ...(value.authoringMode === 'surface' || value.authoringMode === 'pattern'
      ? {authoringMode:value.authoringMode} : value.patternData ? {authoringMode:'pattern'} : {}),
    sleeve: number('sleeve', base.sleeve ?? 0), length: number('length', base.length ?? 0.5), neckline: number('neckline', base.neckline ?? 0.2),
    leg: number('leg', base.leg ?? 1), rise: number('rise', base.rise ?? 0.5), flare: number('flare', base.flare ?? 0.3),
    fit: number('fit', base.fit ?? 0.2), roughness: number('roughness', base.roughness ?? fabrics[normalizeFabric(value.fabric ?? base.fabric)].roughness),
    fabric: normalizeFabric(value.fabric ?? base.fabric),
    color: color('color', base.color), color2: color('color2', base.color2 ?? '#e9e4da'),
    pattern: garmentPatterns.includes(value.pattern) ? value.pattern : 'solid', scale: number('scale', 0.5),
    paint,
    ...(value.patternData ? { patternData: normalizePattern(value.patternData) } : {}),
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
  // Vertices of the visible body (helpers and joint cubes excluded).
  const used = new Uint8Array(count);
  for (const face of faces) for (let c = 0; c < 4; c++) used[data.faces[face * 4 + c]] = 1;
  // The bust point of each side: the most forward torso skin between the spine_03 joint and the
  // neck (bikini cups); on the MakeHuman body it lies about a third of the way up (y ≈ 1.24 m at 1.7 m).
  const chestY = at('spine_03').y, neckY = at('neck_01').y, bust = { l: null, r: null };
  for (let v = 0; v < count; v++) {
    if (!used[v] || armW[v] > 0.2 || headW[v] > 0.2) continue;
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (y < chestY + 0.02 * k || y > chestY + 0.55 * (neckY - chestY) || Math.abs(x) < 0.03 * k || Math.abs(x) > 0.15 * k) continue;
    const side = x > 0 ? 'l' : 'r';
    if (!bust[side] || z > bust[side].z) bust[side] = new Vector3(x, y, z);
  }
  // Metres per unit of the body's UV map (median over its edges), so cut garments get UVs in metres.
  const ratios = [];
  for (let i = 0; i < faces.length; i += 7) {
    const f = faces[i], a = data.faces[f * 4], b = data.faces[f * 4 + 1], ua = data.faceUvs[f * 4], ub = data.faceUvs[f * 4 + 1];
    const d3 = Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2]);
    const d2 = Math.hypot(data.uvs[ua * 2] - data.uvs[ub * 2], data.uvs[ua * 2 + 1] - data.uvs[ub * 2 + 1]);
    if (d2 > 1e-6) ratios.push(d3 / d2);
  }
  ratios.sort((p, q) => p - q);
  context.tailorLayout = {
    faces, normals, arm, leg, armW, legW, headW, arms, legs, height, k, used, kind, bust, uvScale: ratios[ratios.length >> 1] ?? 1,
    hipY: at('thigh_l').y, waistY: at('spine_01').y, chestY, neckY: at('neck_01').y,
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
  } else if (costumeTypes.includes(type)) {
    s = costumeCoverage(garment, v, layout, positions);
  } else if (footwearTypes.includes(type)) {
    s = footwearCoverage(garment, v, layout, positions);
  }
  // Painted cloth: +1 adds, -1 erases, over nearly the whole brush circle
  // (only its faint rim is left out), blended over a few centimetres.
  const painted = garment.paint[v];
  if (painted > 0) s = Math.max(s, (painted - 0.2) * 0.05 * k);
  if (painted < 0) s = Math.min(s, (0.2 + painted) * 0.05 * k);
  return s;
}

/** A path drawn on the skin: points along the segments between `stops`, each snapped to the nearest skin vertex of the torso or the neck. */
function skinPath(layout, positions, stops, spacing) {
  const out = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i], b = stops[i + 1], n = Math.max(1, Math.ceil(a.distanceTo(b) / spacing));
    for (let s = 0; s < (i + 2 === stops.length ? n + 1 : n); s++) {
      const p = a.clone().lerp(b, s / n);
      let best = -1, distance = Infinity;
      for (let v = 0; v < positions.length / 3; v++) {
        // The neck is allowed (its skin weighs as "head"); the head itself, above the neck's base, is not.
        if (!layout.used[v] || layout.armW[v] > 0.35 || positions[v * 3 + 1] > layout.neckY + 0.04 * layout.k) continue;
        const d = (positions[v * 3] - p.x) ** 2 + (positions[v * 3 + 1] - p.y) ** 2 + (positions[v * 3 + 2] - p.z) ** 2;
        if (d < distance) { distance = d; best = v; }
      }
      out.push(new Vector3(positions[best * 3], positions[best * 3 + 1], positions[best * 3 + 2]));
    }
  }
  return out;
}
const pathDistance = (path, x, y, z) => {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
    best = Math.min(best, Math.hypot(a.x + t * dx - x, a.y + t * dy - y, a.z + t * dz - z));
  }
  return best;
};

/**
 * Carnival pieces cut on the body, as signed coverage (metres, > 0 inside):
 * - top: two cups (ellipsoids round each bust point, `length` their size), a band under the bust
 *   and halter straps drawn on the skin from the top of each cup round the neck's base;
 * - bottom: below a waistband (`rise`) and above a leg opening that rises at the hips (`leg`: 0 a
 *   high-cut tanga, 1 a full brief), continuous through the crotch;
 * - swimsuit: a sleeveless bodice (`neckline`) closed by the same leg opening;
 * - armbands and anklets: bands round the upper arms (`sleeve`: where, `length`: how wide) and
 *   the lower legs (`leg`: where);
 * - fringe skirt: a hip band (`rise`); its strands are built by costume.mjs.
 */
function costumeCoverage(garment, v, layout, positions) {
  const { type } = garment, k = layout.k;
  const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
  const torso = Math.min((0.3 - layout.armW[v]) * 0.25, (0.3 - layout.headW[v]) * 0.25);
  const legOpening = () => {
    // Distance down the leg chain (negative above the hip joint); the opening is lower at the
    // inner thigh and the crotch and rises towards the side of the hip for a higher cut.
    const side = layout.legs[x >= 0 ? 'l' : 'r'], lateral = clamp((Math.abs(x) - Math.abs(side.A.x)) / (0.07 * k), -1, 1);
    const cut = (0.02 - (1 - garment.leg) * 0.09 * smooth((lateral + 1) / 2)) * k;
    return cut - layout.leg[v];
  };
  if (type === 'bikini_top') {
    let s = -1;
    const size = 0.75 + 0.6 * garment.length;
    for (const point of [layout.bust.l, layout.bust.r]) {
      if (!point) continue;
      const rx = 0.07 * k * size, ry = 0.068 * k * size, centre = point.y - 0.012 * k;
      const d = Math.hypot((x - point.x) / rx, (y - centre) / ry);
      if (z > point.z - 0.11 * k) s = Math.max(s, (1 - d) * 0.05 * k);
    }
    const under = Math.min(layout.bust.l?.y ?? layout.chestY, layout.bust.r?.y ?? layout.chestY) - 0.068 * k * size + 0.002 * k;
    // At least about one body edge wide (2.6 cm): a narrower band can pass between the vertices of
    // a face, which is then skipped by the cut.
    s = Math.max(s, 0.013 * k - Math.abs(y - under));
    const key = `straps:${garment.length}:${garment.neckline}`;
    layout.paths ??= new Map();
    if (!layout.paths.has(key)) {
      const paths = [];
      for (const point of [layout.bust.l, layout.bust.r]) if (point) {
        const sign = Math.sign(point.x), top = new Vector3(point.x - sign * 0.01 * k, point.y + 0.06 * k * size, point.z - 0.02 * k);
        const neck = new Vector3(sign * 0.045 * k, layout.neckY - 0.01 * k, layout.frontZ - 0.035 * k);
        // Both straps meet behind, in the middle of the nape (where a halter is tied).
        const nape = new Vector3(0, layout.neckY + 0.01 * k, layout.frontZ - 0.15 * k);
        paths.push(skinPath(layout, positions, [top, top.clone().lerp(neck, 0.5), neck, nape], 0.012 * k));
      }
      layout.paths.set(key, paths);
    }
    // The halter straps run up the neck and round the nape (a halterneck ties behind the neck): they are
    // not cut where the neck's skin starts (its weight counts as "head"), only kept off the arms and
    // below the line just above the neck's base.
    const strap = (0.005 + 0.006 * garment.neckline) * k;
    let straps = -1;
    for (const path of layout.paths.get(key)) straps = Math.max(straps, strap - pathDistance(path, x, y, z));
    straps = Math.min(straps, (0.3 - layout.armW[v]) * 0.25, layout.neckY + 0.03 * k - y);
    return Math.max(Math.min(s, torso), straps);
  }
  if (type === 'bikini_bottom') {
    const band = layout.hipY + (layout.waistY - layout.hipY) * (garment.rise * 0.9 - 0.15);
    return Math.min(band - y, legOpening(), (0.3 - layout.armW[v]) * 0.25);
  }
  if (type === 'swimsuit') {
    const n = garment.neckline, cy = layout.neckY + 0.012 * k, cz = layout.frontZ + 0.035 * k;
    const rx = (0.055 + 0.05 * n) * k, ry = (0.03 + 0.2 * n) * k, rz = (0.075 + 0.02 * n) * k;
    const scoop = (Math.hypot(x / rx, (y - cy) / ry, (z - cz) / rz) - 1) * Math.min(rx, ry, rz);
    const armhole = 0.02 * k * (1 - layout.armW[v] * 1.6) - Math.max(0, layout.arm[v]);
    return Math.min(scoop, armhole, layout.neckY - 0.006 * k - y, legOpening(), (0.4 - layout.headW[v]) * 0.25);
  }
  if (type === 'armband') {
    if (layout.armW[v] < 0.5) return -1;
    const centre = (0.06 + 0.55 * garment.sleeve) * layout.arms.l.length;
    return (0.008 + 0.035 * garment.length) * k - Math.abs(layout.arm[v] - centre);
  }
  if (type === 'anklet') {
    if (layout.legW[v] < 0.5) return -1;
    const chain = layout.legs.l, centre = chain.l1 + 0.06 * k + (chain.l2 - 0.12 * k) * garment.leg;
    return (0.008 + 0.03 * garment.length) * k - Math.abs(layout.leg[v] - centre);
  }
  if (type === 'fringe') {
    const top = layout.hipY + (layout.waistY - layout.hipY) * (0.2 + garment.rise * 0.9);
    return Math.min(top - y, y - (top - 0.035 * k), (0.35 - layout.armW[v]) * 0.25);
  }
  return -1;
}

/**
 * Shoes cut on the foot (signed coverage, metres): the leg chain's distance runs past the ankle
 * joint down the foot, so "below the ankle" is a foot. Trainers cover the foot to just above the
 * ankle, boots up the shin (`leg`: from the ankle to below the knee), sandals the sole plus three
 * straps (round the ankle, across the instep and across the toes).
 */
function footwearCoverage(garment, v, layout, positions) {
  if (layout.legW[v] < 0.5) return -1;
  const k = layout.k, x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
  const chain = layout.legs[x >= 0 ? 'l' : 'r'], ankle = chain.l1 + chain.l2, along = layout.leg[v];
  if (garment.type === 'sneakers') return along - (ankle - 0.035 * k);
  if (garment.type === 'boots') return along - (ankle - (0.06 + 0.3 * garment.leg) * k);
  const forward = z - chain.C.z;
  // The sole: only what is under the foot (the toes stay bare above it).
  return Math.max(0.007 * k - y, 0.012 * k - Math.abs(along - (ankle - 0.012 * k)),
    Math.min(0.013 * k - Math.abs(forward - 0.115 * k), 0.06 * k - y), Math.min(0.012 * k - Math.abs(forward - 0.05 * k), 0.08 * k - y));
}

/** Top and bottom heights of a fringe skirt's band, where its strands hang from. */
export function fringeBand(layout, garment) {
  const top = layout.hipY + (layout.waistY - layout.hipY) * (0.2 + garment.rise * 0.9);
  return { top, bottom: top - 0.035 * layout.k };
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
  if (t === 'bikini_top') return { key: 'length', label: 'Bojo', sign: 1 };
  if (t === 'bikini_bottom') return y < layout.hipY - 0.01 * k ? { key: 'leg', label: 'Cava', sign: 1 } : { key: 'rise', label: 'Cintura', sign: -1 };
  if (t === 'swimsuit') return y > (layout.chestY + layout.neckY) / 2 ? { key: 'neckline', label: 'Decote', sign: 1 } : { key: 'leg', label: 'Cava', sign: 1 };
  if (t === 'armband') return { key: 'sleeve', label: 'Posição', sign: 1 };
  if (t === 'anklet') return { key: 'leg', label: 'Posição', sign: 1 };
  if (t === 'fringe') return { key: 'length', label: 'Comprimento', sign: 1 };
  if (t === 'boots') return { key: 'leg', label: 'Cano', sign: -1 };
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
      // Godets: a gored skirt has fabric sectors set into its eight seams, so the hem is wider than a
      // smooth cone and the extra hangs in flutes; outwards only, more of it lower down.
      // Eight godets a few centimetres wide at the hem each: the hem some 30 % wider at full flare.
      const godet = 1 + 0.6 * garment.flare * Math.pow(s, 1.5) * 0.5 * (1 + Math.cos(angle * 8));
      const px = Math.sin(angle) * rx * godet, pz = cz + Math.cos(angle) * rz * godet;
      const side = smooth((px / Math.max(1e-3, rx) + 1) / 2), legs = 0.75 * s;
      panel.vertex(`s${r}:${c}`, () => ({ pos: [px, y, pz], normal: [Math.sin(angle), 0, Math.cos(angle)], uv: [angle * (rx + rz) / 2, top - y],
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

/**
 * Body skin split by anatomical region (dominant bone of each face): left and
 * right arm, left and right leg, torso, head. A pattern panel takes its weights
 * only from the skin of its own region (Blender Data Transfer restricted to a
 * source group), so a sleeve hanging near the torso in the A pose never takes
 * torso weights, nor a bodice the arm's.
 */
function regionColliders(context) {
  if (context.tailorRegions) return context.tailorRegions;
  const { data, positions } = context, layout = bodyLayout(context), names = data.skeleton.bones.map(bone => bone.name);
  const lists = { arm_l: [], arm_r: [], leg_l: [], leg_r: [], torso: [], head: [] };
  for (const face of layout.faces) {
    const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]), influence = new Map();
    for (const v of ids) for (let j = 0; j < 4; j++) influence.set(data.joints[v * 4 + j], (influence.get(data.joints[v * 4 + j]) ?? 0) + data.weights[v * 4 + j]);
    const dominant = names[[...influence].sort((a, b) => b[1] - a[1])[0][0]] ?? '';
    const part = layout.kind(dominant), side = dominant.endsWith('_r') ? 'r' : 'l';
    const region = ['upper', 'lower', 'hand'].includes(part) ? `arm_${side}` : ['thigh', 'calf', 'foot'].includes(part) ? `leg_${side}` : part === 'head' ? 'head' : 'torso';
    lists[region].push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  context.tailorRegions = Object.fromEntries(Object.entries(lists).map(([name, index]) => [name, new SurfaceCollider(0.012 * layout.k).add(positions, layout.normals, index)]));
  return context.tailorRegions;
}

/** Region skin of a pattern placement (`region`, `side` from pattern-cloth). */
function placementRegion(placement) {
  const side = placement.side === 'r' ? 'r' : 'l';
  if (placement.region === 'arm' || placement.region === 'hand') return `arm_${side}`;
  if (placement.region === 'leg' || placement.region === 'foot') return `leg_${side}`;
  if (placement.region === 'head') return 'head';
  return 'torso';
}

/**
 * Barycentric skin-weight transfer from the closest body point (Nearest Face
 * Interpolated; body collider vertices are base-mesh ids). `collidersFor(v)`
 * lists the source surfaces to try in order; a vertex with no source within
 * the maximum distance keeps the weights it already has.
 */
function transferWeights(context, points, panel, collidersFor) {
  const { data } = context, hit = {};
  for (let v = 0; v < points.length / 3; v++) {
    const facing = [panel.normal[v * 3], panel.normal[v * 3 + 1], panel.normal[v * 3 + 2]];
    if (!collidersFor(v).some(skin => skin.closest(points[v * 3], points[v * 3 + 1], points[v * 3 + 2], 0.08, hit, facing))) continue;
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

/**
 * The garment's drafted shell: the cut skin turned into fabric that keeps its ease from the body.
 * First it alternates (a) a Laplacian step along the cloth's own normal only (concave creases
 * such as the underbust, the cleavage, the navel and the spine flatten out, as stretched fabric
 * spans them; points do not slide sideways, so each keeps the skin it was cut from) and (b)
 * Blender's Shrinkwrap "Outside" snap at the `base` offset (the fabric's thickness). Open edges
 * (hem, neckline, cuffs) are smoothed along their own curve, which removes the cut's zigzag. Then
 * the spanned surface is offset by `room(v)` metres of ease and settled.
 */
function fitShell(points, index, bodyNormals, beneath, { base, room, iterations, settle = 6, snapping = true }) {
  const count = points.length / 3, neighbours = Array.from({ length: count }, () => []), edgeUse = new Map();
  for (let i = 0; i < index.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = index[i + e], b = index[i + (e + 1) % 3], key = a < b ? a * 4194304 + b : b * 4194304 + a;
    edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    if (!neighbours[a].includes(b)) neighbours[a].push(b);
    if (!neighbours[b].includes(a)) neighbours[b].push(a);
  }
  const rim = Array.from({ length: count }, () => []);
  for (const [key, used] of edgeUse) if (used === 1) { const a = Math.floor(key / 4194304), b = key % 4194304; rim[a].push(b); rim[b].push(a); }
  const normal = new Float32Array(count * 3), next = new Float32Array(points.length), hit = {}, facing = [0, 0, 0];
  // The cloth's own unit normals, turned outwards (the side the body normal points to).
  const normals = () => {
    normal.fill(0);
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
      const ux = points[b] - points[a], uy = points[b + 1] - points[a + 1], uz = points[b + 2] - points[a + 2];
      const vx = points[c] - points[a], vy = points[c + 1] - points[a + 1], vz = points[c + 2] - points[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { normal[o] += nx; normal[o + 1] += ny; normal[o + 2] += nz; }
    }
    for (let v = 0; v < count; v++) {
      const o = v * 3, length = Math.hypot(normal[o], normal[o + 1], normal[o + 2]) || 1;
      const sign = normal[o] * bodyNormals[o] + normal[o + 1] * bodyNormals[o + 1] + normal[o + 2] * bodyNormals[o + 2] < 0 ? -1 : 1;
      normal[o] *= sign / length; normal[o + 1] *= sign / length; normal[o + 2] *= sign / length;
    }
  };
  // Shrinkwrap "Outside" with the base offset: a point nearer the surface beneath moves out along
  // that surface's normal; one already farther stays.
  const snap = () => {
    // Without snapping (a shoe cut from its smooth last) the shell is only offset and smoothed.
    if (!snapping) return;
    for (let v = 0; v < count; v++) {
      facing[0] = bodyNormals[v * 3]; facing[1] = bodyNormals[v * 3 + 1]; facing[2] = bodyNormals[v * 3 + 2];
      if (!beneath.closest(points[v * 3], points[v * 3 + 1], points[v * 3 + 2], 0.12, hit, facing)) continue;
      const push = base - hit.distance;
      if (push > 0) { points[v * 3] += hit.nx * push; points[v * 3 + 1] += hit.ny * push; points[v * 3 + 2] += hit.nz * push; }
    }
  };
  // One Laplacian step of `factor`: along the cloth's normal inside, along the curve on open edges.
  const relax = (factor = 0.5) => {
    normals();
    next.set(points);
    for (let v = 0; v < count; v++) {
      const list = rim[v].length === 2 ? rim[v] : rim[v].length ? null : neighbours[v];
      if (!list?.length) continue;
      let x = 0, y = 0, z = 0;
      for (const u of list) { x += points[u * 3]; y += points[u * 3 + 1]; z += points[u * 3 + 2]; }
      x = x / list.length - points[v * 3]; y = y / list.length - points[v * 3 + 1]; z = z / list.length - points[v * 3 + 2];
      if (list === rim[v]) { next[v * 3] += factor * x; next[v * 3 + 1] += factor * y; next[v * 3 + 2] += factor * z; continue; }
      const nx = normal[v * 3], ny = normal[v * 3 + 1], nz = normal[v * 3 + 2], along = factor * (x * nx + y * ny + z * nz);
      next[v * 3] += along * nx; next[v * 3 + 1] += along * ny; next[v * 3 + 2] += along * nz;
    }
    points.set(next);
    snap();
  };
  // A field averaged over each vertex's neighbours, `passes` times.
  const blur = (field, stride, passes) => {
    const out = Float32Array.from(field);
    for (let pass = 0; pass < passes; pass++) {
      const copy = out.slice();
      for (let v = 0; v < count; v++) {
        const list = neighbours[v];
        if (!list.length) continue;
        for (let c = 0; c < stride; c++) { let s = copy[v * stride + c]; for (const u of list) s += copy[u * stride + c]; out[v * stride + c] = s / (list.length + 1); }
      }
    }
    return out;
  };
  // 1. Bridge: the cut becomes stretched fabric that spans the hollows at the base offset.
  normals(); snap();
  for (let iteration = 0; iteration < iterations; iteration++) relax();
  // 2. Ease: once the hollows are spanned the surface has no tight creases, so it is offset along
  //    its own (blurred) normal by the ease without folding over itself.
  normals();
  const direction = blur(normal, 3, 4), amount = blur(Float32Array.from({ length: count }, (_, v) => room(v)), 1, 4);
  for (let v = 0; v < count; v++) {
    const o = v * 3, length = Math.hypot(direction[o], direction[o + 1], direction[o + 2]) || 1;
    for (let c = 0; c < 3; c++) points[o + c] += direction[o + c] / length * amount[v];
  }
  // 3. Settle with Taubin λ|μ steps (Taubin 1995: a shrinking then an inflating step remove small
  //    bumps such as the nipples without shrinking the garment, so the ease stays), as many as the
  //    looser the garment is; this also smooths what the offset sharpened (the armpit, the crotch).
  for (let iteration = 0; iteration < settle; iteration++) { relax(0.5); relax(-0.53); }
}

/** Convex hull of 2D points (Andrew's monotone chain), counter-clockwise. */
function convexHull2D(list) {
  const p = list.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** Distance from (x, y) along the unit direction (dx, dy) to where it leaves a convex polygon containing it. */
function rayToPolygon(x, y, dx, dy, polygon) {
  let best = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % polygon.length], ex = bx - ax, ey = by - ay;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const t = ((ax - x) * ey - (ay - y) * ex) / denominator, s = ((ax - x) * dy - (ay - y) * dx) / denominator;
    if (t > 0 && s >= 0 && s <= 1) best = Math.max(best, t);
  }
  return best;
}
/**
 * A shoe is a rigid last-shaped shell: in slices across each foot (along its length), every point of the
 * shell comes out to the convex outline of its slice, so the upper spans the toes and their clefts and
 * the instep, as a shoe's upper is lasted, instead of tracing each toe.
 */
function lastShoe(points, k, ankleY = Infinity) {
  // Slices across the length (x, y), along the length seen from above (x, z) and from the side (z, y):
  // the toes' different lengths are spanned at the front too. Twice, as each pass changes the others' slices.
  const planes = [[2, 0, 1], [1, 0, 2], [0, 2, 1]];
  for (const side of [1, -1]) {
    const ids = [];
    // The foot only: a boot's shaft above the ankle joint is a tube round the leg, not part of the last.
    for (let v = 0; v < points.length / 3; v++) if (Math.sign(points[v * 3]) === side && points[v * 3 + 1] < ankleY) ids.push(v);
    if (ids.length < 10) continue;
    for (let pass = 0; pass < 2; pass++) for (const [axis, a, b] of planes) {
      let min = Infinity, max = -Infinity;
      for (const v of ids) { min = Math.min(min, points[v * 3 + axis]); max = Math.max(max, points[v * 3 + axis]); }
      for (let s0 = min; s0 < max; s0 += 0.008 * k) {
        const slice = ids.filter(v => points[v * 3 + axis] >= s0 && points[v * 3 + axis] < s0 + 0.008 * k);
        if (slice.length < 4) continue;
        const hull = convexHull2D(slice.map(v => [points[v * 3 + a], points[v * 3 + b]]));
        if (hull.length < 3) continue;
        const ca = hull.reduce((s, q) => s + q[0], 0) / hull.length, cb = hull.reduce((s, q) => s + q[1], 0) / hull.length;
        for (const v of slice) {
          const da = points[v * 3 + a] - ca, db = points[v * 3 + b] - cb, r = Math.hypot(da, db);
          if (r < 1e-6) continue;
          const reach = rayToPolygon(ca, cb, da / r, db / r, hull);
          if (reach > r) { points[v * 3 + a] = ca + da / r * reach; points[v * 3 + b] = cb + db / r * reach; }
        }
      }
    }
  }
}

/** The upper convex chain of 2D points (Andrew's monotone chain), left to right: the outline a stretched cover takes. */
function outerChain(list) {
  const p = list.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), upper = [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (const q of p) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) >= 0) upper.pop(); upper.push(q); }
  return upper;
}

/**
 * Give a cut garment its own silhouette instead of the body's. In cylindrical coordinates round each
 * limb (t along it, θ round it), a trouser leg runs in straight lines from the thigh to the knee and
 * from the knee to the hem (Müller & Sohn: the knee and hem half-widths joined by straight lines, the
 * side seam and inseam straight from the knee up to the hip), and a sleeve from the biceps to the cuff:
 * no point is let in nearer the axis than those lines, so the cloth bridges the knee, the calf and the
 * elbow instead of tracing them. On the torso, below the bust and the shoulder blades, the radius round
 * the vertical axis does not shrink going down: the fabric falls from them, as much as the ease allows
 * (a tight tank top still follows the waist). Everything is per angle bin, smoothed round the limb.
 */
function hangSilhouette(points, panel, garment, layout, positions, { tuck = -Infinity, blocked = () => false } = {}) {
  const count = points.length / 3, k = layout.k, BINS = 32, origin = v => panel.origins[v];
  const binOf = angle => ((Math.round(angle / (Math.PI * 2) * BINS) % BINS) + BINS) % BINS;
  const blurBins = values => { let out = values; for (let pass = 0; pass < 2; pass++) out = out.map((r, i) => Math.max(r, (out[(i + BINS - 1) % BINS] + 2 * r + out[(i + 1) % BINS]) / 4)); return out; };
  // A limb: points of one side whose skin belongs to it, measured along the chain from its top joint.
  const limb = (chain, side, weightOf, knots, inner) => {
    const A = chain.A, u = chain.C.clone().sub(A).normalize(), e1 = new Vector3(1, 0, 0).addScaledVector(u, -u.x).normalize(), e2 = u.clone().cross(e1);
    const members = [];
    for (let v = 0; v < count; v++) {
      const o = origin(v);
      if (o < 0 || weightOf(o) < 0.5 || Math.sign(positions[o * 3]) !== (side === 'l' ? 1 : -1)) continue;
      const d = new Vector3(points[v * 3] - A.x, points[v * 3 + 1] - A.y, points[v * 3 + 2] - A.z), t = d.dot(u);
      d.addScaledVector(u, -t);
      members.push({ v, t, r: d.length(), bin: binOf(Math.atan2(d.dot(e2), d.dot(e1))), d });
    }
    if (members.length < 20) return;
    const top = Math.min(...members.map(m => m.t)), end = Math.max(...members.map(m => m.t));
    // The knots' radius per angle: the widest the limb is around each knot (never inside the body).
    const widest = (from, to) => blurBins(Array.from({ length: BINS }, (_, b) => Math.max(0, ...members.filter(m => m.bin === b && m.t >= from && m.t <= to).map(m => m.r))));
    const at = knots(top, end).map(({ t, from, to, scale = 1 }) => ({ t, r: widest(from, to).map(r => r * scale) }));
    for (const m of members) {
      if (m.t <= at[0].t) continue;
      let i = 0;
      while (i + 2 < at.length && m.t > at[i + 1].t) i++;
      const a = at[i], b = at[i + 1], s = Math.min(1, (m.t - a.t) / Math.max(1e-6, b.t - a.t)), line = a.r[m.bin] + (b.r[m.bin] - a.r[m.bin]) * s;
      if (line <= m.r || m.r < 1e-6) continue;
      const scale = line / m.r, o = m.v * 3;
      const target = [A.x + u.x * m.t + m.d.x * scale, A.y + u.y * m.t + m.d.y * scale, A.z + u.z * m.t + m.d.z * scale];
      // The two trouser legs meet at the crotch, they do not cross it.
      if (inner && target[0] * (side === 'l' ? 1 : -1) < 0.003 * k) target[0] = (side === 'l' ? 1 : -1) * Math.max(0.003 * k, Math.abs(points[o]));
      points[o] = target[0]; points[o + 1] = target[1]; points[o + 2] = target[2];
    }
  };
  const legs = garment.type === 'pants' || garment.type === 'shorts', sleeves = ['tshirt', 'longsleeve', 'hoodie', 'dress'].includes(garment.type) && garment.sleeve > 0.05;
  for (const side of ['l', 'r']) {
    if (legs) {
      const c = layout.legs[side], knee = c.l1, taper = 0.9 + 0.1 * smooth(garment.fit / 0.6);
      limb(c, side, o => layout.legW[o], (top, end) => {
        const thigh = top + 0.06 * k;
        if (end <= knee + 0.04 * k) return [{ t: thigh, from: top, to: thigh + 0.03 * k }, { t: end, from: thigh, to: end }];
        return [{ t: thigh, from: top, to: thigh + 0.03 * k }, { t: knee, from: knee - 0.06 * k, to: end }, { t: end, from: knee - 0.06 * k, to: end, scale: taper }];
      }, true);
    }
    if (sleeves) {
      const c = layout.arms[side];
      limb(c, side, o => layout.armW[o], (top, end) => {
        // Sleeve drafting: the biceps width and the cuff width joined by a straight line; the cuff is
        // its own width (the wrist and its ease, an elastic cuff hugging it), never the forearm's.
        const biceps = top + 0.35 * (c.l1 - top);
        return [{ t: biceps, from: top, to: biceps + 0.03 * k }, { t: end, from: end - 0.04 * k, to: end }];
      }, false);
    }
  }
  // Above the crotch a trouser is one tube stretched round the hips: each horizontal section is its
  // convex hull (fabric spans the creases between the thighs and the bulge, front and back), from 1.5 cm
  // above the lowest point of the crotch, where the section is still one loop, up to the waistband.
  if (legs) {
    let crotch = Infinity, waist = -Infinity;
    for (let v = 0; v < count; v++) {
      if (origin(v) < 0) continue;
      if (Math.abs(points[v * 3]) < 0.01 * k) crotch = Math.min(crotch, points[v * 3 + 1]);
      waist = Math.max(waist, points[v * 3 + 1]);
    }
    if (Number.isFinite(crotch)) for (let y0 = crotch + 0.015 * k; y0 < waist; y0 += 0.01 * k) {
      const band = [];
      for (let v = 0; v < count; v++) if (origin(v) >= 0 && points[v * 3 + 1] >= y0 && points[v * 3 + 1] < y0 + 0.01 * k) band.push(v);
      if (band.length < 6) continue;
      // Front and back separately, and only in depth: each point comes out to the convex outline of its
      // side (z against x), so nothing slides sideways and neighbours never cross.
      const cz = band.reduce((s, v) => s + points[v * 3 + 2], 0) / band.length;
      for (const sign of [1, -1]) {
        const side = band.filter(v => (points[v * 3 + 2] - cz) * sign > 0);
        if (side.length < 3) continue;
        const chain = outerChain(side.map(v => [points[v * 3], (points[v * 3 + 2] - cz) * sign]));
        for (const v of side) {
          const x = points[v * 3], i = chain.findIndex((q, j) => j + 1 < chain.length && x >= q[0] && x <= chain[j + 1][0]);
          if (i < 0) continue;
          const [ax, az] = chain[i], [bx, bz] = chain[i + 1], reach = az + (bz - az) * (x - ax) / Math.max(1e-9, bx - ax);
          if (reach > (points[v * 3 + 2] - cz) * sign) points[v * 3 + 2] = cz + reach * sign;
        }
      }
    }
  }
  // The body of a top hangs from the bust and the shoulder blades.
  if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'dress'].includes(garment.type)) {
    const hang = smooth((garment.fit - 0.05) / 0.3), bustY = Math.max(layout.bust.l?.y ?? layout.chestY, layout.bust.r?.y ?? layout.chestY);
    if (hang <= 0) return;
    const torso = [];
    for (let v = 0; v < count; v++) {
      const o = origin(v);
      // Everything of the top that is not sleeve (the sleeves are the arm-weighted half), down to the
      // hem over the hips: leaving the leg-weighted hem out left it tight under a hanging body, a ledge.
      if (o >= 0 && (layout.armW[o] < 0.5 || !sleeves) && layout.headW[o] < 0.3 && points[v * 3 + 1] < bustY) torso.push(v);
    }
    if (torso.length < 20) return;
    let cz = 0;
    for (const v of torso) cz += points[v * 3 + 2];
    cz /= torso.length;
    torso.sort((a, b) => points[b * 3 + 1] - points[a * 3 + 1]);
    // Tucked in: the fabric is held at both ends, so between the bust and the waistband it runs in a
    // straight line from one to the other (per angle), never in nearer than that line.
    if (Number.isFinite(tuck)) {
      const ring = (from, to) => { const r = new Float32Array(BINS); for (const v of torso) { const y = points[v * 3 + 1]; if (y < from || y > to) continue; const x = points[v * 3], z = points[v * 3 + 2] - cz, b = binOf(Math.atan2(x, z)); r[b] = Math.max(r[b], Math.hypot(x, z)); } return blurBins(Array.from(r)); };
      const topY = points[torso[0] * 3 + 1], high = ring(topY - 0.02 * k, topY), low = ring(tuck - 0.01 * k, tuck + 0.01 * k);
      for (const v of torso) {
        const y = points[v * 3 + 1];
        if (y <= tuck || y >= topY) continue;
        const x = points[v * 3], z = points[v * 3 + 2] - cz, r = Math.hypot(x, z), b = binOf(Math.atan2(x, z)), s = (topY - y) / (topY - tuck);
        const want = r + Math.max(0, high[b] + (low[b] - high[b]) * s - r) * hang;
        if (r > 1e-6 && want > r && !blocked(x * want / r, y, cz + z * want / r)) { points[v * 3] = x * want / r; points[v * 3 + 2] = cz + z * want / r; }
      }
      return;
    }
    const reach = new Float32Array(BINS);
    for (let i = 0; i < torso.length;) {
      // One horizontal band (1.5 cm) at a time, top to bottom: each bin keeps the widest seen above it.
      const y0 = points[torso[i] * 3 + 1], band = [];
      while (i < torso.length && points[torso[i] * 3 + 1] > y0 - 0.015 * k) band.push(torso[i++]);
      const here = new Float32Array(BINS);
      for (const v of band) { const x = points[v * 3], z = points[v * 3 + 2] - cz, b = binOf(Math.atan2(x, z)); here[b] = Math.max(here[b], Math.hypot(x, z)); }
      const smoothReach = blurBins(Array.from(reach));
      for (const v of band) {
        const x = points[v * 3], y = points[v * 3 + 1], z = points[v * 3 + 2] - cz, r = Math.hypot(x, z), b = binOf(Math.atan2(x, z));
        const want = r + Math.max(0, smoothReach[b] - r) * hang;
        if (r > 1e-6 && want > r && !blocked(x * want / r, y, cz + z * want / r)) { points[v * 3] = x * want / r; points[v * 3 + 2] = cz + z * want / r; }
      }
      for (let b = 0; b < BINS; b++) reach[b] = Math.max(reach[b], here[b]);
    }
  }
}

/**
 * Close the seams of a sewn garment for good: the stitched points of each seam group (paired one
 * to one by the stitch flattening in pattern-cloth.mjs) become one vertex, with one position and
 * one set of skin weights, so the seam cannot open in any pose and is shaded smoothly across.
 * Triangles that collapse (a dart's tip) are dropped. Returns the new index.
 */
function weldSeams(panel, points) {
  const representative = Int32Array.from({ length: points.length / 3 }, (_, v) => v);
  for (const group of panel.seamGroups ?? []) {
    const r = group[0], total = new Map();
    for (let c = 0; c < 3; c++) points[r * 3 + c] = group.reduce((s, v) => s + points[v * 3 + c], 0) / group.length;
    for (const v of group) for (let j = 0; j < 4; j++) { const w = panel.weights[v * 4 + j]; if (w > 0) total.set(panel.joints[v * 4 + j], (total.get(panel.joints[v * 4 + j]) ?? 0) + w); }
    const top = [...total].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    for (const v of group) {
      representative[v] = r;
      for (let c = 0; c < 3; c++) points[v * 3 + c] = points[r * 3 + c];
      for (let j = 0; j < 4; j++) { panel.joints[v * 4 + j] = top[j]?.[0] ?? 0; panel.weights[v * 4 + j] = (top[j]?.[1] ?? 0) / sum; }
    }
  }
  const index = [];
  for (let i = 0; i < panel.index.length; i += 3) {
    const a = representative[panel.index[i]], b = representative[panel.index[i + 1]], c = representative[panel.index[i + 2]];
    if (a !== b && b !== c && a !== c) index.push(a, b, c);
  }
  return index;
}

/**
 * Smooth the open edges of a draped garment (neckline, hem, cuffs) along their own curve with
 * Taubin λ|μ steps, which removes the zigzag left by the particles without shrinking the opening.
 */
function smoothRims(points, index, passes) {
  const uses = new Map(), rim = new Map();
  for (let i = 0; i < index.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = index[i + e], b = index[i + (e + 1) % 3], key = a < b ? a * 4194304 + b : b * 4194304 + a;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  for (const [key, used] of uses) if (used === 1) {
    const a = Math.floor(key / 4194304), b = key % 4194304;
    (rim.get(a) ?? rim.set(a, []).get(a)).push(b); (rim.get(b) ?? rim.set(b, []).get(b)).push(a);
  }
  const chain = [...rim].filter(([, list]) => list.length === 2);
  for (let pass = 0; pass < passes * 2; pass++) {
    const factor = pass % 2 ? -0.53 : 0.5, moved = chain.map(([v, [a, b]]) => [0, 1, 2].map(c => factor * ((points[a * 3 + c] + points[b * 3 + c]) / 2 - points[v * 3 + c])));
    chain.forEach(([v], i) => { for (let c = 0; c < 3; c++) points[v * 3 + c] += moved[i][c]; });
  }
}

/**
 * Keep a garment `thickness` outside every layer already dressed (garments and shoes, normals
 * turned away from the skin): each point is tested against the closest point of each layer that
 * faces the same way (so a seam or an armpit of the layer beneath never pushes it sideways) and
 * moved out along that layer's normal; the corrections spread over neighbours so the cloth lifts
 * smoothly, and the test repeats until nothing is behind.
 */
function keepOutside(points, index, normals, layers, thickness, k) {
  if (!layers.length) return;
  const count = points.length / 3, hit = {}, facing = [0, 0, 0], neighbours = Array.from({ length: count }, () => []);
  for (let i = 0; i < index.length; i += 3) for (let e = 0; e < 3; e++) { const a = index[i + e], b = index[i + (e + 1) % 3]; neighbours[a].push(b); neighbours[b].push(a); }
  for (let pass = 0; pass < 4; pass++) {
    const push = new Float32Array(count * 3);
    let moved = 0;
    for (let v = 0; v < count; v++) {
      if (!neighbours[v].length) continue;
      facing[0] = normals[v * 3]; facing[1] = normals[v * 3 + 1]; facing[2] = normals[v * 3 + 2];
      let need = 0;
      for (const layer of layers) {
        if (!layer.closest(points[v * 3], points[v * 3 + 1], points[v * 3 + 2], 0.03 * k, hit, facing)) continue;
        const short = thickness - hit.distance;
        if (short <= need || hit.distance < -0.025 * k) continue;
        need = short; push[v * 3] = hit.nx * short; push[v * 3 + 1] = hit.ny * short; push[v * 3 + 2] = hit.nz * short;
      }
      if (need > 0) moved++;
    }
    if (!moved) return;
    for (let spread = 0; spread < 2; spread++) {
      const next = push.slice();
      for (let v = 0; v < count; v++) {
        const list = neighbours[v];
        if (!list.length) continue;
        let x = 0, y = 0, z = 0;
        for (const u of list) { x += push[u * 3]; y += push[u * 3 + 1]; z += push[u * 3 + 2]; }
        x /= list.length * 2; y /= list.length * 2; z /= list.length * 2;
        if (x * x + y * y + z * z > next[v * 3] ** 2 + next[v * 3 + 1] ** 2 + next[v * 3 + 2] ** 2) { next[v * 3] = x; next[v * 3 + 1] = y; next[v * 3 + 2] = z; }
      }
      push.set(next);
    }
    for (let i = 0; i < points.length; i++) points[i] += push[i];
  }
}

/** Fold every open edge under by `depth` so cut fabric shows a hem, not a paper edge. */
function addHems(panel, depth) {
  const count = panel.pos.length / 3, edges = new Map();
  const maxThickness = panel.materials ? panel.materials.reduce((max,m)=>Math.max(max,m.thickness),0.001) : 1;
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
    const localDepth = panel.materials ? depth * panel.materials[v].thickness / maxThickness : depth;
    for (let c = 0; c < 3; c++) panel.pos.push(panel.pos[v * 3 + c] - panel.normal[v * 3 + c] * localDepth);
    panel.normal.push(-panel.normal[v * 3], -panel.normal[v * 3 + 1], -panel.normal[v * 3 + 2]);
    panel.uv.push(panel.uv[v * 2], panel.uv[v * 2 + 1]);
    panel.joints.push(...panel.joints.slice(v * 4, v * 4 + 4)); panel.weights.push(...panel.weights.slice(v * 4, v * 4 + 4));
    panel.keys.push(-1); panel.origins.push(panel.origins[v]);
    if (panel.materials) panel.materials.push(panel.materials[v]);
    if (panel.pieceOf) panel.pieceOf.push(panel.pieceOf[v]);
    if (panel.sources) panel.sources.push(null);
    folded.set(v, at);
    return at;
  };
  for (const { a, b, count: used } of edges.values()) {
    if (used !== 1 || a >= count || b >= count) continue;
    if (panel.sewnBoundaryEdges?.has(a<b?`${a}:${b}`:`${b}:${a}`)) continue;
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
  const meshData = { pos: [], color: [], uv: [], joints: [], weights: [], index: [], keys: [], garment: [], piece: [], sources: [] };
  const covered = new Set(), finished = [];
  garments.forEach((garment, layer) => {
    // Inner parts first: a dress's bodice is draped before its skirt, which
    // then hangs over the bodice's hem (sewn at the waist), not under it.
    const panels = [];
    const authored=garment.authoringMode!=='surface'&&garment.patternData?.panels.length;
    if (authored) panels.push(buildPatternPanels(context, garment, layout, layer, skin));
    else if (garment.type !== 'skirt' && !accessoryOnly.has(garment.type)) {
      // Shoes are cut from the last (shoeLast), not from the toes.
      const { panel, covered: faces } = cutPanel(footwearTypes.includes(garment.type) ? { ...context, positions: shoeLast(context).positions } : context, garment, layout, layer);
      panel.uvScale = layout.uvScale;
      if (panel.index.length) panels.push(panel);
      // Skin under a see-through net (tulle) stays.
      if (!fabrics[garment.fabric].net) for (const f of faces) covered.add(f);
    }
    if (!authored && (garment.type === 'skirt' || garment.type === 'dress')) panels.push(skirtPanel(context, garment, layout, layer));
    for (const panel of panels) {
      // Start just above the surface beneath, then drape.
      const lift = (0.0035 + layer * 0.0035) * k;
      for (let v = 0; v < panel.pos.length / 3; v++) for (let c = 0; c < 3; c++) panel.pos[v * 3 + c] += panel.normal[v * 3 + c] * lift;
      const points = Float32Array.from(panel.pos);
      // Every piece rests on the skin raised by what is already dressed (layer order), not on the
      // nearest point of the thin garments beneath (pattern-cloth.mjs layeredCollider): a shirt
      // under a coat keeps the coat outside it everywhere.
      // A cut piece rests on the drafting skin (no nipples, navel or ribs to trace, see draftSkin).
      const shell = !panel.pattern && !panel.skirt;
      const drafting = shell ? new SurfaceCollider(collider.cell) : collider;
      if (shell) drafting.layers.push(footwearTypes.includes(garment.type) ? shoeLast(context).skin : draftSkin(context), ...collider.layers.slice(1));
      const beneath = layeredCollider(drafting, k);
      // A cut piece starts on the drafting skin (smoothed), not on the skin itself: started on the
      // skin, the dense patch of a nipple stayed a point through the shell's steps.
      if (shell && !footwearTypes.includes(garment.type)) {
        const draft = drafting.layers[0], near = {};
        for (let v = 0; v < points.length / 3; v++) {
          if (!draft.closest(points[v * 3], points[v * 3 + 1], points[v * 3 + 2], 0.03 * k, near, [panel.normal[v * 3], panel.normal[v * 3 + 1], panel.normal[v * 3 + 2]])) continue;
          points[v * 3] = near.x + near.nx * lift; points[v * 3 + 1] = near.y + near.ny * lift; points[v * 3 + 2] = near.z + near.nz * lift;
        }
      }
      // Ease: a garment is bigger than the body (wearing ease, plus design ease for looser
      // styles). The cut is drafted into a shell that spans the body's hollows and keeps the ease
      // from it (fitShell). Gravity rests a garment on what faces up (shoulders, the top of the
      // hips), so there the ease is a third; it hangs away from the sides and from under the bust.
      // Elastic bands (waistbands, cuffs) grip with a quarter of it.
      if (shell) {
        // A shoe is stiff: it spans the gaps between the toes and the hollow of the arch, and stands
        // a few millimetres off the foot (more smoothing, more base).
        const shoe = footwearTypes.includes(garment.type) && garment.type !== 'sandals';
        const base = 0.004 * k, room = garment.fit * 0.038 * k + (shoe ? 0.006 * k : 0);
        fitShell(points, panel.index, panel.normal, beneath, {
          base, iterations: shoe ? 0 : Math.round(18 + garment.fit * 22), settle: shoe ? 8 : Math.round(4 + garment.fit * 26), snapping: !shoe,
          // A sleeve has about half the ease of the body it is sewn to (a loose sweater: some 20 cm
          // more round the chest, 10 cm more round the arm).
          room: v => room * (panel.elastic?.[v] ? 0.25 : 1) * (1 - 0.65 * smooth((panel.normal[v * 3 + 1] - 0.25) / 0.6)) * (1 - 0.5 * (layout.armW[panel.origins[v]] ?? 0)),
        });
        // Its own silhouette: straight legs and sleeves, a body that falls from the bust.
        if (!shoe) {
          // A top under trousers or a skirt (dressed after it) is tucked in at their waistband.
          const outer = garments.slice(layer + 1).find(g => ['pants', 'shorts', 'skirt'].includes(g.type) && !(g.authoringMode !== 'surface' && g.patternData?.panels.length));
          const tuck = outer ? layout.hipY + (layout.waistY - layout.hipY) * (0.35 + outer.rise * 0.9) : -Infinity;
          // The sides of a top never fall into the arms beside them (in the A pose the upper arm hangs
          // along the ribs): a point is not moved where it would come within 8 mm of the arm's skin.
          const regions = regionColliders(context), armSkin = [regions.arm_l, regions.arm_r], near = {};
          const blocked = (x, y, z) => armSkin.some(arm => arm.closest(x, y, z, 0.02 * k, near) && near.distance < 0.008 * k);
          hangSilhouette(points, panel, garment, layout, context.positions, { tuck, blocked });
          // Moved per angle bin, the open edges (hem, cuffs) are smoothed along their own curve too.
          taubinSmooth(points, panel.index, 4);
          smoothRims(points, panel.index, 4);
        }
      }
      // A shoe stands on a flat sole: the part of the shell under the foot (below 4 mm) goes down
      // to one plane 1.2 cm under the sole of the foot (above the studio floor), so the sole has its
      // thickness and a crisp edge. Only what is under the foot moves: lowering the toe caps sank
      // them into the toes, and pushing them out again crumpled the front.
      // The sole juts out a few millimetres round the foot (its horizontal normal), as soles do.
      if (shell && footwearTypes.includes(garment.type)) {
        for (let v = 0; v < points.length / 3; v++) {
          if (points[v * 3 + 1] >= 0.004 * k) continue;
          const nx = panel.normal[v * 3], nz = panel.normal[v * 3 + 2], side = Math.hypot(nx, nz);
          points[v * 3 + 1] = -0.012 * k;
          if (side > 0.2) { points[v * 3] += nx / side * 0.005 * k; points[v * 3 + 2] += nz / side * 0.005 * k; }
        }
        // Trainers and boots are lasted: convex across the foot, the toes and the instep spanned.
        // Many points land on one edge of a slice's outline: Taubin steps (no shrinking) even them out.
        if (garment.type !== 'sandals') { lastShoe(points, k, layout.legs.l.C.y); taubinSmooth(points, panel.index, 12); smoothRims(points, panel.index, 3); }
      }
      const pattern = panel.pattern ? Float32Array.from(panel.rest) : points.slice();
      resolvePenetration(points, panel.index, beneath, { thickness: 0.004 * k, depth: 0.03 * k, smoothing: 6, normals: panel.normal });
      // A cut piece's shell already rests at its ease (the hollows spanned, the ease hanging from
      // what faces up): gravity has nothing left to settle. Dropping it again let the neckline fall
      // into the neck between contacts (a sawtooth edge with skin showing). Tubes (skirts) and sewn
      // pattern pieces start away from their rest and are draped.
      if (!shell) drapeCloth(points, panel.index, beneath, {
        thickness: 0.004 * k, slack: 0.995 + garment.fit * 0.02, frames: 40, substeps: 5, friction: 0.9, radius: 0.05 * k,
        bendCompliance: 3e-6, elastic: panel.elastic, normals: panel.normal, rest: pattern, pinned: panel.pinned,
        ...(panel.pattern ? {frames:30, thickness:panel.thickness, seams:panel.seams, selfCollision:true, iterations:3, particleCompliance:panel.particleCompliance, particleSlack:panel.particleSlack, particleThickness:panel.particleThickness, slack:0.97+garment.fit*0.08} : {}),
      });
      // Sculpted cloth edits apply after draping.
      if (sculptOffsets) panel.keys.forEach((key, v) => {
        const d = key >= 0 && sculptOffsets[key];
        if (d) { points[v * 3] += d[0] * height; points[v * 3 + 1] += d[1] * height; points[v * 3 + 2] += d[2] * height; }
      });
      if (panel.pattern) for (let v=0;v<panel.sources.length;v++) {
        const source=panel.sources[v];
        for (const edit of garment.patternData.edits??[]) {
          if (edit.panel!==source.panel) continue;
          const distance=Math.hypot(source.uv[0]-edit.center[0],source.uv[1]-edit.center[1]);
          if (distance>=edit.radius) continue;
          const influence=(1-distance/edit.radius)**2;
          for (let c=0;c<3;c++)points[v*3+c]+=edit.delta[c]*height*influence;
        }
      }
      // Sewn pieces: the seams are welded shut, then the open edges are smoothed.
      if (panel.pattern) { panel.index = weldSeams(panel, points); smoothRims(points, panel.index, 4); }
      // Exact final pass: nothing may end inside the skin or a lower layer.
      if (panel.pattern) {
        let start=0;
        while(start<points.length/3) {
          let end=start+1;
          while(end<points.length/3&&panel.materials[end]===panel.materials[start])end++;
          resolvePenetration(points.subarray(start*3,end*3),null,beneath,{thickness:panel.particleThickness[start],depth:0.03*k,smoothing:0,normals:panel.normal.slice(start*3,end*3)});
          start=end;
        }
        projectPanelContacts(points,panel,beneath,k);
      } else resolvePenetration(points, panel.index, beneath, { thickness: 0.0035 * k, depth: 0.03 * k, smoothing: 2, normals: panel.normal });
      // Layer order, checked on the garments themselves: the skin raised by them is an estimate,
      // and an inner shirt showed through an outer one in patches where it was off.
      keepOutside(points, panel.index, panel.normal, collider.layers.slice(1), panel.pattern ? panel.thickness : 0.004 * k, k);
      // Weights: a panel cut from the body keeps the weights of the skin it was
      // cut from (topology mapping, like MakeHuman proxies weighted by their
      // reference vertices), so it deforms with that skin and every layer cut
      // from the same skin deforms alike. Pattern panels have no such
      // correspondence: skirt pieces hang from the pelvis and thighs like the
      // skirt tube, the others take the nearest skin of their own region.
      if (panel.pattern) {
        const regions = regionColliders(context), pieces = garment.patternData.panels;
        const skirt = new Map();
        panel.pieceOf.forEach((piece, v) => {
          if (pieces[piece]?.placement.region !== 'skirt') return;
          const range = skirt.get(piece) ?? { top: -Infinity, hem: Infinity, rx: 1e-3, vertices: [] };
          range.top = Math.max(range.top, points[v * 3 + 1]); range.hem = Math.min(range.hem, points[v * 3 + 1]); range.rx = Math.max(range.rx, Math.abs(points[v * 3]));
          range.vertices.push(v); skirt.set(piece, range);
        });
        const names = context.data.skeleton.bones.map(bone => bone.name), pelvis = names.indexOf('pelvis'), thighL = names.indexOf('thigh_l'), thighR = names.indexOf('thigh_r');
        for (const { top, hem, rx, vertices } of skirt.values()) for (const v of vertices) {
          const s = smooth((top - points[v * 3 + 1]) / Math.max(1e-3, top - hem)), legs = 0.75 * s, side = smooth((points[v * 3] / rx + 1) / 2);
          panel.joints.splice(v * 4, 4, pelvis, thighL, thighR, 0); panel.weights.splice(v * 4, 4, 1 - legs, legs * side, legs * (1 - side), 0);
        }
        transferWeights(context, points, panel, v => {
          const placement = pieces[panel.pieceOf[v]]?.placement;
          return !placement || placement.region === 'skirt' ? [] : [regions[placementRegion(placement)], skin];
        });
      }
      panel.pos = Array.from(points);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3)); geometry.setIndex(panel.index); geometry.computeVertexNormals();
      panel.normal = Array.from(geometry.getAttribute('normal').array);
      if(panel.pattern&&!fabrics[garment.fabric].net)for(const face of coveredPatternFaces(context,panel,points,geometry.attributes.normal.array,skin,layout))covered.add(face);
      // Normals turned away from the skin, so "outside" this garment means away from the body.
      collider.add(points, geometry.getAttribute('normal').array, panel.index, { orient: true });
      geometry.dispose();
      addHems(panel, panel.pattern ? panel.thickness * 0.4 : 0.0016 * k);
      finished.push({ panel, garment, layer });
    }
  });
  // Parts of an inner layer fully covered by an outer one are tucked in, so
  // they are removed like covered skin: never visible, and nothing can show
  // through. A skirt or dress tube covers what lies between its band and hem.
  const outerCovers = (layer, v) => garments.some((outer, j) => {
    if (j <= layer || v < 0) return false;
    if (outer.authoringMode!=='surface'&&outer.patternData?.panels.length) return false;
    const y = context.positions[v * 3 + 1];
    if (outer.type === 'skirt' || outer.type === 'dress') {
      const tube = finished.find(item => item.layer === j && item.panel.skirt)?.panel.skirt;
      if (tube && y < tube.top - 0.03 * k && y > tube.hem + 0.04 * k) return true;
      if (outer.type === 'skirt') return false;
    }
    return coverage(outer, v, layout, context.positions) >= 0.03 * k;
  });
  // Index range of every finished panel, drawn with its garment's roughness.
  const ranges = [];
  for (const { panel, garment, layer } of finished) {
    // Sewn pieces too, by the skin point each cloth point was placed over: a shirt under trousers is tucked in.
    const hidden = panel.origins.map(v => outerCovers(layer, v));
    const offset = meshData.pos.length / 3;
    ranges.push({ start: meshData.index.length, key: `${garment.fabric}|${garment.roughness}`, fabric: garment.fabric, roughness: garment.roughness });
    for (let v = 0; v < panel.pos.length / 3; v++) {
      const p = new Vector3(panel.pos[v * 3], panel.pos[v * 3 + 1], panel.pos[v * 3 + 2]);
      const pieceMaterial = panel.materials?.[v] ?? panel.materials?.[panel.origins[v]];
      // Shoes: the sole (the points brought down to its plane) in the second colour; its wall shades
      // from one colour to the other.
      const color = footwearTypes.includes(garment.type) && p.y < -0.006 * k ? new Color(garment.color2) : patternColor(pieceMaterial ? {...garment,...pieceMaterial} : garment, p, k);
      meshData.pos.push(p.x, p.y, p.z); meshData.color.push(color.r, color.g, color.b);
    }
    for (const key of ['joints','weights','keys']) for (const value of panel[key]) meshData[key].push(value);
    // UVs in metres (pattern pieces already are; cut pieces carry the body's map, scaled), so a
    // fabric's texture has the same size on every piece.
    for (const value of panel.uv) meshData.uv.push(value * (panel.uvScale ?? 1));
    for (let v = 0; v < panel.pos.length / 3; v++) meshData.garment.push(layer);
    for (let v = 0; v < panel.pos.length / 3; v++) meshData.piece.push(panel.pieceOf?.[v] ?? -1);
    for (let v = 0; v < panel.pos.length / 3; v++) meshData.sources.push(panel.sources?.[v] ?? null);
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
  geometry.userData.pieceOf = Int16Array.from(meshData.piece);
  geometry.userData.patternSources = meshData.sources;
  // One material per distinct fabric and roughness, and one group per material (a glTF primitive
  // each, so an outfit costs as many draw calls as it has fabrics, not pieces): the triangles of
  // every panel in the same fabric are put together. The fabric's textures are drawn on the page
  // (fabrics.mjs applyFabricTextures, from userData).
  const keys = [...new Set(ranges.map(range => range.key))], sorted = [];
  for (const key of keys) {
    const start = sorted.length;
    ranges.forEach((range, i) => { if (range.key === key) for (let t = range.start, end = ranges[i + 1]?.start ?? meshData.index.length; t < end; t++) sorted.push(meshData.index[t]); });
    if (sorted.length > start) geometry.addGroup(start, sorted.length - start, keys.indexOf(key));
  }
  geometry.setIndex(sorted);
  const materials = keys.map(key => {
    const { fabric, roughness } = ranges.find(range => range.key === key);
    const material = new MeshPhysicalMaterial({ vertexColors: true, side: DoubleSide, ...fabricMaterialParameters(fabric, roughness) });
    material.name = `Tecido_${fabric}`;
    material.userData.hgsFabric = { fabric };
    return material;
  });
  const mesh = new SkinnedMesh(geometry, materials);
  mesh.name = 'Outfit';
  mesh.userData.style = 'tailor';
  mesh.userData.tailor = true;
  mesh.userData.patterns = garments.map(g => g.patternData ?? null);
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

/**
 * The skin a cut garment's shell is drafted on: the body with features under a couple of
 * centimetres (nipples, navel, ribs, collarbone hollows) removed by Taubin λ|μ smoothing, which
 * keeps the breasts, buttocks and limbs at their size. Fabric over such a feature stretches flat
 * (or presses it), so the shell must not trace it. Cached per body.
 */
function draftSkin(context) {
  if (context.tailorDraftSkin) return context.tailorDraftSkin;
  const { data, positions } = context, layout = bodyLayout(context), index = [];
  for (const face of layout.faces) {
    const [a, b, c, d] = [0, 1, 2, 3].map(k => data.faces[face * 4 + k]);
    index.push(a, b, c, a, c, d);
  }
  // Taubin's λ|μ filter is a low-pass: more passes remove smaller features. 40 take out what fabric
  // cannot follow (the nipples, ~1.5 cm, the ribs) and keep the bust and the muscles, much larger.
  const smoothed = Float32Array.from(positions);
  taubinSmooth(smoothed, index, 40);
  context.tailorDraftSkin = new SurfaceCollider(0.012 * layout.k).add(smoothed, layout.normals, index).layers[0];
  return context.tailorDraftSkin;
}

/**
 * The last a shoe is made on: the body with each foot below the ankle smoothed hard (Taubin λ|μ,
 * 60 passes over the foot's faces only, its edge at the ankle held), so the toes and the gaps
 * between them become one rounded front and the arch one smooth curve, at the foot's size. Shoes
 * are cut from it and rest on it. Returns the positions and their surface; cached per body.
 */
function shoeLast(context) {
  if (context.tailorShoeLast) return context.tailorShoeLast;
  const { data, positions } = context, layout = bodyLayout(context), index = [], footIndex = [];
  const foot = v => {
    if (layout.legW[v] < 0.5) return false;
    const chain = layout.legs[positions[v * 3] >= 0 ? 'l' : 'r'];
    return layout.leg[v] > chain.l1 + chain.l2 - 0.02 * layout.k;
  };
  for (const face of layout.faces) {
    const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
    index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    if (ids.every(foot)) footIndex.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  const smoothed = Float32Array.from(positions), count = positions.length / 3;
  // First the hollows are filled (a Laplacian step along the normal, outwards only: the gaps
  // between the toes and the arch rise to the surface around them, nothing shrinks), then
  // Taubin λ|μ steps round off the toe tips.
  const neighbours = Array.from({ length: count }, () => new Set()), rim = new Uint8Array(count), uses = new Map();
  for (let i = 0; i < footIndex.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = footIndex[i + e], b = footIndex[i + (e + 1) % 3], key = a < b ? a * 4194304 + b : b * 4194304 + a;
    neighbours[a].add(b); neighbours[b].add(a); uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  for (const [key, used] of uses) if (used === 1) { rim[Math.floor(key / 4194304)] = 1; rim[key % 4194304] = 1; }
  const normal = new Float32Array(count * 3);
  for (let iteration = 0; iteration < 200; iteration++) {
    normal.fill(0);
    for (let i = 0; i < footIndex.length; i += 3) {
      const a = footIndex[i] * 3, b = footIndex[i + 1] * 3, c = footIndex[i + 2] * 3;
      const ux = smoothed[b] - smoothed[a], uy = smoothed[b + 1] - smoothed[a + 1], uz = smoothed[b + 2] - smoothed[a + 2];
      const vx = smoothed[c] - smoothed[a], vy = smoothed[c + 1] - smoothed[a + 1], vz = smoothed[c + 2] - smoothed[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { normal[o] += nx; normal[o + 1] += ny; normal[o + 2] += nz; }
    }
    const next = smoothed.slice();
    for (let v = 0; v < count; v++) {
      if (rim[v] || !neighbours[v].size) continue;
      let nx = normal[v * 3], ny = normal[v * 3 + 1], nz = normal[v * 3 + 2];
      const length = Math.hypot(nx, ny, nz) || 1, sign = nx * layout.normals[v * 3] + ny * layout.normals[v * 3 + 1] + nz * layout.normals[v * 3 + 2] < 0 ? -1 : 1;
      nx *= sign / length; ny *= sign / length; nz *= sign / length;
      let x = 0, y = 0, z = 0;
      for (const u of neighbours[v]) { x += smoothed[u * 3]; y += smoothed[u * 3 + 1]; z += smoothed[u * 3 + 2]; }
      const n = neighbours[v].size, along = (x / n - smoothed[v * 3]) * nx + (y / n - smoothed[v * 3 + 1]) * ny + (z / n - smoothed[v * 3 + 2]) * nz;
      if (along > 0) { next[v * 3] += 0.5 * along * nx; next[v * 3 + 1] += 0.5 * along * ny; next[v * 3 + 2] += 0.5 * along * nz; }
    }
    smoothed.set(next);
  }
  // The toe box: in each horizontal slice (5 mm) of the forefoot, every point goes out to the
  // slice's convex hull (Andrew's monotone chain), as a shoe's front is one smooth curve round all
  // the toes; then Taubin steps join the slices.
  const footIds = [...new Set(footIndex)];
  for (const side of ['l', 'r']) {
    const chain = layout.legs[side], slices = new Map();
    for (const v of footIds) {
      if ((smoothed[v * 3] >= 0 ? 'l' : 'r') !== side || smoothed[v * 3 + 2] - chain.C.z < 0.04 * layout.k) continue;
      const key = Math.round(smoothed[v * 3 + 1] / (0.005 * layout.k));
      (slices.get(key) ?? slices.set(key, []).get(key)).push(v);
    }
    for (const ids of slices.values()) {
      if (ids.length < 4) continue;
      const pts = ids.map(v => [smoothed[v * 3], smoothed[v * 3 + 2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lower = [], upper = [];
      for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
      for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
      const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
      if (hull.length < 3) continue;
      const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length, cz = hull.reduce((s, p) => s + p[1], 0) / hull.length;
      for (const v of ids) {
        // Out from the hull's centre through the point to the hull's edge (ray–segment intersection).
        const dx = smoothed[v * 3] - cx, dz = smoothed[v * 3 + 2] - cz, length = Math.hypot(dx, dz);
        if (length < 1e-6) continue;
        let reach = length;
        for (let i = 0; i < hull.length; i++) {
          const [ax, az] = hull[i], [bx, bz] = hull[(i + 1) % hull.length], ex = bx - ax, ez = bz - az, d = dx * ez - dz * ex;
          if (Math.abs(d) < 1e-12) continue;
          const t = ((ax - cx) * ez - (az - cz) * ex) / d, u = ((ax - cx) * dz - (az - cz) * dx) / d;
          if (t > 0 && u >= 0 && u <= 1) reach = Math.max(reach, t * length);
        }
        smoothed[v * 3] = cx + dx / length * reach; smoothed[v * 3 + 2] = cz + dz / length * reach;
      }
    }
  }
  taubinSmooth(smoothed, footIndex, 150);
  context.tailorShoeLast = { positions: smoothed, skin: new SurfaceCollider(0.012 * layout.k).add(smoothed, layout.normals, index).layers[0] };
  return context.tailorShoeLast;
}
