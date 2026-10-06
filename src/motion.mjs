import { AnimationClip, Euler, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';

// Clip order matches animationNames in state.mjs.
export const clipNames = ['idle', 'walk', 'fast_walk', 'jog', 'run', 'stop', 'turn', 'sit', 'stand_up',
  'look_around', 'talk', 'gesture', 'wave', 'use_phone', 'carry', 'interact'];
// These play once and hold their last frame instead of looping.
export const oneShotClips = new Set(['stop', 'sit', 'stand_up']);

// Left-arm directions in the torso frame (+x to the character's left, +y up,
// +z forward): [shoulder → elbow, elbow → wrist]. The right arm mirrors x.
const stances = [
  [[0.27, -1, 0.02], [0.14, -1, 0.16]], // natural
  [[0.1, -1, -0.03], [0.05, -1, 0.07]], // relaxed
  [[0.3, -1, -0.1], [0.2, -1, 0.22]], // confident
  [[0.85, -1, -0.32], [-0.9, -0.5, 0.25]], // hands on hips
];

const animatedBones = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r',
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

/** Procedural clips for the editor preview and GLB export, in clipNames order. */
export function buildClips(skeleton, stance = 0, faceMeshes = []) {
  const has = name => skeleton.byName.has(name);
  const rest = {
    l: { upper: restDirection(skeleton, 'upperarm_l', 'lowerarm_l'), fore: restDirection(skeleton, 'lowerarm_l', 'hand_l') },
    r: { upper: restDirection(skeleton, 'upperarm_r', 'lowerarm_r'), fore: restDirection(skeleton, 'lowerarm_r', 'hand_r') },
  };
  const context = { stance, thigh: skeleton.heads[skeleton.byName.get('calf_l')].distanceTo(skeleton.heads[skeleton.byName.get('thigh_l')]) };
  const pelvis = skeleton.bones[skeleton.byName.get('pelvis')];
  const rootName = skeleton.roots[0]?.name;
  return clipNames.map(name => {
    const { seconds, sample } = clips[name];
    const frames = 32, times = [], poses = [];
    for (let i = 0; i <= frames; i++) { times.push(seconds * i / frames); poses.push(sample(i / frames, context)); }
    // Every clip keys the same bones so switching clips never leaves a limb
    // in the previous clip's pose.
    const rotations = new Map([...animatedBones, rootName].filter(bone => bone && has(bone))
      .map(bone => [bone, Array.from({ length: (frames + 1) * 4 }, (_, k) => k % 4 === 3 ? 1 : 0)]));
    poses.forEach((pose, frame) => {
      const quaternions = new Map();
      for (const [bone, euler] of Object.entries(pose.rot ?? {})) quaternions.set(bone, new Quaternion().setFromEuler(new Euler(...euler)));
      for (const side of ['l', 'r']) {
        const dirs = pose.arms[side].map(([x, y, z]) => side === 'r' ? [-x, y, z] : [x, y, z]);
        const [upper, fore] = armRotations(rest[side], dirs);
        quaternions.set(`upperarm_${side}`, upper); quaternions.set(`lowerarm_${side}`, fore);
      }
      if (pose.root && rootName) quaternions.set(rootName, new Quaternion().setFromEuler(new Euler(...pose.root)));
      for (const [bone, q] of quaternions) {
        if (!rotations.has(bone)) continue;
        rotations.get(bone).splice(frame * 4, 4, q.x, q.y, q.z, q.w);
      }
    });
    const tracks = [...rotations].map(([bone, values]) => new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
    if (pelvis) {
      const values = poses.flatMap(pose => {
        const [dx, dy, dz] = pose.pelvis ?? [0, 0, 0];
        return [pelvis.position.x + dx, pelvis.position.y + dy, pelvis.position.z + dz];
      });
      tracks.push(new VectorKeyframeTrack('pelvis.position', times, values));
    }
    for (const [shape, curve] of Object.entries(faceCurves(name, seconds))) {
      const values = times.map(time => curve(time));
      for (const mesh of faceMeshes) tracks.push(new NumberKeyframeTrack(`${mesh}.morphTargetInfluences[${shape}]`, times, values));
    }
    return new AnimationClip(name, seconds, tracks);
  });
}
