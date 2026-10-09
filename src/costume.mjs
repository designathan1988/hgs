import { Bone, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Matrix4, MeshPhysicalMaterial, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { bodyLayout, fringeBand, newGarment } from './tailor.mjs';
import { fabricMaterialParameters, cardMaterialParameters } from './fabrics.mjs';

/**
 * Carnival pieces that are not cut from the body: bead fringe hanging from a hip band, a plume
 * backpiece (costeiro), a plume headdress with its band (cabeça/esplendor) and a crown.
 *
 * As games build plumes, fringe and hair: alpha-tested cards (glTF alphaMode MASK, drawn with
 * alpha to coverage under MSAA, fabrics.mjs) skinned to chains of joints that swing with the
 * VRMC_springBone 1.0 algorithm (spring-bones.mjs), with sphere and capsule colliders on the body
 * so the fringe swings round the thighs and the plumes clear the head and shoulders. The joints
 * join the character's one skeleton after the hair joints (same layout as hair-rig.mjs: each joint
 * the parent of the next, +Y towards it, the first a child of the bone the piece is worn on: pelvis,
 * spine_03 or head). Card vertices are weighted to the worn-on bone near their root and blend into
 * the two chain joints around their arc position past it.
 */
export const costumeAccessories = new Set(['fringe', 'backpiece', 'headdress', 'crown']);
// Two springs (three joints) per chain: the swing of a plume or a strand reads with two, and the
// character keeps within the joint budget for games (docs/PROJETO.md).
const SEGMENTS = 2;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

class Part {
  constructor() { this.pos = []; this.uv = []; this.color = []; this.joints = []; this.weights = []; this.index = []; }
  vertex(p, u, v, color, [joints, weights]) {
    this.pos.push(p.x, p.y, p.z); this.uv.push(u, v); this.color.push(color.r, color.g, color.b);
    this.joints.push(...joints); this.weights.push(...weights);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) { this.index.push(a, b, c, a, c, d); }
}

/** Skin points of the visible body passing `test(v, x, y, z)`. */
function skinPoints(layout, positions, test) {
  const out = [];
  for (let v = 0; v < positions.length / 3; v++) if (layout.used[v] && test(v, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])) out.push(v);
  return out;
}

/** A low percentile of distances, so a collider fits inside the skin it stands for (as hair-rig.mjs). */
function insideRadius(distances, fallback) {
  if (!distances.length) return fallback;
  distances.sort((a, b) => a - b);
  return Math.max(0.01, distances[Math.floor(distances.length * 0.1)]);
}
function segmentDistance(p, a, b) {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-12, ab.lengthSq())));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Head measurements: top, centre and the head's radius in a horizontal direction at a height. */
function headFrame(layout, positions) {
  const ids = skinPoints(layout, positions, v => layout.headW[v] > 0.75);
  let top = -Infinity;
  for (const v of ids) top = Math.max(top, positions[v * 3 + 1]);
  const ringY = top - 0.075 * layout.k;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of ids) if (Math.abs(positions[v * 3 + 1] - ringY) < 0.012 * layout.k) {
    minX = Math.min(minX, positions[v * 3]); maxX = Math.max(maxX, positions[v * 3]);
    minZ = Math.min(minZ, positions[v * 3 + 2]); maxZ = Math.max(maxZ, positions[v * 3 + 2]);
  }
  const centre = new Vector3((minX + maxX) / 2, ringY, (minZ + maxZ) / 2);
  const radius = (angle, y) => {
    let r = 0;
    for (const v of ids) {
      const dy = positions[v * 3 + 1] - y;
      if (Math.abs(dy) > 0.015 * layout.k) continue;
      const dx = positions[v * 3] - centre.x, dz = positions[v * 3 + 2] - centre.z, a = Math.atan2(dx, dz);
      if (Math.abs(Math.atan2(Math.sin(a - angle), Math.cos(a - angle))) < 0.2) r = Math.max(r, Math.hypot(dx, dz));
    }
    return r || 0.09 * layout.k;
  };
  return { top, centre, radius };
}

/**
 * The costume accessories of `garments` on this body: one skinned mesh ("Costume") and the spring
 * joints it needs, added to the character's skeleton. Returns the spring definition (bone names,
 * VRMC_springBone layout) to merge with the hair's, or null.
 */
export function buildCostume(context, garments) {
  const pieces = garments.map((garment, layer) => ({ garment, layer })).filter(({ garment }) => costumeAccessories.has(garment.type));
  if (!pieces.length || context.lod === 'low') return null;
  const layout = bodyLayout(context), k = layout.k, positions = context.positions, body = context.body;
  const bones = body.skeleton.bones, base = bones.length;
  const parts = { feather: new Part(), fringe: new Part() }, solids = new Map(), chains = [], garmentOf = [];
  const index = name => bones.findIndex(bone => bone.name === name);
  const solid = fabric => { if (!solids.has(fabric)) solids.set(fabric, new Part()); return solids.get(fabric); };
  // A chain over members (each a function t → point and the t where its swing starts).
  const chain = (anchor, members, prefix, settings) => {
    const id = chains.length, start = chains.reduce((n, c) => n + c.points.length, 0);
    const points = Array.from({ length: SEGMENTS + 1 }, (_, j) => {
      const sum = new Vector3();
      for (const m of members) sum.add(m.at(m.swing + (1 - m.swing) * j / SEGMENTS));
      return sum.divideScalar(members.length);
    });
    chains.push({ id, anchor, points, names: points.map((_, j) => `${prefix}_${j}`), settings, start });
    return chains[id];
  };
  // `follow` ({ bone, amount }): part of the weight goes to a limb bone, growing along the strand,
  // as a game skirt is skinned to the thighs under its springs, so a stride carries the strands in
  // front of the thigh instead of the thigh passing through them.
  const weightsAt = (anchor, c, s, follow = null) => {
    const a = index(anchor);
    if (!c) return [[a, 0, 0, 0], [1, 0, 0, 0]];
    const blend = smooth(0, 0.12, s), f = Math.min(SEGMENTS - 1e-6, s * SEGMENTS), j = Math.floor(f), t = f - j;
    const limb = follow ? follow.amount * smooth(0, 0.5, s) : 0, spring = blend * (1 - limb);
    const list = [[a, 1 - blend], [base + c.start + j, spring * (1 - t)], [base + c.start + j + 1, spring * t], ...(limb ? [[index(follow.bone), blend * limb]] : [])].filter(([, w]) => w > 1e-4);
    const sum = list.reduce((acc, [, w]) => acc + w, 0);
    return [[0, 1, 2, 3].map(q => list[q]?.[0] ?? 0), [0, 1, 2, 3].map(q => (list[q]?.[1] ?? 0) / sum)];
  };
  /** A plume card along `at(t)`, `side` across it; v runs from the quill (0) to the tip (1). */
  const feather = (part, at, side, width, colorA, colorB, anchor, c, swing, layer) => {
    const rows = 7, first = part.pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows, centre = at(t), s = Math.max(0, (t - swing) / (1 - swing));
      const color = colorA.clone().lerp(colorB, Math.pow(t, 2.5) * 0.85), w = weightsAt(anchor, t < swing ? null : c, s);
      for (const u of [0, 1]) { part.vertex(centre.clone().addScaledVector(side, (u - 0.5) * width), u, t, color, w); garmentOf.push(layer); }
    }
    for (let r = 0; r < rows; r++) { const a = first + r * 2; part.quad(a, a + 1, a + 3, a + 2); }
  };

  for (const { garment, layer } of pieces) {
    const colorA = new Color(garment.color), colorB = new Color(garment.color2);
    if (garment.type === 'backpiece') {
      // Costeiro: a fan of plumes rising from between the shoulder blades, tilted back, in two
      // rows (long outer plumes, shorter inner ones), on four spring chains.
      const anchorY = layout.chestY + 0.3 * (layout.neckY - layout.chestY);
      const backIds = skinPoints(layout, positions, (v, x, y) => layout.armW[v] < 0.2 && layout.headW[v] < 0.2 && Math.abs(x) < 0.03 * k && Math.abs(y - anchorY) < 0.03 * k);
      let backZ = Infinity;
      for (const v of backIds) backZ = Math.min(backZ, positions[v * 3 + 2]);
      const root = new Vector3(0, anchorY, (Number.isFinite(backZ) ? backZ : -0.1 * k) - 0.05 * k);
      const spread = (35 + 70 * garment.flare) * Math.PI / 180, length = (0.55 + 0.95 * garment.length) * k;
      const rows = [{ count: 13 + Math.round(garment.flare * 12), scale: 1, offset: 0 }, { count: 9 + Math.round(garment.flare * 8), scale: 0.62, offset: 0.025 * k }];
      const members = rows.flatMap(({ count, scale, offset }) => Array.from({ length: count }, (_, i) => {
        const angle = -spread + 2 * spread * (count > 1 ? i / (count - 1) : 0.5), L = length * scale * (1 - 0.22 * Math.abs(angle) / Math.max(spread, 1e-3));
        const dir = new Vector3(Math.sin(angle), Math.cos(angle), -0.42).normalize(), out = new Vector3(Math.sin(angle), Math.cos(angle), 0);
        const start = root.clone().add(new Vector3(Math.sin(angle) * 0.04 * k, Math.cos(angle) * 0.04 * k, offset));
        // The plume bows backwards and its tip droops a little under its own weight.
        return { angle, scale, swing: 0.18, at: t => start.clone().addScaledVector(dir, L * t).add(new Vector3(0, -0.06 * L * t * t * Math.abs(Math.sin(angle)), -0.1 * L * t * t)), side: out.clone().cross(new Vector3(0, 0, 1)).normalize(), width: (0.07 + 0.05 * garment.length) * k * (0.8 + 0.2 * scale) };
      }));
      const sectors = 4;
      for (let s = 0; s < sectors; s++) {
        const group = members.filter(m => Math.min(sectors - 1, Math.floor((m.angle + spread) / (2 * spread + 1e-6) * sectors)) === s);
        if (!group.length) continue;
        const c = chain('spine_03', group, `costume_${layer}_back_${s}`, { stiffness: 1.6, gravityPower: 0.05, dragForce: 0.35, hitRadius: round(0.02 * k), colliders: ['head', 'neck', 'upper'] });
        for (const m of group) feather(parts.feather, m.at, m.side, m.width, colorA, colorB, 'spine_03', c, m.swing, layer);
      }
      // A jewelled rosette hides where the quills meet.
      const disc = solid(garment.fabric), centre = root.clone().add(new Vector3(0, 0, -0.02 * k)), discFirst = disc.pos.length / 3, w = [[index('spine_03'), 0, 0, 0], [1, 0, 0, 0]];
      disc.vertex(centre, 0, 0, colorB, w); garmentOf.push(layer);
      for (let a = 0; a <= 24; a++) { const angle = a / 24 * Math.PI * 2; disc.vertex(centre.clone().add(new Vector3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(0.07 * k)), Math.cos(angle) * 0.07 * k, Math.sin(angle) * 0.07 * k, colorB, w); garmentOf.push(layer); }
      for (let a = 0; a < 24; a++) disc.index.push(discFirst, discFirst + 1 + a, discFirst + 2 + a);
    }
    if (garment.type === 'headdress' || garment.type === 'crown') {
      // A band round the head at the hairline (3.5 cm tall), jewelled; a crown adds points above it.
      const head = headFrame(layout, positions), band = solid(garment.fabric), columns = 48, w = [[index('head'), 0, 0, 0], [1, 0, 0, 0]];
      // A band follows the head (its radius at the bottom and top of the band, off it by the hair)
      // with a rounded profile, as a padded jewelled band is, not a straight cylinder.
      const tall = (garment.type === 'crown' ? 0.03 : 0.025) * k, first = band.pos.length / 3, ring = [];
      for (let c = 0; c <= columns; c++) {
        const angle = c / columns * Math.PI * 2, dir = new Vector3(Math.sin(angle), 0, Math.cos(angle));
        // Close on the bare forehead, room for the hair at the sides and back.
        const facing = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))), off = (0.006 + 0.014 * smooth(0.6, 1.3, facing)) * k;
        const rBottom = head.radius(angle, head.centre.y) + off, rTop = head.radius(angle, head.centre.y + tall) + off;
        const bottom = head.centre.clone().addScaledVector(dir, rBottom), top = head.centre.clone().add(new Vector3(0, tall, 0)).addScaledVector(dir, Math.min(rTop, rBottom));
        const middle = bottom.clone().lerp(top, 0.5).addScaledVector(dir, 0.004 * k);
        ring.push({ angle, dir, bottom, top, r: rBottom });
        band.vertex(bottom, angle * rBottom, 0, colorA, w); band.vertex(middle, angle * rBottom, tall / 2, colorA, w); band.vertex(top, angle * rBottom, tall, colorA, w); garmentOf.push(layer, layer, layer);
      }
      for (let c = 0; c < columns; c++) { const a = first + c * 3; band.quad(a, a + 3, a + 4, a + 1); band.quad(a + 1, a + 4, a + 5, a + 2); }
      if (garment.type === 'crown') {
        // Points every 30°, taller at the front.
        const rise = (0.025 + 0.06 * garment.length) * k;
        for (let c = 0; c < columns; c += 4) {
          const a = ring[c], b = ring[c + 4] ?? ring[0], mid = ring[c + 2], h = rise * (0.6 + 0.4 * Math.cos(mid.angle));
          const apex = mid.top.clone().add(new Vector3(0, h, 0)).addScaledVector(mid.dir, -0.004 * k), s = band.pos.length / 3;
          band.vertex(a.top, 0, 0, colorA, w); band.vertex(b.top, 1, 0, colorA, w); band.vertex(apex, 0.5, 1, colorA, w); garmentOf.push(layer, layer, layer);
          band.index.push(s, s + 1, s + 2);
        }
      } else {
        // Esplendor: a fan of plumes (a halo) radiating from the back of the band in the plane behind the
        // head, tilted back, in two rows (long outer plumes, shorter inner ones in front of them). Plumes
        // fanned straight up from the band all round read as two wings in a V from the front.
        const length = (0.3 + 0.8 * garment.length) * k, half = (60 + 40 * garment.flare) * Math.PI / 180;
        const rows = [{ count: 11 + Math.round(garment.flare * 10), scale: 1, lift: 0 }, { count: 8 + Math.round(garment.flare * 6), scale: 0.66, lift: 0.012 * k }];
        const members = rows.flatMap(({ count, scale, lift }) => Array.from({ length: count }, (_, i) => {
          // φ: the plume's angle from straight up, left to right; its root on the back of the band.
          const phi = -half + 2 * half * (count > 1 ? i / (count - 1) : 0.5), azimuth = Math.PI + phi * 0.55;
          const ringPoint = ring[((Math.round(azimuth / (Math.PI * 2) * columns) % columns) + columns) % columns];
          const dir = new Vector3(Math.sin(phi), Math.cos(phi), -0.3).normalize();
          const L = length * scale * (1 - 0.18 * Math.abs(phi) / half), start = ringPoint.top.clone().add(new Vector3(0, lift, 0)).addScaledVector(ringPoint.dir, (scale < 1 ? 0.012 : 0.004) * k);
          // Across the plume in the fan's plane; the second card crosses it, so it has volume from the side.
          const across = new Vector3(Math.cos(phi), -Math.sin(phi), 0), cross = dir.clone().cross(across).normalize();
          return { azimuth: phi, swing: 0.15, at: t => start.clone().addScaledVector(dir, L * t).add(new Vector3(0, -0.04 * L * t * t, -0.05 * L * t * t)), side: across, cross, width: (0.06 + 0.05 * garment.length) * k * (0.85 + 0.15 * scale) };
        }));
        const sectors = 3;
        for (let s = 0; s < sectors; s++) {
          const group = members.filter(m => Math.min(sectors - 1, Math.floor((m.azimuth + half) / (2 * half + 1e-6) * sectors)) === s);
          if (!group.length) continue;
          const c = chain('head', group, `costume_${layer}_head_${s}`, { stiffness: 1.8, gravityPower: 0.04, dragForce: 0.35, hitRadius: round(0.015 * k), colliders: ['head'] });
          for (const m of group) {
            feather(parts.feather, m.at, m.side, m.width, colorA, colorB, 'head', c, m.swing, layer);
            feather(parts.feather, m.at, m.cross, m.width * 0.8, colorA, colorB, 'head', c, m.swing, layer);
          }
        }
      }
    }
    if (garment.type === 'fringe') {
      // Fringe: cards of beaded strands hanging from the bottom of the hip band all round, never
      // closer to the body than the hips and thighs below them (as the skirt tube is built), on
      // spring chains from the pelvis.
      const { bottom } = fringeBand(layout, garment), length = (0.12 + 0.55 * garment.length) * k;
      const lower = skinPoints(layout, positions, (v, x, y) => layout.armW[v] < 0.3 && layout.headW[v] < 0.3 && y < bottom + 0.02 * k && y > bottom - length - 0.05 * k);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const v of lower) if (Math.abs(positions[v * 3 + 1] - bottom) < 0.015 * k) {
        minX = Math.min(minX, positions[v * 3]); maxX = Math.max(maxX, positions[v * 3]); minZ = Math.min(minZ, positions[v * 3 + 2]); maxZ = Math.max(maxZ, positions[v * 3 + 2]);
      }
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, columns = 36 + Math.round(garment.flare * 28), rows = 6, step = 0.02 * k;
      // Body radius per column and height (2 cm rows), from the skin within the column's angle.
      const reach = new Float32Array(columns * (Math.ceil(length / step) + 2));
      const slots = Math.ceil(length / step) + 2;
      for (const v of lower) {
        const dx = positions[v * 3] - cx, dz = positions[v * 3 + 2] - cz, row = Math.round((bottom - positions[v * 3 + 1]) / step);
        if (row < 0 || row >= slots) continue;
        const column = ((Math.round(Math.atan2(dx, dz) / (Math.PI * 2) * columns) % columns) + columns) % columns;
        for (const c of [column - 1, column, column + 1]) { const cc = (c + columns) % columns; reach[cc * slots + row] = Math.max(reach[cc * slots + row], Math.hypot(dx, dz)); }
      }
      const members = Array.from({ length: columns }, (_, c) => {
        const angle = c / columns * Math.PI * 2, dir = new Vector3(Math.sin(angle), 0, Math.cos(angle));
        const radii = [];
        let widest = 0;
        for (let row = 0; row < slots; row++) { widest = Math.max(widest, reach[c * slots + row]); radii.push(widest + 0.014 * k); }
        const r0 = radii[0], flare = 0.12 + 0.2 * garment.flare;
        const radiusAt = s => Math.max(r0 + flare * s, radii[Math.min(slots - 1, Math.round(s / step))]);
        return { angle, swing: 0.04, at: t => new Vector3(cx, bottom - length * t, cz).addScaledVector(dir, radiusAt(length * t)), side: new Vector3(Math.cos(angle), 0, -Math.sin(angle)), width: 2 * Math.PI * r0 / columns * 1.2 };
      });
      // Six chains (front, back, and two on each side) keep the joint budget for games (PROJETO.md).
      const sectors = 6;
      for (let s = 0; s < sectors; s++) {
        const group = members.filter(m => Math.floor(((m.angle + Math.PI / sectors) % (Math.PI * 2)) / (Math.PI * 2) * sectors) % sectors === s);
        if (!group.length) continue;
        const c = chain('pelvis', group, `costume_${layer}_fringe_${s}`, { stiffness: 0.55, gravityPower: 0.35, dragForce: 0.45, hitRadius: round(0.02 * k), colliders: ['hips', 'legs'] });
        for (const m of group) {
          const part = parts.fringe, root = m.at(0);
          // Strands over a leg (front, back and outside of each thigh) follow that thigh in part;
          // those between the legs only swing.
          const follow = { bone: root.x >= cx ? 'thigh_l' : 'thigh_r', amount: 0.75 * smooth(0.01 * k, 0.06 * k, Math.abs(root.x - cx)) };
          // Two tiers, as a fringe skirt is sewn in overlapping rows: the outer one 6 mm further out and
          // half a strand to the side, so its strands hang in the gaps of the inner one.
          const outward = new Vector3(root.x - cx, 0, root.z - cz).normalize();
          for (const tier of [0, 1]) {
            const first = part.pos.length / 3, shift = m.side.clone().multiplyScalar(tier * m.width / 8).addScaledVector(outward, tier * 0.006 * k);
            for (let r = 0; r <= rows; r++) {
              const t = r / rows, centre = m.at(t).add(shift), w = weightsAt('pelvis', c, Math.max(0, (t - m.swing) / (1 - m.swing)), follow), color = colorA.clone().lerp(colorB, t * t * 0.5);
              for (const u of [0, 1]) { part.vertex(centre.clone().addScaledVector(m.side, (u - 0.5) * m.width), u, t, color, w); garmentOf.push(layer); }
            }
            for (let r = 0; r < rows; r++) { const a = first + r * 2; part.quad(a, a + 1, a + 3, a + 2); }
          }
        }
      }
    }
  }

  // One mesh: a group per material (plumes, fringe, then each jewelled fabric).
  const groups = [['feather', parts.feather], ['fringe', parts.fringe], ...[...solids].map(([fabric, part]) => [fabric, part])].filter(([, part]) => part.index.length);
  if (!groups.length) return null;
  const all = { pos: [], uv: [], color: [], joints: [], weights: [], index: [] }, ranges = [];
  for (const [kind, part] of groups) {
    const offset = all.pos.length / 3, start = all.index.length;
    for (const key of ['pos', 'uv', 'color', 'joints', 'weights']) for (const value of part[key]) all[key].push(value);
    for (const i of part.index) all.index.push(i + offset);
    ranges.push({ kind, start, count: part.index.length });
  }
  // The joints: children of the worn-on bone, each the parent of the next, +Y towards it.
  context.group.updateMatrixWorld(true);
  const created = [], Y = new Vector3(0, 1, 0);
  for (const c of chains) {
    let parent = bones[index(c.anchor)], rotation = new Quaternion();
    c.points.forEach((position, j) => {
      const next = c.points[j + 1];
      if (next) rotation = new Quaternion().setFromUnitVectors(Y, next.clone().sub(position).normalize());
      const local = parent.matrixWorld.clone().invert().multiply(new Matrix4().compose(position, rotation, new Vector3(1, 1, 1)));
      const bone = new Bone();
      bone.name = c.names[j];
      local.decompose(bone.position, bone.quaternion, bone.scale);
      parent.add(bone); bone.updateMatrixWorld(true);
      created.push(bone); parent = bone;
    });
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(all.pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(all.uv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(all.color, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(all.joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(all.weights, 4));
  geometry.setIndex(all.index);
  geometry.computeVertexNormals();
  geometry.userData.garmentOf = Int8Array.from(garmentOf);
  ranges.forEach((range, i) => geometry.addGroup(range.start, range.count, i));
  const materials = ranges.map(({ kind }) => {
    const card = kind === 'feather' || kind === 'fringe';
    const material = new MeshPhysicalMaterial({ vertexColors: true, side: DoubleSide, ...(card ? cardMaterialParameters(kind) : fabricMaterialParameters(kind)) });
    material.name = card ? (kind === 'feather' ? 'Plumas' : 'Franjas') : `Tecido_${kind}`;
    material.userData.hgsFabric = card ? { card: kind } : { fabric: kind };
    return material;
  });
  const mesh = new SkinnedMesh(geometry, materials);
  mesh.name = 'Costume';
  context.group.add(mesh);
  // One skeleton for the whole character: its bones (body and hair) followed by these joints.
  const previous = body.skeleton, skeleton = created.length ? new Skeleton([...previous.bones, ...created]) : previous;
  context.group.traverse(object => { if (object.isSkinnedMesh) object.bind(skeleton, object === mesh ? body.bindMatrix : object.bindMatrix); });
  if (skeleton !== previous) previous.dispose();
  return chains.length ? springDefinition(context, layout, chains) : null;
}

/** Spring and collider definition (bone names), colliders measured inside this body's skin. */
function springDefinition(context, layout, chains) {
  const { data, positions } = context, skeleton = context.skeleton, k = layout.k, names = data.skeleton.bones.map(bone => bone.name);
  const at = name => skeleton.heads[skeleton.byName.get(name)], tail = name => skeleton.tails?.[skeleton.byName.get(name)] ?? at(name);
  const bones = context.body.skeleton.bones, local = (name, world) => bones.find(bone => bone.name === name).worldToLocal(world.clone()).toArray().map(v => round(v, 5));
  const dominant = new Int16Array(positions.length / 3).fill(-1);
  for (let v = 0; v < dominant.length; v++) {
    if (!layout.used[v]) continue;
    let best = -1, weight = 0;
    for (let q = 0; q < 4; q++) if (data.weights[v * 4 + q] > weight) { weight = data.weights[v * 4 + q]; best = data.joints[v * 4 + q]; }
    dominant[v] = best;
  }
  const p = new Vector3(), colliders = [], kinds = {};
  const capsule = (name, kind) => {
    const index = names.indexOf(name), a = at(name), b = tail(name), distances = [];
    if (index < 0 || !a) return;
    for (let v = 0; v < dominant.length; v++) if (dominant[v] === index) distances.push(segmentDistance(p.fromArray(positions, v * 3), a, b));
    (kinds[kind] ??= []).push(colliders.length);
    colliders.push({ bone: name, shape: { capsule: { offset: local(name, a), tail: local(name, b), radius: round(insideRadius(distances, 0.05 * k)) } } });
  };
  // The head as a sphere at the middle of its skin, inside 90 % of it.
  const headIds = [];
  for (let v = 0; v < dominant.length; v++) if (layout.used[v] && layout.headW[v] > 0.75) headIds.push(v);
  const centre = new Vector3();
  for (const v of headIds) centre.add(p.fromArray(positions, v * 3));
  centre.divideScalar(Math.max(1, headIds.length));
  const headDistances = headIds.map(v => p.fromArray(positions, v * 3).distanceTo(centre));
  kinds.head = [colliders.length];
  colliders.push({ bone: 'head', shape: { sphere: { offset: local('head', centre), radius: round(insideRadius(headDistances, 0.08 * k)) } } });
  capsule('neck_01', 'neck'); capsule('spine_03', 'upper'); capsule('clavicle_l', 'upper'); capsule('clavicle_r', 'upper'); capsule('upperarm_l', 'upper'); capsule('upperarm_r', 'upper');
  capsule('pelvis', 'hips'); capsule('spine_01', 'hips');
  for (const name of ['thigh_l', 'thigh_r', 'calf_l', 'calf_r']) capsule(name, 'legs');
  const groupNames = Object.keys(kinds);
  return {
    colliders,
    colliderGroups: groupNames.map(name => ({ name: `figurino_${name}`, colliders: kinds[name] })),
    springs: chains.map(c => ({
      name: c.names[0].replace(/_0$/, ''),
      colliderGroups: c.settings.colliders.map(name => groupNames.indexOf(name)).filter(i => i >= 0),
      joints: c.names.map(node => ({ node, stiffness: c.settings.stiffness, gravityPower: c.settings.gravityPower, gravityDir: [0, -1, 0], dragForce: c.settings.dragForce, hitRadius: c.settings.hitRadius })),
    })),
  };
}

/** Colours offered for garments: carnival metallics and brights first, then everyday tones. */
export const garmentPalette = ['#d4a63a', '#c9c9cf', '#b0123c', '#e8358a', '#7b2cbf', '#1d4ed8', '#0aa37f', '#f4c20d', '#ff6f00', '#ffffff', '#141414', '#3c5a78', '#2f3640', '#806a52'];

/**
 * Whole carnival costumes in one click (each piece stays editable): a samba school dancer
 * (passista: sequinned bikini, fringe skirt, armbands, anklets and a plume headdress) and a float
 * star (destaque: a rhinestone swimsuit, a large plume backpiece and headdress).
 */
export const costumePresets = {
  passista: {
    name: 'Passista', title: 'Biquíni de paetê, saia de franjas, braçadeiras, tornozeleiras e cabeça de plumas',
    garments: () => [
      newGarment('bikini_top'), newGarment('bikini_bottom'), newGarment('armband'), newGarment('anklet'),
      newGarment('fringe'), { ...newGarment('headdress'), color: '#ffffff', color2: '#d4a63a' },
    ],
  },
  destaque: {
    name: 'Destaque', title: 'Maiô de pedraria, braçadeiras, costeiro e cabeça de plumas',
    garments: () => [
      { ...newGarment('swimsuit'), color: '#b0123c' }, { ...newGarment('armband'), color: '#d4a63a' }, { ...newGarment('anklet'), color: '#d4a63a' },
      { ...newGarment('backpiece'), color: '#b0123c', color2: '#f4c20d' }, { ...newGarment('headdress'), color: '#b0123c', color2: '#f4c20d', length: 0.7, flare: 0.8 },
    ],
  },
};

/** Join two spring definitions (bone names) into one: colliders, groups and springs re-indexed. */
export function mergeSprings(a, b) {
  if (!a) return b;
  if (!b) return a;
  const colliderOffset = a.colliders.length, groupOffset = a.colliderGroups.length;
  return {
    colliders: [...a.colliders, ...b.colliders],
    colliderGroups: [...a.colliderGroups, ...b.colliderGroups.map(group => ({ ...group, colliders: group.colliders.map(i => i + colliderOffset) }))],
    springs: [...a.springs, ...b.springs.map(spring => ({ ...spring, colliderGroups: spring.colliderGroups.map(i => i + groupOffset) }))],
  };
}
