/**
 * Mesh hair, the way character creators for games do it (Reallusion Character
 * Creator: artist-made hair meshes of a few thousand quads, each with morph
 * sliders for length, volume and fit; colour in the shader): a hairstyle is
 * one of MakeHuman's artist hair meshes (CC0), fitted to the head as a proxy
 * (appearance.mjs proxyObject), deformed by
 * - length: the part below 46 % of its height stretched or shortened,
 * - volume: pushed out from its axis,
 * - wave: waves along it (curlHair: wavy, curly, coily by amount),
 * and sculpted further with the Esculpir brushes on the `Hair` target.
 */
export const meshHairStyles = [
  { id: 'long01', name: 'Longo liso' }, { id: 'bob01', name: 'Chanel de lado' },
  { id: 'toigo_blunt_bob', name: 'Chanel reto' }, { id: 'toigo_blunt_bob_with_bangs', name: 'Chanel com franja' },
  { id: 'toigo_curled_under_bob', name: 'Chanel virado' }, { id: 'toigo_curled_under_bob_with_bangs', name: 'Virado com franja' },
  { id: 'toigo_inverted_bob', name: 'Chanel invertido' }, { id: 'toigo_inverted_bob_with_bangs', name: 'Invertido com franja' },
  { id: 'braid01', name: 'Trança lateral' }, { id: 'culturalibre_hair_06', name: 'Desfiado' },
  { id: 'short01', name: 'Curto repicado' }, { id: 'short02', name: 'Curto liso' },
];
export const meshHairStyleIds = meshHairStyles.map(s => s.id);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, a, b, fallback) => Number.isFinite(v) ? clamp(v, a, b) : fallback;

/** A saved hairstyle, bounded; null for none (bald). */
export function normalizeHairMesh(value) {
  if (!value || typeof value !== 'object' || !meshHairStyleIds.includes(value.style)) return null;
  return { style: value.style, length: num(value.length, 0.4, 2.5, 1), volume: num(value.volume, 0, 1, 0), wave: num(value.wave, 0, 1, 0) };
}
export const meshHairOf = id => normalizeHairMesh({ style: id });

/** The build's hair entry (appearance.mjs): the artist mesh and its deformations. */
export function hairSpecOf(hairMesh) {
  if (!hairMesh) return { style: 'none' };
  const wave = hairMesh.wave;
  return {
    style: hairMesh.style, length: hairMesh.length, volume: hairMesh.volume,
    texture: wave < 0.05 ? 'straight' : wave < 0.4 ? 'wavy' : wave < 0.75 ? 'curly' : 'coily', curl: wave,
  };
}
