import { Vector3 } from 'three';
import { fitProxy, loadProxy } from './proxy.mjs';

/**
 * Facial blendshapes named after Apple's ARKit face-tracking set, the naming
 * most face-capture tools and engines (Unreal Live Link, Unity, VRM, Blender
 * add-ons) map from. "Left" is the character's own left (+x).
 */
export const blendshapeNames = [
  'eyeBlinkLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeSquintLeft', 'eyeWideLeft',
  'eyeBlinkRight', 'eyeLookDownRight', 'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeSquintRight', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawRight', 'jawOpen',
  'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthDimpleLeft', 'mouthDimpleRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper',
  'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
];
/** Names of the earlier 32-shape set that ARKit splits by side. */
export const legacyShapes = { mouthUpperUp: ['mouthUpperUpLeft', 'mouthUpperUpRight'], mouthLowerDown: ['mouthLowerDownLeft', 'mouthLowerDownRight'] };

/**
 * Eye rotation at full eyeLook weight, degrees, from measured normal ductions
 * (PMC11196818: adduction about 45–50°, elevation 29–34°, adduction with
 * depression 41–46°). The shapes rotate the eyeball (face-mesh.mjs).
 */
export const eyeLookDegrees = { in: 45, out: 45, up: 30, down: 42 };

// Expression presets as blendshape weights (state.mjs expressionNames order).
export const expressionWeights = [
  {},
  { mouthSmileLeft: 0.15, mouthSmileRight: 0.15, eyeSquintLeft: 0.1, eyeSquintRight: 0.1 },
  { mouthSmileLeft: 0.55, mouthSmileRight: 0.55, cheekSquintLeft: 0.35, cheekSquintRight: 0.35, eyeSquintLeft: 0.25, eyeSquintRight: 0.25, browOuterUpLeft: 0.1, browOuterUpRight: 0.1 },
  { mouthSmileLeft: 0.9, mouthSmileRight: 0.9, cheekSquintLeft: 0.6, cheekSquintRight: 0.6, eyeSquintLeft: 0.35, eyeSquintRight: 0.35, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  { mouthSmileLeft: 1, mouthSmileRight: 1, jawOpen: 0.45, cheekSquintLeft: 0.8, cheekSquintRight: 0.8, eyeSquintLeft: 0.6, eyeSquintRight: 0.6, mouthUpperUpLeft: 0.3, mouthUpperUpRight: 0.3, browInnerUp: 0.15 },
  { mouthFrownLeft: 0.75, mouthFrownRight: 0.75, browInnerUp: 0.8, eyeSquintLeft: 0.15, eyeSquintRight: 0.15, mouthPressLeft: 0.2, mouthPressRight: 0.2 },
  { browDownLeft: 1, browDownRight: 1, mouthFrownLeft: 0.45, mouthFrownRight: 0.45, noseSneerLeft: 0.5, noseSneerRight: 0.5, eyeSquintLeft: 0.4, eyeSquintRight: 0.4, mouthPressLeft: 0.5, mouthPressRight: 0.5 },
  { browDownLeft: 0.5, browDownRight: 0.5, mouthFrownLeft: 0.3, mouthFrownRight: 0.3, mouthPressLeft: 0.35, mouthPressRight: 0.35, eyeSquintLeft: 0.25, eyeSquintRight: 0.25 },
  { browInnerUp: 0.9, browOuterUpLeft: 0.9, browOuterUpRight: 0.9, eyeWideLeft: 0.85, eyeWideRight: 0.85, jawOpen: 0.5, mouthFunnel: 0.3 },
  { browInnerUp: 1, mouthStretchLeft: 0.35, mouthStretchRight: 0.35, mouthFrownLeft: 0.3, mouthFrownRight: 0.3, eyeWideLeft: 0.3, eyeWideRight: 0.3 },
  { eyeBlinkLeft: 0.45, eyeBlinkRight: 0.45, browInnerUp: 0.2, mouthFrownLeft: 0.15, mouthFrownRight: 0.15, jawOpen: 0.05 },
  { jawOpen: 0.25, mouthSmileLeft: 0.15, mouthSmileRight: 0.15, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2, mouthUpperUpLeft: 0.1, mouthUpperUpRight: 0.1 },
];

const smooth = (edge0, edge1, x) => { const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };
const range = groups => groups.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));

/**
 * Per-vertex deltas (metres, base-mesh vertex order) for every blendshape,
 * fitted to this person's morphed face. Sparse: only moved vertices are kept.
 */
export async function buildFaceShapes(data, positions, unitScale) {
  const count = positions.length / 3;
  const { morpher, base } = data;
  const headBone = data.skeleton.bones.findIndex(bone => bone.name === 'head');
  const headWeight = new Float32Array(count);
  for (let v = 0; v < count; v++) for (let k = 0; k < 4; k++) if (data.joints[v * 4 + k] === headBone) headWeight[v] += data.weights[v * 4 + k] / 65535;
  const side = v => smooth(-0.004, 0.004, positions[v * 3]); // 1 on the left (+x)
  const eyes = fitProxy(await loadProxy('eyes'), positions);
  let eyeTop = -Infinity;
  for (let i = 1; i < eyes.length; i += 3) eyeTop = Math.max(eyeTop, eyes[i]);
  // Regional targets can reach the scalp; keep face shapes below the forehead
  // so the skull never pushes through hair.
  const faceMask = v => headWeight[v] * (1 - smooth(eyeTop + 0.03, eyeTop + 0.045, positions[v * 3 + 1]));

  // A regional MakeHuman target, optionally restricted to one side.
  const regional = (slider, value, only = null) => {
    const delta = new Float32Array(count * 3);
    const entry = morpher.sliders.get(slider);
    if (!entry) throw new Error(`Unknown face target ${slider}`);
    const { group, category } = entry;
    const sign = value < 0 ? 'negative' : 'positive';
    const sides = category.has_left_and_right ? (only ? [only] : ['left', 'right']) : ['unsided'];
    for (const s of sides) {
      const target = category.opposites?.[`${sign}-${s}`];
      if (target) morpher.addLocal(delta, `${group}/${target}`, Math.min(1, Math.abs(value)));
    }
    // Weights above 1 extrapolate the authored target for stronger expressions.
    const boost = Math.max(1, Math.abs(value));
    for (let v = 0; v < count; v++) {
      let w = unitScale * faceMask(v) * boost;
      if (only && !category.has_left_and_right) w *= only === 'left' ? side(v) : 1 - side(v);
      delta[v * 3] *= w; delta[v * 3 + 1] *= w; delta[v * 3 + 2] *= w;
    }
    return delta;
  };
  const mix = (...parts) => {
    const out = new Float32Array(count * 3);
    for (const [delta, weight = 1] of parts) for (let i = 0; i < out.length; i++) out[i] += delta[i] * weight;
    return out;
  };

  // Landmarks from the morphed mesh.
  const groups = base.vertexGroups;
  const upperTeeth = range(groups['helper-upper-teeth']), lowerTeeth = range(groups['helper-lower-teeth']);
  const tongue = range(groups['helper-tongue']);
  let seam = 0;
  { let upperMin = Infinity, lowerMax = -Infinity;
    for (const v of upperTeeth) upperMin = Math.min(upperMin, positions[v * 3 + 1]);
    for (const v of lowerTeeth) lowerMax = Math.max(lowerMax, positions[v * 3 + 1]);
    seam = (upperMin + lowerMax) / 2; }
  // MakeHuman's jaw joint marks the mouth, not the hinge. Place the hinge at
  // the temporomandibular joint, scaled by the dental arch.
  let teethFront = -Infinity, teethHalfWidth = 0;
  for (const v of [...upperTeeth, ...lowerTeeth]) { teethFront = Math.max(teethFront, positions[v * 3 + 2]); teethHalfWidth = Math.max(teethHalfWidth, Math.abs(positions[v * 3])); }
  const k = teethHalfWidth / 0.035;
  const jawPivot = new Vector3(0, seam + 0.028 * k, teethFront - 0.085 * k);
  const lowerSet = new Set([...lowerTeeth, ...tongue]);
  let chin = Infinity;
  for (let v = 0; v < count; v++) {
    if (headWeight[v] < 0.5 || Math.abs(positions[v * 3]) > 0.012) continue;
    if (positions[v * 3 + 2] > teethFront - 0.02 && positions[v * 3 + 1] < seam) chin = Math.min(chin, positions[v * 3 + 1]);
  }
  if (!Number.isFinite(chin)) chin = seam - 0.05 * k;
  const jawWeight = v => {
    if (lowerSet.has(v)) return 1;
    const y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    return headWeight[v] * smooth(seam + 0.0015, seam - 0.004, y) * smooth(jawPivot.z - 0.01, jawPivot.z + 0.03 * k, z) * smooth(chin - 0.03 * k, chin - 0.002, y);
  };
  const jaw = (rotateX, shiftX = 0, shiftZ = 0) => {
    const delta = new Float32Array(count * 3);
    const cos = Math.cos(rotateX), sin = Math.sin(rotateX);
    for (let v = 0; v < count; v++) {
      const w = jawWeight(v);
      if (!w) continue;
      const y = positions[v * 3 + 1] - jawPivot.y, z = positions[v * 3 + 2] - jawPivot.z;
      delta[v * 3] = shiftX * w;
      delta[v * 3 + 1] = (y * cos - z * sin - y) * w;
      delta[v * 3 + 2] = (y * sin + z * cos - z + shiftZ) * w;
    }
    return delta;
  };

  // Eyelids close over the fitted eyeball.
  const eyeBox = sign => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < eyes.length; i += 3) {
      if (Math.sign(eyes[i]) !== sign) continue;
      minX = Math.min(minX, eyes[i]); maxX = Math.max(maxX, eyes[i]);
      minY = Math.min(minY, eyes[i + 1]); maxY = Math.max(maxY, eyes[i + 1]);
      minZ = Math.min(minZ, eyes[i + 2]); maxZ = Math.max(maxZ, eyes[i + 2]);
    }
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2, rz: (maxZ - minZ) / 2 };
  };
  const lids = (sign, upperAmount, lowerAmount) => {
    const e = eyeBox(sign), delta = new Float32Array(count * 3);
    const closeY = e.cy - e.ry * 0.28;
    for (let v = 0; v < count; v++) {
      if (headWeight[v] < 0.5 || Math.sign(positions[v * 3]) !== sign) continue;
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      if (z < e.cz) continue;
      const across = 1 - smooth(0.85, 1.25, Math.abs(x - e.cx) / e.rx);
      if (!across) continue;
      let dy = 0;
      if (y >= e.cy && upperAmount) {
        // The lid margin travels furthest; the crease above follows less and
        // the brow stays put.
        const reach = 1 - smooth(e.cy + e.ry * 0.55, e.cy + e.ry * 1.35, y);
        dy = (closeY - Math.min(y, e.cy + e.ry * 0.55)) * reach * across * upperAmount;
      } else if (y < e.cy && lowerAmount) {
        const reach = 1 - smooth(e.cy - e.ry * 0.55, e.cy - e.ry * 1.25, y);
        dy = (closeY - Math.max(y, e.cy - e.ry * 0.55)) * reach * across * lowerAmount;
      }
      if (!dy) continue;
      const ny = y + dy;
      // Keep the moved skin on or in front of the eyeball.
      const u = (x - e.cx) / (e.rx * 1.02), t = (ny - e.cy) / (e.ry * 1.02);
      const inside = 1 - u * u - t * t;
      const sphereZ = inside > 0 ? e.cz + e.rz * Math.sqrt(inside) + 0.0012 : -Infinity;
      delta[v * 3 + 1] = dy;
      delta[v * 3 + 2] = Math.max(0, sphereZ - z) * Math.min(1, Math.abs(dy) / (e.ry * 0.3));
    }
    return delta;
  };

  // The jawOpen rotation undone on the lower-lip skin only (not teeth, tongue or chin): about a
  // centimetre of lip below the mouth seam, at the front of the face.
  const lowerLipClose = () => {
    const open = jaw(0.3), delta = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      if (lowerSet.has(v) || headWeight[v] < 0.5) continue;
      const y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      const w = smooth(seam - 0.018 * k, seam - 0.008 * k, y) * smooth(teethFront - 0.015 * k, teethFront - 0.005 * k, z);
      for (let c = 0; c < 3; c++) delta[v * 3 + c] = -open[v * 3 + c] * w;
    }
    return delta;
  };
  // The tongue slides forward until its tip is past the lips (2 cm in front of the incisors), the front moving most.
  const tongueShape = () => {
    const delta = new Float32Array(count * 3);
    let back = Infinity, tip = -Infinity;
    for (const v of tongue) { back = Math.min(back, positions[v * 3 + 2]); tip = Math.max(tip, positions[v * 3 + 2]); }
    const reach = teethFront - tip + 0.02 * k;
    for (const v of tongue) {
      const t = (positions[v * 3 + 2] - back) / Math.max(1e-6, tip - back);
      delta[v * 3 + 1] = -0.004 * k * t; delta[v * 3 + 2] = reach * t;
    }
    return delta;
  };

  const shapes = {
    eyeBlinkLeft: lids(1, 1, 0.12), eyeBlinkRight: lids(-1, 1, 0.12),
    eyeWideLeft: mix([regional('eye-height2-decr-incr', 1, 'left')], [regional('eye-height1-decr-incr', 1, 'left')], [regional('eyebrows-trans-down-up', 0.35, 'left')]),
    eyeWideRight: mix([regional('eye-height2-decr-incr', 1, 'right')], [regional('eye-height1-decr-incr', 1, 'right')], [regional('eyebrows-trans-down-up', 0.35, 'right')]),
    eyeSquintLeft: mix([lids(1, 0.18, 0.55)], [regional('eye-bag-height-decr-incr', 0.6, 'left')]),
    eyeSquintRight: mix([lids(-1, 0.18, 0.55)], [regional('eye-bag-height-decr-incr', 0.6, 'right')]),
    browDownLeft: mix([regional('eyebrows-trans-down-up', -1, 'left')], [regional('eyebrows-angle-down-up', 0.6, 'left')]),
    browDownRight: mix([regional('eyebrows-trans-down-up', -1, 'right')], [regional('eyebrows-angle-down-up', 0.6, 'right')]),
    browInnerUp: mix([regional('eyebrows-angle-down-up', -1)], [regional('eyebrows-trans-down-up', 0.45)]),
    browOuterUpLeft: mix([regional('eyebrows-angle-down-up', 0.8, 'left')], [regional('eyebrows-trans-down-up', 0.6, 'left')]),
    browOuterUpRight: mix([regional('eyebrows-angle-down-up', 0.8, 'right')], [regional('eyebrows-trans-down-up', 0.6, 'right')]),
    jawOpen: jaw(0.3),
    jawForward: jaw(0, 0, 0.008),
    jawLeft: jaw(0, 0.008), jawRight: jaw(0, -0.008),
    mouthSmileLeft: mix([regional('mouth-angles-down-up', 2, 'left')], [regional('mouth-scale-horiz-decr-incr', 0.6, 'left')], [regional('mouth-laugh-lines-in-out', 1, 'left')], [regional('cheek-trans-down-up', 0.6, 'left')]),
    mouthSmileRight: mix([regional('mouth-angles-down-up', 2, 'right')], [regional('mouth-scale-horiz-decr-incr', 0.6, 'right')], [regional('mouth-laugh-lines-in-out', 1, 'right')], [regional('cheek-trans-down-up', 0.6, 'right')]),
    mouthFrownLeft: mix([regional('mouth-angles-down-up', -1.8, 'left')], [regional('mouth-lowerlip-ext-down-up', 0.6, 'left')]),
    mouthFrownRight: mix([regional('mouth-angles-down-up', -1.8, 'right')], [regional('mouth-lowerlip-ext-down-up', 0.6, 'right')]),
    mouthStretchLeft: regional('mouth-scale-horiz-decr-incr', 1, 'left'),
    mouthStretchRight: regional('mouth-scale-horiz-decr-incr', 1, 'right'),
    mouthPucker: mix([regional('mouth-scale-horiz-decr-incr', -1)], [regional('mouth-trans-backward-forward', 0.8)], [regional('mouth-lowerlip-volume-decr-incr', 0.4)], [regional('mouth-upperlip-volume-decr-incr', 0.4)]),
    mouthFunnel: mix([regional('mouth-scale-horiz-decr-incr', -0.6)], [regional('mouth-trans-backward-forward', 0.6)], [jaw(0.08)]),
    mouthPressLeft: mix([regional('mouth-lowerlip-volume-decr-incr', -0.7, 'left')], [regional('mouth-upperlip-volume-decr-incr', -0.7, 'left')]),
    mouthPressRight: mix([regional('mouth-lowerlip-volume-decr-incr', -0.7, 'right')], [regional('mouth-upperlip-volume-decr-incr', -0.7, 'right')]),
    mouthUpperUpLeft: mix([regional('mouth-upperlip-height-decr-incr', -1, 'left')], [regional('mouth-upperlip-ext-down-up', 1, 'left')]),
    mouthUpperUpRight: mix([regional('mouth-upperlip-height-decr-incr', -1, 'right')], [regional('mouth-upperlip-ext-down-up', 1, 'right')]),
    mouthLowerDownLeft: mix([regional('mouth-lowerlip-ext-down-up', -1, 'left')], [regional('mouth-lowerlip-height-decr-incr', 0.6, 'left')]),
    mouthLowerDownRight: mix([regional('mouth-lowerlip-ext-down-up', -1, 'right')], [regional('mouth-lowerlip-height-decr-incr', 0.6, 'right')]),
    // Dimples press the skin in: the MakeHuman target named "-in" (negative side of in-out).
    mouthDimpleLeft: regional('mouth-dimples-in-out', -1, 'left'),
    mouthDimpleRight: regional('mouth-dimples-in-out', -1, 'right'),
    mouthRollLower: mix([regional('mouth-lowerlip-volume-decr-incr', -1)], [regional('mouth-lowerlip-height-decr-incr', -0.5)]),
    mouthRollUpper: mix([regional('mouth-upperlip-volume-decr-incr', -1)], [regional('mouth-upperlip-height-decr-incr', -0.5)]),
    mouthShrugLower: regional('mouth-lowerlip-ext-down-up', 1),
    mouthShrugUpper: regional('mouth-upperlip-ext-down-up', 0.6),
    // ARKit mouthClose: the lips meet while the jaw is open, so jawOpen + mouthClose is a closed mouth on an open jaw.
    mouthClose: lowerLipClose(),
    tongueOut: tongueShape(),
    cheekPuff: mix([regional('cheek-volume-decr-incr', 1)], [regional('cheek-inner-decr-incr', 1)], [regional('mouth-dimples-in-out', -0.6)]),
    cheekSquintLeft: regional('cheek-trans-down-up', 1.5, 'left'),
    cheekSquintRight: regional('cheek-trans-down-up', 1.5, 'right'),
    noseSneerLeft: mix([regional('nose-flaring-decr-incr', 1, 'left')], [regional('nose-nostrils-angle-down-up', 1, 'left')], [regional('mouth-upperlip-ext-down-up', 0.4, 'left')]),
    noseSneerRight: mix([regional('nose-flaring-decr-incr', 1, 'right')], [regional('nose-nostrils-angle-down-up', 1, 'right')], [regional('mouth-upperlip-ext-down-up', 0.4, 'right')]),
  };
  // The mouth shifts sideways with the unsided "mouth-trans-in-out" target; the side that moves to +x is the character's left.
  { const one = regional('mouth-trans-in-out', 1), other = regional('mouth-trans-in-out', -1);
    let x = 0; for (let i = 0; i < one.length; i += 3) x += one[i];
    shapes.mouthLeft = x > 0 ? one : other; shapes.mouthRight = x > 0 ? other : one; }
  // The eyeballs turn in face-mesh.mjs; on the skin these shapes move nothing.
  for (const name of blendshapeNames) shapes[name] ??= new Float32Array(count * 3);
  const result = new Map();
  for (const name of blendshapeNames) {
    const delta = shapes[name];
    const ids = [];
    for (let v = 0; v < count; v++) if (Math.abs(delta[v * 3]) + Math.abs(delta[v * 3 + 1]) + Math.abs(delta[v * 3 + 2]) > 1e-6) ids.push(v);
    const values = new Float32Array(ids.length * 3);
    ids.forEach((v, i) => values.set(delta.subarray(v * 3, v * 3 + 3), i * 3));
    result.set(name, { indices: Uint32Array.from(ids), deltas: values });
  }
  return { shapes: result, landmarks: { seam, jawPivot, upperTeeth, lowerTeeth, tongue } };
}

/** Dense delta for one shape at base vertex v (used to attach grooms). */
export function denseShape(shape, count) {
  const dense = new Float32Array(count * 3);
  shape.indices.forEach((v, i) => dense.set(shape.deltas.subarray(i * 3, i * 3 + 3), v * 3));
  return dense;
}
