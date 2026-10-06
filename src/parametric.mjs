import { DEFAULT_MACRO, ageFromYears } from './macro.mjs';
import { Morpher } from './parametric-core.mjs';

const asset = name => new URL(`../assets/${name}`, import.meta.url);

async function readAsset(name, binary = false) {
  const url = asset(name);
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(url);
    if (!binary) return JSON.parse(bytes.toString('utf8'));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${name}: HTTP ${response.status}`);
  return binary ? response.arrayBuffer() : response.json();
}

let loading;
export function loadHumanData() {
  loading ??= (async () => {
    const [base, baseBin, macro, macroBin, local, localBin, modifiers, skeleton, weights] = await Promise.all([
      readAsset('base.json'), readAsset('base.bin', true),
      readAsset('targets-macro-pca.json'), readAsset('targets-macro-pca.bin', true),
      readAsset('targets-local.json'), readAsset('targets-local.bin', true),
      readAsset('modifiers.json'), readAsset('skeleton-game-engine.json'),
      readAsset('weights-game-engine.bin', true),
    ]);
    const section = name => {
      const value = base.sections.find(entry => entry.name === name);
      if (!value) throw new Error(`base.json has no ${name}`);
      return value;
    };
    const faces = section('faceVerts');
    const faceUvs = section('faceUvs');
    const uvs = section('uvs');
    const faceGroup = section('faceGroup');
    const packs = { base, baseBin, macro, macroBin, local, localBin, modifiers };
    return {
      base, skeleton, morpher: new Morpher(packs),
      bodyRange: base.vertexGroups.body,
      faces: new Uint16Array(baseBin, faces.byteOffset, faces.count * 4),
      faceUvs: new Uint16Array(baseBin, faceUvs.byteOffset, faceUvs.count * 4),
      uvs: new Float32Array(baseBin, uvs.byteOffset, uvs.count * 2),
      faceGroup: new Uint8Array(baseBin, faceGroup.byteOffset, faceGroup.count),
      joints: new Uint8Array(weights, skeleton.weights.layout.joints.byteOffset, skeleton.weights.vertexCount * 4),
      weights: new Uint16Array(weights, skeleton.weights.layout.weights.byteOffset, skeleton.weights.vertexCount * 4),
    };
  })();
  return loading;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function shapeHuman(data, spec = {}) {
  const macro = {
    ...DEFAULT_MACRO,
    gender: clamp(spec.gender ?? 0.5, 0, 1),
    age: ageFromYears(clamp(spec.ageYears ?? 30, 1, 90)),
    muscle: clamp(spec.muscle ?? 0.5, 0, 1),
    weight: clamp(spec.weight ?? 0.5, 0, 1),
    height: clamp(spec.height ?? 0.5, 0, 1),
    proportions: clamp(spec.proportions ?? 0.5, 0, 1),
    african: clamp(spec.african ?? 1 / 3, 0, 1),
    asian: clamp(spec.asian ?? 1 / 3, 0, 1),
    caucasian: clamp(spec.caucasian ?? 1 / 3, 0, 1),
    cupsize: clamp(spec.cupsize ?? 0.5, 0, 1),
    firmness: clamp(spec.firmness ?? 0.5, 0, 1),
  };
  const raw = data.morpher.shape(macro, spec.features ?? {});
  let foot = Infinity, crown = -Infinity;
  for (const [start, end] of data.bodyRange) {
    for (let v = start; v <= end; v++) {
      foot = Math.min(foot, raw[v * 3 + 1]);
      crown = Math.max(crown, raw[v * 3 + 1]);
    }
  }
  const scale = Number.isFinite(spec.heightMeters)
    ? clamp(spec.heightMeters, 0.55, 2.2) / (crown - foot)
    : 0.1;
  const positions = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    positions[i] = raw[i] * scale;
    positions[i + 1] = (raw[i + 1] - foot) * scale;
    positions[i + 2] = raw[i + 2] * scale;
  }
  // Metres per morph-target unit, for building more shapes on this body.
  positions.unitScale = scale;
  return positions;
}
