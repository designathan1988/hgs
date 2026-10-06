import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, SkinnedMesh, Uint16BufferAttribute } from 'three';
import { blendshapeNames, buildFaceShapes, expressionWeights } from './face-rig.mjs';

/** Teeth and tongue from the base mesh helpers, so an open jaw shows a mouth. */
function mouthMesh(context) {
  const { data, positions } = context;
  const wanted = new Map([['helper-upper-teeth', 0xe9e2d4], ['helper-lower-teeth', 0xe9e2d4], ['helper-tongue', 0xa8494a]]);
  const groupColor = new Map();
  data.base.faceGroups.forEach((name, index) => { if (wanted.has(name)) groupColor.set(index, wanted.get(name)); });
  const pos = [], colors = [], joints = [], weights = [], index = [], baseIds = [], mouthZ = [];
  const corner = new Map();
  for (let face = 0; face < data.faceGroup.length; face++) {
    const color = groupColor.get(data.faceGroup[face]);
    if (color === undefined) continue;
    const ids = [];
    for (let k = 0; k < 4; k++) {
      const v = data.faces[face * 4 + k];
      if (!corner.has(v)) {
        corner.set(v, baseIds.length);
        baseIds.push(v);
        // Seat the teeth a little behind the lips so closed lips hide them.
        pos.push(positions[v * 3] * 0.97, positions[v * 3 + 1] + 0.0012, positions[v * 3 + 2] - 0.0035);
        colors.push(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
        mouthZ.push(positions[v * 3 + 2]);
        let sum = 0;
        for (let j = 0; j < 4; j++) { joints.push(data.joints[v * 4 + j]); const w = data.weights[v * 4 + j] / 65535; weights.push(w); sum += w; }
        if (sum < 1e-6) weights.splice(-4, 4, 1, 0, 0, 0);
      }
      ids.push(corner.get(v));
    }
    index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  if (!index.length) return null;
  // The mouth has no shadowing, so darken it with depth as a cheap occlusion
  // term; the teeth then read as being inside the mouth.
  const front = Math.max(...mouthZ), back = Math.min(...mouthZ);
  for (let i = 0; i < mouthZ.length; i++) {
    const shade = 0.3 + 0.3 * ((mouthZ[i] - back) / Math.max(1e-6, front - back)) ** 2;
    colors[i * 3] *= shade; colors[i * 3 + 1] *= shade; colors[i * 3 + 2] *= shade;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.userData.baseIds = Uint32Array.from(baseIds);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }));
  mesh.name = 'Mouth';
  context.group.add(mesh);
  mesh.bind(context.body.skeleton, context.body.bindMatrix);
  return mesh;
}

function setMorphs(geometry, deltaFor) {
  geometry.morphAttributes.position = blendshapeNames.map(name => {
    const attribute = new Float32BufferAttribute(deltaFor(name), 3);
    attribute.name = name;
    return attribute;
  });
  geometry.morphTargetsRelative = true;
}

function nearestHeadVertex(positions, candidates) {
  // Uniform grid over the head vertices, 1 cm cells.
  const cell = 0.01, grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const v of candidates) {
    const k = key(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(v);
  }
  return (x, y, z) => {
    let best = -1, distance = Infinity;
    for (let ring = 0; ring < 4 && best < 0; ring++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) for (let k = -ring; k <= ring; k++) {
        for (const v of grid.get(`${cx + i},${cy + j},${cz + k}`) ?? []) {
          const d = (positions[v * 3] - x) ** 2 + (positions[v * 3 + 1] - y) ** 2 + (positions[v * 3 + 2] - z) ** 2;
          if (d < distance) { distance = d; best = v; }
        }
      }
    }
    return best;
  };
}

/**
 * Give the body, mouth and face grooms the same named morph targets and set
 * their starting weights. Returns the meshes that carry the face rig.
 */
export async function addFaceRig(context, weights = {}) {
  const { data, positions, body, group } = context;
  const { shapes } = await buildFaceShapes(data, positions, positions.unitScale ?? 0.1);
  const count = positions.length / 3;
  const dense = new Map([...shapes].map(([name, shape]) => {
    const values = new Float32Array(count * 3);
    shape.indices.forEach((v, i) => values.set(shape.deltas.subarray(i * 3, i * 3 + 3), v * 3));
    return [name, values];
  }));
  const perVertex = (ids, name) => {
    const source = dense.get(name), out = new Float32Array(ids.length * 3);
    ids.forEach((v, i) => { if (v >= 0) out.set(source.subarray(v * 3, v * 3 + 3), i * 3); });
    return out;
  };
  const meshes = [];
  setMorphs(body.geometry, name => perVertex(body.geometry.userData.baseIds, name));
  meshes.push(body);
  const mouth = mouthMesh(context);
  if (mouth) { setMorphs(mouth.geometry, name => perVertex(mouth.geometry.userData.baseIds, name)); meshes.push(mouth); }
  // Grooms follow the skin they sit on.
  const headBone = data.skeleton.bones.findIndex(bone => bone.name === 'head');
  const headVertices = [];
  for (let v = 0; v < count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (data.joints[v * 4 + k] === headBone) w += data.weights[v * 4 + k];
    if (w > 0.5 * 65535) headVertices.push(v);
  }
  const nearest = nearestHeadVertex(positions, headVertices);
  // Brows ignore the eyelid shapes: lid skin is their nearest neighbour at the
  // brow's lower edge, but lids close under the brow, not with it.
  const lidShapes = /^eye(Blink|Squint)/;
  for (const name of ['Brows', 'Lashes', 'BrowCoverage']) {
    const mesh = group.getObjectByName(name);
    if (!mesh) continue;
    const position = mesh.geometry.getAttribute('position');
    const ids = Array.from({ length: position.count }, (_, i) => nearest(position.getX(i), position.getY(i), position.getZ(i)));
    const brow = name !== 'Lashes';
    setMorphs(mesh.geometry, shape => brow && lidShapes.test(shape) ? new Float32Array(ids.length * 3) : perVertex(ids, shape));
    meshes.push(mesh);
  }
  for (const mesh of meshes) { mesh.updateMorphTargets(); }
  applyFaceWeights(meshes, weights);
  return meshes;
}

/** Combine an expression preset with per-shape overrides. */
export function faceWeights(expression = 0, intensity = 1, custom = {}) {
  const result = {};
  for (const [name, value] of Object.entries(expressionWeights[expression] ?? {})) result[name] = value * intensity;
  for (const [name, value] of Object.entries(custom ?? {})) if (Number.isFinite(value) && value !== 0) result[name] = Math.max(0, Math.min(1, (result[name] ?? 0) + value));
  return result;
}

export function applyFaceWeights(meshes, weights) {
  for (const mesh of meshes) {
    if (!mesh.morphTargetDictionary) continue;
    mesh.morphTargetInfluences.fill(0);
    for (const [name, value] of Object.entries(weights)) {
      const index = mesh.morphTargetDictionary[name];
      if (index !== undefined) mesh.morphTargetInfluences[index] = value;
    }
  }
}
