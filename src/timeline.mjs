import {
  AnimationClip, AnimationMixer, InterpolateDiscrete, Matrix4, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack,
} from 'three';
import { retarget } from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fromLocal, pelvisFromLocal, pelvisToLocal, restPosition, toLocal } from './motion.mjs';
// No import of human-three.mjs here: it imports this module, and the generation
// worker's module resolver refuses import cycles (generation.mjs).

/**
 * The character's own animation: { duration, loop, interpolation, keys } with keys of
 * { t, pose: { bone: D, $pelvis } | null, face: { shape: weight } | null } (motion.mjs pose
 * convention; $pelvis in the character's axes). A key without `pose` keys only the face and one
 * without `face` only the body, so the body and the face are two tracks of one timeline.
 * Played and exported as the clip "custom".
 */
export const USER_CLIP = 'custom';
export const interpolations = ['smooth', 'linear', 'step'];

const smoothstep = u => u * u * (3 - 2 * u);
/**
 * Sample times for keys at `times`: the keys themselves, plus (smooth) 30 per second in between,
 * where the curve runs at smoothstep(u) of the way: it leaves and reaches every key at rest (flat
 * tangents, like Blender's auto-clamped Bezier handles on extremes) and never overshoots.
 */
function sampling(times, mode) {
  if (mode !== 'smooth') return times.map((t, i) => ({ t, i, j: i, u: 0 }));
  const out = [];
  for (let i = 0; i < times.length; i++) {
    out.push({ t: times[i], i, j: i, u: 0 });
    if (i === times.length - 1) break;
    const span = times[i + 1] - times[i], steps = Math.floor(span * 30);
    for (let s = 1; s < steps; s++) out.push({ t: times[i] + span * s / steps, i, j: i + 1, u: smoothstep(s / steps) });
  }
  return out;
}

/** The keyed clip as a three.js AnimationClip (null without keys). Bones missing from a body key are at rest there. */
export function buildUserClip(skeleton, clip, faceMeshes = []) {
  const all = [...(clip?.keys ?? [])].sort((a, b) => a.t - b.t);
  if (!all.length) return null;
  const mode = interpolations.includes(clip.interpolation) ? clip.interpolation : 'linear';
  const body = all.filter(key => key.pose), faces = all.filter(key => key.face);
  const tracks = [], interpolation = mode === 'step' ? InterpolateDiscrete : undefined;
  const track = (Type, name, times, values) => { const made = new Type(name, times, values); if (interpolation) made.setInterpolation(interpolation); tracks.push(made); };
  if (body.length) {
    const samples = sampling(body.map(key => key.t), mode), times = samples.map(s => s.t);
    const bones = new Set();
    for (const key of body) for (const name of Object.keys(key.pose)) if (name !== '$pelvis' && skeleton.byName.has(name)) bones.add(name);
    const identity = [0, 0, 0, 1], a = new Quaternion(), b = new Quaternion(), local = new Quaternion();
    for (const name of bones) {
      const index = skeleton.byName.get(name), values = [];
      for (const { i, j, u } of samples) {
        a.fromArray(body[i].pose[name] ?? identity); b.fromArray(body[j].pose[name] ?? identity);
        toLocal(skeleton, index, a.slerp(b, u), local);
        values.push(local.x, local.y, local.z, local.w);
      }
      track(QuaternionKeyframeTrack, `${name}.quaternion`, times, values);
    }
    const pelvis = skeleton.byName.get('pelvis');
    if (pelvis !== undefined && body.some(key => key.pose.$pelvis)) {
      const rest = restPosition(skeleton, pelvis), v = new Vector3();
      const at = key => key.pose.$pelvis ?? [0, 0, 0];
      track(VectorKeyframeTrack, 'pelvis.position', times, samples.flatMap(({ i, j, u }) => {
        const p = at(body[i]), q = at(body[j]);
        return pelvisToLocal(skeleton, p.map((value, c) => value + (q[c] - value) * u), v).add(rest).toArray();
      }));
    }
  }
  if (faces.length) {
    const samples = sampling(faces.map(key => key.t), mode), times = samples.map(s => s.t);
    const shapes = new Set();
    for (const key of faces) for (const name of Object.keys(key.face)) shapes.add(name);
    for (const shape of shapes) {
      const values = samples.map(({ i, j, u }) => { const p = faces[i].face[shape] ?? 0; return p + ((faces[j].face[shape] ?? 0) - p) * u; });
      for (const mesh of faceMeshes) track(NumberKeyframeTrack, `${mesh}.morphTargetInfluences[${shape}]`, times, values);
    }
  }
  return new AnimationClip(USER_CLIP, Math.max(clip.duration ?? 0, all.at(-1).t), tracks);
}

/** Within half a frame at 30 fps: the same key time. */
export const sameTime = (a, b) => Math.abs(a - b) < 1 / 60;

/**
 * The clip with a key at `t`: `pose` (body) and/or `face` replace those parts of a key already
 * there; the other part of that key stays. Returns a new clip.
 */
export function setKey(clip, t, { pose, face } = {}) {
  t = Math.round(Math.max(0, t) * 1000) / 1000;
  const keys = clip.keys.map(key => ({ ...key }));
  let key = keys.find(each => sameTime(each.t, t));
  if (!key) { key = { t, pose: null, face: null }; keys.push(key); }
  if (pose !== undefined) key.pose = pose;
  if (face !== undefined) key.face = face;
  keys.sort((a, b) => a.t - b.t);
  return { ...clip, keys, duration: Math.max(clip.duration, t) };
}
/** The clip without the body (`part` 'pose'), the face ('face') or the whole key at `t`. */
export function clearKey(clip, t, part = 'all') {
  const keys = [];
  for (const key of clip.keys) {
    if (!sameTime(key.t, t)) { keys.push(key); continue; }
    if (part === 'all') continue;
    const left = { ...key, [part]: null };
    if (left.pose || left.face) keys.push(left);
  }
  return { ...clip, keys };
}
/** The clip with the key at `from` moved to `to` (a key already at `to` is replaced). */
export function moveKey(clip, from, to) {
  to = Math.round(Math.max(0, Math.min(60, to)) * 1000) / 1000;
  const moving = clip.keys.find(key => sameTime(key.t, from));
  if (!moving) return clip;
  const keys = clip.keys.filter(key => key !== moving && !sameTime(key.t, to)).concat({ ...moving, t: to }).sort((a, b) => a.t - b.t);
  return { ...clip, keys, duration: Math.max(clip.duration, to) };
}
/**
 * Captured motion mixed into the clip: `keys` (motion.mjs libraryKeys, body only) replace the body
 * keys from their first to their last time; face keys stay.
 */
export function insertMotion(clip, keys) {
  if (!keys.length) return clip;
  const from = keys[0].t - 1e-3, to = keys.at(-1).t + 1e-3;
  const kept = clip.keys.map(key => key.t >= from && key.t <= to ? { ...key, pose: null } : key).filter(key => key.pose || key.face);
  const merged = [...kept];
  for (const key of keys) {
    const same = merged.findIndex(each => sameTime(each.t, key.t));
    if (same >= 0) merged[same] = { ...merged[same], pose: key.pose }; else merged.push({ t: key.t, pose: key.pose, face: null });
  }
  merged.sort((a, b) => a.t - b.t);
  return { ...clip, keys: merged, duration: Math.max(clip.duration, keys.at(-1).t) };
}

/** Bones of the source skeleton by our rig's names: the same name, the Mixamo name (`alias`), or that name as GLTFLoader sanitises it. */
function sourceNames(target, source, alias) {
  const names = new Map(), have = new Set(source.skeleton.bones.map(bone => bone.name));
  for (const bone of target.skeleton.bones) {
    const mixamo = alias(bone.name);
    const found = [bone.name, mixamo, mixamo.replace(':', '')].find(name => have.has(name));
    if (found) names.set(bone.name, found);
  }
  return names;
}

/**
 * Turn the target's bones, parents first, so each points where its source
 * bone points in the source's rest pose (a matching retarget pose, as
 * Unreal's IK Retargeter asks for). Returns world rotations by target name.
 */
function matchPose(target, source, names) {
  const sourceBone = new Map(source.skeleton.bones.map(bone => [bone.name, bone]));
  const bones = [...target.skeleton.bones].sort((a, b) => depth(a) - depth(b));
  const head = new Vector3(), tip = new Vector3(), from = new Vector3(), to = new Vector3(), q = new Quaternion(), parentWorld = new Quaternion();
  target.skeleton.pose(); target.updateMatrixWorld(true);
  source.skeleton.pose(); source.updateMatrixWorld(true);
  for (const bone of bones) {
    const child = bone.children.find(c => c.isBone && names.has(c.name) && names.has(bone.name));
    if (!child) continue;
    bone.getWorldPosition(head); child.getWorldPosition(tip); from.subVectors(tip, head);
    sourceBone.get(names.get(bone.name)).getWorldPosition(head); sourceBone.get(names.get(child.name)).getWorldPosition(tip); to.subVectors(tip, head);
    if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) continue;
    q.setFromUnitVectors(from.normalize(), to.normalize());
    // World rotation q on the bone: local ← parent⁻¹ · q · parent · local.
    (bone.parent ?? target).getWorldQuaternion(parentWorld);
    bone.quaternion.premultiply(parentWorld.clone().invert().multiply(q).multiply(parentWorld));
    bone.updateMatrixWorld(true);
  }
  return new Map(target.skeleton.bones.map(bone => [bone.name, bone.getWorldQuaternion(new Quaternion())]));
}
const depth = bone => { let n = 0; for (let p = bone.parent; p?.isBone; p = p.parent) n++; return n; };

/**
 * An animation from a .glb/.gltf (Mixamo or our own rig) as editable keys:
 * three.js SkeletonUtils.retarget poses our skeleton frame by frame from the
 * source, with local offsets from the matching pose (so a T-pose source drives
 * our A-pose rig), sampled at `fps` (at most 240 keys).
 */
export async function importAnimation(buffer, human, { fps = 10, alias = name => name } = {}) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const clip = gltf.animations[0];
  if (!clip) throw new Error('O arquivo não tem animação');
  let source = null;
  gltf.scene.traverse(object => { if (!source && object.isSkinnedMesh) source = object; });
  if (!source) throw new Error('O arquivo não tem esqueleto com malha');
  const target = human.body, names = sourceNames(target, source, alias);
  if (!names.has('pelvis') || names.size < 10) throw new Error('Ossos não reconhecidos (use nomes Mixamo ou do Unreal Mannequin)');
  const sourceHip = names.get('pelvis'), sourceBone = new Map(source.skeleton.bones.map(bone => [bone.name, bone]));
  // Offsets taken in the matching pose: target world = source world · (source rest⁻¹ · target matched).
  const matched = matchPose(target, source, names), localOffsets = {}, sourceRest = new Quaternion();
  for (const [name, from] of names) {
    sourceBone.get(from).getWorldQuaternion(sourceRest);
    localOffsets[name] = new Matrix4().makeRotationFromQuaternion(sourceRest.invert().multiply(matched.get(name)));
  }
  // Hip height ratio: the source's hips drive our pelvis at our size.
  target.skeleton.pose(); target.updateMatrixWorld(true);
  const ourHip = target.skeleton.bones.find(bone => bone.name === 'pelvis').getWorldPosition(new Vector3()).y;
  const theirHip = sourceBone.get(sourceHip).getWorldPosition(new Vector3()).y;
  const options = { getBoneName: bone => names.get(bone.name), hip: sourceHip, scale: theirHip > 1e-6 ? ourHip / theirHip : 1, localOffsets };
  const mixer = new AnimationMixer(gltf.scene), action = mixer.clipAction(clip);
  action.play();
  const rig = human.context.skeleton, pelvis = rig.bones[rig.byName.get('pelvis')], pelvisRest = restPosition(rig, rig.byName.get('pelvis'));
  const frames = Math.min(240, Math.max(1, Math.round(clip.duration * fps) + 1)), keys = [], D = new Quaternion();
  for (let f = 0; f < frames; f++) {
    const t = frames > 1 ? clip.duration * f / (frames - 1) : 0;
    mixer.setTime(t); gltf.scene.updateMatrixWorld(true);
    retarget(target, source, options);
    const pose = {};
    rig.bones.forEach((bone, i) => {
      fromLocal(rig, i, bone.quaternion, D);
      if (1 - Math.abs(D.w) > 1e-6) pose[bone.name] = D.toArray().map(v => Math.round(v * 1e5) / 1e5);
    });
    pose.$pelvis = pelvisFromLocal(rig, pelvis.position.clone().sub(pelvisRest)).map(v => Math.round(v * 1e4) / 1e4);
    keys.push({ t: Math.round(t * 1000) / 1000, pose, face: {} });
  }
  mixer.stopAllAction();
  target.skeleton.pose();
  return { duration: clip.duration, keys, name: clip.name || 'Importada' };
}
