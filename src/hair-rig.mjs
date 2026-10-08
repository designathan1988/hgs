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
const TAU = Math.PI * 2, SECTORS = 12, SEGMENTS = 4, MIN_FREE = 0.06;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
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
  const chains = [];
  for (const members of sectors) {
    if (!members.length) continue;
    const joints = Array.from({ length: SEGMENTS + 1 }, (_, j) => {
      const sum = new Vector3(), p = new Vector3();
      for (const lock of members) { const e = info.get(lock); sum.add(pointAt(lock, e.held + e.free * j / SEGMENTS, p)); }
      return sum.divideScalar(members.length);
    });
    if (joints.some((p, j) => j && p.distanceTo(joints[j - 1]) < 1e-4)) continue;
    const id = chains.length;
    for (const lock of members) info.get(lock).chain = id;
    const firmness = members.reduce((sum, lock) => sum + (lock.stiffness ?? 0.35), 0) / members.length;
    const radius = members.reduce((sum, lock) => sum + 0.5 * lock.width * lock.volume, 0) / members.length;
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
  const point = new Vector3();
  const weightsFor = (lock, u, p) => {
    const held = weigh(point.copy(p)), e = info.get(lock);
    if (!e || e.chain < 0) return held;
    const a = Math.max(0, Math.min(1, u)) * e.length;
    if (a <= e.held) return held;
    const s = Math.min(1, (a - e.held) / e.free);
    return combine(held, smooth(0, 0.15, s), e.chain, s);
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

  const springs = chains.length ? springDefinition(context, state, chains) : null;
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

/** Spring and collider definition with bone names (VRMC_springBone layout), measured on this body at rest. */
function springDefinition(context, state, chains) {
  const { data, positions } = context, skeleton = context.skeleton, frame = state.frame;
  const names = data.skeleton.bones.map(bone => bone.name), bones = skeleton.bones;
  bones.forEach(bone => bone.updateWorldMatrix(true, false));
  const dominant = new Int16Array(positions.length / 3).fill(-1);
  for (const v of new Set(frame.faces.flatMap(face => [0, 1, 2, 3].map(c => data.faces[face * 4 + c])))) {
    let best = -1, weight = 0;
    for (let q = 0; q < 4; q++) if (data.weights[v * 4 + q] > weight) { weight = data.weights[v * 4 + q]; best = data.joints[v * 4 + q]; }
    dominant[v] = best;
  }
  const at = name => skeleton.heads[skeleton.byName.get(name)], tail = name => skeleton.tails?.[skeleton.byName.get(name)] ?? at(name);
  const local = (name, world) => bones.find(bone => bone.name === name).worldToLocal(world.clone()).toArray().map(v => Math.round(v * 1e5) / 1e5);
  const colliders = [];
  // Head: sphere at the head centre, inside 90 % of the head skin.
  const headDistances = [], p = new Vector3();
  for (let v = 0; v < dominant.length; v++) if (frame.used[v] && frame.headWeight[v] > 0.6) headDistances.push(p.fromArray(positions, v * 3).distanceTo(frame.C));
  colliders.push({ bone: 'head', shape: { sphere: { offset: local('head', frame.C), radius: Math.round(insideRadius(headDistances, frame.R * 0.8) * 1e4) / 1e4 } } });
  for (const name of ['neck_01', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r']) {
    const index = names.indexOf(name), a = at(name), b = tail(name), distances = [];
    for (let v = 0; v < dominant.length; v++) if (dominant[v] === index) distances.push(segmentDistance(p.fromArray(positions, v * 3), a, b));
    colliders.push({ bone: name, shape: { capsule: { offset: local(name, a), tail: local(name, b), radius: Math.round(insideRadius(distances, 0.04) * 1e4) / 1e4 } } });
  }
  return {
    colliders,
    colliderGroups: [{ name: 'corpo', colliders: colliders.map((_, i) => i) }],
    springs: chains.map(chain => ({
      name: `hair_${pad(chain.id)}`, colliderGroups: [0],
      joints: chain.names.map(node => ({
        node,
        // Firm locks return to their styled shape faster and sag less; the
        // rest shape already hangs under gravity (the groom's gravity operator).
        stiffness: Math.round((0.5 + 1.5 * chain.firmness) * 1e3) / 1e3,
        gravityPower: Math.round(0.5 * (1 - chain.firmness) * 1e3) / 1e3,
        gravityDir: [0, -1, 0],
        // Mid-range deceleration (the spec's own example value; dragForce is 0..1).
        dragForce: 0.5,
        hitRadius: Math.round(Math.max(0.005, Math.min(0.03, chain.radius)) * 1e4) / 1e4,
      })),
    })),
  };
}
