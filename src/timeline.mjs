import { AnimationClip, AnimationMixer, Matrix4, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { retarget } from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fromLocal, toLocal } from './motion.mjs';
// No import of human-three.mjs here: it imports this module, and the generation
// worker's module resolver refuses import cycles (generation.mjs).

/**
 * The character's own animation: keys of { t, pose: { bone: D, $pelvis }, face: { shape: weight } }
 * (motion.mjs pose convention), played and exported as the clip "custom".
 */
export const USER_CLIP = 'custom';

/** Local rest position of bone `index` (as makeSkeleton places it). */
function restPosition(skeleton, index) {
  const parent = skeleton.bones[index].parent, p = parent?.isBone ? skeleton.bones.indexOf(parent) : -1;
  if (p < 0) return skeleton.heads[index].clone();
  return skeleton.heads[index].clone().sub(skeleton.heads[p]).applyQuaternion(skeleton.rest[p].clone().invert());
}

/** The keyed clip as a three.js AnimationClip (null without keys). Bones missing from a key are at rest there. */
export function buildUserClip(skeleton, clip, faceMeshes = []) {
  const keys = [...(clip?.keys ?? [])].sort((a, b) => a.t - b.t);
  if (!keys.length) return null;
  const times = keys.map(key => key.t), tracks = [];
  const bones = new Set(), shapes = new Set();
  for (const key of keys) {
    for (const name of Object.keys(key.pose ?? {})) if (name !== '$pelvis' && skeleton.byName.has(name)) bones.add(name);
    for (const name of Object.keys(key.face ?? {})) shapes.add(name);
  }
  const identity = [0, 0, 0, 1], local = new Quaternion();
  for (const name of bones) {
    const index = skeleton.byName.get(name), values = [];
    for (const key of keys) {
      toLocal(skeleton, index, new Quaternion(...(key.pose?.[name] ?? identity)), local);
      values.push(local.x, local.y, local.z, local.w);
    }
    tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
  }
  const pelvis = skeleton.byName.get('pelvis');
  if (pelvis !== undefined && keys.some(key => key.pose?.$pelvis)) {
    const rest = restPosition(skeleton, pelvis);
    tracks.push(new VectorKeyframeTrack('pelvis.position', times, keys.flatMap(key => {
      const [dx, dy, dz] = key.pose?.$pelvis ?? [0, 0, 0];
      return [rest.x + dx, rest.y + dy, rest.z + dz];
    })));
  }
  for (const shape of shapes) for (const mesh of faceMeshes) {
    tracks.push(new NumberKeyframeTrack(`${mesh}.morphTargetInfluences[${shape}]`, times, keys.map(key => key.face?.[shape] ?? 0)));
  }
  return new AnimationClip(USER_CLIP, Math.max(clip.duration ?? 0, times.at(-1)), tracks);
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
    pose.$pelvis = pelvis.position.clone().sub(pelvisRest).toArray().map(v => Math.round(v * 1e4) / 1e4);
    keys.push({ t: Math.round(t * 1000) / 1000, pose, face: {} });
  }
  mixer.stopAllAction();
  target.skeleton.pose();
  return { duration: clip.duration, keys, name: clip.name || 'Importada' };
}
