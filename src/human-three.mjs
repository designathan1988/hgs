import {
  Bone, BufferGeometry, Color, Float32BufferAttribute, Group, MeshStandardMaterial,
  Skeleton, SkinnedMesh, SRGBColorSpace, Uint16BufferAttribute, Uint32BufferAttribute, Vector3,
} from 'three';
import { loadHumanData, shapeHuman } from './parametric.mjs';
import { dressHuman } from './appearance.mjs';
import { reduceGeometry } from './lod.mjs';
import { buildClips } from './motion.mjs';
import { addFaceRig } from './face-mesh.mjs';
import { applyOffsets } from './sculpt.mjs';
import { imageTexture } from './texture-cache.mjs';
export { blendshapeNames } from './face-rig.mjs';
export { faceWeights, applyFaceWeights } from './face-mesh.mjs';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
export { registerHairStyle, registerClothingStyle } from './appearance.mjs';

function resolvedSpec(spec) {
  if (!Number.isFinite(spec.seed)) return spec;
  let state = Math.floor(spec.seed) >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const randomFeatures = {
    'nose-scale-depth-decr-incr': (next() - 0.5) * 0.42,
    'chin-width-decr-incr': (next() - 0.5) * 0.4,
    'cheek-volume-decr-incr': (next() - 0.5) * 0.4,
    'eye-scale-decr-incr': (next() - 0.5) * 0.3,
  };
  return {
    gender: next(), muscle: 0.35 + next() * 0.3,
    weight: 0.35 + next() * 0.3, height: 0.35 + next() * 0.3,
    skin: Math.floor(next() * 8),
    ...spec,
    features: { ...randomFeatures, ...spec.features },
  };
}

function boneHead(meta, groups, positions) {
  const source = meta.head;
  const ids = source.strategy === 'CUBE'
    ? (groups[source.cubeName] ?? []).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))
    : (source.vertexIndices ?? []);
  const head = new Vector3();
  for (const i of ids) head.add(new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
  if (ids.length) head.divideScalar(ids.length);
  return head;
}

function makeSkeleton(data, positions) {
  const meta = data.skeleton.bones;
  const heads = meta.map(bone => boneHead(bone, data.base.vertexGroups, positions));
  const byName = new Map(meta.map((bone, i) => [bone.name, i]));
  const bones = meta.map(({ name }) => { const bone = new Bone(); bone.name = name; return bone; });
  const roots = [];
  for (let i = 0; i < bones.length; i++) {
    const parent = meta[i].parent == null ? undefined : byName.get(meta[i].parent);
    bones[i].position.copy(heads[i]);
    if (parent === undefined) roots.push(bones[i]);
    else {
      bones[i].position.sub(heads[parent]);
      bones[parent].add(bones[i]);
    }
  }
  return { bones, roots, heads, byName };
}

function makeBodyGeometry(data, positions) {
  const bodyGroup = data.base.faceGroups.indexOf('body');
  if (bodyGroup < 0) throw new Error('Human base mesh has no visible body faces');
  const count = data.faceGroup.reduce((n, group) => n + Number(group === bodyGroup), 0);
  const vertexCount = count * 4;
  const pos = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(count * 6);
  const baseIds = new Uint16Array(vertexCount);
  let faceOut = 0;
  for (let face = 0; face < data.faceGroup.length; face++) {
    if (data.faceGroup[face] !== bodyGroup) continue;
    for (let corner = 0; corner < 4; corner++) {
      const v = data.faces[face * 4 + corner];
      const tex = data.faceUvs[face * 4 + corner];
      const out = faceOut * 4 + corner;
      baseIds[out] = v;
      pos.set(positions.subarray(v * 3, v * 3 + 3), out * 3);
      uv[out * 2] = data.uvs[tex * 2];
      uv[out * 2 + 1] = data.uvs[tex * 2 + 1];
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        joints[out * 4 + k] = data.joints[v * 4 + k];
        weights[out * 4 + k] = data.weights[v * 4 + k] / 65535;
        sum += weights[out * 4 + k];
      }
      if (sum < 1e-6) { joints[out * 4] = 0; weights[out * 4] = 1; }
    }
    const a = faceOut * 4;
    indices.set([a, a + 1, a + 2, a, a + 2, a + 3], faceOut * 6);
    faceOut++;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  // Average face normals by source vertex so UV seams stay smooth.
  const smooth = new Float32Array(positions.length);
  const ab = new Vector3(), ac = new Vector3(), normal = new Vector3();
  for (let face = 0; face < faceOut; face++) {
    const o = face * 4;
    const a = baseIds[o] * 3, b = baseIds[o + 1] * 3, c = baseIds[o + 2] * 3;
    ab.set(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
    ac.set(positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]);
    normal.crossVectors(ab, ac);
    for (let k = 0; k < 4; k++) {
      const at = baseIds[o + k] * 3;
      smooth[at] += normal.x; smooth[at + 1] += normal.y; smooth[at + 2] += normal.z;
    }
  }
  const normals = new Float32Array(pos.length);
  for (let i = 0; i < vertexCount; i++) {
    const s = baseIds[i] * 3, d = i * 3;
    const n = new Vector3(smooth[s], smooth[s + 1], smooth[s + 2]).normalize();
    normals[d] = n.x; normals[d + 1] = n.y; normals[d + 2] = n.z;
  }
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.userData.baseIds = baseIds;
  return geometry;
}

// Mean sRGB colour of each bundled skin texture (assets/skins/index.json).
const skinMaps = {
  young_caucasian_female: [206, 158, 131], young_caucasian_male: [224, 169, 137],
  young_asian_female: [207, 158, 126], young_asian_male: [199, 155, 130],
  young_african_female: [96, 56, 41], young_african_male: [87, 56, 41],
  middleage_caucasian_female: [205, 161, 133], middleage_caucasian_male: [205, 160, 132],
  middleage_asian_female: [213, 168, 138], middleage_asian_male: [209, 163, 134],
  middleage_african_female: [98, 56, 39], middleage_african_male: [95, 59, 42],
  old_caucasian_female: [211, 172, 148], old_caucasian_male: [225, 177, 142],
  old_asian_female: [199, 144, 109], old_asian_male: [187, 126, 92],
  old_african_female: [93, 41, 24], old_african_male: [101, 57, 35],
};
export const skinColours = [0xf0c9ad, 0xdfad8b, 0xc98c66, 0xb77850, 0x97603f, 0x75472f, 0x563524, 0x39261d];

/**
 * Pick the age/sex skin texture whose mean colour is nearest the requested
 * tone, then tint it so its mean matches that tone. The tint is the per-channel
 * ratio in linear sRGB, the space three.js multiplies colours in.
 */
export function skinMaterialFor(spec) {
  const age = spec.ageYears ?? 30;
  const band = age < 30 ? 'young' : age < 58 ? 'middleage' : 'old';
  const sex = (spec.gender ?? 0.5) < 0.5 ? 'female' : 'male';
  const target = new Color(spec.skinColor ?? skinColours[Math.max(0, Math.min(7, spec.skin ?? 2))]);
  const ancestries = spec.skinMap ? [spec.skinMap] : ['caucasian', 'asian', 'african'];
  if (!ancestries.every(name => ['caucasian', 'asian', 'african'].includes(name))) throw new Error(`Unknown skin map: ${spec.skinMap}`);
  // Prefer the nearest texture that is at least as light as the tone: darkening
  // a texture keeps its detail, while brightening one washes out highlights.
  const luminance = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  let best = null;
  for (const ancestry of ancestries) {
    const name = `${band}_${ancestry}_${sex}`;
    const mean = new Color().setRGB(...skinMaps[name].map(v => v / 255), SRGBColorSpace);
    const darker = luminance(mean) < luminance(target);
    const distance = (darker ? 10 : 0) + Math.abs(Math.log(luminance(target) / luminance(mean)));
    if (!best || distance < best.distance) best = { name, mean, distance };
  }
  const tint = new Color(target.r / best.mean.r, target.g / best.mean.g, target.b / best.mean.b);
  const peak = Math.max(tint.r, tint.g, tint.b);
  if (peak > 1.6) tint.multiplyScalar(1.6 / peak);
  return { file: `${best.name}.webp`, tint, target };
}

export async function createHuman(spec = {}, { signal, onProgress } = {}) {
  const checkpoint = async stage => {
    signal?.throwIfAborted();
    onProgress?.(stage);
    if (signal || onProgress) await new Promise(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
  };
  await checkpoint('Assets');
  spec = resolvedSpec(spec);
  const data = await loadHumanData();
  await checkpoint('Corpo');
  const positions = shapeHuman(data, spec);
  // Sculpted body offsets act on the base mesh, so wearables and the face rig fit them.
  applyOffsets(positions, spec.sculpt?.body, spec.heightMeters ?? 1.7);
  const group = new Group();
  try {
  group.name = 'Human';
  const skeleton = makeSkeleton(data, positions);
  for (const root of skeleton.roots) group.add(root);
  const geometry = makeBodyGeometry(data, positions);
  const skin = skinMaterialFor(spec);
  const material = new MeshStandardMaterial({
    color: spec.lod === 'low' ? skin.target : skin.tint,
    roughness: 0.55 + 0.4 * Math.max(0, Math.min(1, spec.skinRoughness ?? 0.6)),
  });
  if (spec.lod !== 'low') material.userData.hgsSkinTexture = new URL(`../assets/skins/${skin.file}`, import.meta.url).href;
  if (typeof document !== 'undefined' && spec.lod !== 'low') {
    material.map = await imageTexture(new URL(`../assets/skins/${skin.file}`, import.meta.url).href, { flipY: true });
    material.needsUpdate = true;
  }
  const body = new SkinnedMesh(geometry, material);
  body.name = 'Body';
  group.add(body);
  group.updateMatrixWorld(true);
  body.bind(new Skeleton(skeleton.bones));
  body.normalizeSkinWeights();
  const context = { data, positions, group, body, skeleton, lod: spec.lod ?? 'high', sculpt: spec.sculpt, height: spec.heightMeters ?? 1.7 };
  await checkpoint('Aparência');
  await dressHuman(context, spec);
  await checkpoint('Rig');
  // The facial rig is for the close, editable character; crowd LODs skip it.
  const faceMeshes = context.lod === 'high' ? await addFaceRig(context, spec.faceWeights ?? {}) : [];
  if (spec.lod === 'medium' || spec.lod === 'low') {
    await checkpoint('Detalhes');
    const meshes = [];
    group.traverse(object => { if (object.isMesh) meshes.push(object); });
    for (const mesh of meshes) {
      signal?.throwIfAborted();
      const previous = mesh.geometry;
      mesh.geometry = await reduceGeometry(previous, spec.lod);
      if (mesh.geometry !== previous) previous.dispose();
    }
  }
  const animations = buildClips(skeleton, spec.pose ?? 0, faceMeshes.map(mesh => mesh.name));
  group.animations = animations;
  const bounds = body.geometry.boundingBox;
  const height = bounds.max.y - bounds.min.y;
  await checkpoint('Pronto');
  return {
    // What the hair editor needs to rebuild locks on this exact body.
    context: { data, positions, skeleton, outfitSurface: context.outfitSurface ?? null, height: context.height, lod: context.lod },
    group, body, animations, faceMeshes, metrics: { height, vertices: body.geometry.getAttribute('position').count, triangles: body.geometry.index.count / 3 },
    dispose() {
      disposeHumanGroup(group);
    },
  };
  } catch (error) {
    disposeHumanGroup(group);
    throw error;
  }
}

function disposeHumanGroup(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material);
      for (const key of ['map', 'normalMap']) if (material[key] && !material[key].userData.shared) textures.add(material[key]);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

// Unreal Mannequin names (the rig's own) mapped to Mixamo's, which Unity's
// Humanoid avatar, Godot's retargeting and most animation libraries recognise.
const fingerNames = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky' };
export function mixamoName(name) {
  const fixed = { pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', head: 'Head', Root: 'Root' }[name];
  if (fixed) return `mixamorig:${fixed}`;
  const match = /^(\w+?)_(\d+_)?([lr])$/.exec(name);
  if (!match) return name;
  const side = match[3] === 'l' ? 'Left' : 'Right', part = match[1], index = match[2] ? Number(match[2].slice(0, -1)) : 0;
  if (fingerNames[part]) return `mixamorig:${side}Hand${fingerNames[part]}${index}`;
  const limb = { clavicle: 'Shoulder', upperarm: 'Arm', lowerarm: 'ForeArm', hand: 'Hand', thigh: 'UpLeg', calf: 'Leg', foot: 'Foot', ball: 'ToeBase' }[part];
  return limb ? `mixamorig:${side}${limb}` : name;
}

/**
 * Game-oriented geometry for export, applied temporarily: weld the per-corner
 * vertices the editor keeps (about 2.5x fewer vertices), move the facial
 * blendshapes onto a separate Head mesh so the body carries no morph data,
 * and store opaque textures as JPEG. Returns a function that undoes it.
 */
function optimizeForExport(human, clips) {
  const undo = [];
  const meshes = [];
  human.group.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
  for (const mesh of meshes) {
    const original = mesh.geometry;
    const morphs = original.morphAttributes.position;
    // Welding copies attributes without their names; morph names are the
    // blendshape names, so put them back.
    const named = geometry => { geometry.morphAttributes.position?.forEach((attribute, i) => { attribute.name = morphs[i].name; }); return geometry; };
    let welded = named(mergeVertices(original, 1e-6));
    if (mesh === human.body && morphs?.length) {
      // Faces touching any moved vertex form the head; the rest keeps no morphs.
      const moving = new Uint8Array(welded.getAttribute('position').count);
      for (const target of welded.morphAttributes.position) for (let i = 0; i < target.count; i++) {
        if (Math.abs(target.getX(i)) + Math.abs(target.getY(i)) + Math.abs(target.getZ(i)) > 1e-7) moving[i] = 1;
      }
      const index = welded.index.array, headFaces = [], bodyFaces = [];
      for (let i = 0; i < index.length; i += 3) (moving[index[i]] || moving[index[i + 1]] || moving[index[i + 2]] ? headFaces : bodyFaces).push(index[i], index[i + 1], index[i + 2]);
      const head = welded.clone(); head.setIndex(headFaces);
      const rest = welded.clone(); rest.setIndex(bodyFaces); rest.morphAttributes = {};
      const compact = geometry => { const copy = geometry.toNonIndexed(); const result = mergeVertices(copy, 1e-6); copy.dispose(); return named(result); };
      const headGeometry = compact(head), bodyGeometry = compact(rest);
      head.dispose(); rest.dispose(); welded.dispose();
      welded = bodyGeometry;
      const headMesh = new SkinnedMesh(headGeometry, mesh.material);
      headMesh.name = 'Head';
      mesh.parent.add(headMesh);
      headMesh.bind(mesh.skeleton, mesh.bindMatrix);
      headMesh.updateMorphTargets();
      headMesh.morphTargetInfluences.splice(0, Infinity, ...mesh.morphTargetInfluences);
      for (const clip of clips) for (const track of clip.tracks) if (track.name.startsWith(`${mesh.name}.morphTargetInfluences`)) track.name = track.name.replace(mesh.name, 'Head');
      undo.push(() => { headMesh.removeFromParent(); headGeometry.dispose(); });
    }
    const influences = mesh.morphTargetInfluences, dictionary = mesh.morphTargetDictionary;
    mesh.geometry = welded;
    if (mesh === human.body && morphs?.length) { mesh.morphTargetInfluences = undefined; mesh.morphTargetDictionary = undefined; }
    undo.push(() => { mesh.geometry = original; mesh.morphTargetInfluences = influences; mesh.morphTargetDictionary = dictionary; welded.dispose(); });
    for (const key of ['map', 'normalMap']) {
      const texture = mesh.material?.[key];
      // Opaque colour and normal maps compress far better as JPEG.
      if (texture && !mesh.material.transparent && !mesh.material.alphaTest && texture.userData.mimeType === undefined) {
        texture.userData.mimeType = 'image/jpeg';
        undo.push(() => { delete texture.userData.mimeType; });
      }
    }
  }
  return () => { for (const step of undo.reverse()) step(); };
}

/**
 * Binary glTF of the character. Options: `skeleton` ('unreal' | 'mixamo'),
 * `animations` (include clips), `blendshapes` (include facial morph targets),
 * `cosmetic` (keep the transparent corneal layers, which games rarely want).
 */
export async function exportHumanGLB(human, { skeleton = 'unreal', animations = true, blendshapes = true, cosmetic = true, optimize = true } = {}) {
  const bones = human.body.skeleton.bones;
  const original = bones.map(bone => bone.name);
  const hidden = [], morphs = [];
  let restore = () => {};
  try {
    if (skeleton === 'mixamo') bones.forEach(bone => { bone.name = mixamoName(bone.name); });
    if (!cosmetic) human.group.traverse(object => { if (object.userData.role === 'corneal-wetness' && object.visible) { object.visible = false; hidden.push(object); } });
    if (!blendshapes) human.group.traverse(object => {
      if (!object.geometry?.morphAttributes?.position) return;
      morphs.push([object, object.geometry.morphAttributes.position, object.morphTargetInfluences, object.morphTargetDictionary]);
      object.geometry.morphAttributes.position = undefined; delete object.geometry.morphAttributes.position;
      object.morphTargetInfluences = undefined; object.morphTargetDictionary = undefined;
    });
    const rename = new Map(original.map((name, i) => [name, bones[i].name]));
    const clips = !animations ? [] : human.animations.map(clip => {
      const copy = clip.clone();
      copy.tracks = copy.tracks.filter(track => blendshapes || !track.name.includes('morphTargetInfluences'));
      for (const track of copy.tracks) {
        const [node, ...rest] = track.name.split('.');
        if (rename.has(node)) track.name = [rename.get(node), ...rest].join('.');
      }
      return copy;
    });
    if (optimize) restore = optimizeForExport(human, clips);
    return await new GLTFExporter().parseAsync(human.group, { binary: true, animations: clips });
  } finally {
    restore();
    bones.forEach((bone, i) => { bone.name = original[i]; });
    for (const object of hidden) object.visible = true;
    for (const [object, position, influences, dictionary] of morphs) {
      object.geometry.morphAttributes.position = position; object.morphTargetInfluences = influences; object.morphTargetDictionary = dictionary;
    }
  }
}
