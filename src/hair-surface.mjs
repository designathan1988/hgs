import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Uint16BufferAttribute, Vector3 } from 'three';

const pointKey = (p, i) => [p.getX(i), p.getY(i), p.getZ(i)].map(x => Math.round(x * 1e6)).join(',');

/** One seam-aware subdivision of a solid hairstyle, retaining UVs and skinning. */
export function refineHair(geometry) {
  const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const groups = [], lookup = new Map(), ids = [];
  for (let i = 0; i < p.count; i++) {
    const key = pointKey(p, i);
    if (!lookup.has(key)) { lookup.set(key, groups.length); groups.push({ point: new Vector3().fromBufferAttribute(p, i), neighbours: new Set(), boundary: new Set() }); }
    ids.push(lookup.get(key));
  }
  const edges = new Map(), source = geometry.index.array;
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (let i = 0; i < source.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = ids[source[i + k]], b = ids[source[i + (k + 1) % 3]], c = ids[source[i + (k + 2) % 3]];
    if (a === b) continue;
    groups[a].neighbours.add(b); groups[b].neighbours.add(a);
    const key = edgeKey(a, b);
    if (!edges.has(key)) edges.set(key, { a, b, opposite: new Set() });
    edges.get(key).opposite.add(c);
  }
  for (const edge of edges.values()) if (edge.opposite.size === 1) {
    groups[edge.a].boundary.add(edge.b); groups[edge.b].boundary.add(edge.a);
  }
  const smooth = groups.map(group => {
    const neighbours = group.boundary.size === 2 ? group.boundary : group.neighbours;
    const beta = group.boundary.size === 2 ? 0.125 : neighbours.size === 3 ? 0.1875 : 3 / (8 * Math.max(1, neighbours.size));
    const point = group.point.clone().multiplyScalar(1 - neighbours.size * beta);
    for (const id of neighbours) point.addScaledVector(groups[id].point, beta);
    // Retain the fit and parting of the authored hairstyle.
    return group.point.clone().lerp(point, 0.45);
  });
  const positions = [], uvs = [], outJoints = [], outWeights = [], faces = [];
  for (let i = 0; i < p.count; i++) {
    positions.push(...smooth[ids[i]].toArray());
    uvs.push(uv.getX(i), uv.getY(i));
    for (let k = 0; k < 4; k++) { outJoints.push(joints.getComponent(i, k)); outWeights.push(weights.getComponent(i, k)); }
  }
  const split = new Map();
  const midpoint = (a, b) => {
    const key = edgeKey(a, b);
    if (split.has(key)) return split.get(key);
    const id = positions.length / 3, edge = edges.get(edgeKey(ids[a], ids[b]));
    const linear = groups[ids[a]].point.clone().add(groups[ids[b]].point).multiplyScalar(0.5);
    const curved = linear.clone();
    if (edge?.opposite.size === 2) {
      curved.multiplyScalar(0.75);
      for (const c of edge.opposite) curved.addScaledVector(groups[c].point, 0.125);
    }
    positions.push(...linear.lerp(curved, 0.45).toArray());
    uvs.push((uv.getX(a) + uv.getX(b)) / 2, (uv.getY(a) + uv.getY(b)) / 2);
    const influences = new Map();
    for (const v of [a, b]) for (let k = 0; k < 4; k++) {
      const bone = joints.getComponent(v, k);
      influences.set(bone, (influences.get(bone) ?? 0) + weights.getComponent(v, k) * 0.5);
    }
    const top = [...influences].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((s, [, w]) => s + w, 0);
    for (let k = 0; k < 4; k++) { outJoints.push(top[k]?.[0] ?? 0); outWeights.push((top[k]?.[1] ?? 0) / total); }
    split.set(key, id); return id;
  };
  for (let i = 0; i < source.length; i += 3) {
    const a = source[i], b = source[i + 1], c = source[i + 2];
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    faces.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  result.setAttribute('skinIndex', new Uint16BufferAttribute(outJoints, 4));
  result.setAttribute('skinWeight', new Float32BufferAttribute(outWeights, 4));
  result.setIndex(faces);
  result.computeVertexNormals();
  const normals = result.getAttribute('normal'), points = result.getAttribute('position'), sums = new Map();
  for (let i = 0; i < points.count; i++) {
    const key = pointKey(points, i);
    if (!sums.has(key)) sums.set(key, new Vector3());
    sums.get(key).add(new Vector3().fromBufferAttribute(normals, i));
  }
  for (let i = 0; i < points.count; i++) {
    const n = sums.get(pointKey(points, i)).clone().normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  return result;
}

/** Convert existing strand luminance to a standard exportable tangent normal map. */
export function hairNormalMap(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height), out = ctx.createImageData(canvas.width, canvas.height);
  const value = (x, y) => {
    x = Math.max(0, Math.min(canvas.width - 1, x)); y = Math.max(0, Math.min(canvas.height - 1, y));
    const i = (y * canvas.width + x) * 4;
    return (source.data[i] + source.data[i + 1] + source.data[i + 2]) / 765;
  };
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const n = new Vector3((value(x - 1, y) - value(x + 1, y)) * 2.8, (value(x, y + 1) - value(x, y - 1)) * 2.8, 1).normalize();
    const i = (y * canvas.width + x) * 4;
    out.data[i] = (n.x * 0.5 + 0.5) * 255; out.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
    out.data[i + 2] = (n.z * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const texture = new CanvasTexture(canvas); texture.flipY = false;
  return texture;
}
