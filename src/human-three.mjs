import {
  Bone, BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, Quaternion,
  Scene, Skeleton, SkinnedMesh, SRGBColorSpace, Uint16BufferAttribute, Uint32BufferAttribute, Vector3,
} from 'three';
import { loadHumanData, shapeHuman } from './parametric.mjs';
import { dressHuman, tintedSkinTexture } from './appearance.mjs';
import { reduceGeometry } from './lod.mjs';
import { buildClips } from './motion.mjs';
import { addFaceRig, applyFaceWeights } from './face-mesh.mjs';
import { applyOffsets } from './sculpt.mjs';
import { sanitizeSkin } from './skin.mjs';
export { auditCharacter } from './skin.mjs';
export { blendshapeNames } from './face-rig.mjs';
export { faceWeights, applyFaceWeights } from './face-mesh.mjs';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
export { registerHairStyle, registerClothingStyle } from './appearance.mjs';

export function resolvedSpec(spec) {
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

/**
 * Rest orientation of a bone as Blender builds it from head, tail and roll
 * (vec_roll_to_mat3): the smallest rotation taking +Y onto the bone vector,
 * then the roll about that vector. The rig's roll is defined in Blender's
 * frame (+Z up, -Y forward), the base OBJ imported as (x, -z, y); the result
 * is turned back into this app's frame (+Y up, +Z forward) as a quaternion.
 */
function boneRest(direction, roll) {
  const length = direction.length();
  if (length < 1e-9) return new Quaternion();
  const x = direction.x / length, y = -direction.z / length, z = direction.y / length; // Blender frame
  let X, Y = [x, y, z], Z;
  const theta = 1 + y;
  if (theta > 1e-5) {
    X = [1 - x * x / theta, -x, -x * z / theta];
    Z = [-x * z / theta, -z, 1 - z * z / theta];
  } else if (theta > 1e-9) {
    const t = x * x + z * z, a = (x + z) * (x - z) / t, b = 2 * x * z / t;
    X = [a, -x, b]; Z = [b, -z, -a];
  } else { X = [-1, 0, 0]; Y = [0, -1, 0]; Z = [0, 0, 1]; }
  const axis = new Vector3(...Y), spin = new Quaternion().setFromAxisAngle(axis, roll);
  const toApp = v => new Vector3(v.x, v.z, -v.y);
  const basis = new Matrix4().makeBasis(
    toApp(new Vector3(...X).applyQuaternion(spin)).normalize(),
    toApp(axis).normalize(),
    toApp(new Vector3(...Z).applyQuaternion(spin)).normalize(),
  );
  return new Quaternion().setFromRotationMatrix(basis);
}

/**
 * Sculpted skin moves the joints with it. The joint cubes are never sculpted,
 * so each joint is moved by the mean sculpt displacement of the ring of skin
 * around it (body vertices weighted to the given bones, within a slab across
 * the bone axis), as a point bound to the surface follows its deformation:
 * widening a limb leaves the joint centred, lengthening or moving it carries
 * the joint along.
 */
function sculptShift(data, unsculpted, displaced, bodyVertices, point, axis, bones, half) {
  let x = 0, y = 0, z = 0, n = 0;
  for (const v of bodyVertices) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (bones.has(data.joints[v * 4 + k])) w += data.weights[v * 4 + k];
    if (!w) continue;
    const along = (unsculpted[v * 3] - point.x) * axis.x + (unsculpted[v * 3 + 1] - point.y) * axis.y + (unsculpted[v * 3 + 2] - point.z) * axis.z;
    if (Math.abs(along) > half) continue;
    x += displaced[v * 3]; y += displaced[v * 3 + 1]; z += displaced[v * 3 + 2]; n++;
  }
  return n ? new Vector3(x / n, y / n, z / n) : new Vector3();
}

export function makeSkeleton(data, positions, unsculpted = null, height = 1.7) {
  const meta = data.skeleton.bones;
  const heads = meta.map(bone => boneHead(bone, data.base.vertexGroups, positions));
  const tails = meta.map(bone => boneHead({ head: bone.tail }, data.base.vertexGroups, positions));
  const byName = new Map(meta.map((bone, i) => [bone.name, i]));
  if (unsculpted) {
    const displaced = new Float32Array(positions.length);
    let moved = false;
    for (let i = 0; i < positions.length; i++) { displaced[i] = positions[i] - unsculpted[i]; if (displaced[i]) moved = true; }
    if (moved) {
      const bodyGroup = data.base.faceGroups.indexOf('body'), bodyVertices = new Set();
      for (let f = 0; f < data.faceGroup.length; f++) if (data.faceGroup[f] === bodyGroup) for (let c = 0; c < 4; c++) bodyVertices.add(data.faces[f * 4 + c]);
      const half = 0.015 * height / 1.7;
      const parentOf = meta.map(bone => bone.parent == null ? -1 : byName.get(bone.parent));
      const shifts = meta.map((bone, i) => {
        const axis = tails[i].clone().sub(heads[i]).normalize();
        if (axis.lengthSq() < 0.5) return [new Vector3(), new Vector3()];
        const children = parentOf.flatMap((p, c) => p === i ? [c] : []);
        return [
          sculptShift(data, unsculpted, displaced, bodyVertices, heads[i], axis, new Set([i, parentOf[i]]), half),
          sculptShift(data, unsculpted, displaced, bodyVertices, tails[i], axis, new Set([i, ...children]), half),
        ];
      });
      shifts.forEach(([head, tail], i) => { heads[i].add(head); tails[i].add(tail); });
    }
  }
  const bones = meta.map(({ name }) => { const bone = new Bone(); bone.name = name; return bone; });
  // World rest rotation of every bone (Root: head and tail coincide, identity).
  const rest = meta.map((bone, i) => boneRest(tails[i].clone().sub(heads[i]), bone.roll ?? 0));
  const roots = [];
  for (let i = 0; i < bones.length; i++) {
    const parent = meta[i].parent == null ? undefined : byName.get(meta[i].parent);
    if (parent === undefined) {
      bones[i].position.copy(heads[i]);
      bones[i].quaternion.copy(rest[i]);
      roots.push(bones[i]);
    } else {
      const inverse = rest[parent].clone().invert();
      bones[i].position.copy(heads[i]).sub(heads[parent]).applyQuaternion(inverse);
      bones[i].quaternion.copy(inverse).multiply(rest[i]);
      bones[parent].add(bones[i]);
    }
  }
  return { bones, roots, heads, tails, rest, byName };
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
export const skinMaps = {
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
  // `tint` multiplies texels (baked into the texture); it is never a material factor.
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
  const unsculpted = spec.sculpt?.body && Object.keys(spec.sculpt.body).length ? positions.slice() : null;
  applyOffsets(positions, spec.sculpt?.body, spec.heightMeters ?? 1.7);
  const group = new Group();
  try {
  group.name = 'Human';
  // Joints follow the sculpted skin as well as the morphs.
  const skeleton = makeSkeleton(data, positions, unsculpted, spec.heightMeters ?? 1.7);
  for (const root of skeleton.roots) group.add(root);
  const geometry = makeBodyGeometry(data, positions);
  const skin = skinMaterialFor(spec);
  // glTF limits baseColorFactor to [0, 1]: untextured skin is the target tone;
  // a textured one carries the tint baked into its texture and a white factor.
  const material = new MeshStandardMaterial({
    color: skin.target,
    roughness: 0.55 + 0.4 * Math.max(0, Math.min(1, spec.skinRoughness ?? 0.6)),
  });
  const skinURL = new URL(`../assets/skins/${skin.file}`, import.meta.url).href;
  if (spec.lod !== 'low') material.userData.hgsSkinTexture = { url: skinURL, tint: skin.tint.toArray() };
  if (typeof document !== 'undefined' && spec.lod !== 'low') {
    material.map = await tintedSkinTexture(skinURL, skin.tint.toArray());
    material.color.set(0xffffff);
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
  // The facial rig goes into LOD0 and LOD1: simplification only rewrites the index list, so the
  // blendshapes survive it (lod.mjs). The far level (crowds, LOD2) has none.
  const faceMeshes = context.lod !== 'low' ? await addFaceRig(context, spec.faceWeights ?? {}) : [];
  if (spec.lod === 'medium' || spec.lod === 'low') {
    await checkpoint('Detalhes');
    const meshes = [];
    group.traverse(object => { if (object.isMesh) meshes.push(object); });
    let error = 0;
    for (const mesh of meshes) {
      signal?.throwIfAborted();
      const previous = mesh.geometry, reduced = await reduceGeometry(previous, spec.lod);
      mesh.geometry = reduced.geometry; error = Math.max(error, reduced.error);
      if (mesh.geometry !== previous) { previous.dispose(); if (mesh.morphTargetDictionary) mesh.updateMorphTargets(); }
      // A multi-material mesh keeps its groups (one simplified subset per group); without groups, one material.
      if (Array.isArray(mesh.material) && !mesh.geometry.groups.length) { mesh.material.slice(1).forEach(m => m.dispose()); mesh.material = mesh.material[0]; }
    }
    // updateMorphTargets cleared the influences: the expression goes back on.
    applyFaceWeights(faceMeshes, spec.faceWeights ?? {});
    context.simplificationError = error;
  }
  // Every skinned mesh leaves with glTF-valid weights (one set of four, summing to 1, unused slots 0).
  group.traverse(object => { if (object.isSkinnedMesh) sanitizeSkin(object.geometry, object.name); });
  const animations = buildClips(skeleton, spec.pose ?? 0, faceMeshes.map(mesh => mesh.name));
  group.animations = animations;
  const bounds = body.geometry.boundingBox;
  const height = bounds.max.y - bounds.min.y;
  await checkpoint('Pronto');
  return {
    // What the hair editor needs to rebuild locks on this exact body.
    context: { data, positions, skeleton, outfitSurface: context.outfitSurface ?? null, height: context.height, lod: context.lod },
    group, body, animations, faceMeshes,
    metrics: { height, vertices: body.geometry.getAttribute('position').count, triangles: body.geometry.index.count / 3, simplificationError: context.simplificationError ?? 0 },
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
/**
 * Skinned parts merged into one skinned mesh: attributes unified (UV 0 and
 * COLOR_0 white where a part has none — glTF always multiplies COLOR_0, so
 * white is neutral), one draw group per part group and its material. Parts
 * with morphs must share the same named targets (glTF: every primitive of a
 * mesh has the same morph targets in the same order).
 */
function mergeSkinned(parts, name, skeleton, bindMatrix) {
  const indexCount = g => g.index ? g.index.count : g.getAttribute('position').count;
  let vertices = 0, indices = 0;
  for (const { geometry } of parts) { vertices += geometry.getAttribute('position').count; indices += indexCount(geometry); }
  const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), uv = new Float32Array(vertices * 2);
  const color = new Float32Array(vertices * 4).fill(1), skinIndex = new Uint16Array(vertices * 4), skinWeight = new Float32Array(vertices * 4);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  const targets = parts[0].geometry.morphAttributes.position ?? [];
  const morphPosition = targets.map(() => new Float32Array(vertices * 3)), morphNormal = targets.map(() => new Float32Array(vertices * 3));
  const geometry = new BufferGeometry(), materials = [];
  const copy = (attribute, out, offset, size) => { if (!attribute) return; for (let i = 0; i < attribute.count; i++) for (let k = 0; k < size; k++) out[(offset + i) * size + k] = k < attribute.itemSize ? attribute.getComponent(i, k) : 1; };
  let v0 = 0, i0 = 0;
  for (const part of parts) {
    const g = part.geometry, n = g.getAttribute('position').count;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    copy(g.getAttribute('position'), position, v0, 3); copy(g.getAttribute('normal'), normal, v0, 3); copy(g.getAttribute('uv'), uv, v0, 2);
    copy(g.getAttribute('color'), color, v0, 4); copy(g.getAttribute('skinIndex'), skinIndex, v0, 4); copy(g.getAttribute('skinWeight'), skinWeight, v0, 4);
    targets.forEach((_, t) => { copy(g.morphAttributes.position?.[t], morphPosition[t], v0, 3); copy(g.morphAttributes.normal?.[t], morphNormal[t], v0, 3); });
    const count = indexCount(g);
    for (let i = 0; i < count; i++) index[i0 + i] = (g.index ? g.index.getX(i) : i) + v0;
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      const material = Array.isArray(part.material) ? part.material[group.materialIndex] : part.material;
      let slot = materials.indexOf(material);
      if (slot < 0) { slot = materials.length; materials.push(material); }
      // Adjacent ranges with the same material are one draw call.
      const start = i0 + group.start, length = Math.min(group.count, count - group.start), last = geometry.groups.at(-1);
      if (last && last.materialIndex === slot && last.start + last.count === start) last.count += length;
      else geometry.addGroup(start, length, slot);
    }
    v0 += n; i0 += count;
  }
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(color, 4));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(vertices > 65535 ? new Uint32BufferAttribute(index, 1) : new Uint16BufferAttribute(index, 1));
  if (targets.length) {
    const named = (arrays, t) => { const attribute = new Float32BufferAttribute(arrays[t], 3); attribute.name = targets[t].name; return attribute; };
    geometry.morphAttributes.position = targets.map((_, t) => named(morphPosition, t));
    geometry.morphAttributes.normal = targets.map((_, t) => named(morphNormal, t));
    geometry.morphTargetsRelative = true;
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new SkinnedMesh(geometry, materials);
  mesh.name = name;
  mesh.bind(skeleton, bindMatrix);
  if (targets.length) mesh.updateMorphTargets();
  return mesh;
}

/**
 * Game-oriented export geometry, applied temporarily: weld the per-corner
 * vertices, split the face skin that blendshapes move (position or normal)
 * from the rest of the body, and merge the character into two skinned meshes
 * as engines prefer (Unity: one skinned mesh renderer per character): `Body`
 * (no morphs, one group per part and material) and `Head` (face skin, mouth,
 * brows and lashes with the 32 blendshapes). Opaque textures go as JPEG.
 * Returns a function that undoes it.
 */
function optimizeForExport(human, clips, suffix = '') {
  const undo = [], meshes = [], parts = [];
  human.group.traverse(object => { if (object.isSkinnedMesh && object.visible) meshes.push(object); });
  for (const mesh of meshes) {
    const morphs = mesh.geometry.morphAttributes.position;
    // Welding copies attributes without their names; morph names are the
    // blendshape names, so put them back.
    const named = geometry => { for (const key of ['position', 'normal']) geometry.morphAttributes[key]?.forEach((attribute, i) => { attribute.name = morphs[i].name; }); return geometry; };
    const welded = named(mergeVertices(mesh.geometry, 1e-6));
    if (mesh === human.body && morphs?.length) {
      // Faces touching any vertex a blendshape moves or re-shades form the head.
      const moving = new Uint8Array(welded.getAttribute('position').count);
      for (const key of ['position', 'normal']) for (const target of welded.morphAttributes[key] ?? []) for (let i = 0; i < target.count; i++) {
        if (Math.abs(target.getX(i)) + Math.abs(target.getY(i)) + Math.abs(target.getZ(i)) > 1e-7) moving[i] = 1;
      }
      const index = welded.index.array, headFaces = [], bodyFaces = [];
      for (let i = 0; i < index.length; i += 3) (moving[index[i]] || moving[index[i + 1]] || moving[index[i + 2]] ? headFaces : bodyFaces).push(index[i], index[i + 1], index[i + 2]);
      const head = welded.clone(); head.setIndex(headFaces);
      const rest = welded.clone(); rest.setIndex(bodyFaces); rest.morphAttributes = {};
      const compact = geometry => { const flat = geometry.toNonIndexed(); const result = mergeVertices(flat, 1e-6); flat.dispose(); return named(result); };
      parts.push({ geometry: compact(head), material: mesh.material, source: mesh, morph: true });
      parts.push({ geometry: compact(rest), material: mesh.material, source: mesh, morph: false });
      head.dispose(); rest.dispose(); welded.dispose();
    } else parts.push({ geometry: welded, material: mesh.material, source: mesh, morph: Boolean(welded.morphAttributes.position?.length) });
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) for (const key of ['map', 'normalMap']) {
      const texture = material?.[key];
      // Opaque colour and normal maps compress far better as JPEG.
      if (texture && !material.transparent && !material.alphaTest && texture.userData.mimeType === undefined) {
        texture.userData.mimeType = 'image/jpeg';
        undo.push(() => { delete texture.userData.mimeType; });
      }
    }
  }
  const skeleton = human.body.skeleton, bindMatrix = human.body.bindMatrix, merged = [];
  const bodies = parts.filter(part => !part.morph), faces = parts.filter(part => part.morph);
  // `suffix` names the level for engines that build LOD groups from names (Unity: `_LODX`).
  if (bodies.length) merged.push(mergeSkinned(bodies, `Body${suffix}`, skeleton, bindMatrix));
  if (faces.length) {
    const head = mergeSkinned(faces, `Head${suffix}`, skeleton, bindMatrix), source = faces[0].source;
    for (const [shape, i] of Object.entries(head.morphTargetDictionary)) head.morphTargetInfluences[i] = source.morphTargetInfluences[source.morphTargetDictionary[shape]] ?? 0;
    merged.push(head);
  }
  for (const part of parts) part.geometry.dispose();
  for (const mesh of meshes) { mesh.visible = false; undo.push(() => { mesh.visible = true; }); }
  for (const mesh of merged) { human.group.add(mesh); undo.push(() => { mesh.removeFromParent(); mesh.geometry.dispose(); }); }
  // Facial tracks of every face part now drive the one Head mesh, once per shape.
  const faceNodes = new Set(faces.map(part => part.source.name));
  for (const clip of clips) {
    const seen = new Set();
    clip.tracks = clip.tracks.filter(track => {
      const [node, ...rest] = track.name.split('.');
      if (!faceNodes.has(node) || !rest[0]?.startsWith('morphTargetInfluences')) return true;
      const renamed = [`Head${suffix}`, ...rest].join('.');
      if (seen.has(renamed)) return false;
      seen.add(renamed); track.name = renamed; return true;
    });
  }
  return () => { for (const step of undo.reverse()) step(); };
}

/**
 * VRMC_springBone 1.0 for the hair joint chains (glTF exporter plugin): the
 * chains, colliders and groups of `definition`, with bone names turned into
 * node indices once the nodes are written.
 */
function springBonePlugin(definition, boneByName) {
  return writer => ({
    name: 'VRMC_springBone',
    afterParse() {
      const node = name => writer.nodeMap.get(boneByName.get(name));
      const kept = definition.colliders.map(collider => node(collider.bone) === undefined ? null : { node: node(collider.bone), shape: collider.shape });
      const remap = new Map(); const colliders = [];
      kept.forEach((collider, i) => { if (collider) { remap.set(i, colliders.length); colliders.push(collider); } });
      const springs = definition.springs.map(spring => ({
        name: spring.name, colliderGroups: spring.colliderGroups,
        joints: spring.joints.map(joint => ({ ...joint, node: node(joint.node) })),
      })).filter(spring => spring.joints.every(joint => joint.node !== undefined));
      if (!springs.length) return;
      writer.json.extensions ??= {};
      writer.json.extensions.VRMC_springBone = {
        specVersion: '1.0', colliders,
        colliderGroups: definition.colliderGroups.map(group => ({ name: group.name, colliders: group.colliders.filter(i => remap.has(i)).map(i => remap.get(i)) })),
        springs,
      };
      writer.extensionsUsed.VRMC_springBone = true;
    },
  });
}

/**
 * Binary glTF of the character. Options: `skeleton` ('unreal' | 'mixamo'),
 * `animations` (include clips), `blendshapes` (include facial morph targets),
 * `cosmetic` (keep the transparent corneal layers, which games rarely want).
 */
export async function exportHumanGLB(human, { skeleton = 'unreal', animations = true, blendshapes = true, cosmetic = true, optimize = true, suffix = '' } = {}) {
  const bones = human.body.skeleton.bones;
  const original = bones.map(bone => bone.name);
  const boneByName = new Map(bones.map((bone, i) => [original[i], bone]));
  const springs = human.group.userData.hairSprings ?? null;
  const hidden = [], morphs = [], stashed = [];
  let restore = () => {};
  // Joints are written at the bind pose, never at the current animation frame
  // (the glTF node transforms are what engines import as the rest pose).
  const posed = bones.map(bone => [bone.position.clone(), bone.quaternion.clone(), bone.scale.clone()]);
  human.body.skeleton.pose();
  try {
    if (skeleton === 'mixamo') bones.forEach(bone => { bone.name = mixamoName(bone.name); });
    if (!cosmetic) human.group.traverse(object => { if (object.userData.role === 'corneal-wetness' && object.visible) { object.visible = false; hidden.push(object); } });
    if (!blendshapes) human.group.traverse(object => {
      if (!object.geometry?.morphAttributes?.position) return;
      morphs.push([object, object.geometry.morphAttributes, object.morphTargetInfluences, object.morphTargetDictionary]);
      object.geometry.morphAttributes = {};
      object.morphTargetInfluences = undefined; object.morphTargetDictionary = undefined;
    });
    // userData is app state (vertex ids, sculpt keys, local asset URLs); the
    // exporter would write it as extras, so it is left out of the file.
    human.group.traverse(object => {
      for (const owner of [object, object.geometry, ...(Array.isArray(object.material) ? object.material : [object.material])]) {
        if (owner?.userData && Object.keys(owner.userData).length) { stashed.push([owner, owner.userData]); owner.userData = {}; }
      }
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
    if (optimize) restore = optimizeForExport(human, clips, suffix);
    // The character's parts are the scene's root nodes: a skinned mesh under a
    // parent node gets NODE_SKINNED_MESH_NON_ROOT (its transform is ignored).
    const scene = new Scene();
    scene.children.push(...human.group.children);
    const exporter = new GLTFExporter();
    if (springs) exporter.register(springBonePlugin(springs, boneByName));
    return await exporter.parseAsync(scene, { binary: true, animations: clips, maxTextureSize: 2048 });
  } finally {
    restore();
    for (const [owner, userData] of stashed) owner.userData = userData;
    bones.forEach((bone, i) => { bone.name = original[i]; bone.position.copy(posed[i][0]); bone.quaternion.copy(posed[i][1]); bone.scale.copy(posed[i][2]); });
    for (const object of hidden) object.visible = true;
    for (const [object, attributes, influences, dictionary] of morphs) {
      object.geometry.morphAttributes = attributes; object.morphTargetInfluences = influences; object.morphTargetDictionary = dictionary;
    }
  }
}
