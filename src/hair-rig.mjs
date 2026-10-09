import { Bone, Matrix4, Quaternion, Skeleton, Vector3 } from 'three';
import { anglesOf, hairSkinWeights } from './scalp.mjs';

/**
 * Joint chains for the free part of long hair, as game characters animate
 * hair (VRMC_springBone: chains of joints, each the parent of the next, the
 * last one only a tail, with sphere/capsule colliders on the body).
 *
 * - The part of a lock resting on the head or neck skin, or held by a tie,
 *   clip or pin, keeps the weights of that skin (hairSkinWeights). Past it the
 *   lock's free part begins; locks whose free part is shorter than 6 cm (at
 *   1.7 m) stay on the head.
 * - Free locks are grouped by the azimuth (30° sectors) of the point where they
 *   leave the head; a sector with a single lock joins its nearest neighbour.
 *   Each group gets one chain of SEGMENTS + 1 joints along the mean of its
 *   members' free parts, a child of `head` with +Y towards the next joint.
 * - A free vertex is weighted to the two chain joints around its arc position,
 *   fading in from the skin weights over the first 15 % of the free part.
 * - Spring settings follow the locks' firmness; colliders are the head (sphere)
 *   and neck, chest, clavicles and upper arms (capsules), with radii measured
 *   on the skin so a collider never stands outside the body.
 */
const TAU = Math.PI * 2, SECTORS = 12, SEGMENTS = 4, MIN_FREE = 0.06, MAX_CHAINS = 12;const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pad = n => String(n).padStart(2, '0');

/** Point at arc length `a` (from the root) along a lock's chain of particles. */
function pointAt(lock, a, out = new Vector3()) {
  const n = lock.x.length / 3, f = Math.max(0, Math.min(n - 1, a / lock.seg)), i = Math.min(n - 2, Math.floor(f)), t = f - i;
  return out.set(
    lock.x[i * 3] * (1 - t) + lock.x[i * 3 + 3] * t,
    lock.x[i * 3 + 1] * (1 - t) + lock.x[i * 3 + 4] * t,
    lock.x[i * 3 + 2] * (1 - t) + lock.x[i * 3 + 5] * t,
  );
}

/** A low percentile of distances, so a collider fits inside the skin it stands for. */
function insideRadius(distances, fallback) {
  if (!distances.length) return fallback;
  distances.sort((a, b) => a - b);
  return Math.max(0.005, distances[Math.floor(distances.length * 0.1)]);
}

function segmentDistance(p, a, b) {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-12, ab.lengthSq())));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Distance from a point to a polyline. */
function polylineDistance(points, p) {
  let distance = Infinity;
  for (let j = 0; j + 1 < points.length; j++) distance = Math.min(distance, segmentDistance(p, points[j], points[j + 1]));
  return distance;
}

/** Distance between segments p1q1 and p2q2 (closest points of two segments, Ericson, Real-Time Collision Detection §5.1.9). */
function segmentsDistance(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r), clamp = x => Math.max(0, Math.min(1, x));
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
  if (a <= 1e-12) { s = 0; t = clamp(f / e); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) { t = 0; s = clamp(-c / a); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-12 ? clamp((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

/**
 * Whether two locks may share a chain (Chai, Zheng & Zhou, "Adaptive Skinning for Interactive Hair-Solid
 * Simulation", §4.2): guides separated by a solid must not interpolate the same hair. The segment joining
 * their corresponding points (same fraction of the free part) must not cross any body collider.
 */
const CHECKS = 6;
function separatedByBody(a, b, colliders) {
  for (let t = 1; t <= CHECKS; t++) {
    const p = a[t], q = b[t];
    for (const c of colliders) if ((c.b ? segmentsDistance(p, q, c.a, c.b) : segmentDistance(c.a, p, q)) < c.radius) return true;
  }
  return false;
}

/**
 * The hair rig of a settled locks hairstyle on this body. Returns weights for
 * the game mesh (`weightsFor(lock, u, point)`, `weightsAt(point)`), and
 * `attach()` which adds the joints under `head`, extends the character's one
 * skeleton and rebinds every skinned mesh; `springs` is the serialisable
 * spring and collider definition (bone names), or null without chains.
 */
export function buildHairRig(context, state, { joints: withJoints = true } = {}) {
  const { data, positions } = context, body = context.body, frame = state.frame;
  const k = (context.height ?? 1.7) / 1.7;
  const weigh = hairSkinWeights(data, positions, state.normals, frame), hit = {};
  const info = new Map(), free = [];
  for (const lock of state.locks) {
    if ((lock.density ?? 1) <= 0) continue;
    const n = lock.x.length / 3, reach = 0.5 * lock.width * lock.volume + 0.014;
    let held = 0;
    for (let i = 1; i < n; i++) {
      if (!weigh.skin.closest(lock.x[i * 3], lock.x[i * 3 + 1], lock.x[i * 3 + 2], reach, hit) || hit.distance > reach) break;
      held = i;
    }
    // Points held by a tie, clip or pin stay with the head; the spring starts past the last one.
    for (const i of lock.pins.keys()) held = Math.max(held, i);
    // Set with gel, a lock keeps its styled shape: all of it moves with the head.
    if ((lock.gel ?? 0) >= 0.5) held = n - 1;
    const length = (n - 1) * lock.seg, entry = { held: held * lock.seg, length, free: length - held * lock.seg, chain: -1, leave: held };
    info.set(lock, entry);
    if (withJoints && entry.free >= MIN_FREE * k) free.push(lock);
  }
  // Sectors of the leaving point around the head centre.
  const sectors = Array.from({ length: SECTORS }, () => []);
  for (const lock of free) {
    const e = info.get(lock), i = e.leave * 3, { theta } = anglesOf(frame, lock.x[i], lock.x[i + 1], lock.x[i + 2]);
    sectors[Math.floor((((theta / TAU) % 1) + 1) % 1 * SECTORS) % SECTORS].push(lock);
  }
  for (let s = 0; s < SECTORS; s++) {
    if (sectors[s].length !== 1) continue;
    for (let d = 1; d < SECTORS; d++) {
      const target = [(s + d) % SECTORS, (s - d + SECTORS) % SECTORS].find(t => sectors[t].length);
      if (target !== undefined) { sectors[target].push(...sectors[s]); sectors[s] = []; break; }
    }
  }
  // Points at the same fractions of each free part, for the separation check.
  const corresponding = new Map(free.map(lock => {
    const e = info.get(lock);
    return [lock, Array.from({ length: CHECKS + 1 }, (_, t) => pointAt(lock, e.held + e.free * t / CHECKS))];
  }));
  const colliders = free.length ? bodyColliders(context, frame) : [];
  const fits = (lock, group) => group.every(other => !separatedByBody(corresponding.get(lock), corresponding.get(other), colliders));
  // Within a sector, locks of very different free lengths swing on chains of their own (a fringe
  // and the long hair behind it): sorted by free length, a lock joins a group whose shortest is
  // within 1.7× and which no body part separates from it (in front of / behind a shoulder).
  let groups = [];
  for (const members of sectors) {
    if (!members.length) continue;
    const sorted = [...members].sort((a, b) => info.get(a).free - info.get(b).free), own = [];
    for (const lock of sorted) {
      const group = own.find(g => info.get(lock).free <= 1.7 * info.get(g[0]).free && fits(lock, g));
      if (group) group.push(lock); else own.push([lock]);
    }
    groups.push(...own);
  }
  // At most MAX_CHAINS chains (the bone budget, docs/PROJETO.md): the smallest groups join the
  // nearest group around the head that no body part separates from them, until they fit.
  while (groups.length > MAX_CHAINS) {
    groups.sort((a, b) => a.length - b.length);
    const small = groups.shift(), at = info.get(small[0]).leave * 3;
    const theta = anglesOf(frame, small[0].x[at], small[0].x[at + 1], small[0].x[at + 2]).theta;
    let best = 0, distance = Infinity;
    groups.forEach((group, g) => {
      const o = info.get(group[0]).leave * 3, t = anglesOf(frame, group[0].x[o], group[0].x[o + 1], group[0].x[o + 2]).theta;
      // A separated group only when no other is left (counted a full turn farther).
      const d = Math.abs(Math.atan2(Math.sin(t - theta), Math.cos(t - theta))) + (small.every(lock => fits(lock, group)) ? 0 : TAU);
      if (d < distance) { distance = d; best = g; }
    });
    groups[best].push(...small);
  }
  const chains = [];
  for (const members of groups) {
    if (!members.length) continue;
    // The chain reaches the tip of the longest member, so no hair hangs past its last joint (where no
    // collider reaches it): joint j is the mean of the members that reach j/SEGMENTS of that length.
    const longest = Math.max(...members.map(lock => info.get(lock).free));
    const joints = Array.from({ length: SEGMENTS + 1 }, (_, j) => {
      const sum = new Vector3(), p = new Vector3(), d = longest * j / SEGMENTS;
      let count = 0;
      for (const lock of members) {
        const e = info.get(lock);
        if (e.free + 1e-6 < d) continue;
        sum.add(pointAt(lock, e.held + d, p)); count++;
      }
      return sum.divideScalar(count);
    });
    if (joints.some((p, j) => j && p.distanceTo(joints[j - 1]) < 1e-4)) continue;
    const id = chains.length;
    for (const lock of members) info.get(lock).chain = id;
    // Light gel (below ½, which holds the lock whole) firms the spring.
    const firmness = members.reduce((sum, lock) => sum + Math.min(1, (lock.stiffness ?? 0.35) + 1.2 * (lock.gel ?? 0)), 0) / members.length;
    // hitRadius (VRMC_springBone: the joint's hitbox) covers the bundle the chain carries: the members'
    // distance to the chain (90th percentile) plus their half width. It never exceeds the chain's
    // clearance from the colliders at rest, so the hair does not move off its styled shape standing still.
    const spread = [];
    for (const lock of members) for (let t = 1; t <= CHECKS; t++) spread.push(polylineDistance(joints, corresponding.get(lock)[t]) + 0.5 * lock.width * lock.volume);
    spread.sort((a, b) => a - b);
    let clearance = Infinity;
    for (let j = 1; j < joints.length; j++) for (const c of colliders) clearance = Math.min(clearance, (c.b ? segmentDistance(joints[j], c.a, c.b) : joints[j].distanceTo(c.a)) - c.radius);
    const radius = Math.max(0.005, Math.min(spread[Math.floor(spread.length * 0.9)] ?? 0, clearance));
    chains.push({ id, members, joints, names: joints.map((_, j) => `hair_${pad(id)}_${j}`), firmness, radius });
  }
  // Hair joints follow the body's bones in the one skeleton.
  const base = context.skeleton.bones.length;
  const jointIndex = (chain, j) => base + chain * (SEGMENTS + 1) + j;

  const combine = (held, blend, chain, s) => {
    const total = new Map();
    for (let q = 0; q < 4; q++) if (held[1][q] > 0) total.set(held[0][q], held[1][q] * (1 - blend));
    const f = s * SEGMENTS, j = Math.min(SEGMENTS - 1, Math.floor(f)), t = f - j;
    total.set(jointIndex(chain, j), (total.get(jointIndex(chain, j)) ?? 0) + blend * (1 - t));
    total.set(jointIndex(chain, j + 1), (total.get(jointIndex(chain, j + 1)) ?? 0) + blend * t);
    const top = [...total].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((acc, [, w]) => acc + w, 0) || 1;
    return [[0, 1, 2, 3].map(q => top[q]?.[0] ?? 0), [0, 1, 2, 3].map(q => (top[q]?.[1] ?? 0) / sum)];
  };
  // Position along each chain (0 at the root joint, 1 at the tip) of the closest point to a lock point:
  // a vertex is weighted to the joints nearest to it (weights by distance to the bones).
  const along = (chain, q) => {
    const joints = chains[chain].joints, lengths = [0];
    for (let j = 1; j < joints.length; j++) lengths.push(lengths[j - 1] + joints[j].distanceTo(joints[j - 1]));
    let best = 0, distance = Infinity;
    for (let j = 0; j + 1 < joints.length; j++) {
      const a = joints[j], ab = joints[j + 1].clone().sub(a), t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / Math.max(1e-12, ab.lengthSq())));
      const d = q.distanceTo(a.clone().addScaledVector(ab, t));
      if (d < distance) { distance = d; best = (lengths[j] + t * (lengths[j + 1] - lengths[j])) / lengths.at(-1); }
    }
    return best;
  };
  const point = new Vector3(), centre = new Vector3();
  const weightsFor = (lock, u, p) => {
    const held = weigh(point.copy(p)), e = info.get(lock);
    if (!e || e.chain < 0) return held;
    const a = Math.max(0, Math.min(1, u)) * e.length;
    if (a <= e.held) return held;
    // The fade-in from the skin follows the lock's own free part; the joints follow the position.
    const fade = smooth(0, 0.15, Math.min(1, (a - e.held) / e.free));
    return combine(held, fade, e.chain, along(e.chain, pointAt(lock, a, centre)));
  };
  // Fused (volume) surfaces have no lock per vertex: the nearest lock particle gives lock and arc position.
  let samples = null;
  const cell = 0.02;
  const weightsAt = p => {
    if (!samples) {
      samples = new Map();
      for (const lock of info.keys()) {
        const n = lock.x.length / 3;
        for (let i = 0; i < n; i++) {
          const key = `${Math.floor(lock.x[i * 3] / cell)},${Math.floor(lock.x[i * 3 + 1] / cell)},${Math.floor(lock.x[i * 3 + 2] / cell)}`;
          if (!samples.has(key)) samples.set(key, []);
          samples.get(key).push([lock, i / (n - 1), i * 3]);
        }
      }
    }
    let best = null, distance = Infinity;
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    for (let ring = 1; ring <= 4 && !best; ring++) for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
      for (const sample of samples.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const [lock, , o] = sample, d = (lock.x[o] - p.x) ** 2 + (lock.x[o + 1] - p.y) ** 2 + (lock.x[o + 2] - p.z) ** 2;
        if (d < distance) { distance = d; best = sample; }
      }
    }
    return best ? weightsFor(best[0], best[1], p) : weigh(point.copy(p));
  };

  const springs = chains.length ? springDefinition(context, chains, colliders) : null;
  function attach() {
    if (!chains.length) return [];
    const head = body.skeleton.bones.find(bone => bone.name === 'head'), Y = new Vector3(0, 1, 0);
    context.group.updateMatrixWorld(true);
    const created = [];
    for (const chain of chains) {
      let parent = head, rotation = new Quaternion();
      chain.joints.forEach((position, j) => {
        const next = chain.joints[j + 1];
        if (next) rotation = new Quaternion().setFromUnitVectors(Y, next.clone().sub(position).normalize());
        const world = new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
        const local = parent.matrixWorld.clone().invert().multiply(world);
        const bone = new Bone();
        bone.name = chain.names[j];
        local.decompose(bone.position, bone.quaternion, bone.scale);
        parent.add(bone);
        bone.updateMatrixWorld(true);
        created.push(bone);
        parent = bone;
      });
    }
    // One skeleton for the whole character: the body's bones followed by the hair joints.
    const previous = body.skeleton, skeleton = new Skeleton([...previous.bones, ...created]);
    context.group.traverse(object => { if (object.isSkinnedMesh) object.bind(skeleton, object.bindMatrix); });
    previous.dispose();
    return created;
  }
  return { chains, springs, weightsFor, weightsAt, attach };
}

/** The body colliders at rest, in world space: head sphere and capsules, radii measured inside the skin. */
function bodyColliders(context, frame) {
  const { data, positions } = context, skeleton = context.skeleton;
  const names = data.skeleton.bones.map(bone => bone.name);
  const dominant = new Int16Array(positions.length / 3).fill(-1);
  for (const v of new Set(frame.faces.flatMap(face => [0, 1, 2, 3].map(c => data.faces[face * 4 + c])))) {
    let best = -1, weight = 0;
    for (let q = 0; q < 4; q++) if (data.weights[v * 4 + q] > weight) { weight = data.weights[v * 4 + q]; best = data.joints[v * 4 + q]; }
    dominant[v] = best;
  }
  const at = name => skeleton.heads[skeleton.byName.get(name)], tail = name => skeleton.tails?.[skeleton.byName.get(name)] ?? at(name);
  const colliders = [];
  // Head: sphere at the head centre, inside 90 % of the head skin.
  const headDistances = [], p = new Vector3();
  for (let v = 0; v < dominant.length; v++) if (frame.used[v] && frame.headWeight[v] > 0.6) headDistances.push(p.fromArray(positions, v * 3).distanceTo(frame.C));
  colliders.push({ bone: 'head', a: frame.C.clone(), b: null, radius: Math.round(insideRadius(headDistances, frame.R * 0.8) * 1e4) / 1e4 });
  // Long hair falls down the back and over the chest: spine_02 and spine_01 too.
  for (const name of ['neck_01', 'spine_03', 'spine_02', 'spine_01', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r']) {
    const index = names.indexOf(name), a = at(name), b = tail(name), distances = [];
    for (let v = 0; v < dominant.length; v++) if (dominant[v] === index) distances.push(segmentDistance(p.fromArray(positions, v * 3), a, b));
    colliders.push({ bone: name, a: a.clone(), b: b.clone(), radius: Math.round(insideRadius(distances, 0.04) * 1e4) / 1e4 });
  }
  return colliders;
}

/** Spring and collider definition with bone names (VRMC_springBone layout), measured on this body at rest. */
function springDefinition(context, chains, bodyParts) {
  const bones = context.skeleton.bones;
  bones.forEach(bone => bone.updateWorldMatrix(true, false));
  const local = (name, world) => bones.find(bone => bone.name === name).worldToLocal(world.clone()).toArray().map(v => Math.round(v * 1e5) / 1e5);
  const colliders = bodyParts.map(({ bone, a, b, radius }) => ({
    bone, shape: b ? { capsule: { offset: local(bone, a), tail: local(bone, b), radius } } : { sphere: { offset: local(bone, a), radius } },
  }));
  return {
    colliders,
    colliderGroups: [{ name: 'corpo', colliders: colliders.map((_, i) => i) }],
    springs: chains.map(chain => ({
      // Inertia in the pelvis's space (VRMC_springBone center): running or walking does not fling the hair.
      name: `hair_${pad(chain.id)}`, colliderGroups: [0], center: 'pelvis',
      joints: chain.names.map(node => ({
        node,
        // Firm locks return to their styled shape faster and sag less; the
        // rest shape already hangs under gravity (the groom's gravity operator).
        stiffness: Math.round((0.5 + 1.5 * chain.firmness) * 1e3) / 1e3,
        gravityPower: Math.round(0.5 * (1 - chain.firmness) * 1e3) / 1e3,
        gravityDir: [0, -1, 0],
        // Mid-range deceleration (the spec's own example value; dragForce is 0..1).
        dragForce: 0.5,
        hitRadius: Math.round(chain.radius * 1e4) / 1e4,
      })),
    })),
  };
}
