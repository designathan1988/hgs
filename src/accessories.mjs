import {
  BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Float32BufferAttribute, Matrix4, MeshPhysicalMaterial, MeshStandardMaterial,
  Shape, ShapeGeometry, SkinnedMesh, SphereGeometry, TorusGeometry, TubeGeometry, Uint16BufferAttribute, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fitProxy, loadProxy } from './proxy.mjs';
import { headFrame } from './scalp.mjs';

/**
 * Glasses, earrings, hats and necklaces. As accessories on a game character are attached to a socket
 * (a point parented to a bone, Unreal's skeletal mesh sockets), each one is built where it sits on
 * this head — the eyes' centres, the ear lobes and tops, the outline of the head and its hair, the
 * base of the neck, all measured on the character — and skinned to the same skeleton: the head bone
 * for what the head carries, the nearest skin's weights for a necklace.
 */

export const accessoryStyles = {
  glasses: { nenhum: 'Nenhum', redondo: 'Redondos', quadrado: 'Quadrados', aviador: 'Aviador' },
  earrings: { nenhum: 'Nenhum', ponto: 'Ponto', argola: 'Argola', pendente: 'Pendente' },
  hat: { nenhum: 'Nenhum', gorro: 'Gorro', bone: 'Boné', chapeu: 'Chapéu' },
  necklace: { nenhum: 'Nenhum', corrente: 'Corrente', pingente: 'Pingente' },
};
export const accessoryNames = { glasses: 'Óculos', earrings: 'Brincos', hat: 'Chapéu', necklace: 'Colar' };
export const metals = { ouro: '#d4af37', prata: '#c9ccd1', rose: '#c98f7a', preto: '#232326' };
export const defaultAccessories = Object.freeze({
  glasses: { style: 'nenhum', color: '#1b1b1d', lens: 'clara' },
  earrings: { style: 'nenhum', metal: 'ouro' },
  hat: { style: 'nenhum', color: '#3a3f4a' },
  necklace: { style: 'nenhum', metal: 'ouro' },
});

const metalMaterial = hex => new MeshPhysicalMaterial({ color: hex, metalness: 1, roughness: 0.28, clearcoat: 0.4 });

/** Skin a geometry wholly to one bone, or per vertex to the nearest skin's weights (`nearest(p)` → [joints, weights]). */
function skinned(geometry, name, context, bone, nearest = null) {
  const count = geometry.getAttribute('position').count, joints = new Uint16Array(count * 4), weights = new Float32Array(count * 4), p = new Vector3();
  for (let i = 0; i < count; i++) {
    if (nearest) { const [j, w] = nearest(p.fromBufferAttribute(geometry.getAttribute('position'), i)); joints.set(j, i * 4); weights.set(w, i * 4); }
    else { joints[i * 4] = bone; weights[i * 4] = 1; }
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  return geometry;
}
function addMesh(context, name, geometries, material) {
  const parts = geometries.filter(Boolean).map(g => { const out = g.index ? g.toNonIndexed() : g; for (const key of Object.keys(out.attributes)) if (!['position', 'normal'].includes(key)) out.deleteAttribute(key); return out; });
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts, false);
  return { geometry, material, name };
}
const tube = (points, radius, closed = false, segments = 64) => new TubeGeometry(new CatmullRomCurve3(points, closed, 'centripetal'), segments, radius, 8, closed);

/** Where things sit on this head. */
function landmarks(context) {
  const { data, positions } = context, frame = headFrame(data, positions), count = positions.length / 3;
  const v3 = v => new Vector3(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
  // The side of the skull: head skin that is not ear, so `skull(sign, y, z)` is how far out the head is there.
  const near = [];
  for (let v = 0; v < count; v++) if (frame.used[v] && !frame.ear[v] && frame.headWeight[v] > 0.5 && Math.abs(positions[v * 3]) > frame.R * 0.3) near.push(v);
  // With `hair`, the outer surface: the skin or the ready-made hair base over it, whichever stands out more.
  const base = context.group?.getObjectByName('HairBase')?.geometry.getAttribute('position');
  const skull = (sign, y, z, first = 0.01, hair = false) => {
    for (const reach of [first, 0.018, 0.03]) {
      let x = 0;
      for (const v of near) if (Math.sign(positions[v * 3]) === sign && Math.abs(positions[v * 3 + 1] - y) < reach && Math.abs(positions[v * 3 + 2] - z) < reach) x = Math.max(x, Math.abs(positions[v * 3]));
      if (hair && base) for (let i = 0; i < base.count; i++) if (Math.sign(base.getX(i)) === sign && Math.abs(base.getY(i) - y) < first && Math.abs(base.getZ(i) - z) < first) x = Math.max(x, Math.abs(base.getX(i)));
      if (x) return x;
    }
    return frame.R * 0.6;
  };
  // Ears: per side, the top, the lobe (where the lobe target moves most) and the outer extent; and the
  // auricle (ear that stands off the skull), its crest and its back edge, where a glasses temple rests.
  const ears = {};
  const morpher = data.morpher;
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    let top = null, outer = 0;
    const auricle = [];
    for (let v = 0; v < count; v++) if (frame.ear[v] && Math.sign(positions[v * 3]) === sign) {
      if (!top || positions[v * 3 + 1] > top.y) top = v3(v);
      outer = Math.max(outer, Math.abs(positions[v * 3]));
      if (Math.abs(positions[v * 3]) > skull(sign, positions[v * 3 + 1], positions[v * 3 + 2]) + 0.004) auricle.push(v3(v));
    }
    let crest = null;
    for (const p of auricle) if (!crest || p.y > crest.y) crest = p;
    // The back edge of the auricle, from its crest down: the rearmost auricle point in each 4 mm band.
    const back = [];
    if (crest) for (let k = 1; k <= 10; k++) {
      const y = crest.y - k * 0.004;
      let edge = null;
      for (const p of auricle) if (Math.abs(p.y - y) < 0.002 && p.z < crest.z + 0.002 && (!edge || p.z < edge.z)) edge = p;
      if (edge) back.push(new Vector3(edge.x, y, edge.z));
    }
    let lobe = null;
    const t = morpher?.localByName?.get(`ears/${side}-ear-lobe-incr`);
    if (t) {
      let best = -1, most = 0;
      for (let e = t.start; e < t.start + t.count; e++) { const d = Math.hypot(morpher.lDelta[e * 3], morpher.lDelta[e * 3 + 1], morpher.lDelta[e * 3 + 2]); if (d > most) { most = d; best = morpher.lIdx[e]; } }
      if (best >= 0) lobe = v3(best);
    }
    ears[side] = { top, lobe, outer, sign, crest, back };
  }
  return { frame, ears, skull };
}

/** Eye centres and sizes from the fitted eyes proxy (as face-groom.mjs measures them). */
async function eyesOf(context) {
  const eyes = fitProxy(await loadProxy('eyes'), context.positions), out = {};
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, front = -Infinity, x = 0, y = 0, n = 0;
    for (let i = 0; i < eyes.length; i += 3) {
      if (Math.sign(eyes[i]) !== sign) continue;
      x += eyes[i]; y += eyes[i + 1]; n++;
      minX = Math.min(minX, eyes[i]); maxX = Math.max(maxX, eyes[i]); minY = Math.min(minY, eyes[i + 1]); maxY = Math.max(maxY, eyes[i + 1]); front = Math.max(front, eyes[i + 2]);
    }
    out[side] = { cx: x / n, cy: y / n, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2, front, sign };
  }
  return out;
}

/** The outline of the head and of the hair on it, per direction from the head centre (for a hat's crown). */
function crownOutline(context, frame, THETA = 48, PHI = 20) {
  const grid = new Float32Array(THETA * (PHI + 1)), C = frame.C, d = new Vector3();
  const take = (x, y, z) => {
    d.set(x - C.x, y - C.y, z - C.z);
    const r = d.length(); if (!r) return;
    const phi = Math.acos(Math.max(-1, Math.min(1, d.y / r))), theta = Math.atan2(d.x, d.z);
    if (phi > Math.PI * 0.75) return;
    const t = ((Math.floor((theta + Math.PI) / (Math.PI * 2) * THETA) % THETA) + THETA) % THETA, p = Math.min(PHI, Math.round(phi / (Math.PI * 0.75) * PHI));
    grid[t * (PHI + 1) + p] = Math.max(grid[t * (PHI + 1) + p], r);
  };
  const P = context.positions;
  for (let v = 0; v < P.length / 3; v++) if (frame.used[v] && frame.headWeight[v] > 0.5) take(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
  for (const name of ['HairBase', 'Hair']) {
    const mesh = context.group.getObjectByName(name);
    const position = mesh?.geometry.getAttribute('position');
    // Hair close to the head shapes the crown; long locks hanging away from it do not.
    if (position) for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      if (Math.hypot(x - C.x, y - C.y, z - C.z) < frame.R * 1.3) take(x, y, z);
    }
  }
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = frame.R;
  // Max-biased blur, so the crown is smooth and never cuts into the hair.
  const out = Float32Array.from(grid);
  for (let pass = 0; pass < 3; pass++) for (let t = 0; t < THETA; t++) for (let p = 0; p <= PHI; p++) {
    let most = 0; for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const pp = p + dp; if (pp < 0 || pp > PHI) continue; most = Math.max(most, out[((t + dt + THETA) % THETA) * (PHI + 1) + pp]); }
    out[t * (PHI + 1) + p] = Math.max(out[t * (PHI + 1) + p], most * 0.985);
  }
  return { at: (theta, phi) => { const t = ((Math.floor((theta + Math.PI) / (Math.PI * 2) * THETA) % THETA) + THETA) % THETA, p = Math.min(PHI, Math.round(phi / (Math.PI * 0.75) * PHI)); return out[t * (PHI + 1) + p]; } };
}

function glasses(eyes, ears, skull, settings) {
  const style = settings.style, frame = [], lenses = [];
  const lensCentre = {}, half = {};
  for (const side of ['l', 'r']) {
    const e = eyes[side], a = Math.max(0.021, e.rx * 1.25) * (style === 'aviador' ? 1.1 : 1), b = a * (style === 'redondo' ? 0.92 : style === 'aviador' ? 0.9 : 0.72);
    const centre = new Vector3(e.cx, e.cy + e.ry * 0.05 - (style === 'aviador' ? b * 0.12 : 0), e.front + 0.013);
    lensCentre[side] = centre; half[side] = [a, b];
    const outline = [];
    if (style === 'aviador') {
      // The teardrop, in units of the half width (u outward from the nose) and half height (v up): its tip at
      // the bridge, a nearly straight top, the round full end low and outward, the nose side slanting up to the tip.
      const drop = [[-1, 0.5], [-0.55, 0.72], [0.2, 0.74], [0.8, 0.62], [1, 0.2], [0.92, -0.4], [0.6, -0.85], [0.15, -1], [-0.3, -0.82], [-0.68, -0.38], [-0.92, 0.12]];
      const curve = new CatmullRomCurve3(drop.map(([u, v]) => new Vector3(u, v, 0)), true, 'centripetal');
      for (const p of curve.getSpacedPoints(48).slice(0, 48)) outline.push([p.x * a * e.sign, p.y * b]);
    } else for (let k = 0; k < 48; k++) {
      const t = k / 48 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      let x = a * c, y = b * s;
      if (style === 'quadrado') { const q = 4, r = 1 / Math.pow(Math.pow(Math.abs(c), q) + Math.pow(Math.abs(s), q), 1 / q); x = a * c * r; y = b * s * r; }
      outline.push([x, y]);
    }
    frame.push(tube(outline.map(([x, y]) => new Vector3(centre.x + x, centre.y + y, centre.z - 0.004 * (x * e.sign > 0 ? x / a : 0))), 0.0016, true, 96));
    const shape = new Shape(); outline.forEach(([x, y], k) => (k ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    lenses.push(new ShapeGeometry(shape, 12).applyMatrix4(new Matrix4().makeTranslation(centre.x, centre.y, centre.z - 0.001)));
  }
  // Bridge over the nose, and the temples: skull temples, as an optician fits them — straight back along
  // the side of the head, over the crest of the ear where it meets the head, bent down just past it, and
  // the last 30–45 mm lying against the head behind the ear.
  const l = lensCentre.l, r = lensCentre.r, top = Math.max(half.l[1], half.r[1]) * 0.55, RADIUS = 0.0015, GAP = 0.0008;
  frame.push(tube([new Vector3(l.x - half.l[0] * 0.92, l.y + top, l.z), new Vector3(0, l.y + top * 1.25, l.z + 0.003), new Vector3(r.x + half.r[0] * 0.92, r.y + top, r.z)], RADIUS, false, 24));
  // An aviator's double bridge: the brow bar, straight across the tops of both lenses.
  if (style === 'aviador') {
    const y = l.y + half.l[1] * 0.74;
    frame.push(tube([new Vector3(l.x + half.l[0] * 0.25, y, l.z), new Vector3(l.x - half.l[0] * 0.6, y + 0.0004, l.z + 0.0015), new Vector3(0, y + 0.0006, l.z + 0.003), new Vector3(r.x + half.r[0] * 0.6, y + 0.0004, r.z + 0.0015), new Vector3(r.x - half.r[0] * 0.25, y, r.z)], RADIUS * 0.85, false, 32));
  }
  for (const side of ['l', 'r']) {
    const c = lensCentre[side], ear = ears[side], sign = ear.sign, edge = new Vector3(c.x + sign * half[side][0], c.y + top * 0.6, c.z - 0.004);
    // On the head: never closer to the midline than the skin or short hair around there (a 14 mm window,
    // so the line stays smooth over small bumps) plus the temple's radius.
    const onHead = p => { p.x = sign * Math.max(Math.abs(p.x), skull(sign, p.y, p.z, 0.014, true) + RADIUS + GAP); return p; };
    if (!ear.crest) {
      const reach = ear.top ?? new Vector3(sign * 0.075, c.y, c.z - 0.09);
      frame.push(tube([edge, onHead(edge.clone().lerp(reach, 0.5)), onHead(reach.clone().setY(reach.y + RADIUS))], RADIUS, false, 40));
      continue;
    }
    const over = onHead(new Vector3(0, ear.crest.y + RADIUS + GAP, ear.crest.z));
    const path = [edge, ...[0.2, 0.45, 0.7, 0.9].map(t => onHead(edge.clone().lerp(over, t))), over];
    // Behind the ear: just behind the auricle's back edge, against the head, for about 32 mm.
    // The back edge, smoothed along its length ([1 2 1], twice) so the temple follows the ear, not its facets.
    let edgeZ = ear.back.map(p => p.z);
    for (let pass = 0; pass < 2; pass++) edgeZ = edgeZ.map((z, i) => (edgeZ[Math.max(0, i - 1)] + 2 * z + edgeZ[Math.min(edgeZ.length - 1, i + 1)]) / 4);
    let length = 0, last = over;
    for (const [i, p] of ear.back.entries()) {
      if (i % 2 === 0 && i !== ear.back.length - 1) continue;
      const q = onHead(new Vector3(0, p.y, edgeZ[i] - RADIUS - GAP));
      length += q.distanceTo(last); last = q;
      path.push(q);
      if (length > 0.032) break;
    }
    frame.push(tube(path, RADIUS, false, 64));
  }
  return { frame, lenses };
}

function hat(frame, outline, settings) {
  const { C, R } = frame, style = settings.style, parts = [];
  // The crown: over the head and the hair, down to the brim line (low at the back, above the brows at the front).
  const THETA = 48, ROWS = 16, pos = [], index = [];
  // The brim line: above the brows at the front (the head centre is at eye height), lower over the ears and at the back.
  const brimPhi = theta => { const back = (1 - Math.cos(theta)) / 2; return Math.PI * ((style === 'gorro' ? 0.37 : 0.35) + 0.15 * back); };
  const lift = style === 'chapeu' ? 0.012 : 0.006;
  // A brimmed hat's crown stands on the brim line with near-vertical walls up to a top over the hair
  // (row 0 is the top's centre, the last row the brim line); caps and beanies follow the head and hair.
  const top = C.y + outline.at(0, 0) + 0.025;
  for (let row = 0; row <= ROWS; row++) for (let t = 0; t <= THETA; t++) {
    const theta = t / THETA * Math.PI * 2 - Math.PI, u = row / ROWS;
    if (style === 'chapeu') {
      const phiB = brimPhi(theta), rB = outline.at(theta, phiB) + lift, sB = Math.sin(phiB);
      const radius = rB * sB, base = C.y + Math.cos(phiB) * rB;
      // Top (u < 0.3): a shallow dome closing to the centre; walls (u ≥ 0.3): straight down to the brim, widening a little.
      const w = u < 0.3 ? Math.sin(u / 0.3 * Math.PI / 2) : 1, y = u < 0.3 ? top + 0.008 * (1 - w) : top + (base - top) * (u - 0.3) / 0.7;
      const r = radius * w * (u < 0.3 ? 0.94 : 0.94 + 0.06 * (u - 0.3) / 0.7);
      pos.push(C.x + Math.sin(theta) * r, y, C.z + Math.cos(theta) * r);
    } else {
      const phi = u * brimPhi(theta), r = outline.at(theta, phi) + lift, s = Math.sin(phi);
      pos.push(C.x + s * Math.sin(theta) * r, C.y + Math.cos(phi) * r, C.z + s * Math.cos(theta) * r);
    }
    if (row < ROWS && t < THETA) { const a = row * (THETA + 1) + t, b = a + 1, c = a + THETA + 1, d = c + 1; index.push(a, c, b, b, c, d); }
  }
  const crown = new BufferGeometry(); crown.setAttribute('position', new Float32BufferAttribute(pos, 3)); crown.setIndex(index); crown.computeVertexNormals();
  parts.push(crown);
  const rim = (scale, width, drop, from = -Math.PI, to = Math.PI) => {
    const p = [], ix = [], N = 48;
    for (let k = 0; k <= N; k++) {
      const theta = from + (to - from) * k / N, phi = brimPhi(theta), r0 = outline.at(theta, phi) + lift, s = Math.sin(phi);
      const base = new Vector3(C.x + s * Math.sin(theta) * r0, C.y + Math.cos(phi) * r0, C.z + s * Math.cos(theta) * r0);
      const out = new Vector3(Math.sin(theta), 0, Math.cos(theta));
      const tip = base.clone().addScaledVector(out, width * scale(theta)).add(new Vector3(0, -drop * scale(theta), 0));
      p.push(base.x, base.y, base.z, tip.x, tip.y, tip.z);
      if (k < N) { const a = k * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setIndex(ix); g.computeVertexNormals(); return g;
  };
  if (style === 'gorro') parts.push(rim(() => 1, 0.006, 0.03));
  // A cap's visor: only over the forehead, longest in the middle.
  if (style === 'bone') parts.push(rim(theta => Math.max(0, Math.cos(theta * 1.5)) ** 0.7, R * 0.7, 0.018, -Math.PI * 0.32, Math.PI * 0.32));
  if (style === 'chapeu') parts.push(rim(() => 1, R * 0.62, 0.012));
  return parts;
}

function earrings(ears, settings) {
  const style = settings.style, parts = [];
  for (const side of ['l', 'r']) {
    const lobe = ears[side].lobe;
    if (!lobe) continue;
    const at = lobe.clone().add(new Vector3(ears[side].sign * 0.001, -0.002, 0.001));
    if (style === 'ponto') parts.push(new SphereGeometry(0.0032, 12, 8).translate(at.x, at.y, at.z));
    if (style === 'argola') parts.push(new TorusGeometry(0.0095, 0.0011, 8, 32).rotateY(Math.PI / 2).translate(at.x, at.y - 0.0095, at.z));
    if (style === 'pendente') { parts.push(new SphereGeometry(0.0025, 10, 8).translate(at.x, at.y, at.z)); parts.push(tube([at, at.clone().add(new Vector3(0, -0.012, 0))], 0.0005, false, 8)); parts.push(new SphereGeometry(0.0045, 12, 10).scale(1, 1.5, 1).translate(at.x, at.y - 0.018, at.z)); }
  }
  return parts;
}

function necklace(context, settings) {
  const { positions, data } = context, neck = data.skeleton.bones.findIndex(b => b.name === 'neck_01');
  const heads = context.skeleton?.heads;
  const base = heads?.[neck] ? new Vector3().copy(heads[neck]) : null;
  if (!base) return [];
  // The chain's line: at the base of the neck behind, lower in front. Per direction, the outline is the
  // farthest of the skin and of any clothes there (a necklace is worn over a collar, never through it).
  const N = 40, radius = new Float32Array(N), y0 = base.y - 0.01;
  const drop = t => { const theta = (t + 0.5) / N * Math.PI * 2 - Math.PI; return y0 - 0.035 * Math.max(0, Math.cos(theta)) ** 2; };
  const take = (px, py, pz) => {
    const x = px - base.x, z = pz - base.z;
    if (Math.hypot(x, z) > 0.12) return;
    const t = ((Math.floor((Math.atan2(x, z) + Math.PI) / (Math.PI * 2) * N) % N) + N) % N;
    if (Math.abs(py - drop(t)) < 0.01) radius[t] = Math.max(radius[t], Math.hypot(x, z));
  };
  for (let v = 0; v < positions.length / 3; v++) take(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
  for (const name of ['Outfit', 'Costume']) {
    const position = context.group?.getObjectByName(name)?.geometry.getAttribute('position');
    if (position) for (let i = 0; i < position.count; i++) take(position.getX(i), position.getY(i), position.getZ(i));
  }
  let filled = radius.map((r, t) => r || Math.max(radius[(t + 1) % N], radius[(t + N - 1) % N]) || 0.06);
  // A chain hangs in a smooth curve: the outline is smoothed round the neck (a max keeps it off the skin).
  for (let pass = 0; pass < 4; pass++) filled = filled.map((r, t) => Math.max(r * 0.97, (filled[(t + 1) % N] + r + filled[(t + N - 1) % N]) / 3));
  const points = [];
  for (let t = 0; t < N; t++) {
    const theta = (t + 0.5) / N * Math.PI * 2 - Math.PI, front = Math.max(0, Math.cos(theta));
    const r = filled[t] + 0.003 + 0.004 * front;
    points.push(new Vector3(base.x + Math.sin(theta) * r, drop(t), base.z + Math.cos(theta) * r));
  }
  const parts = [tube(points, settings.style === 'corrente' ? 0.0011 : 0.0009, true, 120)];
  if (settings.style === 'pingente') {
    const lowest = points.reduce((a, b) => (b.z > a.z ? b : a));
    parts.push(new SphereGeometry(0.006, 14, 12).scale(1, 1.4, 0.6).translate(lowest.x, lowest.y - 0.009, lowest.z + 0.002));
  }
  parts.line = points;
  return parts;
}

/** Build the chosen accessories on the character (after its hair, so a hat's crown clears it). */
export async function addAccessories(context, settings = {}) {
  const chosen = Object.fromEntries(Object.entries(defaultAccessories).map(([k, v]) => [k, { ...v, ...(settings[k] ?? {}) }]));
  if (Object.values(chosen).every(item => item.style === 'nenhum')) return [];
  const head = context.data.skeleton.bones.findIndex(bone => bone.name === 'head');
  const { frame, ears, skull } = landmarks(context);
  const built = [];
  if (chosen.glasses.style !== 'nenhum') {
    const { frame: rims, lenses } = glasses(await eyesOf(context), ears, skull, chosen.glasses);
    built.push(addMesh(context, 'Glasses', rims, new MeshStandardMaterial({ color: new Color(chosen.glasses.color), roughness: 0.35, metalness: 0.2 })));
    const dark = chosen.glasses.lens === 'escura';
    built.push(addMesh(context, 'GlassesLenses', lenses, new MeshPhysicalMaterial({ color: dark ? 0x101214 : 0xe8eef2, roughness: 0.05, metalness: 0, transparent: true, opacity: dark ? 0.82 : 0.18, depthWrite: false, side: DoubleSide })));
  }
  if (chosen.earrings.style !== 'nenhum') built.push(addMesh(context, 'Earrings', earrings(ears, chosen.earrings), metalMaterial(metals[chosen.earrings.metal] ?? metals.ouro)));
  if (chosen.hat.style !== 'nenhum') built.push(addMesh(context, 'Hat', hat(frame, crownOutline(context, frame), chosen.hat), new MeshStandardMaterial({ color: new Color(chosen.hat.color), roughness: 0.85, side: DoubleSide })));
  const meshes = [];
  for (const item of built.filter(Boolean)) {
    skinned(item.geometry, item.name, context, head);
    const mesh = new SkinnedMesh(item.geometry, item.material);
    mesh.name = item.name; mesh.userData.accessory = true;
    context.group.add(mesh); mesh.bind(context.body.skeleton, context.body.bindMatrix);
    meshes.push(mesh);
  }
  if (chosen.necklace.style !== 'nenhum') {
    const parts = necklace(context, chosen.necklace), line = parts.line;
    const item = addMesh(context, 'Necklace', parts, metalMaterial(metals[chosen.necklace.metal] ?? metals.ouro));
    if (item) {
      // A chain moves with the skin under it and stays smooth along its length. Each point of its line
      // blends the weights of the skin around it (the 8 nearest body vertices, by inverse distance, an
      // interpolated transfer as Blender's Data Transfer does); the blend is smoothed round the loop, and
      // each vertex interpolates the two line points nearest to it. Nearest-vertex weights alone change
      // bone from one vertex to the next, and the chain breaks into a zigzag as soon as the body moves.
      const body = context.body.geometry, BP = body.getAttribute('position'), BJ = body.getAttribute('skinIndex'), BW = body.getAttribute('skinWeight');
      let blends = line.map(p => {
        const best = [];
        for (let v = 0; v < BP.count; v++) {
          const d = Math.hypot(BP.getX(v) - p.x, BP.getY(v) - p.y, BP.getZ(v) - p.z);
          if (best.length < 8 || d < best[best.length - 1][0]) { best.push([d, v]); best.sort((a, b) => a[0] - b[0]); if (best.length > 8) best.pop(); }
        }
        const blend = new Map();
        for (const [d, v] of best) for (let k = 0; k < 4; k++) { const w = BW.getComponent(v, k) / (d + 0.002); if (w > 0) blend.set(BJ.getComponent(v, k), (blend.get(BJ.getComponent(v, k)) ?? 0) + w); }
        return blend;
      });
      const mix = (maps, ws) => { const out = new Map(); maps.forEach((m, i) => m.forEach((w, j) => out.set(j, (out.get(j) ?? 0) + w * ws[i]))); return out; };
      const unit = m => { let s = 0; m.forEach(w => (s += w)); m.forEach((w, j) => m.set(j, w / s)); return m; };
      blends = blends.map(unit);
      for (let pass = 0; pass < 3; pass++) blends = blends.map((m, i) => mix([blends[(i + line.length - 1) % line.length], m, blends[(i + 1) % line.length]], [0.25, 0.5, 0.25]));
      const nearest = p => {
        let i = 0;
        line.forEach((q, k) => { if (q.distanceToSquared(p) < line[i].distanceToSquared(p)) i = k; });
        const prev = (i + line.length - 1) % line.length, next = (i + 1) % line.length;
        const j = line[prev].distanceToSquared(p) < line[next].distanceToSquared(p) ? prev : next;
        const di = line[i].distanceTo(p), dj = line[j].distanceTo(p), t = di / (di + dj || 1);
        const top = [...unit(mix([blends[i], blends[j]], [1 - t, t])).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = top.reduce((s, [, w]) => s + w, 0);
        while (top.length < 4) top.push([0, 0]);
        return [top.map(([j]) => j), top.map(([, w]) => w / sum)];
      };
      skinned(item.geometry, item.name, context, head, nearest);
      const mesh = new SkinnedMesh(item.geometry, item.material);
      mesh.name = 'Necklace'; mesh.userData.accessory = true;
      context.group.add(mesh); mesh.bind(context.body.skeleton, context.body.bindMatrix);
      meshes.push(mesh);
    }
  }
  return meshes;
}
