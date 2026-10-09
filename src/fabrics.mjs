import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, NoColorSpace } from 'three';

/**
 * Fabrics for made-to-measure garments and costume pieces, as physically based glTF materials.
 *
 * Each fabric is a set of MeshPhysicalMaterial parameters that the glTF exporter writes with core
 * metallic-roughness plus KHR_materials_sheen (back-scattering of fibres: cotton, velvet-like
 * knits, silk and satin get sheen; the sheen roughness is independent of the base roughness),
 * KHR_materials_clearcoat (leather finish) and KHR_materials_iridescence (sequins' thin-film
 * shift), and a tangent-space normal map of its weave or surface (plain weave, denim twill, jersey
 * knit, leather grain, sequins, rhinestones), tiled in metres through KHR_texture_transform.
 * Tulle is a net: its colour texture carries the holes in alpha and the material is alpha-tested
 * (glTF alphaMode MASK), drawn on both sides.
 *
 * The parameters are plain data, so a garment built in the worker carries them to the page; the
 * textures are drawn there on a canvas (`applyFabricTextures`), like the other generated textures.
 * Garment UVs are in metres (tailor.mjs), so `tile` is the width of one texture tile in metres.
 */
export const fabricIds = ['cotton', 'denim', 'knit', 'silk', 'satin', 'leather', 'sequin', 'rhinestone', 'lame', 'tulle'];
export const fabricNames = {
  cotton: 'Algodão', denim: 'Jeans', knit: 'Malha', silk: 'Seda', satin: 'Cetim', leather: 'Couro',
  sequin: 'Paetê', rhinestone: 'Pedraria', lame: 'Lamê', tulle: 'Tule',
};
export const fabrics = {
  cotton: { roughness: 0.88, sheen: 0.35, sheenRoughness: 0.75, normal: 'plain', tile: 0.04, normalScale: 0.45 },
  denim: { roughness: 0.9, sheen: 0.15, sheenRoughness: 0.8, normal: 'twill', tile: 0.04, normalScale: 0.8, color: '#3b5577' },
  knit: { roughness: 0.92, sheen: 0.5, sheenRoughness: 0.6, normal: 'knit', tile: 0.04, normalScale: 0.6 },
  silk: { roughness: 0.38, sheen: 1, sheenRoughness: 0.32, normal: 'plain', tile: 0.012, normalScale: 0.12 },
  satin: { roughness: 0.22, sheen: 0.8, sheenRoughness: 0.25, normal: null, tile: 0.04, normalScale: 0 },
  leather: { roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.45, normal: 'grain', tile: 0.08, normalScale: 0.5, color: '#4a2f22' },
  sequin: { roughness: 0.18, metalness: 0.92, iridescence: 0.35, normal: 'sequin', tile: 0.05, normalScale: 1, color: '#d4a63a' },
  rhinestone: { roughness: 0.3, metalness: 0.15, sheen: 0.6, sheenRoughness: 0.3, normal: 'stones', tile: 0.05, normalScale: 1, gems: true, iridescence: 0.25 },
  lame: { roughness: 0.32, metalness: 0.85, normal: 'plain', tile: 0.01, normalScale: 0.35, color: '#c9b37a' },
  tulle: { roughness: 0.8, sheen: 0.4, sheenRoughness: 0.5, normal: null, tile: 0.02, normalScale: 0, net: true },
};
export const normalizeFabric = id => (fabricIds.includes(id) ? id : 'cotton');

/** MeshPhysicalMaterial parameters (plain values) for a fabric; `roughness` overrides the preset's. */
export function fabricMaterialParameters(id, roughness = null) {
  const f = fabrics[normalizeFabric(id)];
  return {
    roughness: roughness ?? f.roughness, metalness: f.metalness ?? 0,
    sheen: f.sheen ?? 0, sheenRoughness: f.sheenRoughness ?? 1, sheenColor: new Color(f.sheen ? 0xffffff : 0x000000).multiplyScalar(f.sheen ? 0.6 : 0),
    clearcoat: f.clearcoat ?? 0, clearcoatRoughness: f.clearcoatRoughness ?? 0,
    iridescence: f.iridescence ?? 0, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 420],
    ...(f.net ? { alphaTest: 0.5 } : {}),
  };
}

/** Material parameters for costume cards: plumes (soft, sheen) and bead fringe (metallic, iridescent). */
export function cardMaterialParameters(card) {
  return card === 'feather'
    ? { roughness: 0.75, metalness: 0, sheen: 0.7, sheenRoughness: 0.45, sheenColor: new Color(0.6, 0.6, 0.6), alphaTest: 0.3 }
    : { roughness: 0.25, metalness: 0.85, iridescence: 0.3, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 420], alphaTest: 0.45 };
}

// ---------------------------------------------------------------- page-side textures

const SIZE = 256;
const cache = new Map();
const fract = x => x - Math.floor(x);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
function valueNoise(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = t => t * t * (3 - 2 * t), w = (i, j) => hash(((xi + i) % period + period) % period, ((yi + j) % period + period) % period);
  return w(0, 0) * (1 - s(xf)) * (1 - s(yf)) + w(1, 0) * s(xf) * (1 - s(yf)) + w(0, 1) * (1 - s(xf)) * s(yf) + w(1, 1) * s(xf) * s(yf);
}

/** Height (0..1) at texel (x, y) of one seamless tile, per surface kind. */
const heights = {
  // Plain weave: warp and weft threads crossing over and under each other alternately.
  plain: (x, y) => {
    const n = 16, u = x / SIZE * n, v = y / SIZE * n, i = Math.floor(u), j = Math.floor(v);
    const across = Math.sin(Math.PI * fract(v)), along = Math.sin(Math.PI * fract(u));
    return (i + j) % 2 ? 0.5 + 0.5 * across * (0.6 + 0.4 * along) : 0.5 + 0.5 * along * (0.6 + 0.4 * across) - 0.15;
  },
  // Denim 3/1 twill: each weft thread passes over three warps, shifting one per row (diagonal ribs).
  twill: (x, y) => {
    const n = 24, u = x / SIZE * n, v = y / SIZE * n, i = Math.floor(u), j = Math.floor(v);
    const over = ((i - j) % 4 + 4) % 4 < 3;
    return over ? 0.55 + 0.45 * Math.sin(Math.PI * fract(v)) : 0.35 + 0.4 * Math.sin(Math.PI * fract(u));
  },
  // Jersey knit: columns of V-shaped stitches (two leaning loops per stitch).
  knit: (x, y) => {
    const n = 12, u = x / SIZE * n, v = y / SIZE * n * 1.4, fu = fract(u), fv = fract(v);
    const lean = fu < 0.5 ? fu * 2 : (1 - fu) * 2, d = Math.abs(fract(fv + lean * 0.35) - 0.5);
    return Math.sin(Math.PI * fu) * (1 - d * 1.2);
  },
  // Leather grain: fine multi-octave noise with sharper pores.
  grain: (x, y) => {
    let h = 0, a = 0.5;
    for (const f of [8, 16, 32, 64]) { h += a * valueNoise(x / SIZE * f, y / SIZE * f, f); a *= 0.5; }
    return Math.pow(h, 1.6);
  },
  // Rhinestones: rows of round faceted stones (domes with a flat table) on smooth fabric.
  stones: (x, y) => {
    const n = 7, u = x / SIZE * n, v = y / SIZE * n, j = Math.floor(v), cu = fract(u + (j % 2 ? 0.5 : 0)) - 0.5, cv = fract(v) - 0.5;
    const r = Math.hypot(cu, cv) / 0.36;
    if (r >= 1) return 0;
    const facet = Math.round(Math.atan2(cv, cu) / (Math.PI / 4)) * (Math.PI / 4), across = r * Math.cos(Math.atan2(cv, cu) - facet);
    return Math.min(0.75, 1 - across) ;
  },
};

/** A normal map (tangent space, +Y up in texture rows) from a height function, by central differences. */
function normalCanvas(kind, strength = 3) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d'), image = context.createImageData(SIZE, SIZE), h = new Float32Array(SIZE * SIZE);
  if (kind === 'sequin') return sequinCanvas();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) h[y * SIZE + x] = heights[kind](x + 0.5, y + 0.5);
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + (x + SIZE) % SIZE];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const length = Math.hypot(dx, dy, 1), o = (y * SIZE + x) * 4;
    image.data[o] = (-dx / length * 0.5 + 0.5) * 255; image.data[o + 1] = (dy / length * 0.5 + 0.5) * 255;
    image.data[o + 2] = (1 / length * 0.5 + 0.5) * 255; image.data[o + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Sequins: overlapping discs in staggered rows, each hung from its top hole and tilted a little at
 * random, so neighbouring sequins catch the light differently (the sparkle of paetê).
 */
function sequinCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d'), image = context.createImageData(SIZE, SIZE), n = 8, cell = SIZE / n;
  for (let o = 0; o < image.data.length; o += 4) { image.data[o] = 128; image.data[o + 1] = 128; image.data[o + 2] = 255; image.data[o + 3] = 255; }
  // Rows drawn top to bottom: each lower row overlaps the one above, as sequins are sewn.
  for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
    const cx = (i + (j % 2 ? 0.5 : 0) + 0.5) * cell, cy = (j + 0.5) * cell * 0.85, r = cell * 0.62;
    const ti = ((i % n) + n) % n, tj = ((j % n) + n) % n;
    const tx = (hash(ti, tj) - 0.5) * 0.9, ty = (hash(tj + 7, ti + 3) - 0.5) * 0.9 - 0.25;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const hole = d < 0.12, rim = d > 0.9;
      let nx = tx + (rim ? (x - cx) / r * 0.6 : 0), ny = -ty - (rim ? (y - cy) / r * 0.6 : 0), nz = 1;
      if (hole) { nx = 0; ny = 0; }
      const length = Math.hypot(nx, ny, nz), px = ((x % SIZE) + SIZE) % SIZE, py = ((y % SIZE) + SIZE) % SIZE, o = (py * SIZE + px) * 4;
      image.data[o] = (nx / length * 0.5 + 0.5) * 255; image.data[o + 1] = (ny / length * 0.5 + 0.5) * 255; image.data[o + 2] = (nz / length * 0.5 + 0.5) * 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Rhinestones are shiny and metallic, the cloth between them is not (glTF: roughness in G, metalness in B). */
function stonesMetalRoughCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d'), image = context.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const stone = heights.stones(x + 0.5, y + 0.5) > 0, o = (y * SIZE + x) * 4;
    // Stones: roughness 0.08, metalness 1; the satin between them: roughness 0.3, metalness 0.
    image.data[o] = 255; image.data[o + 1] = stone ? 20 : 77; image.data[o + 2] = stone ? 255 : 0; image.data[o + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Tulle: a hexagonal net, opaque threads and open holes (alpha), white so the vertex colour shows. */
function tulleCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d'), image = context.createImageData(SIZE, SIZE), n = 16;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE * n, v = y / SIZE * n * 1.1547, row = Math.floor(v), fu = fract(u + (row % 2) * 0.5) - 0.5, fv = fract(v) - 0.5;
    const thread = Math.min(Math.abs(fu), Math.abs(Math.abs(fu) + Math.abs(fv) * 0.9 - 0.5)) < 0.09, o = (y * SIZE + x) * 4;
    image.data[o] = image.data[o + 1] = image.data[o + 2] = 255; image.data[o + 3] = thread ? 255 : 0;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function tiled(key, make, tile, colorSpace = NoColorSpace) {
  let texture = cache.get(key);
  if (!texture) {
    texture = new CanvasTexture(make());
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.colorSpace = colorSpace;
    texture.userData.shared = true;
    cache.set(key, texture);
  }
  // One texture per tile size (the repeat is a property of the texture, exported as KHR_texture_transform).
  const sized = cache.get(`${key}@${tile}`) ?? texture.clone();
  sized.repeat.set(1 / tile, 1 / tile);
  sized.userData.shared = true;
  cache.set(`${key}@${tile}`, sized);
  return sized;
}

/**
 * A plume on a card (u across, v from the quill to the tip): a rachis down the middle and many
 * fine barbs leaning towards the tip, longest in the middle of the vane and rounded at the tip, with
 * fluffy, partly transparent ends. White, so the vertex colour tints it.
 */
function featherCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 512;
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, cx = W / 2;
  g.clearRect(0, 0, W, H);
  g.lineCap = 'round';
  // Canvas row 0 is the tip (v = 1 after the texture's flipY), the bottom row the quill.
  const vane = t => Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 1.02)), 0.55) * (t < 0.08 ? t / 0.08 : 1);
  for (let i = 0; i < 900; i++) {
    const t = 0.04 + 0.96 * hash(i, 1), y = H * (1 - t), side = i % 2 ? 1 : -1, reach = (W / 2 - 3) * vane(t) * (0.75 + 0.25 * hash(i, 2));
    const lean = reach * (0.55 + 0.3 * hash(i, 3)), wave = (hash(i, 4) - 0.5) * 10;
    g.strokeStyle = `rgba(255,255,255,${0.35 + 0.55 * hash(i, 5)})`;
    g.lineWidth = 1 + hash(i, 6);
    g.beginPath(); g.moveTo(cx, y);
    g.quadraticCurveTo(cx + side * reach * 0.5, y - lean * 0.35 + wave, cx + side * reach, y - lean);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, H); g.lineTo(cx, H * 0.03); g.stroke();
  return canvas;
}

/**
 * Fringe on a card: four strands of sequins and beads hanging side by side, open between them.
 * Strands are about a fifth of the card wide: thinner ones fall below the alpha threshold in the
 * smaller mip levels (averaged with the gaps) and vanish at a distance.
 */
function fringeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 512;
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, strands = 4;
  g.clearRect(0, 0, W, H);
  for (let s = 0; s < strands; s++) {
    const x = (s + 0.5) * W / strands;
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    // Sequins and beads along the strand, overlapping, a little off its line as they hang loose.
    for (let y = 4 + hash(s, 9) * 6; y < H - 6; y += 9 + hash(s, Math.floor(y)) * 4) {
      const off = (hash(s, y) - 0.5) * 4, r = 9 + hash(y, s) * 4;
      g.fillStyle = `rgba(${235 + 20 * hash(y, s + 2)},${235 + 20 * hash(y, s + 3)},255,1)`;
      g.beginPath(); g.ellipse(x + off, y, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
    }
  }
  return canvas;
}

/** A whole-card texture (not tiled), shared. */
function cardTexture(key, make) {
  let texture = cache.get(key);
  if (!texture) {
    texture = new CanvasTexture(make());
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.userData.shared = true;
    cache.set(key, texture);
  }
  return texture;
}

/** Attach a fabric's textures to a material built from fabricMaterialParameters (page only). */
export function applyFabricTextures(material, { fabric, card }) {
  if (typeof document === 'undefined') return;
  // Plumes and fringe are alpha-tested cards (glTF alphaMode MASK). With the renderer's MSAA,
  // alpha to coverage turns the cut-out edge into partial coverage per sample: soft edges with no
  // sorting, as foliage and hair cards are drawn in games.
  if (card) {
    material.map = cardTexture(`card:${card}`, card === 'feather' ? featherCanvas : fringeCanvas);
    material.alphaTest = card === 'feather' ? 0.3 : 0.45;
    material.alphaToCoverage = true;
    material.needsUpdate = true;
    return;
  }
  const f = fabrics[normalizeFabric(fabric)];
  if (f.normal) {
    material.normalMap = tiled(`fabric-normal:${f.normal}`, () => normalCanvas(f.normal), f.tile);
    material.normalScale.set(f.normalScale, f.normalScale);
  }
  if (f.gems) {
    const metalRough = tiled('fabric-stones-mr', stonesMetalRoughCanvas, f.tile);
    material.roughnessMap = metalRough; material.metalnessMap = metalRough;
    material.roughness = 1; material.metalness = 1;
  }
  if (f.net) {
    material.map = tiled('fabric-tulle', tulleCanvas, f.tile, SRGBColorSpace);
    material.alphaTest = 0.5;
  }
  material.needsUpdate = true;
}
