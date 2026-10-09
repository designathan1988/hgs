import { AnimationClip, Euler, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';

// Clip order matches animationNames in state.mjs (clipLabels, then the user's own clip). New clips go at
// the end: a saved character keeps its clip by index.
export const clipNames = ['idle', 'walk', 'fast_walk', 'jog', 'run', 'stop', 'turn', 'sit', 'stand_up',
  'look_around', 'talk', 'gesture', 'wave', 'use_phone', 'carry', 'interact', 'samba', 'runway_walk',
  'breathe', 'sit_idle', 'stroll', 'walk_cool', 'catwalk', 'dance', 'dance_cool', 'dance_silly', 'dance_energetic',
  'dance_happy', 'cheer', 'clap', 'laugh', 'shrug', 'crouch'];
export const clipLabels = ['Parado', 'Andar', 'Andar rápido', 'Trote', 'Correr', 'Parar', 'Virar', 'Sentar', 'Levantar',
  'Olhar em volta', 'Falar', 'Apresentar', 'Acenar', 'Usar celular', 'Segurar bolsa', 'Bater na porta', 'Sambar', 'Desfilar',
  'Respirar', 'Sentado', 'Passear', 'Andar confiante', 'Passarela', 'Dançar', 'Dança descolada', 'Dança divertida', 'Dança agitada',
  'Dança animada', 'Comemorar', 'Bater palmas', 'Rir', 'Dar de ombros', 'Agachado'];
/** Groups of the library in the Animação panel. */
export const clipGroups = [
  ['Parado', ['idle', 'breathe', 'look_around', 'talk', 'gesture', 'laugh', 'shrug', 'wave', 'use_phone', 'carry', 'interact']],
  ['Andar e correr', ['walk', 'stroll', 'walk_cool', 'fast_walk', 'jog', 'run', 'stop', 'turn', 'catwalk', 'runway_walk']],
  ['Sentar', ['sit', 'sit_idle', 'stand_up', 'crouch']],
  ['Festa', ['samba', 'dance', 'dance_cool', 'dance_silly', 'dance_energetic', 'dance_happy', 'cheer', 'clap']],
];
// These play once and hold their last frame instead of looping.
export const oneShotClips = new Set(['stop', 'turn', 'sit', 'stand_up']);

// Left-arm directions in the torso frame (+x to the character's left, +y up,
// +z forward): [shoulder → elbow, elbow → wrist]. The right arm mirrors x.
const stances = [
  [[0.27, -1, 0.02], [0.14, -1, 0.16]], // natural
  [[0.1, -1, -0.03], [0.05, -1, 0.07]], // relaxed
  [[0.3, -1, -0.1], [0.2, -1, 0.22]], // confident
  [[0.85, -1, -0.32], [-0.9, -0.5, 0.25]], // hands on hips
];

const animatedBones = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r',
  'foot_l', 'foot_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'];
const TAU = Math.PI * 2;
const X = new Vector3(1, 0, 0);
const smooth = t => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const swung = (dir, angle) => new Vector3(...dir).applyAxisAngle(X, angle).toArray();

function stancePose(stance, breath = 0) {
  const [up, fore] = stances[stance] ?? stances[0];
  return {
    rot: { spine_02: [0.012 * breath, 0, 0], head: [0.014 * breath, 0, 0] },
    arms: { l: [up, fore], r: [up, fore] },
  };
}

// Walking in place: thighs swing about X (positive swings a leg back), the
// knee only flexes during the swing phase, and each arm swings against the
// leg on its own side.
function gait(t, { stride, knee, arm, lean, bob, bent }) {
  const phase = TAU * t;
  const thighL = -stride * Math.sin(phase), thighR = -thighL;
  const calfL = 0.06 + knee * Math.max(0, Math.cos(phase));
  const calfR = 0.06 + knee * Math.max(0, -Math.cos(phase));
  const up = bent ? [0.12, -1, -0.05] : [0.17, -1, 0.02];
  const fore = bent ? [0.05, -0.25, 1] : [0.1, -1, 0.18];
  return {
    rot: {
      thigh_l: [thighL, 0, 0], thigh_r: [thighR, 0, 0],
      calf_l: [calfL, 0, 0], calf_r: [calfR, 0, 0],
      foot_l: [-(thighL + calfL) * 0.6, 0, 0], foot_r: [-(thighR + calfR) * 0.6, 0, 0],
      spine_01: [lean, 0, 0], spine_02: [0, 0.18 * stride * Math.sin(phase), 0],
    },
    arms: {
      l: [swung(up, arm * Math.sin(phase)), swung(fore, arm * Math.sin(phase))],
      r: [swung(up, -arm * Math.sin(phase)), swung(fore, -arm * Math.sin(phase))],
    },
    pelvis: [0, -bob * (0.5 - 0.5 * Math.cos(2 * phase)), 0],
  };
}

const gaits = {
  walk: { seconds: 1.1, stride: 0.36, knee: 0.55, arm: 0.3, lean: 0.03, bob: 0.012 },
  fast_walk: { seconds: 0.85, stride: 0.45, knee: 0.7, arm: 0.4, lean: 0.06, bob: 0.015 },
  jog: { seconds: 0.72, stride: 0.55, knee: 1.15, arm: 0.5, lean: 0.12, bob: 0.03, bent: true },
  run: { seconds: 0.6, stride: 0.75, knee: 1.5, arm: 0.7, lean: 0.2, bob: 0.04, bent: true },
};

/** Smooth piecewise value through keys [[u, value], ...] (u ascending over 0..1). */
function keyed(u, keys) {
  for (let i = 1; i < keys.length; i++) {
    const [u1, v1] = keys[i];
    if (u > u1 && i < keys.length - 1) continue;
    const [u0, v0] = keys[i - 1];
    return v0 + (v1 - v0) * smooth((u - u0) / Math.max(1e-6, u1 - u0));
  }
  return keys.at(-1)[1];
}

/**
 * Samba no pé, the solo samba of the passista: 2/4, three steps per measure (step-ball-change,
 * "and-a-one, and-a-two"), one measure on each side. The torso stays upright and the knees do the
 * work: on 1 the weight is on the outside foot, straight; on "a" it passes briefly to the ball of
 * the other foot, whose knee bends and drops that side of the hips; on 2 it is back on the
 * outside foot; on "and" the other foot lifts to start the next measure. The hips swing to the
 * side bearing the weight (pelvis roll and sideways shift, the legs counter-rotated so the feet
 * stay under the body), the knees bounce twice per measure, and the arms, out to the sides with
 * the elbows bent, rise and fall against the hips.
 */
function samba(t, c) {
  const u = (t * 2) % 1, first = t < 0.5, size = c.thigh / 0.42;
  // Weight on the right foot (1) or the left (0) through the measure that starts on the right.
  const measure = keyed(u, [[0, 1], [0.28, 1], [0.375, 0.2], [0.47, 1], [0.72, 1], [1, 0]]);
  const w = first ? measure : 1 - measure;
  const roll = -(w - 0.5) * 2 * 0.15, shift = -(w - 0.5) * 2 * 0.035 * size, yaw = (w - 0.5) * 2 * 0.07;
  const bounce = 0.5 + 0.5 * Math.cos(TAU * 4 * t);
  // The unweighted leg is bent, a little forward and up on its ball; the weighted one nearly straight.
  const calfR = 0.1 + 0.42 * (1 - w) + 0.3 * bounce, calfL = 0.1 + 0.42 * w + 0.3 * bounce;
  const thighR = -0.5 * calfR - 0.1 * (1 - w), thighL = -0.5 * calfL - 0.1 * w;
  const lift = (1 - w) - 0.5;
  return {
    rot: {
      pelvis: [0, yaw, roll],
      thigh_r: [thighR, 0, -roll - 0.04], thigh_l: [thighL, 0, -roll + 0.04],
      calf_r: [calfR, 0, 0], calf_l: [calfL, 0, 0],
      foot_r: [-(thighR + calfR) * 0.7 + 0.28 * (1 - w), 0, 0], foot_l: [-(thighL + calfL) * 0.7 + 0.28 * w, 0, 0],
      // The torso stays upright over the moving hips; the shoulders shimmy in time.
      spine_01: [0.03, -yaw * 0.8, -roll * 0.9], spine_02: [0, 0, 0.015 * Math.sin(TAU * 8 * t)],
      spine_03: [-0.03, 0.025 * Math.sin(TAU * 8 * t), 0], head: [0.02, 0, -0.04 * Math.sin(TAU * 2 * t)],
    },
    arms: {
      l: [[0.78, -0.42 + 0.3 * lift, 0.3], [0.3, 0.45 + 0.35 * lift, 0.85]],
      r: [[0.78, -0.42 - 0.3 * lift, 0.3], [0.3, 0.45 - 0.35 * lift, 0.85]],
    },
    // The feet stay on the floor: the pelvis comes down by what the weighted leg shortens (thigh
    // forward half the knee's bend, so hip–ankle is (thigh + shin)·cos(bend/2)) and by the height its
    // hip rises over the pelvis centre with the roll (half the hip width, about 9 cm at 1.7 m).
    pelvis: [shift, -2 * c.thigh * (1 - Math.cos(0.5 * (w * calfR + (1 - w) * calfL))) - 0.09 * size * Math.abs(Math.sin(roll)), 0],
  };
}

/**
 * Runway walk (desfile): heel first, each foot placed in front of the other on one line (the legs
 * turn in towards the middle in stance and swing round the other leg), long even strides at a
 * steady pace, the hips swaying with the stride (pelvis roll and sideways shift over the stance
 * leg, and more pelvis rotation than an everyday walk), shoulders back and level against the hips,
 * head straight, arms loose and close with a small swing.
 */
function runwayWalk(t, c) {
  const phase = TAU * t, size = c.thigh / 0.42, stride = 0.34;
  const thighL = -stride * Math.sin(phase), thighR = -thighL;
  const swingL = Math.max(0, Math.cos(phase)), swingR = Math.max(0, -Math.cos(phase));
  const calfL = 0.04 + 0.5 * swingL, calfR = 0.04 + 0.5 * swingR;
  // Left stance while cos(phase) < 0: the weight and the hip go to the left.
  const roll = -0.1 * Math.cos(phase), yaw = -0.15 * Math.sin(phase);
  const across = 0.1, inL = across * (0.55 - 0.45 * Math.cos(phase)), inR = across * (0.55 + 0.45 * Math.cos(phase));
  return {
    rot: {
      pelvis: [0, yaw, roll],
      thigh_l: [thighL, 0, -roll - inL], thigh_r: [thighR, 0, -roll + inR],
      calf_l: [calfL, 0, 0], calf_r: [calfR, 0, 0],
      foot_l: [-(thighL + calfL) * 0.6, 0, 0], foot_r: [-(thighR + calfR) * 0.6, 0, 0],
      spine_01: [0.01, -yaw * 0.75, -roll * 0.85], spine_03: [-0.07, 0, 0], neck_01: [0.02, 0, 0], head: [0.04, 0, 0],
    },
    arms: {
      l: [swung([0.12, -1, -0.1], 0.16 * Math.sin(phase)), swung([0.04, -1, 0.12], 0.2 * Math.sin(phase))],
      r: [swung([0.12, -1, -0.1], -0.16 * Math.sin(phase)), swung([0.04, -1, 0.12], -0.2 * Math.sin(phase))],
    },
    pelvis: [-0.022 * size * Math.cos(phase), -0.01 * size * (0.5 - 0.5 * Math.cos(2 * phase)), 0],
  };
}

function seated(u, thigh) {
  return {
    rot: {
      thigh_l: [-1.5 * u, 0, 0], thigh_r: [-1.5 * u, 0, 0],
      calf_l: [1.5 * u, 0, 0], calf_r: [1.5 * u, 0, 0],
      spine_01: [0.18 * Math.sin(Math.PI * u) + 0.04 * u, 0, 0],
    },
    arms: { l: [[0.18, -1, 0.05 + 0.4 * u], [0.1, -1 + 0.75 * u, 0.2 + 0.8 * u]],
      r: [[0.18, -1, 0.05 + 0.4 * u], [0.1, -1 + 0.75 * u, 0.2 + 0.8 * u]] },
    pelvis: [0, -thigh * 0.97 * u, -thigh * 0.95 * u],
  };
}

const clips = {
  idle: { seconds: 2, sample: (t, c) => stancePose(c.stance, Math.sin(TAU * t)) },
  ...Object.fromEntries(Object.entries(gaits).map(([name, g]) => [name, { seconds: g.seconds, sample: t => gait(t, g) }])),
  stop: { seconds: 1.6, sample: (t, c) => {
    const fade = 1 - smooth(t / 0.75);
    const walk = gait(t * 2.2, { ...gaits.walk, stride: gaits.walk.stride * fade, knee: gaits.walk.knee * fade, arm: gaits.walk.arm * fade });
    const rest = stancePose(c.stance);
    walk.arms = Object.fromEntries(['l', 'r'].map(side => [side, walk.arms[side].map((dir, i) =>
      dir.map((v, k) => v * fade + rest.arms[side][i][k] * (1 - fade)))]));
    return walk;
  } },
  turn: { seconds: 4, sample: (t, c) => {
    const step = gait(t * 4, { ...gaits.walk, stride: 0.12, knee: 0.35, arm: 0.1 });
    step.root = [0, TAU * t, 0];
    step.arms = stancePose(c.stance).arms;
    return step;
  } },
  sit: { seconds: 1.6, sample: (t, c) => seated(smooth(t), c.thigh) },
  stand_up: { seconds: 1.6, sample: (t, c) => seated(1 - smooth(t), c.thigh) },
  look_around: { seconds: 4, sample: (t, c) => {
    const pose = stancePose(c.stance, Math.sin(TAU * t));
    pose.rot.neck_01 = [0, 0.25 * Math.sin(TAU * t), 0];
    pose.rot.head = [0.06 * Math.sin(2 * TAU * t), 0.55 * Math.sin(TAU * t), 0];
    pose.rot.spine_03 = [0, 0.12 * Math.sin(TAU * t), 0];
    return pose;
  } },
  talk: { seconds: 3, sample: (t, c) => {
    const pose = stancePose(c.stance, Math.sin(TAU * t));
    pose.rot.head = [0.05 * Math.sin(3 * TAU * t), 0.08 * Math.sin(TAU * t), 0.03 * Math.sin(2 * TAU * t)];
    const lift = 0.5 + 0.5 * Math.sin(2 * TAU * t);
    pose.arms.r = [[0.16, -1, 0.12], [0.1 + 0.25 * lift, -0.35 - 0.3 * (1 - lift), 1]];
    return pose;
  } },
  gesture: { seconds: 2.5, sample: t => {
    const open = 0.5 - 0.5 * Math.cos(TAU * t);
    return {
      rot: { head: [0, 0, 0.04 * Math.sin(TAU * t)], spine_02: [0.02, 0, 0] },
      arms: { l: [[0.22, -1, 0.15], [0.15 + 0.7 * open, -0.15, 1]], r: [[0.22, -1, 0.15], [0.15 + 0.7 * open, -0.15, 1]] },
    };
  } },
  wave: { seconds: 2, sample: (t, c) => {
    const pose = stancePose(c.stance, Math.sin(TAU * t));
    pose.arms.r = [[0.75, 0.35, 0.12], [0.3 * Math.sin(3 * TAU * t), 1, 0.12]];
    pose.rot.head = [0, -0.08, 0];
    return pose;
  } },
  use_phone: { seconds: 3, sample: (t, c) => {
    const pose = stancePose(c.stance, Math.sin(TAU * t));
    pose.arms.r = [[0.12, -1, 0.25], [-0.45, 0.6 + 0.03 * Math.sin(2 * TAU * t), 0.75]];
    pose.rot.head = [0.38, 0, 0];
    pose.rot.neck_01 = [0.12, 0, 0];
    return pose;
  } },
  carry: { seconds: 2, sample: t => ({
    rot: { spine_01: [-0.05, 0, 0], spine_02: [0.01 * Math.sin(TAU * t), 0, 0] },
    arms: { l: [[0.14, -1, 0.22], [-0.3, 0.05, 1]], r: [[0.14, -1, 0.22], [-0.3, 0.05, 1]] },
  }) },
  // Two measures of 2/4 (one on each side) at about 150 beats a minute.
  samba: { seconds: 1.6, sample: samba },
  runway_walk: { seconds: 1.1, sample: runwayWalk },
  interact: { seconds: 2.4, sample: (t, c) => {
    const pose = stancePose(c.stance);
    const reach = 0.5 - 0.5 * Math.cos(TAU * t);
    pose.arms.r = [[0.15, -1 + 0.75 * reach, 0.35 + 0.65 * reach], [0.02, -0.5 + 0.45 * reach, 1]];
    pose.rot.spine_02 = [0.08 * reach, 0, 0];
    pose.rot.head = [0.1 * reach, 0, 0];
    return pose;
  } },
};

// Blinks in every clip, plus jaw motion while talking. Values are blendshape
// weights over time in seconds.
function blinkAt(time, seconds) {
  const blinks = Math.max(1, Math.round(seconds / 2.6));
  let value = 0;
  for (let i = 0; i < blinks; i++) {
    const at = seconds * (i + 0.62) / blinks, d = Math.abs(time - at) / 0.09;
    value = Math.max(value, d < 1 ? 1 - d * d : 0);
  }
  return value;
}
function faceCurves(name, seconds) {
  const curves = { eyeBlinkLeft: t => blinkAt(t, seconds), eyeBlinkRight: t => blinkAt(t, seconds) };
  if (name === 'talk') {
    curves.jawOpen = t => 0.12 + 0.18 * Math.max(0, Math.sin(TAU * t * 2.7 / seconds * 3)) * (0.6 + 0.4 * Math.sin(TAU * t / seconds));
    curves.mouthFunnel = t => 0.15 * Math.max(0, Math.sin(TAU * t * 1.3 / seconds * 3 + 1));
  }
  if (name === 'run' || name === 'jog') curves.jawOpen = () => 0.12;
  // A passista smiles through the samba.
  if (name === 'samba') { curves.mouthSmileLeft = () => 0.55; curves.mouthSmileRight = () => 0.55; curves.jawOpen = () => 0.06; }
  return curves;
}

function restDirection(skeleton, from, to) {
  return skeleton.heads[skeleton.byName.get(to)].clone().sub(skeleton.heads[skeleton.byName.get(from)]).normalize();
}

function armRotations(rest, [up, fore]) {
  const upper = new Quaternion().setFromUnitVectors(rest.upper, new Vector3(...up).normalize());
  const local = new Vector3(...fore).normalize().applyQuaternion(upper.clone().invert());
  return [upper, new Quaternion().setFromUnitVectors(rest.fore, local)];
}

/**
 * Pose convention shared by clips, posing and the timeline: a bone's rotation D
 * is given against a world-aligned rest, and its local rotation is
 * R_parent⁻¹ · D · R_bone (R: world rest rotations, skeleton.rest).
 */
function parentRestInverse(skeleton, index) {
  const parent = skeleton.bones[index].parent;
  return parent?.isBone ? skeleton.rest[skeleton.bones.indexOf(parent)].clone().invert() : new Quaternion();
}
/** Local rotation of bone `index` for the rotation D. */
export function toLocal(skeleton, index, D, out = new Quaternion()) {
  if (!skeleton.rest) return out.copy(D);
  return out.copy(D).premultiply(parentRestInverse(skeleton, index)).multiply(skeleton.rest[index]);
}
/** The rotation D of bone `index` from its local rotation (inverse of toLocal). */
export function fromLocal(skeleton, index, local, out = new Quaternion()) {
  if (!skeleton.rest) return out.copy(local);
  return out.copy(local).premultiply(parentRestInverse(skeleton, index).invert()).multiply(skeleton.rest[index].clone().invert());
}

function armRest(skeleton) {
  return {
    l: { upper: restDirection(skeleton, 'upperarm_l', 'lowerarm_l'), fore: restDirection(skeleton, 'lowerarm_l', 'hand_l') },
    r: { upper: restDirection(skeleton, 'upperarm_r', 'lowerarm_r'), fore: restDirection(skeleton, 'lowerarm_r', 'hand_r') },
  };
}
/** The rotations D of a sampled pose ({ rot, arms, root }), by bone name. */
export function sampleRotations(rest, pose, rootName) {
  const quaternions = new Map();
  for (const [bone, euler] of Object.entries(pose.rot ?? {})) quaternions.set(bone, new Quaternion().setFromEuler(new Euler(...euler)));
  for (const side of ['l', 'r']) {
    if (!pose.arms?.[side]) continue;
    const dirs = pose.arms[side].map(([x, y, z]) => side === 'r' ? [-x, y, z] : [x, y, z]);
    const [upper, fore] = armRotations(rest[side], dirs);
    quaternions.set(`upperarm_${side}`, upper); quaternions.set(`lowerarm_${side}`, fore);
  }
  if (pose.root && rootName) quaternions.set(rootName, new Quaternion().setFromEuler(new Euler(...pose.root)));
  return quaternions;
}

/** The mirror image of a pose across the body's midplane: left and right swap, D → (x, −y, −z, w). */
export function mirrorPose(pose) {
  const out = {};
  for (const [name, value] of Object.entries(pose)) {
    if (name === '$pelvis') { out[name] = [-value[0], value[1], value[2]]; continue; }
    const other = name.replace(/_l$/, '_R').replace(/_r$/, '_l').replace(/_R$/, '_r');
    out[other] = [value[0], -value[1], -value[2], value[3]];
  }
  return out;
}

/** Ready-made poses as { bone: D [x, y, z, w], $pelvis: [dx, dy, dz] } (A is the rest pose). */
export const poseLibrary = ['A', 'T', 'natural', 'hips', 'sit', 'wave', 'run'];
export function libraryPose(skeleton, name) {
  const rest = armRest(skeleton), thigh = skeleton.heads[skeleton.byName.get('calf_l')].distanceTo(skeleton.heads[skeleton.byName.get('thigh_l')]);
  const sampled = {
    A: { rot: {} },
    // Arms level and straight out to the sides.
    T: { rot: {}, arms: { l: [[1, 0, 0], [1, 0, 0]], r: [[1, 0, 0], [1, 0, 0]] } },
    natural: stancePose(0), hips: stancePose(3),
    sit: seated(1, thigh), wave: clips.wave.sample(0.125, { stance: 0 }), run: gait(0.25, gaits.run),
  }[name];
  if (!sampled) return {};
  const out = {};
  for (const [bone, q] of sampleRotations(rest, sampled, skeleton.roots[0]?.name)) out[bone] = q.toArray();
  if (sampled.pelvis) out.$pelvis = [...sampled.pelvis];
  return out;
}

// ------------------------------------------------------------ captured clips (Rocketbox library)

const asset = name => new URL(`../assets/animations/${name}`, import.meta.url);
async function readAsset(name, binary) {
  const url = asset(name);
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(url);
    return binary ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : JSON.parse(bytes.toString('utf8'));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load animations/${name}: HTTP ${response.status}`);
  return binary ? response.arrayBuffer() : response.json();
}

let libraryLoading = null;
/**
 * The motion-capture library made by tools/import-rocketbox.mjs (Microsoft Rocketbox, MIT): per clip
 * and sex, D rotations per bone (motion.mjs convention) at the kept frames, and the pelvis offset in
 * hip heights. Resolves to { clips: { id: { m, f } }, credit } or null when the files are missing.
 */
export function loadMotionLibrary() {
  libraryLoading ??= (async () => {
    const [index, bin] = await Promise.all([readAsset('rocketbox.json'), readAsset('rocketbox.bin', true)]);
    const decode = variant => {
      const time = frames => Float32Array.from(frames, f => f / index.fps);
      const tracks = new Map(variant.tracks.map(([bone, count, framesAt, valuesAt]) => {
        const values = Float32Array.from(new Int16Array(bin, valuesAt, count * 4), v => v / index.quaternionScale);
        // int16 rounding: back to unit length.
        for (let k = 0; k < values.length; k += 4) {
          const n = Math.hypot(values[k], values[k + 1], values[k + 2], values[k + 3]) || 1;
          for (let c = 0; c < 4; c++) values[k + c] /= n;
        }
        return [index.bones[bone], { times: time(new Uint16Array(bin, framesAt, count)), values }];
      }));
      const [count, framesAt, valuesAt] = variant.pelvis;
      const pelvis = { times: time(new Uint16Array(bin, framesAt, count)), values: Float32Array.from(new Int16Array(bin, valuesAt, count * 3), v => v / index.pelvisScale) };
      return { duration: variant.duration, loop: variant.loop, file: variant.file, tracks, pelvis };
    };
    const clipsById = {};
    for (const [id, variants] of Object.entries(index.clips)) clipsById[id] = Object.fromEntries(Object.entries(variants).map(([sex, v]) => [sex, decode(v)]));
    return { clips: clipsById, credit: { source: index.source, license: index.license, copyright: index.copyright } };
  })().catch(error => { console.warn('Motion library unavailable', error); libraryLoading = null; return null; });
  return libraryLoading;
}

/** The library clip `id` for a body of this sex (gender < 0.5 is female, state.mjs), or null. */
export function libraryVariant(library, id, gender = 0.5) {
  const variants = library?.clips?.[id];
  if (!variants) return null;
  return (gender < 0.5 ? variants.f ?? variants.m : variants.m ?? variants.f) ?? null;
}

/** Local rest position of bone `index` (as makeSkeleton places it). */
export function restPosition(skeleton, index) {
  const parent = skeleton.bones[index].parent, p = parent?.isBone ? skeleton.bones.indexOf(parent) : -1;
  if (p < 0) return skeleton.heads[index].clone();
  return skeleton.heads[index].clone().sub(skeleton.heads[p]).applyQuaternion(skeleton.rest[p].clone().invert());
}
/** Height of the hip joints (thigh heads) over the floor at rest: library pelvis offsets are in these units. */
const hipHeight = skeleton => ['thigh_l', 'thigh_r'].reduce((sum, name) => sum + skeleton.heads[skeleton.byName.get(name)].y / 2, 0);

/**
 * The pelvis offset of a pose ($pelvis, world axes of the character at rest: +y up, +z forward) as a
 * change of pelvis.position, which is in the parent's space (Root rests turned −90° about X).
 */
export function pelvisToLocal(skeleton, offset, out = new Vector3()) {
  const p = skeleton.byName.get('pelvis'), parent = p === undefined ? null : skeleton.bones[p].parent;
  out.set(offset[0], offset[1], offset[2]);
  if (parent?.isBone && skeleton.rest) out.applyQuaternion(skeleton.rest[skeleton.bones.indexOf(parent)].clone().invert());
  return out;
}
/** The world offset $pelvis from a change of pelvis.position (inverse of pelvisToLocal). */
export function pelvisFromLocal(skeleton, local) {
  const p = skeleton.byName.get('pelvis'), parent = p === undefined ? null : skeleton.bones[p].parent;
  const out = local.clone();
  if (parent?.isBone && skeleton.rest) out.applyQuaternion(skeleton.rest[skeleton.bones.indexOf(parent)]);
  return out.toArray();
}

/** Blinks as sparse keys: closed at each blink's middle, open 90 ms either side. */
function blinkTrack(seconds) {
  const times = [0], values = [0], blinks = Math.max(1, Math.round(seconds / 2.6));
  for (let i = 0; i < blinks; i++) {
    const at = seconds * (i + 0.62) / blinks;
    for (const [dt, v] of [[-0.09, 0], [-0.045, 0.75], [0, 1], [0.045, 0.75], [0.09, 0]]) {
      const t = at + dt;
      if (t > times.at(-1) + 1e-4 && t < seconds) { times.push(t); values.push(v); }
    }
  }
  if (seconds > times.at(-1) + 1e-4) { times.push(seconds); values.push(0); }
  return { times, values };
}
// Faces that go with a captured clip (blendshape weights; constant over the clip).
const libraryFaces = {
  laugh: { mouthSmileLeft: 0.7, mouthSmileRight: 0.7, jawOpen: 0.25, cheekSquintLeft: 0.35, cheekSquintRight: 0.35 },
  cheer: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6, jawOpen: 0.15 },
  dance: { mouthSmileLeft: 0.4, mouthSmileRight: 0.4 }, dance_cool: { mouthSmileLeft: 0.3, mouthSmileRight: 0.3 },
  dance_silly: { mouthSmileLeft: 0.55, mouthSmileRight: 0.55, jawOpen: 0.08 }, dance_energetic: { mouthSmileLeft: 0.35, mouthSmileRight: 0.35 },
  dance_happy: { mouthSmileLeft: 0.5, mouthSmileRight: 0.5 }, clap: { mouthSmileLeft: 0.45, mouthSmileRight: 0.45 },
  wave: { mouthSmileLeft: 0.35, mouthSmileRight: 0.35 },
};

/** A captured clip on this skeleton: local rotations from the D keys, the pelvis at this body's hip height. */
function libraryClip(skeleton, name, variant, faceMeshes) {
  const tracks = [], local = new Quaternion(), D = new Quaternion();
  for (const [bone, { times, values }] of variant.tracks) {
    const index = skeleton.byName.get(bone);
    if (index === undefined) continue;
    const out = new Float32Array(values.length);
    for (let k = 0; k < values.length; k += 4) {
      toLocal(skeleton, index, D.fromArray(values, k), local);
      out[k] = local.x; out[k + 1] = local.y; out[k + 2] = local.z; out[k + 3] = local.w;
    }
    tracks.push(new QuaternionKeyframeTrack(`${bone}.quaternion`, times, out));
  }
  const p = skeleton.byName.get('pelvis');
  if (p !== undefined) {
    const rest = restPosition(skeleton, p), H = hipHeight(skeleton), { times, values } = variant.pelvis;
    const out = new Float32Array(values.length), v = new Vector3();
    for (let k = 0; k < values.length; k += 3) {
      pelvisToLocal(skeleton, [values[k] * H, values[k + 1] * H, values[k + 2] * H], v).add(rest);
      out[k] = v.x; out[k + 1] = v.y; out[k + 2] = v.z;
    }
    tracks.push(new VectorKeyframeTrack('pelvis.position', times, out));
  }
  const seconds = variant.duration, blink = blinkTrack(seconds);
  const shapes = { eyeBlinkLeft: blink, eyeBlinkRight: blink };
  if (name === 'talk') {
    const curves = faceCurves('talk', seconds), times = Array.from({ length: Math.ceil(seconds * 12) + 1 }, (_, i) => Math.min(seconds, i / 12));
    for (const shape of ['jawOpen', 'mouthFunnel']) shapes[shape] = { times, values: times.map(curves[shape]) };
  }
  for (const [shape, value] of Object.entries(libraryFaces[name] ?? {})) shapes[shape] = { times: [0, seconds], values: [value, value] };
  for (const [shape, { times, values }] of Object.entries(shapes)) {
    for (const mesh of faceMeshes) tracks.push(new NumberKeyframeTrack(`${mesh}.morphTargetInfluences[${shape}]`, times, values));
  }
  return new AnimationClip(name, seconds, tracks);
}

/**
 * A library clip as timeline keys ({ t, pose: { bone: D, $pelvis }, face }, timeline.mjs), sampled at
 * `fps` (at most `limit` keys), starting at `start` seconds; for mixing captured motion into the user's clip.
 */
export function libraryKeys(skeleton, variant, { fps = 15, start = 0, limit = 600, from = 0, to = variant.duration } = {}) {
  const span = Math.max(0, Math.min(variant.duration, to) - from);
  const count = Math.min(limit, Math.max(2, Math.round(span * fps) + 1)), keys = [];
  const sample = (times, values, size, t, out) => {
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    const j = Math.min(times.length - 1, i + 1), u = j === i ? 0 : Math.max(0, Math.min(1, (t - times[i]) / (times[j] - times[i])));
    if (size === 4) return out.fromArray(values, i * 4).slerp(new Quaternion().fromArray(values, j * 4), u);
    return [0, 1, 2].map(c => values[i * 3 + c] + (values[j * 3 + c] - values[i * 3 + c]) * u);
  };
  const H = hipHeight(skeleton), q = new Quaternion();
  for (let k = 0; k < count; k++) {
    const t = from + span * k / (count - 1), pose = {};
    for (const [bone, track] of variant.tracks) {
      if (!skeleton.byName.has(bone)) continue;
      sample(track.times, track.values, 4, t, q);
      if (1 - Math.abs(q.w) > 1e-6) pose[bone] = q.toArray().map(v => Math.round(v * 1e5) / 1e5);
    }
    pose.$pelvis = sample(variant.pelvis.times, variant.pelvis.values, 3, t).map(v => Math.round(v * H * 1e4) / 1e4);
    keys.push({ t: Math.round((start + t - from) * 1000) / 1000, pose, face: null });
  }
  return keys;
}

/**
 * Clips for the editor preview and GLB export, in clipNames order: captured ones from `library`
 * (loadMotionLibrary; the variant of the body's sex) and procedural ones for the rest (and for
 * every clip when the library is not given, e.g. inside the generation worker).
 */
export function buildClips(skeleton, stance = 0, faceMeshes = [], { library = null, gender = 0.5, only = null } = {}) {
  const has = name => skeleton.byName.has(name);
  const rest = armRest(skeleton);
  const context = { stance, thigh: skeleton.heads[skeleton.byName.get('calf_l')].distanceTo(skeleton.heads[skeleton.byName.get('thigh_l')]) };
  const pelvis = skeleton.bones[skeleton.byName.get('pelvis')];
  const rootName = skeleton.roots[0]?.name;
  // `only`: just that clip is built (null in the others' places), e.g. while a slider reshapes the body.
  const built = clipNames.map(name => {
    if (only && name !== only) return null;
    const captured = name === 'idle' ? null : libraryVariant(library, name, gender);
    if (captured) return libraryClip(skeleton, name, captured, faceMeshes);
    // Without the library, a captured-only clip stands still (procedural idle under its own name).
    const { seconds, sample } = clips[name] ?? clips.idle;
    const frames = 32, times = [], poses = [];
    for (let i = 0; i <= frames; i++) { times.push(seconds * i / frames); poses.push(sample(i / frames, context)); }
    // Every clip keys the same bones so switching clips never leaves a limb
    // in the previous clip's pose.
    const rotations = new Map([...animatedBones, rootName].filter(bone => bone && has(bone))
      .map(bone => [bone, Array.from({ length: (frames + 1) * 4 }, (_, k) => k % 4 === 3 ? 1 : 0)]));
    poses.forEach((pose, frame) => {
      for (const [bone, q] of sampleRotations(rest, pose, rootName)) {
        if (!rotations.has(bone)) continue;
        rotations.get(bone).splice(frame * 4, 4, q.x, q.y, q.z, q.w);
      }
    });
    // The poses above are rotations relative to a world-aligned rest. Bones
    // rest at R_b (world), so the local key is R_parent⁻¹ · D · R_b: the bone's
    // world rotation becomes W_b · R_b and skinning (· R_b⁻¹) is unchanged.
    if (skeleton.rest) for (const [bone, values] of rotations) {
      const index = skeleton.byName.get(bone), parent = skeleton.bones[index].parent;
      const parentRest = parent?.isBone ? skeleton.rest[skeleton.bones.indexOf(parent)].clone().invert() : new Quaternion();
      const rest = skeleton.rest[index], q = new Quaternion();
      for (let k = 0; k < values.length; k += 4) {
        q.set(values[k], values[k + 1], values[k + 2], values[k + 3]);
        q.premultiply(parentRest).multiply(rest);
        values[k] = q.x; values[k + 1] = q.y; values[k + 2] = q.z; values[k + 3] = q.w;
      }
    }
    const tracks = [...rotations].map(([bone, values]) => new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
    if (pelvis) {
      // pose.pelvis is in the character's axes (down is −y); pelvis.position is in Root's space.
      const rest = restPosition(skeleton, skeleton.byName.get('pelvis')), v = new Vector3();
      const values = poses.flatMap(pose => pelvisToLocal(skeleton, pose.pelvis ?? [0, 0, 0], v).add(rest).toArray());
      tracks.push(new VectorKeyframeTrack('pelvis.position', times, values));
    }
    for (const [shape, curve] of Object.entries(faceCurves(name, seconds))) {
      const values = times.map(time => curve(time));
      for (const mesh of faceMeshes) tracks.push(new NumberKeyframeTrack(`${mesh}.morphTargetInfluences[${shape}]`, times, values));
    }
    return new AnimationClip(name, seconds, tracks);
  });
  // Every clip keys the same bones and shapes (a bone a clip leaves out holds its rest pose there),
  // so switching clips never leaves a limb in the previous clip's pose, in the app or in an engine.
  const everyTrack = new Map();
  for (const clip of built) for (const track of clip?.tracks ?? []) if (!everyTrack.has(track.name)) everyTrack.set(track.name, track);
  for (const clip of built) {
    if (!clip) continue;
    const present = new Set(clip.tracks.map(track => track.name));
    for (const [trackName, sample] of everyTrack) {
      if (present.has(trackName)) continue;
      const [node, property] = trackName.split('.');
      const times = [0, clip.duration];
      if (property === 'quaternion') {
        const index = skeleton.byName.get(node), q = skeleton.rest ? toLocal(skeleton, index, new Quaternion()) : skeleton.bones[index].quaternion;
        clip.tracks.push(new QuaternionKeyframeTrack(trackName, times, [...q.toArray(), ...q.toArray()]));
      } else if (property === 'position') {
        const p = restPosition(skeleton, skeleton.byName.get(node)).toArray();
        clip.tracks.push(new VectorKeyframeTrack(trackName, times, [...p, ...p]));
      } else if (sample.ValueTypeName === 'number') clip.tracks.push(new NumberKeyframeTrack(trackName, times, [0, 0]));
    }
  }
  return built;
}
