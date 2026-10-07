import {
  AmbientLight, AnimationMixer, Color, DirectionalLight, GridHelper, Group, Mesh,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector3, WebGLRenderer,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { LoopOnce, LoopRepeat } from 'three';
import { createHuman, exportHumanGLB, faceWeights, applyFaceWeights } from './human-three.mjs';
import { oneShotClips } from './motion.mjs';
import { SculptSession } from './sculpt.mjs';
import { LockEditor } from './lock-editor.mjs';
import { hairPresetData } from './hair-presets.mjs';
import { ageHeightReference, randomCharacter, hairPalette, topPalette, bottomPalette } from './state.mjs';

const femaleOutfits = ['female_casualsuit01', 'female_casualsuit02', 'female_elegantsuit01', 'female_sportsuit01'];
const maleOutfits = ['male_casualsuit01', 'male_casualsuit02', 'male_elegantsuit01', 'male_worksuit01'];
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const hex = value => parseInt(value.slice(1), 16);

/** The locks a character's hair is built from: its edited locks, else its ready-made style. */
export const hairLocksOf = person => person.locks ?? hairPresetData(person.hairPreset);

export function studioSpec(person, { undressed = false } = {}) {
  const features = {
    'nose-scale-depth-decr-incr': person.nose,
    'head-scale-horiz-decr-incr': person.faceWidth,
    'head-scale-vert-decr-incr': person.headSize,
    'chin-width-decr-incr': person.jaw,
    'cheek-volume-decr-incr': person.cheek,
    'eye-scale-decr-incr': person.eyeSize,
    'eye-trans-in-out': person.eyeSpacing ?? 0,
    'measure-shoulder-dist-decr-incr': person.shoulders,
    'torso-scale-horiz-decr-incr': person.waist,
    'measure-hips-circ-decr-incr': person.hips,
    'upperlegs-height-decr-incr': person.legLength,
  };
  const female = person.gender < 0.5;
  const colors = person.colors ?? {};
  const age = person.ageYears ?? person.age;
  const stature = (person.heightMeters ?? person.height) / ageHeightReference(age, person.gender);
  const outfit = person.outfit === 4 ? 'tailor' : (female ? femaleOutfits : maleOutfits)[(person.outfit ?? 0) % femaleOutfits.length];
  return {
    seed: person.seed, gender: person.gender, ageYears: age,
    muscle: person.muscle, weight: clamp((person.build + 1) / 2, 0, 1),
    // Tall or short for the age shifts proportions; heightMeters sets the size.
    height: clamp(0.5 + (stature - 1) / 0.24, 0, 1),
    heightMeters: person.heightMeters ?? person.height,
    features, skin: person.skin, skinRoughness: person.skinRoughness,
    skinColor: colors.skin ? hex(colors.skin) : undefined,
    eyeColor: person.eyeColor, irisColor: colors.eyes ? hex(colors.eyes) : undefined,
    eyebrows: { angle: person.browAngle ?? 0, shape: ['natural', 'straight', 'arched', 'angled'][person.browShape ?? 0],
      arch: person.browArch ?? 0, thickness: person.browThickness ?? 1, width: person.browWidth ?? 1,
      height: person.browHeight ?? 0, density: person.browDensity ?? 1 },
    // Hair is mesh locks: the edited locks, else the chosen ready-made style.
    hair: { style: hairLocksOf(person)?.locks.length ? 'locks' : 'none' },
    hairLocks: hairLocksOf(person),
    hairColor: hex(colors.hair ?? hairPalette[person.hairColor] ?? hairPalette[1]),
    browColor: colors.brows ? hex(colors.brows) : undefined,
    lashes: { length: person.lashLength ?? 1, curl: person.lashCurl ?? 0.5, density: person.lashDensity ?? 1, color: colors.lashes ? hex(colors.lashes) : undefined },
    clothing: undressed ? { style: 'none' } : outfit === 'tailor' ? { style: 'tailor', garments: person.garments ?? [] } : { style: outfit, color: hex(colors.top ?? topPalette[person.topColor] ?? topPalette[0]),
      bottomColor: hex(colors.bottom ?? bottomPalette[person.bottomColor] ?? bottomPalette[0]) },
    shoes: undressed ? 'none' : 'shoes01',
    sculpt: person.sculpt,
    animationSpeed: person.animationSpeed,
    pose: person.pose,
    faceWeights: faceWeights(person.expression, person.expressionIntensity ?? 0.5, person.faceShapes),
  };
}

export class Camera {
  constructor() {
    this.yaw = 0.12; this.pitch = 0.04; this.distance = 3.35;
    this.currentView = 'body';
    this.target = new Vector3(0, 0.98, 0);
  }
  eye() {
    return new Vector3(
      this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance,
    );
  }
  /**
   * Orbit; with a pivot (the surface point under the cursor, as Blender's
   * Auto Depth), the camera turns around that point, which stays where it is
   * on screen.
   */
  orbit(dx, dy, pivot = null) {
    const before = pivot && this.basis(), eye = pivot && this.eye();
    this.yaw += dx * 0.008; this.pitch = clamp(this.pitch + dy * 0.006, -1.2, 1.2);
    if (!pivot) return;
    // The pivot in the old camera frame, put back at the same place in the new one.
    const rel = pivot.clone().sub(eye), local = before.map(axis => rel.dot(axis));
    const after = this.basis(), newEye = pivot.clone();
    after.forEach((axis, k) => newEye.addScaledVector(axis, -local[k]));
    this.target.copy(newEye).addScaledVector(after[2], this.distance);
  }
  /** Camera right, up and forward (towards the target). */
  basis() {
    const forward = new Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return [right, new Vector3().crossVectors(right, forward), forward];
  }
  zoom(delta) { this.distance = clamp(this.distance * Math.exp(delta * 0.001), 0.35, 90); }
  /**
   * Zoom towards a point (the surface under the cursor, Blender's "Zoom to
   * Mouse Position"): the view scales about it, so it stays under the cursor.
   */
  zoomAt(delta, point) {
    const before = this.distance;
    this.zoom(delta);
    const s = this.distance / before;
    this.target.sub(point).multiplyScalar(s).add(point);
  }
  pan(dx, dy) {
    const factor = this.distance * 0.0013;
    this.target.x -= Math.cos(this.yaw) * dx * factor;
    this.target.z += Math.sin(this.yaw) * dx * factor;
    this.target.y += dy * factor;
  }
  view(name, height = 1.75) {
    this.currentView = name;
    if (name === 'front') { this.yaw = 0; this.pitch = 0; this.distance = Math.max(1.35, height * 1.85); this.target.set(0, height * 0.52, 0); }
    if (name === 'side') { this.yaw = Math.PI / 2; this.pitch = 0; this.distance = Math.max(1.35, height * 1.85); this.target.set(0, height * 0.52, 0); }
    if (name === 'rear') { this.yaw = Math.PI; this.pitch = 0; this.distance = Math.max(1.35, height * 1.85); this.target.set(0, height * 0.52, 0); }
    if (name === 'face') { this.yaw = 0; this.pitch = 0; this.distance = 0.68; this.target.set(0, height * 0.88, 0); }
    if (name === 'body') { this.yaw = 0.12; this.pitch = 0.04; this.distance = Math.max(1.45, height * 1.95); this.target.set(0, height * 0.52, 0); }
    if (name === 'crowd') { this.yaw = 0.35; this.pitch = 0.38; this.distance = 22; this.target.set(0, 0.9, 0); }
  }
  /** Follow a change in body height while keeping the user's orbit and zoom. */
  rescale(from, to) {
    if (!(from > 0) || Math.abs(to - from) < 0.005) return;
    const ratio = to / from;
    this.target.y *= ratio;
    if (this.currentView !== 'face') this.distance = clamp(this.distance * ratio, 0.35, 90);
  }
}

export class Renderer {
  static async create(canvas, onError) { return new Renderer(canvas, onError); }
  constructor(canvas, onError) {
    this.canvas = canvas; this.onError = onError;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.setClearColor(0x202b34);
    this.scene = new Scene(); this.scene.background = new Color(0x202b34);
    this.viewCamera = new PerspectiveCamera(36, 1, 0.025, 180);
    this.camera = new Camera();
    this.scene.add(new AmbientLight(0xffffff, 1.2));
    const key = new DirectionalLight(0xfff2df, 2.6); key.position.set(-3, 7, 5); this.scene.add(key); this.keyLight = key;
    const fill = new DirectionalLight(0xb2c9ff, 0.85); fill.position.set(3, 4, -4); this.scene.add(fill); this.fillLight = fill;
    const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: 0x343a3f, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.015; this.scene.add(floor);
    const grid = new GridHelper(200, 100, 0x4c555b, 0x3d454b); grid.position.y = -0.012; this.scene.add(grid);
    this.current = null; this.mixer = null; this.crowd = [];
    this.crowdPrototypes = []; this.crowdVersion = 0;
    this.lastTime = null; this.token = 0; this.requestedCrowd = 0; this.crowdBuiltFor = 0; this.action = null;
    this.sculpt = new SculptSession(this); this.sculptMode = false; this.undressed = false;
    this.lockEditor = new LockEditor(this); this.locksMode = false;
    this.pivotRay = new Raycaster();
  }
  async setCharacter(person) {
    const token = ++this.token;
    try {
      const spec = studioSpec(person, { undressed: this.sculptMode && this.undressed });
      const human = await createHuman(spec);
      this.hairColor = spec.hairColor;
      if (token !== this.token) { human.dispose(); return false; }
      const previous = this.current;
      if (previous) { this.scene.remove(previous.group); previous.dispose(); }
      const crowdSeed = this.person?.seed;
      this.person = person;
      this.current = human; this.scene.add(human.group);
      this.mixer = new AnimationMixer(human.group);
      this.action = null;
      this.setPresentation(person);
      // Keep the user's orbit and zoom; only follow a change in stature.
      if (!previous) this.camera.view(this.camera.currentView, human.metrics.height);
      else if (!this.requestedCrowd) this.camera.rescale(previous.metrics.height, human.metrics.height);
      // Crowd variants depend only on the seed, so other edits keep the crowd.
      if (crowdSeed !== person.seed || this.crowdBuiltFor !== this.requestedCrowd) this.setCrowdCount(this.requestedCrowd);
      if (this.sculptMode) this.freezeForSculpt();
      if (this.locksMode) this.beginLocks();
      return true;
    } catch (error) { this.onError(error.message); console.error(error); return false; }
  }
  /** Animation, playback speed and lighting change without rebuilding the mesh. */
  setPresentation(person) {
    if (this.person) Object.assign(this.person, { animation: person.animation, animationSpeed: person.animationSpeed, lighting: person.lighting,
      expression: person.expression, expressionIntensity: person.expressionIntensity, faceShapes: person.faceShapes });
    this.faceBase = faceWeights(person.expression, person.expressionIntensity ?? 0.5, person.faceShapes);
    if (this.current && !this.frozen) applyFaceWeights(this.current.faceMeshes, this.faceBase);
    const light = [
      [2.3, 0.9, 0x26323a], [1.7, 1.3, 0x29333a], [2.6, 0.85, 0x202b34],
      [3.2, 0.3, 0x171e2b], [2.8, 1.0, 0x30404a],
    ][person.lighting ?? 2];
    this.keyLight.intensity = light[0]; this.fillLight.intensity = light[1];
    this.scene.background.setHex(light[2]);
    if (!this.current || !this.mixer || this.frozen) return;
    const clip = this.current.animations[person.animation ?? 0] ?? this.current.animations[0];
    const action = this.mixer.clipAction(clip);
    if (action !== this.action) {
      this.mixer.stopAllAction();
      action.reset();
      if (oneShotClips.has(clip.name)) { action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; }
      else action.setLoop(LoopRepeat, Infinity);
      action.play();
      this.action = action;
    }
    action.setEffectiveTimeScale(person.animationSpeed ?? 1);
  }
  /**
   * Sculpting works on the rest pose: stop playback, return the skeleton to
   * its bind pose and clear facial weights so the mesh shows its stored shape.
   */
  freezeForSculpt() {
    if (!this.current) return;
    this.mixer?.stopAllAction();
    this.action = null;
    this.current.body.skeleton.pose();
    applyFaceWeights(this.current.faceMeshes, {});
    this.sculpt.prepare(this.current, { pins: this.person?.sculpt?.pins?.[this.current.group.getObjectByName('Hair')?.userData.style] });
  }
  get frozen() { return this.sculptMode || this.locksMode; }
  /** Hair editing: rest pose, live lock physics, meshes rebuilt as you work. */
  setLocksMode(on) {
    this.locksMode = on;
    if (on) { this.beginLocks(); return null; }
    const data = this.lockEditor.end();
    if (this.person) this.setPresentation(this.person);
    return data;
  }
  beginLocks() {
    if (!this.current) return;
    this.mixer?.stopAllAction(); this.action = null;
    this.current.body.skeleton.pose();
    applyFaceWeights(this.current.faceMeshes, {});
    const keep = this.lockEditor.active ? this.lockEditor.end() : null;
    this.lockEditor.begin(this.current, keep ?? (this.person ? hairLocksOf(this.person) : null), this.hairColor ?? 0x30231e);
    const height = this.current.metrics.height;
    if (this.camera.distance > 1.2) { this.camera.yaw = 0.55; this.camera.pitch = 0.12; this.camera.distance = 1.05; this.camera.target.set(0, height * 0.88, 0); }
  }
  setSculptMode(on) {
    this.sculptMode = on;
    this.sculpt.cursor.visible = false;
    if (on) this.freezeForSculpt();
    else if (this.person) { this.sculpt.target = null; this.setPresentation(this.person); }
  }
  /** Replay a one-shot clip such as Sit from its first frame. */
  replay() { this.action?.reset().play(); }
  async setCrowdCount(count, onProgress = () => {}) {
    this.requestedCrowd = count;
    const version = ++this.crowdVersion;
    for (const item of this.crowd) this.scene.remove(item.group);
    this.crowd.length = 0;
    this.crowdBuiltFor = 0;
    for (const prototype of this.crowdPrototypes) { prototype.low.dispose(); prototype.medium.dispose(); }
    this.crowdPrototypes = [];
    if (!this.current || !count) { onProgress(null); return; }
    const ages = [4, 8, 18, 25, 35, 50, 67, 82];
    const prototypes = [];
    try {
      for (let type = 0; type < Math.min(count, ages.length); type++) {
        onProgress(`Building crowd ${type + 1}/${Math.min(count, ages.length)}…`);
        const variant = randomCharacter((this.person.seed + type * 173 + 1) >>> 0);
        variant.gender = type % 2;
        variant.ageYears = ages[type];
        variant.heightMeters = ageHeightReference(ages[type], variant.gender);
        const spec = studioSpec(variant);
        const low = await createHuman({ ...spec, lod: 'low' });
        let medium;
        try { medium = await createHuman({ ...spec, lod: 'medium' }); }
        catch (error) { low.dispose(); throw error; }
        prototypes.push({ low, medium });
        if (version !== this.crowdVersion) {
          prototypes.forEach(item => { item.low.dispose(); item.medium.dispose(); }); return;
        }
      }
    } catch (error) {
      prototypes.forEach(item => { item.low.dispose(); item.medium.dispose(); });
      onProgress(null); this.onError(error.message); console.error(error); return;
    }
    this.crowdPrototypes = prototypes;
    // Lay the crowd on a grid with the centre cell left free for the edited character.
    const width = Math.ceil(Math.sqrt(count + 1)) | 1, middle = (width * width - 1) / 2;
    for (let i = 0; i < count; i++) {
      const prototype = prototypes[i % prototypes.length];
      const low = cloneSkinned(prototype.low.group);
      const medium = cloneSkinned(prototype.medium.group);
      const group = new Group(); group.add(low, medium);
      const cell = i < middle ? i : i + 1;
      group.position.set((cell % width - (width - 1) / 2) * 1.4, 0, (Math.floor(cell / width) - (width - 1) / 2) * 1.4);
      group.rotation.y = (i * 2.399) % (Math.PI * 2);
      medium.visible = false;
      this.scene.add(group);
      const lowMixer = new AnimationMixer(low), mediumMixer = new AnimationMixer(medium);
      lowMixer.clipAction(prototype.low.animations[1]).play();
      mediumMixer.clipAction(prototype.medium.animations[1]).play();
      this.crowd.push({ group, low, medium, lowMixer, mediumMixer,
        height: prototype.low.metrics.height, phase: (i * 0.37) % 1 });
    }
    this.crowdBuiltFor = count;
    onProgress(null);
  }
  /** Export at the chosen detail level; lower levels are built on demand. */
  async exportGLB({ lod = 'high', groom = 'strands', ...options } = {}) {
    if (!this.current || !this.person) throw new Error('No human is ready to export');
    if (lod === 'high' && groom === 'strands' && !this.frozen && !this.undressed) {
      applyFaceWeights(this.current.faceMeshes, this.faceBase ?? {});
      return exportHumanGLB(this.current, options);
    }
    const human = await createHuman({ ...studioSpec(this.person), lod, groom });
    try { return await exportHumanGLB(human, options); } finally { human.dispose(); }
  }
  /** The point of the character (body, clothes, hair) under the cursor, or null. */
  pivotAt(ndc) {
    const objects = [this.current?.group, this.lockEditor.group].filter(group => group?.parent);
    if (!objects.length) return null;
    this.pivotRay.setFromCamera(ndc, this.viewCamera);
    const hit = this.pivotRay.intersectObjects(objects, true).find(h => h.object.visible && h.object.isMesh && !h.object.isInstancedMesh && h.object !== this.lockEditor.hoverMark);
    return hit ? hit.point.clone() : null;
  }
  /** The point under the cursor, or on the cursor's ray at the view centre's depth over empty space. */
  pointUnder(ndc) {
    const hit = this.pivotAt(ndc);
    if (hit) return hit;
    const ray = this.pivotRay.ray, depth = this.camera.target.clone().sub(ray.origin).dot(ray.direction);
    return ray.origin.clone().addScaledVector(ray.direction, Math.max(0.05, depth));
  }
  render(time) {
    if (this.lastTime == null) this.lastTime = time;
    const dt = Math.min(0.1, time - this.lastTime); this.lastTime = time;
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.viewCamera.aspect = width / height; this.viewCamera.updateProjectionMatrix();
    this.viewCamera.position.copy(this.camera.eye()); this.viewCamera.lookAt(this.camera.target);
    if (!this.frozen) this.mixer?.update(dt);
    if (this.locksMode && this.lockEditor.active) this.lockEditor.step(dt || 1 / 60);
    // Clips animate blinks and the jaw; keep the chosen expression underneath.
    for (const mesh of this.frozen ? [] : this.current?.faceMeshes ?? []) {
      for (const [name, value] of Object.entries(this.faceBase ?? {})) {
        const index = mesh.morphTargetDictionary[name];
        if (index !== undefined && mesh.morphTargetInfluences[index] < value) mesh.morphTargetInfluences[index] = value;
      }
    }
    const ranked = this.crowd.map(person => {
      const center = new Vector3(person.group.position.x, person.height * 0.5, person.group.position.z);
      const distance = Math.max(0.1, center.distanceTo(this.viewCamera.position));
      const pixels = person.height * height / (2 * Math.tan(this.viewCamera.fov * Math.PI / 360) * distance);
      return { person, pixels };
    }).sort((a, b) => b.pixels - a.pixels);
    const mediumSet = new Set(ranked.slice(0, 10).filter(item => item.pixels > 70).map(item => item.person));
    let mediumCount = 0;
    for (const person of this.crowd) {
      const detailed = mediumSet.has(person);
      person.medium.visible = detailed; person.low.visible = !detailed;
      if (detailed) { mediumCount++; person.mediumMixer.setTime(time + person.phase); }
      else person.lowMixer.setTime(time + person.phase);
    }
    this.renderer.render(this.scene, this.viewCamera);
    if (!this.current) return null;
    const info = this.renderer.info.render;
    return {
      draws: info.calls, triangles: info.triangles,
      vertices: this.current.metrics.vertices, visible: this.crowd.length + 1,
      skeletons: this.crowd.length + 1, faces: this.crowd.length + 1,
      lod: [1, mediumCount, this.crowd.length - mediumCount, 0, 0],
    };
  }
}
