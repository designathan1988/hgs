import {
  BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, FrontSide, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, SRGBColorSpace, SkinnedMesh, Uint16BufferAttribute,
  Uint32BufferAttribute, Vector3,
} from 'three';
import { fitProxy, loadProxy, proxySkin, proxyTextureURL } from './proxy.mjs';
import { addFaceGroom } from './face-groom.mjs';
import { refineHair, hairNormalMap } from './hair-surface.mjs';
import { eyePalette } from './state.mjs';
import { applyOffsets } from './sculpt.mjs';
import { imageTexture, sharedTexture } from './texture-cache.mjs';
import { tailorOutfit, hideBodyFaces, bodyCollider } from './tailor.mjs';
import { prepareLocks, locksMesh, locksScalpColors, locksUnderlayGeometry, underlayMaterial } from './locks.mjs';
import { resolvePenetration, colliderFromGeometry, cullCovered } from './collision.mjs';

const hairGenerators = new Map();
const clothingGenerators = new Map();

export function registerHairStyle(name, generator) {
  if (!name || typeof generator !== 'function') throw new TypeError('Hair style requires a name and generator');
  hairGenerators.set(name, generator);
}

export function registerClothingStyle(name, generator) {
  if (!name || typeof generator !== 'function') throw new TypeError('Clothing style requires a name and generator');
  clothingGenerators.set(name, generator);
}

const bodyOutfits = new Set(['female_casualsuit01', 'female_casualsuit02', 'female_elegantsuit01', 'female_sportsuit01',
  'male_casualsuit01', 'male_casualsuit02', 'male_elegantsuit01', 'male_worksuit01']);
const hairStyles = new Set(['short01', 'short02', 'long01', 'bob01', 'braid01',
  'toigo_blunt_bob', 'toigo_blunt_bob_with_bangs', 'toigo_curled_under_bob',
  'toigo_curled_under_bob_with_bangs', 'toigo_inverted_bob', 'toigo_inverted_bob_with_bangs',
  'culturalibre_hair_06']);
const shoeStyles = new Set(['shoes01', 'shoes02']);
const shellStyles = { afro: { thickness: 0.06, bumps: 0.2, round: 0.7 }, buzz: { thickness: 0.0025, bumps: 0, round: 0, opacity: 0.82 } };

const linear = value => { const x = value / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const encode = x => Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055));
// The recoloured texture keeps the garment's shading at half brightness on
// average so the vertex colour can reach the chosen swatch without exceeding 1.
const DETAIL_MEAN = 0.5;

/**
 * Split a garment into its UV islands (shirt panels, trouser legs, belt...) and
 * mark each island as upper or lower body by where its centre sits.
 */
function garmentPieces(positions, index, waistY) {
  const parent = new Int32Array(positions.length / 3).map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let i = 0; i < index.length; i += 3) { union(index[i], index[i + 1]); union(index[i], index[i + 2]); }
  const sums = new Map();
  for (let v = 0; v < positions.length / 3; v++) {
    const root = find(v), entry = sums.get(root) ?? { y: 0, n: 0 };
    entry.y += positions[v * 3 + 1]; entry.n++; sums.set(root, entry);
  }
  const lower = new Uint8Array(positions.length / 3);
  for (let v = 0; v < lower.length; v++) { const { y, n } = sums.get(find(v)); lower[v] = y / n < waistY ? 1 : 0; }
  return lower;
}

/** A grey version of the garment texture whose mean over the mesh is DETAIL_MEAN in linear light. */
function detailTexture(image, uvs) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const drawing = canvas.getContext('2d', { willReadFrequently: true });
  drawing.drawImage(image, 0, 0);
  const pixels = drawing.getImageData(0, 0, canvas.width, canvas.height);
  const luminance = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < luminance.length; i++) {
    const d = pixels.data;
    luminance[i] = 0.2126 * linear(d[i * 4]) + 0.7152 * linear(d[i * 4 + 1]) + 0.0722 * linear(d[i * 4 + 2]);
  }
  let mean = 0, count = 0;
  for (let i = 0; i < uvs.length; i += 2) {
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(uvs[i] * canvas.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(uvs[i + 1] * canvas.height)));
    mean += luminance[y * canvas.width + x]; count++;
  }
  mean = Math.max(0.02, mean / Math.max(1, count));
  for (let i = 0; i < luminance.length; i++) {
    const value = encode(Math.min(1, luminance[i] / mean * DETAIL_MEAN));
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = value;
  }
  drawing.putImageData(pixels, 0, 0);
  return new CanvasTexture(canvas);
}

async function proxyObject(name, label, context, { color, hair = false, fit = 0, length = 1, volume = 0, textureFile = null, deform = null, recolor = null, texture = 'straight', curl = 0.5, collide = 0, layer = false } = {}) {
  const proxy = await loadProxy(name);
  const shaped = fitProxy(proxy, context.positions);
  if (deform) for (let i = 0; i < shaped.length; i += 3) {
    const point = deform(new Vector3().fromArray(shaped, i));
    shaped.set(point.toArray(), i);
  }
  if (hair) {
    let highest = -Infinity, lowest = Infinity, centreX = 0, centreZ = 0;
    for (let i = 0; i < shaped.length; i += 3) {
      highest = Math.max(highest, shaped[i + 1]);
      lowest = Math.min(lowest, shaped[i + 1]);
      centreX += shaped[i]; centreZ += shaped[i + 2];
    }
    centreX /= shaped.length / 3; centreZ /= shaped.length / 3;
    const anchor = highest - (highest - lowest) * 0.46;
    for (let i = 0; i < shaped.length; i += 3) {
      shaped[i] = centreX + (shaped[i] - centreX) * (1 + volume * 0.22);
      if (shaped[i + 1] < anchor) shaped[i + 1] = anchor + (shaped[i + 1] - anchor) * Math.max(0.4, Math.min(3.5, length));
      shaped[i + 2] = centreZ + (shaped[i + 2] - centreZ) * (1 + volume * 0.22);
    }
  } else if (fit) {
    let cx = 0, cz = 0;
    for (let i = 0; i < shaped.length; i += 3) { cx += shaped[i]; cz += shaped[i + 2]; }
    cx /= shaped.length / 3; cz /= shaped.length / 3;
    for (let i = 0; i < shaped.length; i += 3) {
      shaped[i] = cx + (shaped[i] - cx) * (1 + fit * 0.08);
      shaped[i + 2] = cz + (shaped[i + 2] - cz) * (1 + fit * 0.08);
    }
  }
  const kind = label === 'Hair' ? 'hair' : label === 'Outfit' ? 'outfit' : null;
  if (kind) applyOffsets(shaped, context.sculpt?.[kind]?.[name], context.height ?? 1.7);
  const skin = proxySkin(proxy, context.data.joints, context.data.weights);
  let geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(shaped, 3));
  if (proxy.uvs.length) geometry.setAttribute('uv', new Float32BufferAttribute(proxy.uvs, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skin.joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skin.weights, 4));
  geometry.setIndex(new Uint32BufferAttribute(proxy.index, 1));
  geometry.computeVertexNormals();
  const textured = typeof document !== 'undefined' && context.lod !== 'low';
  if (recolor) {
    const lower = garmentPieces(shaped, proxy.index, recolor.waistY);
    const scale = textured && proxy.uvs.length ? 1 / DETAIL_MEAN : 1;
    const [top, bottom] = [recolor.top, recolor.bottom].map(value => new Color(value).multiplyScalar(scale));
    const colors = new Float32Array(shaped.length);
    for (let v = 0; v < lower.length; v++) {
      const tone = lower[v] ? bottom : top;
      colors[v * 3] = Math.min(1, tone.r); colors[v * 3 + 1] = Math.min(1, tone.g); colors[v * 3 + 2] = Math.min(1, tone.b);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }
  if (hair && !proxy.meta.transparent && context.lod !== 'low') {
    const refined = refineHair(geometry);
    geometry.dispose(); geometry = refined;
  }
  if (hair && texture !== 'straight') curlHair(geometry, texture, curl);
  // Keep the wearable outside the skin and the layers already dressed.
  if (collide && context.collider) {
    const position = geometry.getAttribute('position');
    // Authored wearables can be double-sided or have inward normals, so they
    // collide with whichever surface is nearest.
    // Fitted wearables start close to their place, so only shallow
    // penetrations (up to 1.5 cm) are searched for.
    if (resolvePenetration(position.array, geometry.index.array, context.collider, { thickness: collide * (context.height ?? 1.7) / 1.7, depth: 0.015 })) {
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      if (hair) weldNormals(geometry);
    }
  }
  const cutout = proxy.meta.transparent;
  const Material = hair && context.lod !== 'low' ? MeshPhysicalMaterial : MeshStandardMaterial;
  const material = new Material({
    color: recolor ? 0xffffff : color ?? 0xffffff, roughness: hair ? 0.5 : 0.75, vertexColors: Boolean(recolor),
    alphaTest: cutout ? 0.35 : 0, alphaToCoverage: cutout,
    transparent: false, depthWrite: true,
    side: hair || proxy.meta.doubleSided || proxy.meta.transparent ? DoubleSide : FrontSide,
  });
  if (hair && material.isMeshPhysicalMaterial) { material.sheen = 0.6; material.sheenRoughness = 0.65; material.sheenColor.set(0x958477); }
  const textureURL = textureFile ? new URL(`../assets/proxies/${textureFile}`, import.meta.url).href : proxyTextureURL(proxy);
  if (textureURL && textured) {
    const base = await imageTexture(textureURL);
    const derived = make => async () => { const texture = make(); texture.colorSpace = SRGBColorSpace; texture.flipY = false; texture.needsUpdate = true; return texture; };
    let texture = base;
    if (recolor) texture = await sharedTexture(`detail:${name}`, derived(() => detailTexture(base.image, proxy.uvs)));
    else if (proxy.meta.kind === 'eyebrows' || proxy.meta.kind === 'eyelashes') {
      // Alpha-only cards: white texels, coloured by the material.
      texture = await sharedTexture(`white:${textureURL}`, derived(() => {
        const canvas = document.createElement('canvas');
        canvas.width = base.image.width; canvas.height = base.image.height;
        const drawing = canvas.getContext('2d', { willReadFrequently: true });
        drawing.drawImage(base.image, 0, 0);
        const pixels = drawing.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) { pixels.data[i] = 255; pixels.data[i + 1] = 255; pixels.data[i + 2] = 255; }
        drawing.putImageData(pixels, 0, 0);
        return new CanvasTexture(canvas);
      }));
    }
    material.map = texture;
    if (hair) { material.normalMap = await sharedTexture(`normal:${textureURL}`, () => hairNormalMap(base.image)); material.normalScale.set(0.7, 0.7); }
    material.needsUpdate = true;
  }
  geometry.userData.proxyVertexCount = shaped.length / 3;
  if (layer && context.collider) colliderFromGeometry(geometry, context.collider);
  const mesh = new SkinnedMesh(geometry, material);
  mesh.name = label;
  mesh.userData.style = name;
  context.group.add(mesh);
  mesh.bind(context.body.skeleton, context.body.bindMatrix);
  return { mesh, proxy };
}

const bodyHeight = context => context.body.geometry.boundingBox.max.y - context.body.geometry.boundingBox.min.y;

export const hairTextures = ['straight', 'wavy', 'curly', 'coily'];
// Wavelength (m), radial and sideways amplitude (m) and extra volume per texture.
const textureShapes = {
  wavy: { wave: 0.075, radial: 0.007, side: 0.002, volume: 0.04 },
  curly: { wave: 0.038, radial: 0.008, side: 0.007, volume: 0.12 },
  coily: { wave: 0.022, radial: 0.006, side: 0.006, volume: 0.22 },
};

/**
 * Wave, curl or coil a mesh hairstyle without adding geometry: below the crown
 * each vertex follows a helix around its strand direction (approximated by
 * the downward direction), growing in from the scalp so the hairline stays.
 */
function curlHair(geometry, texture, curl = 0.5) {
  const shape = textureShapes[texture];
  if (!shape) return;
  const position = geometry.getAttribute('position');
  let top = -Infinity, bottom = Infinity, cx = 0, cz = 0;
  for (let i = 0; i < position.count; i++) {
    top = Math.max(top, position.getY(i)); bottom = Math.min(bottom, position.getY(i));
    cx += position.getX(i); cz += position.getZ(i);
  }
  cx /= position.count; cz /= position.count;
  const anchor = top - (top - bottom) * 0.3, strength = 0.5 + curl;
  // A wave needs a few vertices per turn; coarse card meshes get longer waves.
  const index = geometry.index.array;
  let edges = 0, total = 0;
  for (let i = 0; i < index.length; i += 3 * Math.max(1, Math.floor(index.length / 3000))) {
    const a = index[i], b = index[i + 1];
    total += Math.hypot(position.getX(a) - position.getX(b), position.getY(a) - position.getY(b), position.getZ(a) - position.getZ(b)); edges++;
  }
  const wavelength = Math.max(shape.wave / Math.max(0.4, strength * 0.9), 4.5 * total / Math.max(1, edges));
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const below = Math.max(0, anchor - y);
    const grow = Math.min(1, below / 0.05);
    const rx = x - cx, rz = z - cz, length = Math.hypot(rx, rz) || 1;
    const ux = rx / length, uz = rz / length;
    // Neighbouring locks start their turn at different heights, so curls read
    // as separate locks instead of rings around the head.
    const angle = Math.atan2(rz, rx);
    const phase = angle * 13 + Math.sin(angle * 7) * 2.4 + Math.sin(y * 61 + angle * 3) * 0.8;
    const turn = 2 * Math.PI * below / wavelength + phase;
    const radial = (shape.radial * Math.cos(turn) + shape.volume * 0.05 * Math.min(1, below / 0.12)) * grow * strength;
    const side = shape.side * Math.sin(turn) * grow * strength;
    position.setXYZ(i, x + ux * radial - uz * side, y + shape.volume * 0.25 * below * grow * strength, z + uz * radial + ux * side);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * A light hairstyle grown from the scalp itself: an offset shell of the head
 * surface, fading to nothing at the hairline. Afro uses a thick, rounded,
 * bumpy shell; Buzz cut a thin one. Roughly 2-4k triangles, no textures.
 */
async function shellHair(context, color, { thickness, bumps, round, opacity = 1 }) {
  const original = context.body.geometry;
  const pos = original.getAttribute('position'), normals = original.getAttribute('normal');
  const joints = original.getAttribute('skinIndex'), weights = original.getAttribute('skinWeight');
  const headIndex = context.data.skeleton.bones.findIndex(bone => bone.name === 'head');
  const eyePositions = fitProxy(await loadProxy('eyes'), context.positions);
  let eyeY = 0, eyeZ = 0;
  for (let i = 0; i < eyePositions.length; i += 3) { eyeY += eyePositions[i + 1]; eyeZ = Math.max(eyeZ, eyePositions[i + 2]); }
  eyeY /= eyePositions.length / 3;
  const crown = original.boundingBox.max.y, span = Math.max(0.04, crown - eyeY);
  const alphaAt = v => {
    const z = pos.getZ(v), y = pos.getY(v);
    const forward = Math.max(0, Math.min(1, (z + 0.015) / Math.max(0.02, eyeZ + 0.015)));
    // A natural hairline: high on the forehead, down to the nape at the back.
    const threshold = eyeY + span * (-0.62 + forward * 1.02);
    const t = Math.max(0, Math.min(1, (y - threshold) / Math.max(0.01, span * 0.18)));
    return t * t * (3 - 2 * t);
  };
  // Head centre for rounding the silhouette.
  const centre = new Vector3(0, eyeY + span * 0.25, eyeZ - span * 0.85);
  const radii = new Vector3(span * 0.95, span * 0.8, span * 1.0);
  const noise = (x, y, z) => Math.sin(x * 157 + Math.sin(y * 93)) * Math.sin(y * 131 + Math.sin(z * 71)) * Math.sin(z * 113 + Math.sin(x * 89));
  const out = { pos: [], normal: [], joints: [], weights: [], color: [], index: [] };
  const base = new Color(color);
  const seen = new Map();
  const vertex = v => {
    const key = `${pos.getX(v).toFixed(5)},${pos.getY(v).toFixed(5)},${pos.getZ(v).toFixed(5)}`;
    if (seen.has(key)) return seen.get(key);
    const alpha = alphaAt(v);
    const p = new Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)), n = new Vector3(normals.getX(v), normals.getY(v), normals.getZ(v));
    // Taper towards the hairline and the nape so the shell has no hard rim.
    // The volume builds up over most of the head height, so a rounded style
    // closes in towards the nape instead of overhanging it.
    const nape = Math.max(0, Math.min(1, (p.y - (eyeY - span * 0.7)) / (span * (round > 0 ? 1.3 : 0.4))));
    const grow = alpha * nape * nape * (3 - 2 * nape);
    const bump = 1 + bumps * noise(p.x, p.y, p.z);
    p.addScaledVector(n, 0.002 + thickness * 0.15 * grow);
    if (round > 0) {
      // Rounded styles reach for an ellipsoid around the skull, so the
      // silhouette is a ball rather than an offset of the head.
      const offset = p.clone().sub(centre).divide(radii);
      const reach = Math.max(offset.length(), 1) * (1 + thickness * bump / radii.y);
      const target = centre.clone().add(offset.normalize().multiply(radii).multiplyScalar(reach));
      if (target.distanceTo(centre) > p.distanceTo(centre)) p.lerp(target, grow * round);
    } else p.addScaledVector(n, thickness * grow * bump);
    const at = out.pos.length / 3;
    out.pos.push(p.x, p.y, p.z);
    const shade = 0.75 + 0.25 * Math.sqrt(alpha);
    out.color.push(base.r * shade, base.g * shade, base.b * shade, Math.min(opacity, alpha * alpha * 4));
    for (let j = 0; j < 4; j++) { out.joints.push(joints.getComponent(v, j)); out.weights.push(weights.getComponent(v, j)); }
    seen.set(key, at);
    return at;
  };
  // Visible body quads only; each is (a, a+1, a+2, a, a+2, a+3) in the index.
  for (let quad = 0; quad < original.index.count; quad += 6) {
    const first = original.index.array[quad];
    let headWeight = 0, maximumAlpha = 0;
    for (let k = 0; k < 4; k++) {
      const v = first + k;
      maximumAlpha = Math.max(maximumAlpha, alphaAt(v));
      for (let j = 0; j < 4; j++) if (joints.getComponent(v, j) === headIndex) headWeight += weights.getComponent(v, j);
    }
    if (headWeight / 4 < 0.48 || maximumAlpha < 0.001) continue;
    const ids = [0, 1, 2, 3].map(k => vertex(first + k));
    out.index.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(out.pos, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(out.color, 4));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(out.joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(out.weights, 4));
  geometry.setIndex(out.index);
  geometry.computeVertexNormals();
  applyOffsets(geometry.getAttribute('position').array, context.sculpt?.hair?.[context.shellStyle], context.height ?? 1.7);
  geometry.computeVertexNormals();
  geometry.userData.proxyVertexCount = out.pos.length / 3;
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, transparent: true, alphaTest: 0.25, side: DoubleSide });
  const mesh = new SkinnedMesh(geometry, material);
  mesh.name = 'Hair';
  mesh.userData.style = context.shellStyle;
  context.group.add(mesh);
  mesh.bind(context.body.skeleton, context.body.bindMatrix);
  return mesh;
}

/** Average normals of vertices that share a position (UV seams), so lighting stays continuous. */
function weldNormals(geometry) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), sums = new Map(), keys = [];
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e6)},${Math.round(position.getY(i) * 1e6)},${Math.round(position.getZ(i) * 1e6)}`;
    keys.push(key);
    const sum = sums.get(key) ?? [0, 0, 0];
    sum[0] += normal.getX(i); sum[1] += normal.getY(i); sum[2] += normal.getZ(i);
    sums.set(key, sum);
  }
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = sums.get(keys[i]), length = Math.hypot(x, y, z) || 1;
    normal.setXYZ(i, x / length, y / length, z / length);
  }
  normal.needsUpdate = true;
}

function hideCoveredSkin(geometry, hiddenVertices) {
  if (!hiddenVertices.length) return;
  const hidden = new Set(hiddenVertices);
  const baseIds = geometry.userData.baseIds;
  const old = geometry.index.array;
  const kept = [];
  // Each quad is stored as (a, a+1, a+2, a, a+2, a+3); read its corners from
  // the index itself, which may already have had other covered quads removed.
  for (let i = 0; i < old.length; i += 6) {
    const v = old[i];
    if ([0, 1, 2, 3].every(k => hidden.has(baseIds[v + k]))) continue;
    for (let k = 0; k < 6; k++) kept.push(old[i + k]);
  }
  geometry.setIndex(kept);
}

function childLayer(context, label, select, color, offset = 0.008) {
  const original = context.body.geometry;
  const pos = original.getAttribute('position');
  const nor = original.getAttribute('normal');
  const uv = original.getAttribute('uv');
  const joints = original.getAttribute('skinIndex');
  const weights = original.getAttribute('skinWeight');
  const height = context.body.geometry.boundingBox.max.y - context.body.geometry.boundingBox.min.y;
  const out = { pos: [], nor: [], uv: [], joints: [], weights: [], index: [] };
  // Visible body quads only; each is (a, a+1, a+2, a, a+2, a+3) in the index.
  for (let quad = 0; quad < original.index.count; quad += 6) {
    const first = original.index.array[quad];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) { x += pos.getX(first + k); y += pos.getY(first + k); z += pos.getZ(first + k); }
    x /= 4; y /= 4; z /= 4;
    const influence = new Map();
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) {
      const bone = joints.getComponent(first + k, j);
      influence.set(bone, (influence.get(bone) ?? 0) + weights.getComponent(first + k, j));
    }
    const dominant = [...influence].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const boneName = context.data.skeleton.bones[dominant]?.name ?? '';
    if (!select(Math.abs(x) / height, y / height, z / height, boneName)) continue;
    const at = out.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const v = first + k;
      out.pos.push(pos.getX(v) + nor.getX(v) * offset, pos.getY(v) + nor.getY(v) * offset, pos.getZ(v) + nor.getZ(v) * offset);
      out.nor.push(nor.getX(v), nor.getY(v), nor.getZ(v));
      out.uv.push(uv.getX(v), uv.getY(v));
      for (let j = 0; j < 4; j++) { out.joints.push(joints.getComponent(v, j)); out.weights.push(weights.getComponent(v, j)); }
    }
    out.index.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(out.pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(out.nor, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(out.uv, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(out.joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(out.weights, 4));
  geometry.setIndex(out.index);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ color, roughness: 0.88, side: DoubleSide }));
  mesh.name = label;
  context.group.add(mesh);
  mesh.bind(context.body.skeleton, context.body.bindMatrix);
  return mesh;
}

async function addSurfaceEyes(context, eyeColor = 0, irisColor) {
  const proxy = await loadProxy('eyes');
  const fitted = fitProxy(proxy, context.positions);
  const points = Array.from(fitted), triangles = Array.from(proxy.index);
  // Subdivide the authored eyeball mesh for a smooth iris boundary while
  // retaining its exact fit to the eyelids.
  for (let pass = 0; pass < 2; pass++) {
    const edges = new Map(), next = [];
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) return edges.get(key);
      const at = points.length / 3;
      for (let k = 0; k < 3; k++) points.push((points[a * 3 + k] + points[b * 3 + k]) * 0.5);
      edges.set(key, at);
      return at;
    };
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    triangles.splice(0, triangles.length, ...next);
  }
  const eyeBounds = [-1, 1].map(sign => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let x = 0, y = 0, count = 0;
    for (let i = 0; i < fitted.length; i += 3) {
      if (Math.sign(fitted[i]) !== sign) continue;
      minX = Math.min(minX, fitted[i]); maxX = Math.max(maxX, fitted[i]);
      minY = Math.min(minY, fitted[i + 1]); maxY = Math.max(maxY, fitted[i + 1]);
      minZ = Math.min(minZ, fitted[i + 2]); maxZ = Math.max(maxZ, fitted[i + 2]);
      x += fitted[i]; y += fitted[i + 1]; count++;
    }
    return { sign, cx: x / count, cy: y / count, cz: (minZ + maxZ) / 2,
      rx: (maxX - minX) / 2, ry: (maxY - minY) / 2, rz: (maxZ - minZ) / 2 };
  });
  const irisColors = eyePalette;
  const iris = new Color(irisColor ?? irisColors[Math.max(0, Math.min(irisColors.length - 1, eyeColor))]);
  const sclera = new Color(0xece8e2), pupil = new Color(0x080a0d), rim = new Color(0x3a2921);
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const vertexColors = [];
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    const e = eyeBounds[x < 0 ? 0 : 1];
    const distance = Math.hypot((x - e.cx) / e.rx, (y - e.cy) / e.ry);
    const front = (z - e.cz) / e.rz;
    const angle = Math.atan2(y - e.cy, x - e.cx);
    const fibers = 0.82 + 0.13 * Math.sin(angle * 17) + 0.05 * Math.sin(angle * 29 + 0.9);
    const tone = iris.clone().multiplyScalar(fibers).lerp(rim, smooth(0.39, 0.45, distance));
    tone.lerp(pupil, 1 - smooth(0.13, 0.19, distance));
    const pigment = (1 - smooth(0.43, 0.48, distance)) * smooth(0.28, 0.5, front);
    const color = sclera.clone().lerp(tone, pigment);
    vertexColors.push(color.r, color.g, color.b);
  }
  const headIndex = context.data.skeleton.bones.findIndex(bone => bone.name === 'head');
  const joints = new Uint16Array(points.length / 3 * 4), weights = new Float32Array(joints.length);
  for (let i = 0; i < points.length / 3; i++) { joints[i * 4] = headIndex; weights[i * 4] = 1; }
  const eyeGeometry = new BufferGeometry();
  eyeGeometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  eyeGeometry.setAttribute('color', new Float32BufferAttribute(vertexColors, 3));
  eyeGeometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  eyeGeometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  eyeGeometry.setIndex(triangles);
  eyeGeometry.computeVertexNormals();
  const mesh = new SkinnedMesh(eyeGeometry, new MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.21, clearcoat: 1, clearcoatRoughness: 0.07, side: DoubleSide,
  }));
  mesh.name = 'Eyes';
  context.group.add(mesh);
  mesh.bind(context.body.skeleton, context.body.bindMatrix);
  const position = eyeGeometry.getAttribute('position');
  const head = context.body.skeleton.bones.find(bone => bone.name === 'head');
  head.updateWorldMatrix(true, false);
  for (const [sign, name] of [[1, 'IrisLeft'], [-1, 'IrisRight']]) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let x = 0, y = 0, count = 0;
    for (let i = 0; i < position.count; i++) {
      if (Math.sign(position.getX(i)) !== sign) continue;
      const px = position.getX(i), py = position.getY(i), pz = position.getZ(i);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
      x += px; y += py; count++;
    }
    const cx = x / count, cy = y / count, cz = (minZ + maxZ) / 2;
    const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2, rz = (maxZ - minZ) / 2;
    const points = [], normals = [], faces = [], segments = 32, rings = 7, maxPolar = Math.asin(0.44);
    for (let row = 0; row <= rings; row++) for (let col = 0; col < segments; col++) {
      const polar = row / rings * maxPolar, azimuth = col / segments * Math.PI * 2;
      const sx = Math.sin(polar) * Math.cos(azimuth), sy = Math.sin(polar) * Math.sin(azimuth), sz = Math.cos(polar);
      const local = head.worldToLocal(new Vector3(cx + rx * sx, cy + ry * sy, cz + rz * sz + 0.00005));
      points.push(local.x, local.y, local.z);
      const normal = new Vector3(sx / rx, sy / ry, sz / rz).normalize();
      normals.push(normal.x, normal.y, normal.z);
      if (row === rings) continue;
      const a = row * segments + col, b = a + segments;
      const c = row * segments + (col + 1) % segments, d = c + segments;
      faces.push(a, b, c, b, d, c);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geometry.setIndex(faces);
    const cornea = new Mesh(geometry, new MeshPhysicalMaterial({
      color: 0xffffff, transparent: true, opacity: 0.04, depthWrite: false,
      roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02, side: DoubleSide,
    }));
    cornea.name = name;
    cornea.userData.role = 'corneal-wetness';
    head.add(cornea);
  }
}

async function addScalpUnderlay(context, hairColor) {
  if (context.lod === 'low') return;
  const original = context.body.geometry;
  const pos = original.getAttribute('position'), normals = original.getAttribute('normal');
  const uv = original.getAttribute('uv'), joints = original.getAttribute('skinIndex');
  const weights = original.getAttribute('skinWeight');
  const headIndex = context.data.skeleton.bones.findIndex(bone => bone.name === 'head');
  const eyePositions = fitProxy(await loadProxy('eyes'), context.positions);
  let eyeY = 0, eyeZ = 0;
  for (let i = 0; i < eyePositions.length; i += 3) { eyeY += eyePositions[i + 1]; eyeZ = Math.max(eyeZ, eyePositions[i + 2]); }
  eyeY /= eyePositions.length / 3;
  const span = Math.max(0.04, original.boundingBox.max.y - eyeY);
  const hair = new Color(hairColor).multiplyScalar(0.25);
  const out = { pos: [], normal: [], uv: [], joints: [], weights: [], color: [], index: [] };
  const alphaAt = v => {
    const z = pos.getZ(v), y = pos.getY(v);
    const forward = Math.max(0, Math.min(1, (z + 0.015) / Math.max(0.02, eyeZ + 0.015)));
    const threshold = eyeY + span * (-0.27 + forward * 0.72);
    const t = Math.max(0, Math.min(1, (y - threshold) / Math.max(0.01, span * 0.23)));
    return t * t * (3 - 2 * t);
  };
  // Visible body quads only; each is (a, a+1, a+2, a, a+2, a+3) in the index.
  for (let quad = 0; quad < original.index.count; quad += 6) {
    const first = original.index.array[quad];
    let headWeight = 0, maximumAlpha = 0;
    for (let k = 0; k < 4; k++) {
      const v = first + k;
      maximumAlpha = Math.max(maximumAlpha, alphaAt(v));
      for (let j = 0; j < 4; j++) if (joints.getComponent(v, j) === headIndex) headWeight += weights.getComponent(v, j);
    }
    if (headWeight / 4 < 0.48 || maximumAlpha < 0.001) continue;
    const at = out.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const v = first + k;
      out.pos.push(pos.getX(v) + normals.getX(v) * 0.0015,
        pos.getY(v) + normals.getY(v) * 0.0015,
        pos.getZ(v) + normals.getZ(v) * 0.0015);
      out.normal.push(normals.getX(v), normals.getY(v), normals.getZ(v));
      out.uv.push(uv.getX(v), uv.getY(v));
      out.color.push(hair.r, hair.g, hair.b, alphaAt(v));
      for (let j = 0; j < 4; j++) {
        out.joints.push(joints.getComponent(v, j));
        out.weights.push(weights.getComponent(v, j));
      }
    }
    out.index.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  if (!out.index.length) throw new Error('Could not make a scalp underlay from the head surface');
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(out.pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(out.normal, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(out.uv, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(out.joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(out.weights, 4));
  geometry.setAttribute('color', new Float32BufferAttribute(out.color, 4));
  geometry.setIndex(out.index);
  const material = new MeshStandardMaterial({
    vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95, side: DoubleSide,
  });
  const scalp = new SkinnedMesh(geometry, material);
  scalp.name = 'ScalpUnderlay';
  context.group.add(scalp);
  scalp.bind(context.body.skeleton, context.body.bindMatrix);
}

export async function dressHuman(context, spec) {
  if (context.lod !== 'low') {
    await addSurfaceEyes(context, spec.eyeColor ?? 0, spec.irisColor);
    // 'cards' grooming uses the authored alpha cards instead of strands: a few
    // hundred triangles for brows and lashes instead of ~25k.
    const cards = spec.groom === 'cards';
    const brow = await addFaceGroom(context, spec.browColor ?? spec.hairColor ?? 0x392b23, spec.seed ?? 1, spec.eyebrows, spec.lashes, !cards);
    if (cards && (spec.lashes?.density ?? 1) > 0) {
      const lashes = await proxyObject('eyelashes01', 'Lashes', context, { color: spec.lashes?.color ?? 0x201915, textureFile: 'eyelashes01-original.png' });
      Object.assign(lashes.mesh.material, { alphaTest: 0.3, alphaToCoverage: false });
    }
    if (brow.density > 0) {
    const browCoverage = await proxyObject('eyebrow002', 'BrowCoverage', context, {
      color: new Color(spec.browColor ?? spec.hairColor ?? 0x392b23).lerp(new Color(0xa68065), 0.3),
      textureFile: 'eyebrow002-original.png',
      deform: brow.deform,
    });
    browCoverage.mesh.material.alphaTest = 0.08;
    browCoverage.mesh.material.alphaToCoverage = false;
    browCoverage.mesh.material.transparent = true;
    browCoverage.mesh.material.opacity = (cards ? 1 : 0.65) * brow.density;
    browCoverage.mesh.material.depthWrite = false;
    browCoverage.mesh.material.needsUpdate = true;
    }
  }

  // Layers are dressed from the skin outwards, like garments in a cloth
  // simulator: each is kept at a small thickness outside the body and every
  // layer beneath it, then joins the collider for the next one.
  if (context.lod !== 'low') context.collider = bodyCollider(context);
  if (spec.shoes === 'none') {
    // Barefoot.
  } else if ((spec.ageYears ?? 30) < 16) {
    childLayer(context, 'ChildShoes', (_x, y, _z, bone) => y < 0.14 && /^(foot|ball)/.test(bone), 0x674b36);
  } else {
    const shoes = spec.shoes ?? 'shoes01';
    if (!shoeStyles.has(shoes)) throw new Error(`Unknown shoes: ${shoes}`);
    const { proxy } = await proxyObject(shoes, 'Shoes', context, { color: context.lod === 'low' ? 0x684d38 : undefined, collide: 0.0015, layer: true });
    // Shoes list the foot skin they cover, like outfits do.
    hideCoveredSkin(context.body.geometry, proxy.deleteVerts);
  }
  const clothing = spec.clothing ?? {};
  if (clothingGenerators.has(clothing.style)) {
    const object = await clothingGenerators.get(clothing.style)({ ...context, spec });
    if (!object?.isObject3D) throw new TypeError(`Clothing generator ${clothing.style} must return a Three.js Object3D`);
    context.group.add(object);
  } else if (clothing.style === 'none') {
    // Undressed preview, e.g. while sculpting the body.
  } else if (clothing.style === 'tailor') {
    const { covered } = tailorOutfit(context, clothing.garments ?? [], context.sculpt?.outfit?.tailor, context.collider ?? bodyCollider(context));
    hideBodyFaces(context.body.geometry, covered);
  } else if ((spec.ageYears ?? 30) < 16) {
    childLayer(context, 'ChildTop', (_x, y, _z, bone) =>
      y > 0.42 && y < 0.87 && /^(spine|clavicle|upperarm|lowerarm|neck)/.test(bone),
    clothing.color ?? 0x477aa1, 0.014);
    childLayer(context, 'ChildBottom', (_x, y, _z, bone) =>
      y > 0.09 && y < 0.6 && /^(pelvis|thigh|calf)/.test(bone),
    clothing.bottomColor ?? 0x343d57, 0.008);
    if (context.lod !== 'low') childLayer(context, 'ChildWaist', (x, y) => x < 0.28 && y > 0.47 && y < 0.56,
      clothing.bottomColor ?? 0x343d57, 0.011);
  } else {
    const style = clothing.style ?? (spec.gender < 0.5 ? 'female_casualsuit01' : 'male_worksuit01');
    if (!bodyOutfits.has(style)) throw new Error(`Unknown outfit: ${style}`);
    const pelvis = context.skeleton.heads[context.skeleton.byName.get('pelvis')];
    const top = clothing.color ?? (clothing.bottomColor !== undefined || context.lod === 'low' ? 0x45505e : undefined);
    const { proxy } = await proxyObject(style, 'Outfit', context, {
      fit: clothing.fit ?? 0, collide: 0.002, layer: true,
      recolor: top === undefined ? null : { top, bottom: clothing.bottomColor ?? top, waistY: pelvis.y + 0.02 * bodyHeight(context) },
    });
    hideCoveredSkin(context.body.geometry, proxy.deleteVerts);
  }
  // Whatever of the shoes now sits behind the clothes (a sock inside a trouser leg) is tucked away.
  const outfitMesh = context.group.getObjectByName('Outfit'), shoesMesh = context.group.getObjectByName('Shoes');
  if (outfitMesh && shoesMesh && context.collider) cullCovered(shoesMesh.geometry, outfitMesh.geometry, context.collider);
  // The outfit surface, for hair that rests on clothes.
  if (outfitMesh) {
    const geometry = outfitMesh.geometry;
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    context.outfitSurface = { positions: geometry.getAttribute('position').array, normals: geometry.getAttribute('normal').array, index: geometry.index.array };
  }
  const hair = spec.hair ?? { style: spec.gender < 0.5 ? 'long01' : 'short01' };
  if (hair.style && hair.style !== 'none') {
    if (hair.style === 'locks') {
      // Mesh locks styled in the Mechas editor: solid smooth locks, merged and skinned to the head.
      const state = prepareLocks(context, spec.hairLocks);
      // Free locks hang by gravity on this body and its clothes (deterministic:
      // on the body they were made on, they come out as they were saved).
      state.sim.apply();
      if (state.locks.length) {
        const color = spec.hairColor ?? 0x30231e;
        const mesh = locksMesh(context, state, color);
        context.group.add(mesh);
        mesh.bind(context.body.skeleton, context.body.bindMatrix);
        const under = context.lod === 'low' ? null : locksUnderlayGeometry(context.body.geometry, locksScalpColors(state), color);
        if (under) {
          const scalp = new SkinnedMesh(under, underlayMaterial());
          scalp.name = 'ScalpUnderlay';
          context.group.add(scalp);
          scalp.bind(context.body.skeleton, context.body.bindMatrix);
        }
      }
    } else if (shellStyles[hair.style]) {
      context.shellStyle = hair.style;
      const shape = shellStyles[hair.style];
      await shellHair(context, spec.hairColor ?? 0x30231e, { ...shape, thickness: shape.thickness * (0.6 + (hair.length ?? 1) * 0.5) * (1 + (hair.volume ?? 0)) });
    } else if (hairGenerators.has(hair.style)) {
      const object = await hairGenerators.get(hair.style)({ ...context, spec });
      if (!object?.isObject3D) throw new TypeError(`Hair generator ${hair.style} must return a Three.js Object3D`);
      context.group.add(object);
    } else {
      if (!hairStyles.has(hair.style)) throw new Error(`Unknown hair style: ${hair.style}`);
      await proxyObject(hair.style, 'Hair', context, {
        hair: true, length: hair.length ?? 1, volume: hair.volume ?? 0,
        color: spec.hairColor ?? 0xffffff, texture: hair.texture ?? 'straight', curl: hair.curl ?? 0.5, collide: 0.003,
      });
      await addScalpUnderlay(context, spec.hairColor ?? 0x30231e);
    }
  }

}
