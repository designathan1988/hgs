import { Color, MeshStandardMaterial, Quaternion, TorusGeometry, Vector3 } from 'three';
import { LOCK_POINTS as N, collisionRadius } from './locks.mjs';

/**
 * Hair ties and holders. An accessory holds lock points in place relative to
 * the head, as Maya Hair's Transform constraint holds the points attached to
 * its node, and gathers hairs together as its Hair to Hair constraint does:
 * each held point is one of the lock's pins (fixed by the static groom and the
 * dynamics alike), tagged with the accessory that holds it (`pin.holder`).
 * The accessory's shape is built from the points it holds, so it follows the
 * hair on any body; a band is placed by its direction from the head centre.
 */
export const accessoryTypes = ['tie', 'clip', 'barrette', 'band'];
export const accessoryColors = { tie: 0x262626, clip: 0x3b3330, barrette: 0x8a5a3c, band: 0x1f1f1f, tiara: 0xc9a227 };

const unit = state => state.frame.R / 0.11;
const at = (lock, i, out = new Vector3()) => out.fromArray(lock.x, i * 3);
const mean = points => points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(Math.max(1, points.length));
function perpendicular(v) {
  const a = Math.abs(v.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  return a.addScaledVector(v, -a.dot(v)).normalize();
}
function nextId(state) {
  const used = new Set(state.accessories.map(a => a.id));
  let n = 0;
  while (used.has(`acc-${n}`)) n++;
  return `acc-${n}`;
}
function hold(lock, i, point, id) { const p = point.clone(); p.holder = id; lock.pins.set(i, p); }

/** The pins an accessory holds, lock by lock, each lock's pins in chain order. */
export function accessoryPins(state, id) {
  const out = [];
  for (const lock of state.locks) {
    const pins = [...lock.pins].filter(([, p]) => p.holder === id).sort((a, b) => a[0] - b[0]);
    if (pins.length) out.push({ lock, pins });
  }
  return out;
}

/** Take an accessory off: its pins are released. Returns the locks it held. */
export function removeAccessory(state, id) {
  const held = new Set();
  for (const lock of state.locks) for (const [i, p] of [...lock.pins]) if (p.holder === id) { lock.pins.delete(i); held.add(lock); }
  state.accessories = (state.accessories ?? []).filter(a => a.id !== id);
  return [...held];
}

/** Accessories with no pin left (released, cut off, lock deleted) are gone; a band stands on the head by itself. */
export function pruneAccessories(state) {
  const held = new Set();
  for (const lock of state.locks) for (const p of lock.pins.values()) if (p.holder) held.add(p.holder);
  state.accessories = (state.accessories ?? []).filter(a => a.type === 'band' || held.has(a.id));
}

/** The skin or clothing point under `p`, `lift` above it along its normal. */
function onHead(state, p, lift) {
  const hit = {}, head = state.collider?.head;
  if (head?.closest(p.x, p.y, p.z, 0.1 * unit(state), hit)) {
    const normal = new Vector3(hit.nx, hit.ny, hit.nz);
    return { point: new Vector3(hit.x, hit.y, hit.z).addScaledVector(normal, lift), normal };
  }
  return { point: p.clone(), normal: p.clone().sub(state.frame.C).normalize() };
}

/**
 * A point an accessory may hold: past the follicle with a free segment on
 * both sides (two held points side by side would fix the length between
 * them, and a segment keeps its length).
 */
const holdable = (lock, i) => i >= 3 && i < N && !lock.pins.has(i - 1) && !lock.pins.has(i) && !lock.pins.has(i + 1);

/** Last held point of a lock before index i: the follicle point or a pin. */
function anchorBelow(lock, i) {
  let a = 1;
  for (const j of lock.pins.keys()) if (j < i && j > a) a = j;
  return a;
}

/**
 * The chain point a lock can bring to `target` without stretching: among the
 * points whose chain from the last held point before them reaches the target,
 * the one nearest to it. Null when the lock is too short.
 */
export function holdIndex(lock, target) {
  const p = new Vector3(), q = new Vector3();
  let best = null, distance = Infinity;
  for (let i = 3; i < N - 1; i++) {
    if (!holdable(lock, i)) continue;
    const a = anchorBelow(lock, i);
    if (at(lock, a, q).distanceTo(target) > (i - a) * lock.seg * 0.97) continue;
    const d = at(lock, i, p).distanceTo(target);
    if (d < distance) { distance = d; best = i; }
  }
  return best;
}

function hairDirection(picks) {
  const sum = new Vector3(), a = new Vector3(), b = new Vector3();
  for (const { lock, k } of picks) sum.add(at(lock, k + 1, b).sub(at(lock, k, a)).normalize());
  return sum.lengthSq() < 1e-8 ? new Vector3(0, -1, 0) : sum.normalize();
}

/**
 * Elastic: the locks are gathered at `center` into one bundle. Squeezed by
 * the band, each flat lock becomes a round strand as wide as it is thick, so
 * the bundle's radius is ½·√(Σ thickness²). Each lock is held at the point
 * nearest to the band that it can reach, on the bundle's rim; past it, the
 * lock hangs from the band.
 */
export function tieLocks(state, locks, center, options = {}) {
  return tieGather(state, locks.map(lock => ({ lock, k: holdIndex(lock, center) })).filter(p => p.k !== null), center, options);
}

/** The point of each lock is already chosen (`picks`: { lock, k }); the band goes round them at `center` (their middle when omitted). */
export function tieGather(state, picks, center = null, { color = accessoryColors.tie } = {}) {
  state.accessories ??= [];
  picks = picks.filter(({ lock, k }) => holdable(lock, k) && k < N - 1);
  if (!picks.length) return null;
  center ??= mean(picks.map(({ lock, k }) => at(lock, k)));
  const axis = hairDirection(picks), u = perpendicular(axis), v = new Vector3().crossVectors(axis, u);
  const radius = 0.5 * Math.sqrt(picks.reduce((sum, { lock }) => sum + (lock.width * lock.volume) ** 2, 0));
  const id = nextId(state), d = new Vector3();
  picks.forEach(({ lock, k }, n) => {
    d.copy(at(lock, k)).sub(center); d.addScaledVector(axis, -d.dot(axis));
    if (d.lengthSq() < 1e-10) { const t = n / picks.length * Math.PI * 2; d.copy(u).multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t)); }
    hold(lock, k, center.clone().add(d.setLength(radius * 0.75)), id);
  });
  state.accessories.push({ id, type: 'tie', color });
  return { id, locks: picks.map(p => p.lock) };
}

/** Bobby pin: the locks passing within 1.5 cm of `point` (counted from their surface: half their width off the centre line) are pressed onto the head there. */
export function clipLocks(state, locks, point, { color = accessoryColors.clip } = {}) {
  state.accessories ??= [];
  const id = nextId(state), held = [], p = new Vector3(), q = new Vector3();
  for (const lock of locks) {
    let best = -1, distance = 0.015 * unit(state) + 0.5 * lock.width;
    for (let i = 2; i < N - 1; i++) {
      // Distance to the segment (i, i+1); the nearer end is the point held.
      const ab = at(lock, i + 1, q).sub(at(lock, i, p)), t = Math.max(0, Math.min(1, point.clone().sub(p).dot(ab) / Math.max(1e-12, ab.lengthSq())));
      const d = p.clone().addScaledVector(ab, t).distanceTo(point), j = t < 0.5 ? i : i + 1;
      if (d < distance && holdable(lock, j)) { distance = d; best = j; }
    }
    if (best < 0) continue;
    hold(lock, best, onHead(state, at(lock, best, p), collisionRadius(lock, best)).point, id);
    held.push(lock);
  }
  if (!held.length) return null;
  state.accessories.push({ id, type: 'clip', color });
  return { id, locks: held };
}

/** Barrette: the locks are gathered onto the head at `point`, side by side along a 6 cm clip across the hair. */
export function barretteLocks(state, locks, point, { color = accessoryColors.barrette } = {}) {
  state.accessories ??= [];
  const base = onHead(state, point, 0), picks = locks.map(lock => ({ lock, k: holdIndex(lock, base.point) })).filter(p => p.k !== null);
  if (!picks.length) return null;
  const n = base.normal, along = hairDirection(picks);
  along.addScaledVector(n, -along.dot(n));
  if (along.lengthSq() < 1e-8) along.copy(perpendicular(n));
  along.normalize();
  const axis = new Vector3().crossVectors(n, along).normalize(), half = 0.03 * unit(state), id = nextId(state);
  for (const { lock, k } of picks) {
    const s = Math.max(-half * 0.85, Math.min(half * 0.85, at(lock, k).sub(base.point).dot(axis)));
    hold(lock, k, onHead(state, base.point.clone().addScaledVector(axis, s), collisionRadius(lock, k)).point, id);
  }
  state.accessories.push({ id, type: 'barrette', color });
  return { id, locks: picks.map(p => p.lock) };
}

/**
 * The line of a band over the head: the skin in the plane through the head
 * centre that contains the left-right axis and `dir`, from one ear to the other.
 */
function bandCurve(state, dir) {
  const C = state.frame.C, R = state.frame.R, x = new Vector3(1, 0, 0);
  const up = dir.clone().addScaledVector(x, -dir.dot(x)).normalize(), plane = new Vector3().crossVectors(x, up).normalize();
  const head = state.collider?.head, hit = {}, points = [], normals = [];
  for (let k = 0; k <= 48; k++) {
    const phi = -1.75 + 3.5 * k / 48, d = up.clone().multiplyScalar(Math.cos(phi)).addScaledVector(x, Math.sin(phi));
    const probe = C.clone().addScaledVector(d, R * 1.5);
    if (!head?.closest(probe.x, probe.y, probe.z, R, hit) || hit.y < C.y - 0.45 * R) continue;
    // The skin point, kept in the band's plane.
    const p = new Vector3(hit.x, hit.y, hit.z), off = p.clone().sub(C).dot(plane);
    points.push(p.addScaledVector(plane, -off)); normals.push(new Vector3(hit.nx, hit.ny, hit.nz));
  }
  return { points, normals, plane };
}

/** Band (headband, tiara) over the head through `point`: every lock lying under it is held where it crosses it. */
export function bandAcross(state, point, { color = accessoryColors.band, style = 'band' } = {}) {
  state.accessories ??= [];
  const C = state.frame.C, dir = point.clone().sub(C).normalize(), { plane } = bandCurve(state, dir);
  const id = nextId(state), near = 0.025 * unit(state), a = new Vector3(), b = new Vector3();
  for (const lock of state.locks) {
    for (let i = 2; i < N - 1; i++) {
      const sa = at(lock, i, a).sub(C).dot(plane), sb = at(lock, i + 1, b).sub(C).dot(plane);
      if (sa * sb > 0) continue;
      const j = Math.abs(sa) <= Math.abs(sb) ? i : i + 1;
      if (!holdable(lock, j)) break;
      const p = at(lock, j, a), s = p.clone().sub(C).dot(plane), skin = onHead(state, p.addScaledVector(plane, -s), 0);
      if (skin.point.distanceTo(at(lock, j, b)) > near + collisionRadius(lock, j)) break;
      hold(lock, j, skin.point.addScaledVector(skin.normal, collisionRadius(lock, j)), id);
      break;
    }
  }
  state.accessories.push({ id, type: 'band', color, style, dir: dir.toArray() });
  return { id, locks: accessoryPins(state, id).map(h => h.lock) };
}

// ------------------------------------------------------------- geometry

function solid(color) { const c = new Color(color); return [c.r, c.g, c.b]; }

/** A three.js geometry as a part (positions, normals, uvs, colours, index), as geometryFrom merges them. */
function partOf(geometry, color) {
  const pos = geometry.getAttribute('position').array, rgb = solid(color), colors = new Float32Array(pos.length);
  for (let i = 0; i < colors.length; i += 3) colors.set(rgb, i);
  return { pos: Float32Array.from(pos), normal: Float32Array.from(geometry.getAttribute('normal').array), uv: Float32Array.from(geometry.getAttribute('uv').array), color: colors, index: Array.from(geometry.index.array) };
}

/** A rounded-edged bar swept along `points`, `width` across (sides) and `thickness` along `ups`, with closed ends. */
function sweep(points, ups, width, thickness, color) {
  const n = points.length, pos = [], normal = [], uv = [], index = [], rgb = solid(color);
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]], tangents = points.map((p, j) => points[Math.min(n - 1, j + 1)].clone().sub(points[Math.max(0, j - 1)]).normalize());
  const sides = ups.map((u, j) => new Vector3().crossVectors(u, tangents[j]).normalize());
  points.forEach((p, j) => {
    for (const [a, b] of corners) {
      pos.push(...p.clone().addScaledVector(sides[j], a * width / 2).addScaledVector(ups[j], b * thickness / 2).toArray());
      normal.push(...sides[j].clone().multiplyScalar(a).addScaledVector(ups[j], b).normalize().toArray());
      uv.push(j / (n - 1), (a + 1) / 2);
    }
  });
  // Corners run counter-clockwise about the tangent (side × up), so these triangles face outwards.
  for (let j = 0; j + 1 < n; j++) for (let c = 0; c < 4; c++) {
    const a = j * 4 + c, b = j * 4 + (c + 1) % 4;
    index.push(a, b, a + 4, b, b + 4, a + 4);
  }
  for (const [j, sign] of [[0, -1], [n - 1, 1]]) {
    const start = pos.length / 3;
    for (let c = 0; c < 4; c++) { pos.push(pos[(j * 4 + c) * 3], pos[(j * 4 + c) * 3 + 1], pos[(j * 4 + c) * 3 + 2]); normal.push(...tangents[j].clone().multiplyScalar(sign).toArray()); uv.push(sign > 0 ? 1 : 0, 0.5); }
    if (sign > 0) index.push(start, start + 1, start + 2, start, start + 2, start + 3);
    else index.push(start, start + 2, start + 1, start, start + 3, start + 2);
  }
  const colors = new Float32Array(pos.length);
  for (let i = 0; i < colors.length; i += 3) colors.set(rgb, i);
  return { pos: new Float32Array(pos), normal: new Float32Array(normal), uv: new Float32Array(uv), color: colors, index };
}

function ring(center, axis, radius, tube, color) {
  const geometry = new TorusGeometry(radius, tube, 8, 36);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), axis));
  geometry.translate(center.x, center.y, center.z);
  const part = partOf(geometry, color);
  geometry.dispose();
  return part;
}

/** The way a held lock leaves its holder: from the held point to the next one. */
const leaving = h => { const i = h.pins[0][0]; return at(h.lock, Math.min(N - 1, i + 1)).sub(at(h.lock, i)); };

function tieParts(state, acc, held) {
  const k = unit(state), first = held.map(h => h.pins[0][1]), center = mean(first), axis = mean(held.map(leaving));
  if (axis.lengthSq() < 1e-10) axis.set(0, -1, 0);
  axis.normalize();
  const spread = first.reduce((m, p) => { const d = p.clone().sub(center); return Math.max(m, d.addScaledVector(axis, -d.dot(axis)).length()); }, 0);
  const tube = 0.0018 * k, radius = Math.max(0.003 * k, spread / 0.75) + tube;
  // Two turns of the elastic around the bundle, just past the held points.
  return [1, 3.6].map(t => ring(center.clone().addScaledVector(axis, tube * t), axis, radius, tube, acc.color));
}

function clipParts(state, acc, held) {
  const k = unit(state), points = held.flatMap(h => h.pins.map(([, p]) => p.clone())), center = mean(points);
  const along = mean(held.map(leaving));
  const { normal } = onHead(state, center, 0);
  along.addScaledVector(normal, -along.dot(normal));
  if (along.lengthSq() < 1e-10) along.copy(perpendicular(normal));
  along.normalize();
  const lift = held.reduce((m, h) => Math.max(m, collisionRadius(h.lock, h.pins[0][0])), 0) + 0.0012 * k, length = 0.045 * k;
  // The top leg of a bobby pin lies on the hair, gently waved.
  const line = Array.from({ length: 11 }, (_, j) => {
    const t = j / 10 - 0.5;
    return onHead(state, center.clone().addScaledVector(along, t * length), lift).point.addScaledVector(normal, Math.sin(t * Math.PI * 6) * 0.0005 * k);
  });
  return [sweep(line, line.map(() => normal), 0.0016 * k, 0.0008 * k, acc.color)];
}

function barretteParts(state, acc, held) {
  const k = unit(state), first = held.map(h => h.pins[0][1]), center = mean(first);
  const along = mean(held.map(leaving));
  const { normal } = onHead(state, center, 0);
  along.addScaledVector(normal, -along.dot(normal));
  if (along.lengthSq() < 1e-10) along.copy(perpendicular(normal));
  along.normalize();
  const axis = new Vector3().crossVectors(normal, along).normalize();
  const extent = Math.max(0.025 * k, first.reduce((m, p) => Math.max(m, Math.abs(p.clone().sub(center).dot(axis))), 0) + 0.01 * k);
  const lift = held.reduce((m, h) => Math.max(m, collisionRadius(h.lock, h.pins[0][0])), 0) * 2 + 0.0018 * k;
  const line = Array.from({ length: 9 }, (_, j) => onHead(state, center.clone().addScaledVector(axis, (j / 8 - 0.5) * 2 * extent), lift).point);
  return [sweep(line, line.map(p => onHead(state, p, 0).normal), 0.011 * k, 0.0035 * k, acc.color)];
}

function bandParts(state, acc) {
  const k = unit(state), { points, normals } = bandCurve(state, new Vector3(...acc.dir));
  if (points.length < 2) return [];
  const held = accessoryPins(state, acc.id), tiara = acc.style === 'tiara', thickness = 0.003 * k;
  const hair = held.reduce((m, h) => Math.max(m, 2 * collisionRadius(h.lock, h.pins[0][0])), 0.003 * k);
  const line = points.map((p, j) => p.clone().addScaledVector(normals[j], hair + thickness / 2));
  return [sweep(line, normals, (tiara ? 0.005 : 0.012) * k, thickness, acc.color)];
}

/** One material for every accessory: each part carries its colour per vertex (glTF COLOR_0). */
export function accessoryMaterial() { return new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 }); }

/** The parts (positions, normals, uvs, colours, index) of every accessory, for geometryFrom. */
export function accessoryParts(state) {
  const parts = [];
  for (const acc of state.accessories ?? []) {
    if (acc.type === 'band') { parts.push(...bandParts(state, acc)); continue; }
    const held = accessoryPins(state, acc.id);
    if (!held.length) continue;
    if (acc.type === 'tie') parts.push(...tieParts(state, acc, held));
    else if (acc.type === 'clip') parts.push(...clipParts(state, acc, held));
    else if (acc.type === 'barrette') parts.push(...barretteParts(state, acc, held));
  }
  return parts;
}
