import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three';
import { blendshapeNames, buildFaceShapes, expressionWeights, eyeLookDegrees, legacyShapes } from './face-rig.mjs';

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

/**
 * Named morph targets for position and normal (glTF morphs POSITION and
 * NORMAL as relative displacements). `normalFor(name, delta)` returns the
 * normal displacement of the shape; without it normals are left neutral.
 */
function setMorphs(geometry, deltaFor, normalFor = null) {
  const deltas = blendshapeNames.map(name => deltaFor(name));
  const named = (array, name) => { const attribute = new Float32BufferAttribute(array, 3); attribute.name = name; return attribute; };
  geometry.morphAttributes.position = deltas.map((delta, i) => named(delta, blendshapeNames[i]));
  if (normalFor) geometry.morphAttributes.normal = deltas.map((delta, i) => named(normalFor(blendshapeNames[i], delta), blendshapeNames[i]));
  geometry.morphTargetsRelative = true;
}

/** Smooth normals per base vertex over the visible body faces (as human-three.mjs builds the body's own normals). */
function baseNormals(data, faces, positions) {
  const smooth = new Float32Array(positions.length);
  for (const face of faces) {
    const a = data.faces[face * 4] * 3, b = data.faces[face * 4 + 1] * 3, c = data.faces[face * 4 + 2] * 3;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (let k = 0; k < 4; k++) { const at = data.faces[face * 4 + k] * 3; smooth[at] += nx; smooth[at + 1] += ny; smooth[at + 2] += nz; }
  }
  for (let i = 0; i < smooth.length; i += 3) { const l = Math.hypot(smooth[i], smooth[i + 1], smooth[i + 2]) || 1; smooth[i] /= l; smooth[i + 1] /= l; smooth[i + 2] /= l; }
  return smooth;
}

/** Normal displacement of a shape on a mesh whose normals are its own vertex normals (mouth, grooms). */
function meshNormalDelta(geometry) {
  const position = geometry.getAttribute('position'), index = geometry.index;
  const normalsOf = array => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(array, 3)); if (index) g.setIndex(index.clone()); g.computeVertexNormals(); const n = g.getAttribute('normal').array; g.dispose(); return n; };
  const neutral = normalsOf(Float32Array.from(position.array));
  return (_name, delta) => {
    if (!delta.some(Boolean)) return new Float32Array(delta.length);
    const moved = Float32Array.from(position.array);
    for (let i = 0; i < moved.length; i++) moved[i] += delta[i];
    const shaped = normalsOf(moved), out = new Float32Array(delta.length);
    for (let i = 0; i < out.length; i++) out[i] = shaped[i] - neutral[i];
    return out;
  };
}

/**
 * The eyeLook shapes on the eyeballs: each eye turns about its own centre
 * (yaw about +Y, pitch about +X, right-hand rule; the character's left eye is
 * at +x and looks "out" towards +x). A blendshape is linear, so the turn is
 * exact at weights 0 and 1. Returns { position, normal } delta makers.
 */
function eyeLook(geometry) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  // Only the drawn eyeball: the eyes proxy keeps its corneal shell's vertices, unindexed, in front of
  // the globe; counting them moved the centre forward and the turned eye out of the lids.
  const drawn = new Uint8Array(position.count);
  if (geometry.index) for (const v of geometry.index.array) drawn[v] = 1; else drawn.fill(1);
  const centre = sign => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.count; i++) {
      if (!drawn[i] || Math.sign(position.getX(i)) !== sign) continue;
      for (let k = 0; k < 3; k++) { const v = position.getComponent(i, k); min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); }
    }
    // The proxy's eyeball is a spherical cap (measured: 3.0 cm wide and tall, 2.0 cm deep), not a
    // whole sphere: its centre is one radius behind its front, not the middle of its box.
    const radius = (max[0] - min[0] + max[1] - min[1]) / 4;
    return new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2] - radius);
  };
  const centres = { 1: centre(1), [-1]: centre(-1) }, X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), deg = Math.PI / 180;
  // Per shape: the eye it moves (+1 left, -1 right) and its rotation.
  const turn = name => {
    const match = /^eyeLook(Up|Down|In|Out)(Left|Right)$/.exec(name);
    if (!match) return null;
    const sign = match[2] === 'Left' ? 1 : -1, d = eyeLookDegrees;
    if (match[1] === 'Up') return { sign, axis: X, angle: -d.up * deg };
    if (match[1] === 'Down') return { sign, axis: X, angle: d.down * deg };
    // Out turns the left eye to +x (+angle about Y), the right eye to -x; In the other way.
    const out = match[1] === 'Out';
    return { sign, axis: Y, angle: (out ? 1 : -1) * sign * (out ? d.out : d.in) * deg };
  };
  const make = (name, attribute, about) => {
    const out = new Float32Array(position.count * 3), t = turn(name);
    if (!t || !attribute) return out;
    const p = new Vector3();
    for (let i = 0; i < position.count; i++) {
      if (Math.sign(position.getX(i)) !== t.sign) continue;
      p.fromBufferAttribute(attribute, i);
      if (about) p.sub(centres[t.sign]);
      const turned = p.clone().applyAxisAngle(t.axis, t.angle);
      out[i * 3] = turned.x - p.x; out[i * 3 + 1] = turned.y - p.y; out[i * 3 + 2] = turned.z - p.z;
    }
    return out;
  };
  return { position: name => make(name, position, true), normal: name => make(name, normal, false) };
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
 * ARKit's neutral face (every coefficient at 0) has the lips together; MakeHuman's base mouth stands
 * a slit apart (0.25–0.5 mm, measured), and the lit teeth show through it as a white line. The slit's
 * height is measured on the body itself with rays from the front, in columns across the mouth, and
 * the neutral body geometry gets the fraction of mouthClose (lips closing, jaw kept) that shuts every
 * column: a shape is linear in its weight, so the slit shrinks linearly too; two measurements (weight
 * 0 and 0.1) give each column's rate, and the largest weight needed (plus 0.4 mm) is applied. The base
 * positions stay as they are, so every shape stays relative to them. Returns the weight.
 */
function sealLips(body, close, positions) {
  if (!close) return 0;
  const count = positions.length / 3;
  // The lower lip: what mouthClose really lifts (its falloff barely touches the upper lip too).
  let lift = 0;
  for (let v = 0; v < count; v++) lift = Math.max(lift, close[v * 3 + 1]);
  let lip = -1;
  for (let v = 0; v < count; v++) {
    if (Math.abs(positions[v * 3]) < 0.004 && close[v * 3 + 1] > 0.25 * lift && (lip < 0 || positions[v * 3 + 1] > positions[lip * 3 + 1])) lip = v;
  }
  if (lip < 0) return 0;
  const lipY = positions[lip * 3 + 1], lipZ = positions[lip * 3 + 2];
  const ids = body.geometry.userData.baseIds, position = body.geometry.getAttribute('position'), base = Float32Array.from(position.array);
  // The probe: only the body triangles around the mouth (rays against the whole body would be slow).
  const index = body.geometry.index.array, near = i => Math.abs(base[i * 3]) < 0.05 && Math.abs(base[i * 3 + 1] - lipY) < 0.025 && base[i * 3 + 2] > lipZ - 0.06, keep = [];
  for (let t = 0; t < index.length; t += 3) if (near(index[t]) && near(index[t + 1]) && near(index[t + 2])) keep.push(index[t], index[t + 1], index[t + 2]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', position); geometry.setIndex(keep);
  const probe = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })), ray = new Raycaster(), origin = new Vector3(), back = new Vector3(0, 0, -1);
  const apply = weight => {
    for (let i = 0; i < ids.length; i++) { const v = ids[i] * 3; for (let k = 0; k < 3; k++) position.array[i * 3 + k] = base[i * 3 + k] + weight * close[v + k]; }
    geometry.boundingSphere = null; geometry.boundingBox = null;
  };
  const columns = [0, 0.006, 0.012, 0.016, 0.02];
  const hitZ = (x, y) => { ray.set(origin.set(x, y, lipZ + 0.2), back); return ray.intersectObject(probe, false)[0]?.point.z ?? null; };
  // Per column: the lips' front, then the height where a ray passes it by more than 8 mm (into the mouth).
  const fronts = columns.map(x => { let f = -Infinity; for (let y = lipY - 0.01; y <= lipY + 0.008; y += 0.0005) { const z = hitZ(x, y); if (z !== null) f = Math.max(f, z); } return f; });
  const slits = () => columns.map((x, c) => { let n = 0; for (let y = lipY - 0.01; y <= lipY + 0.008; y += 0.0001) { const z = hitZ(x, y); if (z !== null && z < fronts[c] - 0.008) n++; } return n * 0.0001; });
  const before = slits();
  apply(0.1);
  const after = slits();
  let weight = 0;
  columns.forEach((_, c) => { const rate = (before[c] - after[c]) / 0.1; if (before[c] > 0 && rate > 0) weight = Math.max(weight, (before[c] + 0.0004) / rate); });
  // Capped low: mouthClose lifts the lower lip forward as well as up, and the measurement often asks for
  // the cap, so a cap of 0.3 gave every face a pout (seen in the app); 0.06 keeps the lips as modelled.
  weight = Math.min(0.06, weight);
  apply(weight);
  position.needsUpdate = true;
  probe.material.dispose(); geometry.setIndex(null);
  return weight;
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
  const perVertex = (ids, name, from = dense) => {
    const source = from.get(name), out = new Float32Array(ids.length * 3);
    ids.forEach((v, i) => { if (v >= 0) out.set(source.subarray(v * 3, v * 3 + 3), i * 3); });
    return out;
  };
  const meshes = [];
  // The neutral face with the lips together, as ARKit's neutral (measured slit, see sealLips).
  const seal = body.geometry.userData.lipSeal = sealLips(body, dense.get('mouthClose'), positions);
  // That closure is not ARKit's jawOpen: "jawOpen 1, mouthClose 0" is the mouth wide open (Apple,
  // mouthClose). So jawOpen takes the seal back out as it opens: at 1 the lips part exactly as the shape
  // was authored, at 0 they rest together.
  // Only the body carries the seal (the mouth interior and the grooms keep the shapes as authored).
  const skin = new Map(dense);
  if (seal && dense.has('jawOpen') && dense.has('mouthClose')) {
    const jaw = Float32Array.from(dense.get('jawOpen')), close = dense.get('mouthClose');
    for (let i = 0; i < jaw.length; i++) jaw[i] -= seal * close[i];
    skin.set('jawOpen', jaw);
  }
  // Body normals per base vertex, neutral and for each shape, so a shape's normal
  // displacement is exactly zero wherever no face around a vertex moves.
  const bodyGroup = data.base.faceGroups.indexOf('body'), bodyFaces = [];
  for (let f = 0; f < data.faceGroup.length; f++) if (data.faceGroup[f] === bodyGroup) bodyFaces.push(f);
  const neutral = baseNormals(data, bodyFaces, positions);
  const bodyNormal = name => {
    const delta = skin.get(name), shaped = Float32Array.from(positions);
    for (let i = 0; i < shaped.length; i++) shaped[i] += delta[i];
    const normals = baseNormals(data, bodyFaces, shaped), ids = body.geometry.userData.baseIds, out = new Float32Array(ids.length * 3);
    ids.forEach((v, i) => { for (let k = 0; k < 3; k++) out[i * 3 + k] = normals[v * 3 + k] - neutral[v * 3 + k]; });
    return out;
  };
  setMorphs(body.geometry, name => perVertex(body.geometry.userData.baseIds, name, skin), bodyNormal);
  meshes.push(body);
  const mouth = mouthMesh(context);
  if (mouth) { setMorphs(mouth.geometry, name => perVertex(mouth.geometry.userData.baseIds, name), meshNormalDelta(mouth.geometry)); meshes.push(mouth); }
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
    setMorphs(mesh.geometry, shape => brow && lidShapes.test(shape) ? new Float32Array(ids.length * 3) : perVertex(ids, shape), meshNormalDelta(mesh.geometry));
    meshes.push(mesh);
  }
  // The eyeballs carry the eyeLook shapes (zero for every other shape).
  const eyes = group.getObjectByName('Eyes');
  if (eyes) {
    if (!eyes.geometry.getAttribute('normal')) eyes.geometry.computeVertexNormals();
    const look = eyeLook(eyes.geometry);
    setMorphs(eyes.geometry, look.position, look.normal);
    meshes.push(eyes);
  }
  for (const mesh of meshes) { mesh.updateMorphTargets(); }
  applyFaceWeights(meshes, weights);
  return meshes;
}

/** Combine an expression preset with per-shape overrides. */
export function faceWeights(expression = 0, intensity = 1, custom = {}) {
  const result = {};
  for (const [name, value] of Object.entries(expressionWeights[expression] ?? {})) result[name] = value * intensity;
  for (const [name, value] of Object.entries(custom ?? {})) {
    if (!Number.isFinite(value) || value === 0) continue;
    // Shapes saved before the ARKit split (mouthUpperUp, mouthLowerDown) apply to both sides.
    for (const shape of legacyShapes[name] ?? [name]) result[shape] = Math.max(0, Math.min(1, (result[shape] ?? 0) + value));
  }
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
