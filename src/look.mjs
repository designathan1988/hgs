import { Color, SRGBColorSpace } from 'three';
import { skinMaterialFor, skinMaps } from './human-three.mjs';
import { tintedSkinTexture, garmentTexture } from './appearance.mjs';
import { imageTexture, sharedTexture } from './texture-cache.mjs';
import { loadProxy } from './proxy.mjs';

/**
 * Colours and roughness changed on the character on screen, without a rebuild.
 * The build puts colour where glTF can carry it (baseColorFactor ≤ 1): the skin
 * tone and the ready-made garment colours live in their textures. While a
 * colour is dragged the preview multiplies the material colour instead (three.js
 * colours may exceed 1) or bakes an uncached garment texture; `bakeLook` then
 * puts the final value into the textures exactly as the build does.
 */

const hairBrowMix = new Color(0x775a46), coverageMix = new Color(0xa68065);
const meshesOf = human => { const list = []; human.group.traverse(object => { if (object.isMesh) list.push(object); }); return list; };
const materialsOf = mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material];

/** Mean linear colour of a bundled skin texture with its baked tint. */
function bakedMean(url, tint) {
  const name = decodeURIComponent(url.split('/').pop()).replace(/\.webp$/, '');
  const mean = skinMaps[name];
  if (!mean) return null;
  const c = new Color().setRGB(...mean.map(v => v / 255), SRGBColorSpace);
  return [Math.min(1, c.r * tint[0]), Math.min(1, c.g * tint[1]), Math.min(1, c.b * tint[2])];
}

/** Garment colours of the ready-made outfit (as appearance.dressHuman picks them). */
function outfitColors(spec) {
  const clothing = spec.clothing ?? {};
  if (clothing.style === 'tailor' || clothing.style === 'none' || clothing.color === undefined) return null;
  return { top: new Color(clothing.color).getHex(), bottom: new Color(clothing.bottomColor ?? clothing.color).getHex() };
}

let garmentJob = null, garmentNext = null;
/** Recolour the ready-made outfit texture; one bake at a time, the latest request wins. */
function recolorOutfit(human, spec, final) {
  const colors = outfitColors(spec);
  if (!colors) return;
  garmentNext = { human, colors, final };
  if (garmentJob) return;
  garmentJob = (async () => {
    while (garmentNext) {
      const { human: target, colors: { top, bottom }, final: last } = garmentNext; garmentNext = null;
      for (const mesh of meshesOf(target)) for (const material of materialsOf(mesh)) {
        const source = material.userData.hgsProxyTexture;
        if (!source?.recolor) continue;
        const [base, proxy] = await Promise.all([imageTexture(source.url), loadProxy(source.name)]);
        const make = () => { const texture = garmentTexture(base.image, proxy, source.recolor.lower, top, bottom); texture.colorSpace = SRGBColorSpace; texture.flipY = false; texture.needsUpdate = true; return texture; };
        // Drag steps are not cached (they would pile up); the final colour is shared like the build's.
        const texture = last ? await sharedTexture(`garment:${source.name}:${top}:${bottom}`, async () => make()) : make();
        if (material.map && material.map !== texture && material.userData.liveTexture) material.map.dispose();
        material.map = texture; material.userData.liveTexture = !last;
        source.recolor = { ...source.recolor, top, bottom };
        material.needsUpdate = true;
      }
    }
  })().finally(() => { garmentJob = null; });
}

/** Apply `spec`'s colours (a studioSpec) to the character on screen right away. */
export function liveLook(human, spec, { garments = null } = {}) {
  const skin = skinMaterialFor(spec), hair = new Color(spec.hairColor ?? 0x30231e), brow = new Color(spec.browColor ?? spec.hairColor ?? 0x392b23);
  const lashes = new Color(spec.lashes?.color ?? 0x201915);
  const roughness = 0.55 + 0.4 * Math.max(0, Math.min(1, spec.skinRoughness ?? 0.6));
  for (const mesh of meshesOf(human)) for (const material of materialsOf(mesh)) {
    const baked = material.userData.hgsSkinTexture;
    if (mesh === human.body) {
      material.roughness = roughness;
      // Textured skin: the colour factor carries the change from the baked tone to the new one.
      const mean = baked && material.map ? bakedMean(baked.url, baked.tint) : null;
      if (mean) material.color.setRGB(skin.target.r / Math.max(1e-3, mean[0]), skin.target.g / Math.max(1e-3, mean[1]), skin.target.b / Math.max(1e-3, mean[2]));
      else material.color.copy(skin.target);
    } else if (mesh.name === 'Hair' || mesh.name === 'HairCap') {
      material.color.copy(hair);
      material.specularColor?.copy(hair).lerp(new Color(0xffffff), 0.12);
    } else if (mesh.name === 'Brows') material.color.copy(brow).lerp(hairBrowMix, 0.15);
    else if (mesh.name === 'BrowCoverage') material.color.copy(brow).lerp(coverageMix, 0.3);
    else if (mesh.name === 'Lashes') material.color.copy(lashes);
  }
  recolorOutfit(human, spec, false);
  if (garments) recolorTailored(human, garments);
}

/** Solid made-to-measure garments: their vertex colour (tailor.mjs patternColor, 'solid'). */
function recolorTailored(human, garments) {
  for (const mesh of meshesOf(human)) {
    if (!mesh.userData.tailor) continue;
    const g = mesh.geometry, color = g.getAttribute('color'), of = g.userData.garmentOf;
    if (!color || !of) continue;
    const tones = garments.map(garment => garment.pattern === 'solid' && !garment.patternData ? new Color(garment.color) : null);
    for (let v = 0; v < color.count; v++) { const tone = tones[of[v]]; if (tone) color.setXYZ(v, tone.r, tone.g, tone.b); }
    color.needsUpdate = true;
  }
}

/** The final colours into the textures, as the build would make them. */
export async function bakeLook(human, spec) {
  liveLook(human, spec);
  const skin = skinMaterialFor(spec);
  const material = human.body.material, baked = material.userData.hgsSkinTexture;
  if (baked && material.map) {
    const url = new URL(`../assets/skins/${skin.file}`, import.meta.url).href, tint = skin.tint.toArray();
    material.map = await tintedSkinTexture(url, tint);
    material.color.set(0xffffff);
    material.userData.hgsSkinTexture = { url, tint };
    material.needsUpdate = true;
  }
  recolorOutfit(human, spec, true);
}

/** Structural equality of normalized character data (normalizeGarment rebuilds `paint` and `patternData` on every patch). */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!same(a[key], b[key])) return false;
  return true;
}

/** True when `garments` differ from `before` only in the colour of solid, undrafted pieces. */
export function onlyGarmentColour(before, garments) {
  if (!Array.isArray(before) || !Array.isArray(garments) || before.length !== garments.length) return false;
  let changed = false;
  for (let i = 0; i < garments.length; i++) {
    const old = before[i], garment = garments[i];
    if (old === garment) continue;
    for (const key of new Set([...Object.keys(old), ...Object.keys(garment)])) {
      if (key === 'color' || same(old[key], garment[key])) continue;
      return false;
    }
    if (old.color !== garment.color) {
      if (garment.pattern !== 'solid' || garment.patternData) return false;
      changed = true;
    }
  }
  return changed;
}
