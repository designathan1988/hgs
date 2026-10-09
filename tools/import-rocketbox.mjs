// Converts Microsoft Rocketbox animations (MIT, https://github.com/microsoft/Microsoft-Rocketbox)
// into the app's clip library: assets/animations/rocketbox.json + rocketbox.bin.
//
// Usage:
//   node tools/import-rocketbox.mjs --urls             lists the files to download (raw.githubusercontent.com)
//   node tools/import-rocketbox.mjs <download folder>  converts them (the FBX files and the two avatars)
//
// The FBX files are read as data only (three.js FBXLoader); nothing from them is executed.
//
// Retarget. Rocketbox uses the 3ds Max Biped (Bip01_*). For every frame the world rotation of each
// source bone W(t) is taken relative to a reference pose S in which source and target match
// (three.js SkeletonUtils.retarget and Unreal's IK Retargeter ask for the same: both skeletons in
// one pose). S is the Rocketbox avatar's bind pose with each bone turned, parents first, onto the
// direction of the matching bone of our A-pose rest (the smallest rotation, so twist is kept).
// The world change ΔW_b = W_b(t) · S_b⁻¹ then applies to our bone at rest: world = ΔW_b · R_b, and
// the stored key is the pose rotation of motion.mjs, D_b = ΔW_parent⁻¹ · ΔW_b. The pelvis
// position is stored in units of the source's hip height, so it scales to any body.
//
// Storage. Each track keeps the frames that slerp (as three.js QuaternionLinearInterpolant) cannot
// rebuild within a per-bone angle tolerance, checked on every frame in between (linear key
// reduction, N. Frechette, "Animation Compression: Linear Key Reduction", 2016). Quaternions are
// int16 (x / 32767), frames uint16; the pelvis is int16 in 1/8192 of the hip height.
import fs from 'node:fs';
import path from 'node:path';
import { AnimationMixer, LoadingManager, LoopOnce, Quaternion, Texture, Vector3 } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { createHuman } from '../src/human-three.mjs';

const REPO = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/';
const FPS = 30;
const folder = { s: 'all_animations_max_motextr_static', xy: 'all_animations_max_motextr_xy', xyz: 'all_animations_max_motextr_xyz' };

// id → [male file, female file, plays in a loop]; a file is [folder, name].
export const manifest = {
  walk: [['xy', 'm_walk_neutral'], ['xy', 'f_walk_neutral'], true],
  fast_walk: [['xy', 'm_walk_fast_01'], ['xy', 'f_walk_fast_01'], true],
  jog: [['xy', 'm_run_slow_01'], ['xy', 'f_run_slow_01'], true],
  run: [['xy', 'm_run_neutral'], ['xy', 'f_run_neutral'], true],
  stop: [['xy', 'm_walk_stop'], ['xy', 'f_walk_stop'], false],
  turn: [['xyz', 'm_turn_left_90'], ['xyz', 'f_turn_left_90'], false],
  sit: [['xyz', 'm_sit_down_chair_01'], ['xyz', 'f_sit_down_chair_01'], false],
  stand_up: [['xyz', 'm_sit_stand_up_chair_01'], ['xyz', 'f_sit_stand_up_chair_01'], false],
  look_around: [['s', 'm_idle_look_around_01'], ['s', 'f_idle_look_around_01'], true],
  talk: [['s', 'm_gestic_talk_neutral_01'], ['s', 'f_gestic_talk_neutral_01'], true],
  gesture: [['s', 'm_gestic_presentation_right_01'], ['s', 'f_gestic_presentation_right_01'], true],
  wave: [['s', 'm_wave_01'], ['s', 'f_wave_01'], true],
  use_phone: [['s', 'm_cell_phone_textmessage'], ['s', 'f_cell_phone_textmessage'], true],
  carry: [['s', 'm_hold_bag_idle'], ['s', 'f_hold_bag_idle_01'], true],
  interact: [['s', 'm_knock_door'], ['s', 'f_knock_door'], true],
  breathe: [['s', 'm_idle_neutral_01'], ['s', 'f_idle_neutral_01'], true],
  sit_idle: [['s', 'm_sit_chair_idle_neutral_01'], ['s', 'f_sit_chair_idle_neutral_01'], true],
  stroll: [['xy', 'm_walk_stroll_01'], ['xy', 'f_walk_stroll_01'], true],
  walk_cool: [['xy', 'm_walk_cool_01'], ['xy', 'f_walk_cool_01'], true],
  catwalk: [['xy', 'm_walk_cool_02'], ['xy', 'f_walk_extremefemale'], true],
  dance: [['s', 'm_dancing_neutral'], ['s', 'f_dancing_neutral'], true],
  dance_cool: [['s', 'm_dancing_cool'], ['s', 'f_dancing_cool'], true],
  dance_silly: [['s', 'm_dancing_silly'], ['s', 'f_dancing_silly'], true],
  dance_energetic: [['s', 'm_dancing_aggressive'], ['s', 'f_dancing_aggressive'], true],
  dance_happy: [['xyz', 'm_dancing_sexy'], ['s', 'f_dancing_affective'], true],
  cheer: [['s', 'm_cheer_01'], ['s', 'f_cheer_01'], true],
  clap: [['s', 'm_claphands_01'], ['s', 'f_claphands_01'], true],
  laugh: [['s', 'm_gestic_laugh_loud'], ['s', 'f_gestic_laugh_loud'], true],
  shrug: [['s', 'm_gestic_shrug_01'], ['s', 'f_gestic_shrug_01'], true],
  crouch: [['s', 'm_crouch_idle'], ['s', 'f_crouch_idle'], true],
};
const avatars = { m: 'Avatars/Adults/Male_Adult_01/Export/Male_Adult_01.fbx', f: 'Avatars/Adults/Female_Adult_01/Export/Female_Adult_01.fbx' };
const fileName = ([, name]) => `${name}.max.fbx`;
const fileURL = ([dir, name]) => `${REPO}Animations/${folder[dir]}/${name}.max.fbx`;

// Our bone → Biped bone.
const fingers = { thumb: 0, index: 1, middle: 2, ring: 3, pinky: 4 };
function bipedName(name) {
  const fixed = { pelvis: 'Bip01_Pelvis', spine_01: 'Bip01_Spine', spine_02: 'Bip01_Spine1', spine_03: 'Bip01_Spine2', neck_01: 'Bip01_Neck', head: 'Bip01_Head' }[name];
  if (fixed) return fixed;
  const m = /^(\w+?)_(?:(\d+)_)?([lr])$/.exec(name);
  if (!m) return null;
  const side = m[3].toUpperCase(), part = m[1];
  if (part in fingers) return `Bip01_${side}_Finger${fingers[part]}${['', '1', '2'][Number(m[2]) - 1]}`;
  const limb = { clavicle: 'Clavicle', upperarm: 'UpperArm', lowerarm: 'Forearm', hand: 'Hand', thigh: 'Thigh', calf: 'Calf', foot: 'Foot', ball: 'Toe0' }[part];
  return limb ? `Bip01_${side}_${limb}` : null;
}
// The child whose head sets each bone's direction (our rig); bones without one keep the source's.
const aimChild = {
  pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head',
  clavicle: 'upperarm', upperarm: 'lowerarm', lowerarm: 'hand', hand: 'middle_01', thigh: 'calf', calf: 'foot', foot: 'ball',
};
function aimOf(name) {
  if (aimChild[name]) return aimChild[name];
  const m = /^(\w+?)_(?:(\d+)_)?([lr])$/.exec(name);
  if (!m) return null;
  if (m[1] in fingers) return Number(m[2]) < 3 ? `${m[1]}_0${Number(m[2]) + 1}_${m[3]}` : null;
  return aimChild[m[1]] ? `${aimChild[m[1]]}_${m[3]}` : null;
}
// Angle tolerance (radians) of the key reduction: the trunk and legs carry everything below them.
function tolerance(name) {
  if (/^(pelvis|spine|thigh|calf|clavicle|upperarm)/.test(name)) return 0.15 * Math.PI / 180;
  if (/^(lowerarm|hand|foot|neck|head)/.test(name)) return 0.3 * Math.PI / 180;
  return 0.6 * Math.PI / 180;
}

function parseFBX(file) {
  const bytes = fs.readFileSync(file);
  // Textures are not needed (and Node has no DOM to decode them).
  const manager = new LoadingManager();
  manager.addHandler(/.*/, { path: '', setPath() { return this; }, load: () => new Texture() });
  const group = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  group.updateMatrixWorld(true);
  const byName = new Map();
  group.traverse(object => { if (/^Bip01/.test(object.name) && !byName.has(object.name)) byName.set(object.name, object); });
  return { group, byName };
}
const depth = object => { let n = 0; for (let p = object.parent; p; p = p.parent) n++; return n; };

/**
 * The matched reference pose S: the avatar's bind pose with each mapped bone turned, parents
 * first, so it points where our bone points at rest. World rotations by our bone name.
 */
function referencePose(avatar, rig) {
  const pairs = rig.bones.map(bone => [bone.name, bipedName(bone.name)]).filter(([, b]) => b && avatar.byName.has(b));
  pairs.sort((a, b) => depth(avatar.byName.get(a[1])) - depth(avatar.byName.get(b[1])));
  const head = new Vector3(), tip = new Vector3(), from = new Vector3(), to = new Vector3(), q = new Quaternion(), parentWorld = new Quaternion();
  for (const [ours, theirs] of pairs) {
    const aim = aimOf(ours), aimSource = aim && bipedName(aim);
    if (!aim || !rig.byName.has(aim) || !avatar.byName.has(aimSource)) continue;
    to.subVectors(rig.heads[rig.byName.get(aim)], rig.heads[rig.byName.get(ours)]);
    const bone = avatar.byName.get(theirs);
    bone.getWorldPosition(head); avatar.byName.get(aimSource).getWorldPosition(tip); from.subVectors(tip, head);
    if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) continue;
    q.setFromUnitVectors(from.normalize(), to.normalize());
    bone.parent.getWorldQuaternion(parentWorld);
    bone.quaternion.premultiply(parentWorld.clone().invert().multiply(q).multiply(parentWorld));
    bone.updateMatrixWorld(true);
  }
  const out = new Map();
  for (const [ours, theirs] of pairs) out.set(ours, avatar.byName.get(theirs).getWorldQuaternion(new Quaternion()));
  const hip = avatar.byName.get('Bip01_Pelvis').getWorldPosition(new Vector3());
  return { rotations: out, hipHeight: hip.y };
}

/** Slerp key reduction: indices of the frames kept so every frame is rebuilt within `tol` radians. */
function reduceRotations(values, frames, tol) {
  const q = (i, out) => out.fromArray(values, i * 4);
  const a = new Quaternion(), b = new Quaternion(), c = new Quaternion(), s = new Quaternion();
  const fits = (i, j) => {
    q(i, a); q(j, b);
    for (let k = i + 1; k < j; k++) {
      s.copy(a).slerp(b, (k - i) / (j - i));
      if (s.angleTo(q(k, c)) > tol) return false;
    }
    return true;
  };
  const keep = [0];
  let start = 0;
  for (let j = 2; j < frames; j++) if (!fits(start, j)) { keep.push(j - 1); start = j - 1; }
  if (frames > 1) keep.push(frames - 1);
  return keep;
}
function reducePositions(values, frames, tol) {
  const keep = [0];
  let start = 0;
  const fits = (i, j) => {
    for (let k = i + 1; k < j; k++) {
      const u = (k - i) / (j - i);
      for (let c = 0; c < 3; c++) if (Math.abs(values[i * 3 + c] + (values[j * 3 + c] - values[i * 3 + c]) * u - values[k * 3 + c]) > tol) return false;
    }
    return true;
  };
  for (let j = 2; j < frames; j++) if (!fits(start, j)) { keep.push(j - 1); start = j - 1; }
  if (frames > 1) keep.push(frames - 1);
  return keep;
}

/** One clip as D keys per bone and the pelvis offset per frame. */
function convertClip(file, rig, reference, loop) {
  const source = parseFBX(file);
  const clip = source.group.animations[0];
  if (!clip) throw new Error(`${file}: sem animação`);
  const mixer = new AnimationMixer(source.group);
  // Played once and clamped: setTime(duration) on a looping action wraps to the first frame.
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const names = rig.bones.map(bone => bone.name);
  const parentOf = rig.bones.map(bone => (bone.parent?.isBone ? names.indexOf(bone.parent.name) : -1));
  const rotations = names.map(() => new Float32Array(frames * 4));
  const hips = new Float32Array(frames * 3);
  const identity = new Quaternion(), world = new Quaternion(), delta = names.map(() => new Quaternion()), D = new Quaternion(), hip = new Vector3();
  const inverseReference = new Map([...reference.rotations].map(([name, S]) => [name, S.clone().invert()]));
  for (let f = 0; f < frames; f++) {
    mixer.setTime(Math.min(clip.duration, f / FPS));
    source.group.updateMatrixWorld(true);
    names.forEach((name, i) => {
      const theirs = bipedName(name), Sinv = inverseReference.get(name), p = parentOf[i];
      // Unmapped bones (Root, hair) turn with their parent.
      if (!theirs || !Sinv || !source.byName.has(theirs)) delta[i].copy(p >= 0 ? delta[p] : identity);
      else delta[i].copy(source.byName.get(theirs).getWorldQuaternion(world)).multiply(Sinv);
      D.copy(p >= 0 ? delta[p] : identity).invert().multiply(delta[i]).normalize();
      // One hemisphere along time, so neighbouring keys interpolate the short way.
      if (f > 0) {
        const prev = rotations[i].subarray((f - 1) * 4, f * 4);
        if (D.x * prev[0] + D.y * prev[1] + D.z * prev[2] + D.w * prev[3] < 0) D.set(-D.x, -D.y, -D.z, -D.w);
      }
      rotations[i].set([D.x, D.y, D.z, D.w], f * 4);
    });
    source.byName.get('Bip01_Pelvis').getWorldPosition(hip);
    hips.set([hip.x, hip.y, hip.z], f * 3);
  }
  // Pelvis in hip heights, from its rest point over the feet. A loop drops its travel (in place, as a
  // game's in-place clip: the line from the first to the last frame, then the mean); a one-shot keeps
  // its own path from the first frame (sitting moves back onto the chair).
  const H = reference.hipHeight, offsets = new Float32Array(frames * 3);
  const first = [hips[0], hips[2]], last = [hips[(frames - 1) * 3], hips[(frames - 1) * 3 + 2]];
  for (let f = 0; f < frames; f++) {
    const u = f / (frames - 1);
    const x = hips[f * 3] - (loop ? first[0] + (last[0] - first[0]) * u : first[0]);
    const z = hips[f * 3 + 2] - (loop ? first[1] + (last[1] - first[1]) * u : first[1]);
    offsets.set([x / H, hips[f * 3 + 1] / H - 1, z / H], f * 3);
  }
  if (loop) for (const c of [0, 2]) {
    let mean = 0;
    for (let f = 0; f < frames; f++) mean += offsets[f * 3 + c] / frames;
    for (let f = 0; f < frames; f++) offsets[f * 3 + c] -= mean;
  }
  const travel = [last[0] - first[0], last[1] - first[1]];
  return { duration: (frames - 1) / FPS, frames, names, rotations, offsets, travel, hipStart: hips[1], hipEnd: hips[(frames - 1) * 3 + 1] };
}

class Packer {
  constructor() { this.chunks = []; this.length = 0; }
  push(typed) { const offset = this.length; this.chunks.push(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)); this.length += typed.byteLength; return offset; }
  bytes() { const out = new Uint8Array(this.length); let at = 0; for (const c of this.chunks) { out.set(c, at); at += c.length; } return out; }
}

async function main() {
  if (process.argv.includes('--urls')) {
    for (const [m, f] of Object.values(manifest)) for (const entry of [m, f]) if (entry) console.log(fileURL(entry));
    for (const avatar of Object.values(avatars)) console.log(REPO + avatar);
    return;
  }
  const dir = process.argv[2];
  if (!dir) { console.error('Uso: node tools/import-rocketbox.mjs <pasta com os .fbx> | --urls'); process.exitCode = 1; return; }
  const out = new URL('../assets/animations/', import.meta.url);
  fs.mkdirSync(out, { recursive: true });
  const packer = new Packer(), clips = {};
  let bones = null;
  for (const [gender, which] of [['m', 0], ['f', 1]]) {
    // The default body of that sex (gender 0 is female, state.mjs) gives the A-pose rest.
    const human = await createHuman({ seed: 42, ageYears: 30, gender: gender === 'm' ? 1 : 0 });
    const rig = human.context.skeleton;
    bones ??= rig.bones.map(bone => bone.name);
    const avatar = parseFBX(path.join(dir, path.basename(avatars[gender])));
    const reference = referencePose(avatar, rig);
    console.log(`${gender}: referência com ${reference.rotations.size} ossos, quadril ${reference.hipHeight.toFixed(1)} cm`);
    for (const [id, entry] of Object.entries(manifest)) {
      const source = entry[which], loop = entry[2];
      if (!source) continue;
      const clip = convertClip(path.join(dir, fileName(source)), rig, reference, loop);
      const tracks = [];
      let keys = 0;
      clip.names.forEach((name, i) => {
        const values = clip.rotations[i];
        // Bones that never leave rest are not stored (motion.mjs keys them at rest).
        let moving = false;
        for (let f = 0; f < clip.frames && !moving; f++) moving = 1 - Math.abs(values[f * 4 + 3]) > 1e-7;
        if (!moving) return;
        const kept = reduceRotations(values, clip.frames, tolerance(name));
        const frames = Uint16Array.from(kept), q = new Int16Array(kept.length * 4);
        kept.forEach((f, k) => { for (let c = 0; c < 4; c++) q[k * 4 + c] = Math.round(Math.max(-1, Math.min(1, values[f * 4 + c])) * 32767); });
        tracks.push([bones.indexOf(name), kept.length, packer.push(frames), packer.push(q)]);
        keys += kept.length;
      });
      // 2 mm at a 0.9 m hip.
      const keptHip = reducePositions(clip.offsets, clip.frames, 0.002 / 0.9);
      const hipFrames = Uint16Array.from(keptHip), hip = new Int16Array(keptHip.length * 3);
      keptHip.forEach((f, k) => { for (let c = 0; c < 3; c++) hip[k * 3 + c] = Math.round(Math.max(-3.9, Math.min(3.9, clip.offsets[f * 3 + c])) * 8192); });
      const pelvis = [keptHip.length, packer.push(hipFrames), packer.push(hip)];
      (clips[id] ??= {})[gender] = { file: `Assets/Animations/${folder[source[0]]}/${fileName(source)}`, duration: Math.round(clip.duration * 1e4) / 1e4, frames: clip.frames, loop, tracks, pelvis };
      console.log(`  ${id.padEnd(16)} ${gender} ${fileName(source).padEnd(36)} ${clip.duration.toFixed(2)} s, ${String(clip.frames).padStart(4)} quadros, ${tracks.length} ossos, ${keys} chaves (${(100 * keys / Math.max(1, tracks.length * clip.frames)).toFixed(0)}%), percurso x ${clip.travel[0].toFixed(1)} z ${clip.travel[1].toFixed(1)} cm, quadril ${clip.hipStart.toFixed(1)}→${clip.hipEnd.toFixed(1)} cm`);
    }
    human.dispose();
  }
  const bytes = packer.bytes();
  const index = {
    format: 'human-studio-motion-library', version: 1,
    source: 'Microsoft Rocketbox Avatar Library, https://github.com/microsoft/Microsoft-Rocketbox',
    license: 'MIT', copyright: 'Copyright (c) 2020 Microsoft',
    citation: 'Gonzalez-Franco et al., "The Rocketbox library and the utility of freely available rigged avatars", Frontiers in Virtual Reality, 2020, doi:10.3389/frvir.2020.561558',
    convention: 'D rotations (motion.mjs): world = D_root…D_bone · rest; pelvis offset in hip heights',
    fps: FPS, quaternionScale: 32767, pelvisScale: 8192, bones, clips,
  };
  fs.writeFileSync(new URL('rocketbox.bin', out), bytes);
  fs.writeFileSync(new URL('rocketbox.json', out), JSON.stringify(index));
  console.log(`Gravado: assets/animations/rocketbox.json e rocketbox.bin (${(bytes.length / 1024).toFixed(0)} KiB)`);
}

await main();
