import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const simplifier = new SimplifyModifier();
const fractions = { medium: 0.36, low: 0.12 };

/** Keep UVs, normals and skin attributes while reducing the actual index list. */
export async function reduceGeometry(geometry, level) {
  const fraction = fractions[level];
  if (!fraction || !geometry.index || geometry.index.count < 900) return geometry;
  const welded = mergeVertices(geometry);
  const vertices = welded.getAttribute('position').count;
  const remove = Math.floor(vertices * (1 - fraction));
  const reduced = await simplifier.modify(welded, remove);
  welded.dispose();
  reduced.computeBoundingBox();
  return reduced;
}
