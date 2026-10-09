import { BufferAttribute, BufferGeometry } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

/**
 * Levels of detail with meshoptimizer (https://meshoptimizer.org/):
 * attribute-aware simplification that only rewrites the index list, so the
 * kept vertices keep their positions, UVs, skin weights and morph targets
 * (the facial blendshapes survive in LOD1). Triangle share per level follows
 * the budget in docs/PROJETO.md (hair 30k / 15k / 3k: ½ and ⅒); `error` caps
 * the deviation relative to the mesh extents.
 */
export const LOD_LEVELS = { high: null, medium: { ratio: 0.5, error: 0.01 }, low: { ratio: 0.1, error: 0.05 } };
// meshoptimizer README: normals weight ~1; UVs 10–100 by UV density (one atlas for the whole body: low density, 10).
const NORMAL_WEIGHT = 1, UV_WEIGHT = 10;

/**
 * Reduce `geometry` to `level`. Each material group is simplified on its own
 * with its border locked (README: multi-material meshes), Regularize for
 * skinned deformation. Returns { geometry, error } with the error in metres.
 */
export async function reduceGeometry(geometry, level) {
  const settings = LOD_LEVELS[level];
  if (!settings || !geometry.index || geometry.index.count < 900) return { geometry, error: 0 };
  await MeshoptSimplifier.ready;
  // Identical vertices welded first (README: duplicates keep the simplifier from collapsing).
  const welded = mergeVertices(geometry, 1e-6);
  for (const key of Object.keys(welded.morphAttributes)) welded.morphAttributes[key].forEach((attribute, i) => { attribute.name = geometry.morphAttributes[key][i].name; });
  const position = welded.getAttribute('position'), normal = welded.getAttribute('normal'), uv = welded.getAttribute('uv');
  const count = position.count, stride = 5;
  const positions = new Float32Array(count * 3), attributes = new Float32Array(count * stride);
  for (let v = 0; v < count; v++) {
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = position.getComponent(v, k);
    if (normal) for (let k = 0; k < 3; k++) attributes[v * stride + k] = normal.getComponent(v, k);
    if (uv) for (let k = 0; k < 2; k++) attributes[v * stride + 3 + k] = uv.getComponent(v, k);
  }
  const weights = [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT, UV_WEIGHT, UV_WEIGHT];
  const source = welded.index.array;
  const groups = welded.groups.length ? welded.groups : [{ start: 0, count: source.length, materialIndex: 0 }];
  const out = [], kept = [];
  let worst = 0;
  for (const group of groups) {
    const length = Math.min(group.count, source.length - group.start);
    if (length <= 0) continue;
    const indices = Uint32Array.from(source.subarray(group.start, group.start + length));
    const target = Math.max(3, Math.floor(indices.length * settings.ratio / 3) * 3);
    const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, stride, weights, null, target, settings.error, ['LockBorder', 'Regularize']);
    kept.push({ start: out.length, count: reduced.length, materialIndex: group.materialIndex ?? 0 });
    for (let i = 0; i < reduced.length; i++) out.push(reduced[i]);
    worst = Math.max(worst, error);
  }
  const result = compact(welded, out, welded.groups.length ? kept : []);
  welded.dispose();
  return { geometry: result, error: worst * MeshoptSimplifier.getScale(positions, 3) };
}

/** Drop the vertices no triangle uses, remapping every attribute and morph target. */
function compact(source, index, groups) {
  const count = source.getAttribute('position').count, remap = new Int32Array(count).fill(-1);
  let next = 0;
  for (const v of index) if (remap[v] < 0) remap[v] = next++;
  const copy = attribute => {
    const size = attribute.itemSize, array = new attribute.array.constructor(next * size);
    for (let v = 0; v < count; v++) if (remap[v] >= 0) for (let k = 0; k < size; k++) array[remap[v] * size + k] = attribute.getComponent(v, k);
    const result = new BufferAttribute(array, size, attribute.normalized);
    result.name = attribute.name;
    return result;
  };
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, copy(attribute));
  for (const [name, list] of Object.entries(source.morphAttributes)) geometry.morphAttributes[name] = list.map(copy);
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  const mapped = Uint32Array.from(index, v => remap[v]);
  geometry.setIndex(new BufferAttribute(next > 65535 ? mapped : Uint16Array.from(mapped), 1));
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  // Per-vertex records (baseIds, garmentOf, sculpt keys, proxy vertex count) no longer match the reduced vertices.
  geometry.userData = Object.fromEntries(Object.entries(source.userData).filter(([key, value]) => key !== 'proxyVertexCount' && !ArrayBuffer.isView(value) && !Array.isArray(value)));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
