import { normalizeSculpt } from './sculpt.mjs';
import { normalizeGarment, newGarment } from './tailor.mjs';
import { normalizeLocks } from './locks.mjs';
import { hairPresetIds } from './hair-presets.mjs';

export const skinPalette = ['#f0c9ad', '#dfad8b', '#c98c66', '#b77850', '#97603f', '#75472f', '#563524', '#39261d'];
export const hairPalette = ['#181514', '#30231e', '#4b3327', '#70503a', '#a1784c', '#c9a977', '#823d2d', '#474343', '#ddd2bf'];
// Iris colours as rendered on the eyeball (appearance.mjs uses this list).
export const eyePalette = ['#563622', '#80583b', '#7b7568', '#53725a', '#4c6484', '#858b8b'];
export const topPalette = ['#45403d', '#293b49', '#a66141', '#94837a', '#75836a', '#7c6474'];
export const bottomPalette = ['#626152', '#343944', '#4d554d', '#4b5361', '#a3947e', '#393634'];
export const outfitNames = ['Casual', 'Esporte fino', 'Social', 'Trabalho', 'Sob medida'];
// Ready-made hair meshes (MakeHuman CC0, made by artists): the base the edited locks are laid over.
export const hairBases = [
  { id: 'short01', name: 'Curto repicado' }, { id: 'short02', name: 'Curto liso' }, { id: 'culturalibre_hair_06', name: 'Desfiado' },
  { id: 'long01', name: 'Longo liso' }, { id: 'braid01', name: 'Trança lateral' }, { id: 'bob01', name: 'Chanel de lado' },
  { id: 'toigo_blunt_bob', name: 'Chanel reto' }, { id: 'toigo_blunt_bob_with_bangs', name: 'Chanel reto com franja' },
  { id: 'toigo_curled_under_bob', name: 'Chanel virado' }, { id: 'toigo_curled_under_bob_with_bangs', name: 'Chanel virado com franja' },
  { id: 'toigo_inverted_bob', name: 'Chanel invertido' }, { id: 'toigo_inverted_bob_with_bangs', name: 'Chanel invertido com franja' },
];
const hairBaseIds = hairBases.map(base => base.id);
// Old presets stored a CC0 hair mesh index; each maps to the nearest mesh-lock style.
const legacyHair = ['curto', 'curto', 'longo', 'chanel', 'chanel', 'chanel', 'franja', 'longo', 'franja', 'franja', 'cacheado', 'curto', 'careca', 'longo', 'longo'];
export const expressionNames = ['Neutra', 'Relaxada', 'Feliz', 'Sorriso', 'Rindo', 'Triste', 'Brava', 'Irritada', 'Surpresa', 'Preocupada', 'Cansada', 'Falando'];
// The last one is the character's own keyed clip (timeline.mjs).
export const animationNames = ['Parado', 'Andar', 'Andar rápido', 'Trote', 'Correr', 'Parar', 'Virar', 'Sentar', 'Levantar', 'Olhar em volta', 'Falar', 'Gesticular', 'Acenar', 'Usar celular', 'Carregar', 'Interagir', 'Personalizada'];
export const lightingNames = ['Neutra', 'Luz do dia', 'Estúdio', 'Dramática', 'Externa'];

export const defaultCharacter = Object.freeze({
  name: 'Maya Chen', seed: 42, gender: 0, age: 28, ageYears: 28, height: 1.72, heightMeters: 1.72,
  build: 0.05, muscle: 0.32, shoulders: 0.0, waist: 0.0, hips: 0.08,
  legLength: 0, headSize: 0, faceWidth: 0, jaw: 0, cheek: 0.12,
  nose: 0, eyeSize: 0, eyeSpacing: 0, skin: 2, skinDetail: 0.65,
  skinRoughness: 0.58, hairPreset: 'careca', hairBase: 'toigo_blunt_bob', hairColor: 1,
  eyeColor: 0, outfit: 0, topColor: 0, bottomColor: 0,
  browAngle: 0, browShape: 0, browArch: 0, browThickness: 1, browWidth: 1, browHeight: 0, browDensity: 1,
  expression: 1, expressionIntensity: 0.38, animation: 0,
  animationSpeed: 1, lighting: 2, pose: 0, faceShapes: {}, colors: {},
  lashLength: 1, lashCurl: 0.5, lashDensity: 1,
  // MakeHuman macros (macro.mjs normalises the three ancestries to sum 1).
  // On the 0.001 grid of saved values (a save/load roundtrip keeps them); the macro divides by their sum.
  proportions: 0.5, african: 0.333, asian: 0.333, caucasian: 0.333, cupsize: 0.5, firmness: 0.5,
});

// Approximate visual defaults informed by WHO/CDC child curves and adult
// anthropometry. They choose a starting stature, not a clinical percentile.
const STATURE = [
  [1, 0.74, 0.76], [2, 0.87, 0.88], [5, 1.09, 1.10],
  [8, 1.27, 1.28], [12, 1.50, 1.49], [16, 1.62, 1.71],
  [20, 1.64, 1.76], [40, 1.63, 1.75], [80, 1.60, 1.70], [90, 1.57, 1.67],
];

export function ageHeightReference(ageYears, gender = 0.5) {
  const age = Math.max(1, Math.min(90, ageYears));
  const sex = Math.max(0, Math.min(1, gender));
  for (let i = 1; i < STATURE.length; i++) {
    if (age > STATURE[i][0]) continue;
    const a = STATURE[i - 1], b = STATURE[i];
    const t = (age - a[0]) / (b[0] - a[0]);
    const female = a[1] + (b[1] - a[1]) * t;
    const male = a[2] + (b[2] - a[2]) * t;
    return female + (male - female) * sex;
  }
  return STATURE.at(-1)[1] + (STATURE.at(-1)[2] - STATURE.at(-1)[1]) * sex;
}

const ranges = {
  gender: [0, 1, true], age: [18, 78, true], ageYears: [1, 90, true], height: [1.48, 1.98], heightMeters: [0.55, 2.2],
  build: [-1, 1], muscle: [0, 1], shoulders: [-1, 1], waist: [-1, 1], hips: [-1, 1],
  legLength: [-1, 1], headSize: [-1, 1], faceWidth: [-1, 1], jaw: [-1, 1], cheek: [-1, 1],
  nose: [-1, 1], eyeSize: [-1, 1], eyeSpacing: [-1, 1], skin: [0, 7, true],
  skinDetail: [0, 1], skinRoughness: [0, 1], hairColor: [0, 8, true],
  eyeColor: [0, 5, true], outfit: [0, 4, true], topColor: [0, 5, true],
  browAngle: [-25, 25], browShape: [0, 3, true], browArch: [-1, 1], browThickness: [0.35, 2.1],
  browWidth: [0.7, 1.4], browHeight: [-1, 1], browDensity: [0, 1],
  lashLength: [0.4, 1.8], lashCurl: [0, 1], lashDensity: [0, 1],
  bottomColor: [0, 5, true], expression: [0, 11, true], expressionIntensity: [0, 1],
  animation: [0, 16, true], animationSpeed: [0.4, 1.8], lighting: [0, 4, true], pose: [0, 3, true],
  proportions: [0, 1], african: [0, 1], asian: [0, 1], caucasian: [0, 1], cupsize: [0, 1], firmness: [0, 1],
};

export const colorKeys = ['skin', 'hair', 'eyes', 'top', 'bottom', 'brows', 'lashes'];

/**
 * A pose ({ bone: [x, y, z, w], $pelvis: [dx, dy, dz] }, motion.mjs convention):
 * bone names as in the rig, unit quaternions, a pelvis offset of at most 1 m.
 */
export function normalizePose(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [name, entry] of Object.entries(value).slice(0, 80)) {
    if (!Array.isArray(entry) || !entry.every(Number.isFinite)) continue;
    if (name === '$pelvis' && entry.length === 3) { out[name] = entry.map(v => Math.round(Math.max(-1, Math.min(1, v)) * 1e4) / 1e4); continue; }
    if (!/^[A-Za-z][A-Za-z0-9_]{1,31}$/.test(name) || entry.length !== 4) continue;
    const length = Math.hypot(...entry);
    if (length < 1e-6) continue;
    out[name] = entry.map(v => Math.round(v / length * 1e5) / 1e5);
  }
  return out;
}

/** The keyed clip: { name, duration (s, ≤ 60), keys: [{ t, pose, face }] } sorted by time, at most 240 keys. */
export function normalizeClip(value) {
  const keys = [];
  for (const key of Array.isArray(value?.keys) ? value.keys.slice(0, 240) : []) {
    if (!Number.isFinite(key?.t)) continue;
    const face = {};
    for (const [shape, weight] of Object.entries(key.face ?? {})) if (/^[a-zA-Z]{3,32}$/.test(shape) && Number.isFinite(weight)) face[shape] = Math.round(Math.max(0, Math.min(1, weight)) * 1000) / 1000;
    keys.push({ t: Math.round(Math.max(0, Math.min(60, key.t)) * 1000) / 1000, pose: normalizePose(key.pose), face });
  }
  keys.sort((a, b) => a.t - b.t);
  const last = keys.at(-1)?.t ?? 0;
  const duration = Number.isFinite(value?.duration) ? Math.max(last, Math.min(60, Math.max(0.1, value.duration))) : Math.max(2, last);
  return { name: typeof value?.name === 'string' ? value.name.slice(0, 40) : 'Personalizada', duration: Math.round(duration * 1000) / 1000, keys };
}

export function normalizeCharacter(value = {}) {
  const result = { ...defaultCharacter };
  result.version = 2;
  result.creation = { locks: Object.fromEntries(['body', 'face', 'hair', 'clothes'].map(key => [key, value.creation?.locks?.[key] === true])) };
  if (typeof value.name === 'string') result.name = value.name.trim().slice(0, 42) || defaultCharacter.name;
  if (Number.isFinite(value.seed)) result.seed = Math.floor(value.seed) >>> 0;
  for (const [key, [min, max, integer]] of Object.entries(ranges)) {
    if (!Number.isFinite(value[key])) continue;
    const number = Math.max(min, Math.min(max, value[key]));
    result[key] = integer ? Math.round(number) : Math.round(number * 1000) / 1000;
  }
  // Per-blendshape offsets added on top of the expression preset.
  result.faceShapes = {};
  if (value.faceShapes && typeof value.faceShapes === 'object') {
    for (const [name, weight] of Object.entries(value.faceShapes)) {
      if (/^[a-zA-Z]{3,32}$/.test(name) && Number.isFinite(weight) && weight !== 0) result.faceShapes[name] = Math.round(Math.max(-1, Math.min(1, weight)) * 1000) / 1000;
    }
  }
  result.sculpt = normalizeSculpt(value.sculpt);
  // Every MakeHuman regional adjustment by category name ("l-"/"r-" for one side only), -1..1.
  result.morphs = {};
  if (value.morphs && typeof value.morphs === 'object') {
    for (const [name, amount] of Object.entries(value.morphs).slice(0, 300)) {
      if (/^([lr]-)?[a-z0-9-]{3,60}$/.test(name) && Number.isFinite(amount) && amount !== 0) result.morphs[name] = Math.round(Math.max(-1, Math.min(1, amount)) * 1000) / 1000;
    }
  }
  // The character's own pose (Animação → Posar) and keyed clip (Linha do tempo).
  result.posing = normalizePose(value.posing);
  result.clip = normalizeClip(value.clip);
  // Hair: a ready-made style, and the locks edited from it (null = the style as made).
  if (hairPresetIds.includes(value.hairPreset)) result.hairPreset = value.hairPreset;
  else if (Number.isInteger(value.hairStyle) && legacyHair[value.hairStyle]) result.hairPreset = legacyHair[value.hairStyle];
  // Characters saved before the base existed keep their hair as it was: no base.
  result.hairBase = hairBaseIds.includes(value.hairBase) ? value.hairBase : value.hairBase === undefined && !('hairPreset' in value) ? defaultCharacter.hairBase : null;
  result.locks = value.locks ? normalizeLocks(value.locks) : null;
  if (result.locks && !result.locks.locks.length && !Array.isArray(value.locks?.locks)) result.locks = null;
  result.garments = Array.isArray(value.garments) ? value.garments.slice(0, 8).map(normalizeGarment) : [newGarment('tshirt'), newGarment('pants')];
  // Free colours chosen with the colour picker; a palette swatch clears them.
  result.colors = {};
  for (const key of colorKeys) if (typeof value.colors?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value.colors[key])) result.colors[key] = value.colors[key].toLowerCase();
  if (!Number.isFinite(value.ageYears) && Number.isFinite(value.age)) result.ageYears = result.age;
  if (!Number.isFinite(value.heightMeters) && Number.isFinite(value.height)) result.heightMeters = result.height;
  return result;
}

export function serializePreset(character) { return JSON.stringify(normalizeCharacter(character)); }
export function parsePreset(json) { return normalizeCharacter(JSON.parse(json)); }

export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const givenNames = ['Maya', 'Elena', 'Amira', 'Nora', 'Sofia', 'Ari', 'Kai', 'Leo', 'Mateo', 'Noah', 'Sam', 'Rafael', 'Inez', 'Theo', 'Aisha', 'Jules'];
const familyNames = ['Chen', 'Silva', 'Park', 'Rivera', 'Okafor', 'Mendes', 'Khan', 'Moreau', 'Costa', 'Tanaka', 'Diaz', 'Bennett'];
const pick = (random, max) => Math.floor(random() * max);
const signed = random => random() * 2 - 1;

export function randomCharacter(seed = Math.floor(Math.random() * 4294967296)) {
  const random = rng(seed);
  const gender = pick(random, 2);
  const age = 19 + pick(random, 54);
  const build = signed(random) * 0.65;
  const height = 1.57 + random() * 0.35 + gender * 0.04;
  const family = pick(random, 4);
  const skinGroup = [pick(random, 3), 2 + pick(random, 3), 4 + pick(random, 4), pick(random, 8)][family];
  return normalizeCharacter({
    ...defaultCharacter, seed, gender, age,
    name: `${givenNames[pick(random, givenNames.length)]} ${familyNames[pick(random, familyNames.length)]}`,
    ageYears: age,
    height, heightMeters: height,
    build, muscle: 0.14 + random() * 0.66,
    shoulders: (gender ? 0.18 : -0.08) + signed(random) * 0.35,
    waist: build * 0.55 + signed(random) * 0.2,
    hips: (gender ? -0.06 : 0.2) + signed(random) * 0.28,
    legLength: signed(random) * 0.42, headSize: signed(random) * 0.28,
    faceWidth: signed(random) * 0.65, jaw: signed(random) * 0.65,
    cheek: signed(random) * 0.6, nose: signed(random) * 0.6,
    eyeSize: signed(random) * 0.45, eyeSpacing: signed(random) * 0.45,
    skin: skinGroup, skinDetail: 0.45 + random() * 0.5,
    skinRoughness: 0.43 + random() * 0.3,
    // A ready-made hair mesh, no locks over it (the editor adds them).
    hairPreset: 'careca', hairBase: (gender ? ['short01', 'short02', 'culturalibre_hair_06', 'short02'] : ['long01', 'toigo_blunt_bob', 'toigo_curled_under_bob_with_bangs', 'toigo_inverted_bob', 'bob01', 'braid01'])[pick(random, gender ? 4 : 6)],
    hairColor: pick(random, 9),
    eyeColor: pick(random, 6), outfit: pick(random, 4),
    topColor: pick(random, 6), bottomColor: pick(random, 6),
    expression: pick(random, 12), expressionIntensity: 0.2 + random() * 0.45,
    animationSpeed: 0.78 + random() * 0.45,
    lighting: 2,
  });
}

/** A new deterministic variation, preserving complete authoring groups chosen by the user. */
export function varyCharacter(character, locks = character.creation?.locks ?? {}, seed = Math.floor(Math.random() * 4294967296)) {
  const current = normalizeCharacter(character), next = randomCharacter(seed);
  const groups = {
    body: ['gender', 'age', 'ageYears', 'height', 'heightMeters', 'build', 'muscle', 'shoulders', 'waist', 'hips', 'legLength', 'headSize', 'skin', 'skinDetail', 'skinRoughness',
      'proportions', 'african', 'asian', 'caucasian', 'cupsize', 'firmness', 'morphs'],
    face: ['faceWidth', 'jaw', 'cheek', 'nose', 'eyeSize', 'eyeSpacing', 'eyeColor', 'browAngle', 'browShape', 'browArch', 'browThickness', 'browWidth', 'browHeight', 'browDensity', 'lashLength', 'lashCurl', 'lashDensity', 'faceShapes'],
    hair: ['hairPreset', 'hairBase', 'hairColor', 'locks'],
    clothes: ['outfit', 'garments', 'topColor', 'bottomColor'],
  };
  for (const [group, keys] of Object.entries(groups)) if (locks[group]) for (const key of keys) next[key] = structuredClone(current[key]);
  next.colors = {};
  for (const [group, keys] of Object.entries({ body: ['skin'], face: ['eyes', 'brows', 'lashes'], hair: ['hair'], clothes: ['top', 'bottom'] })) {
    if (locks[group]) for (const key of keys) if (current.colors[key]) next.colors[key] = current.colors[key];
  }
  if (locks.body || locks.face) next.sculpt.body = structuredClone(current.sculpt.body);
  if (locks.hair) { next.sculpt.hair = structuredClone(current.sculpt.hair); next.sculpt.pins = structuredClone(current.sculpt.pins); }
  if (locks.clothes) next.sculpt.outfit = structuredClone(current.sculpt.outfit);
  for (const key of ['name', 'animation', 'animationSpeed', 'lighting', 'pose', 'expression', 'expressionIntensity']) next[key] = current[key];
  next.creation = { locks: { ...locks } };
  return normalizeCharacter(next);
}
