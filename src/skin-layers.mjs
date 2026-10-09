import { CanvasTexture, SRGBColorSpace } from 'three';

/**
 * Makeup and tattoos as layers painted into the skin texture (as Character Creator's SkinGen stacks
 * makeup and decal layers over the base skin): what is painted travels with the texture into the GLB,
 * so every engine shows it.
 *
 * - Makeup regions come from MakeHuman's regional targets: a vertex belongs to the lips as much as the
 *   lip-volume targets move it (|displacement| over the target's largest one), eased so the region has
 *   a soft edge. The weights are rasterised in UV space (barycentric per body triangle) and the colour
 *   is mixed in linear light keeping the skin's own shading (its luminance over the region's mean), so
 *   pores and folds still read through lipstick or blush.
 * - Tattoos are decals: a design (drawn here, or an image the user loads) in the ink colour, multiplied
 *   onto the skin at a UV position, size and angle.
 */

export const makeupRegions = {
  // Thresholds checked in the app: the lip volume targets also move the skin round the lips a little.
  lips: { targets: ['mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-upperlip-volume-incr'], from: 0.45, to: 0.8 },
  eyeshadow: { targets: ['eyes/l-eye-eyefold-up', 'eyes/r-eye-eyefold-up'], from: 0.25, to: 0.7 },
  eyeliner: { targets: ['eyes/l-eye-height1-incr', 'eyes/r-eye-height1-incr'], from: 0.62, to: 0.92 },
  blush: { targets: ['cheek/l-cheek-volume-incr', 'cheek/r-cheek-volume-incr'], from: 0.35, to: 0.95 },
};
export const makeupNames = { lips: 'Batom', eyeshadow: 'Sombra', eyeliner: 'Delineador', blush: 'Blush' };
export const defaultMakeup = Object.freeze({
  lips: { color: '#a23a3f', amount: 0 }, eyeshadow: { color: '#6b4a6e', amount: 0 },
  eyeliner: { color: '#1b1412', amount: 0 }, blush: { color: '#d06a6a', amount: 0 },
});

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const linear = v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const encode = x => Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055));
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => linear(i));
const hexRGB = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(linear); };

const regionCache = new WeakMap();
/** Per base vertex, how much it belongs to each makeup region (0..1); fixed by the base mesh, cached per data. */
export function regionWeights(data) {
  if (regionCache.has(data)) return regionCache.get(data);
  const morpher = data.morpher, count = data.base.vertexCount ?? data.joints.length / 4, out = {};
  for (const [region, { targets, from, to }] of Object.entries(makeupRegions)) {
    const w = new Float32Array(count);
    for (const name of targets) {
      const t = morpher.localByName.get(name);
      if (!t) continue;
      let peak = 0;
      for (let e = t.start; e < t.start + t.count; e++) peak = Math.max(peak, Math.hypot(morpher.lDelta[e * 3], morpher.lDelta[e * 3 + 1], morpher.lDelta[e * 3 + 2]));
      if (!peak) continue;
      for (let e = t.start; e < t.start + t.count; e++) {
        const v = morpher.lIdx[e], d = Math.hypot(morpher.lDelta[e * 3], morpher.lDelta[e * 3 + 1], morpher.lDelta[e * 3 + 2]) / peak;
        if (v < count) w[v] = Math.max(w[v], smoothstep(from, to, d));
      }
    }
    out[region] = w;
  }
  regionCache.set(data, out);
  return out;
}

/** Rasterise per-vertex weights of the body (corner UVs) into a W×H alpha buffer (max blend), texture rows flipped (v up). */
function rasterise(alpha, W, H, geometry, weightOf) {
  const uv = geometry.getAttribute('uv'), index = geometry.index.array, ids = geometry.userData.baseIds;
  const box = [W, H, 0, 0];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const wa = weightOf(ids[a]), wb = weightOf(ids[b]), wc = weightOf(ids[c]);
    if (wa <= 0 && wb <= 0 && wc <= 0) continue;
    const ax = uv.getX(a) * W, ay = (1 - uv.getY(a)) * H, bx = uv.getX(b) * W, by = (1 - uv.getY(b)) * H, cx = uv.getX(c) * W, cy = (1 - uv.getY(c)) * H;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area, l2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area, l3 = 1 - l1 - l2;
      if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
      const value = l1 * wa + l2 * wb + l3 * wc, i = y * W + x;
      if (value > alpha[i]) alpha[i] = value;
    }
    box[0] = Math.min(box[0], x0); box[1] = Math.min(box[1], y0); box[2] = Math.max(box[2], x1); box[3] = Math.max(box[3], y1);
  }
  return box;
}

/** Built-in tattoo designs, drawn black on a transparent 256×256 canvas (the ink colour is applied later). */
export const tattooDesigns = {
  estrela: { name: 'Estrela', draw(g) { g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 50 : 118, a = -Math.PI / 2 + k * Math.PI / 5; g.lineTo(128 + r * Math.cos(a), 128 + r * Math.sin(a)); } g.closePath(); g.lineWidth = 14; g.stroke(); } },
  coracao: { name: 'Coração', draw(g) { g.beginPath(); g.moveTo(128, 214); g.bezierCurveTo(20, 140, 30, 40, 128, 84); g.bezierCurveTo(226, 40, 236, 140, 128, 214); g.fill(); } },
  tribal: { name: 'Tribal', draw(g) { g.lineCap = 'round'; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(128, 30); g.bezierCurveTo(128 + s * 120, 60, 128 + s * 40, 140, 128 + s * 110, 226); g.bezierCurveTo(128 + s * 20, 170, 128 + s * 70, 90, 128, 30); g.fill(); } g.beginPath(); g.arc(128, 128, 18, 0, Math.PI * 2); g.fill(); } },
  rosa: { name: 'Rosa', draw(g) { g.lineWidth = 9; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(128, 104, 22 + k * 18, Math.PI * (0.15 + k * 0.4), Math.PI * (1.55 + k * 0.4)); g.stroke(); } g.beginPath(); g.moveTo(128, 176); g.quadraticCurveTo(116, 210, 128, 246); g.stroke(); g.beginPath(); g.ellipse(100, 212, 22, 9, -0.6, 0, Math.PI * 2); g.fill(); } },
  ancora: { name: 'Âncora', draw(g) { g.lineWidth = 14; g.lineCap = 'round'; g.beginPath(); g.arc(128, 46, 20, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(128, 66); g.lineTo(128, 222); g.moveTo(84, 96); g.lineTo(172, 96); g.stroke(); g.beginPath(); g.arc(128, 150, 72, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); } },
  texto: { name: 'Texto', draw(g, tattoo) { g.font = 'bold 54px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(tattoo.text ?? 'amor').slice(0, 14), 128, 128, 240); } },
};

const images = new Map();
/** An uploaded tattoo image (a data URL), decoded once. */
function imageOf(url) {
  if (images.has(url)) return images.get(url);
  const promise = new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url; });
  images.set(url, promise);
  return promise;
}

/** A tattoo's design in its ink colour, on its own 256×256 canvas. */
async function inkedDesign(tattoo) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = g.strokeStyle = '#000';
  if (tattoo.image) g.drawImage(await imageOf(tattoo.image), 0, 0, 256, 256);
  else (tattooDesigns[tattoo.design] ?? tattooDesigns.estrela).draw(g, tattoo);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = tattoo.color ?? '#1d2430';
  g.fillRect(0, 0, 256, 256);
  return canvas;
}

export const hasSkinLayers = layers => Boolean(layers && (Object.values(layers.makeup ?? {}).some(item => item?.amount > 0) || layers.tattoos?.length));

const layered = new Map();
/**
 * The skin texture `base` (a CanvasTexture of the tinted skin) with the makeup and tattoos of `layers`
 * painted in. `geometry` is the body's (corner UVs and base ids), `data` the human data (targets).
 * Cached by texture and layers; returns `base` when there is nothing to paint.
 */
export function layeredSkinTexture(base, geometry, data, layers) {
  if (!hasSkinLayers(layers) || typeof document === 'undefined') return Promise.resolve(base);
  const key = `${base.uuid}|${JSON.stringify(layers)}`;
  if (layered.has(key)) return layered.get(key);
  const promise = (async () => {
    const source = base.image, W = source.width, H = source.height;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0);
    const pixels = g.getImageData(0, 0, W, H), d = pixels.data;
    const weights = regionWeights(data);
    for (const [region, item] of Object.entries(layers.makeup ?? {})) {
      if (!(item?.amount > 0) || !weights[region]) continue;
      const alpha = new Float32Array(W * H), w = weights[region];
      const [x0, y0, x1, y1] = rasterise(alpha, W, H, geometry, v => w[v] ?? 0);
      if (x1 < x0) continue;
      // The region's mean skin luminance: the colour keeps the skin's shading relative to it.
      let sum = 0, n = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (alpha[i] > 0.5) { const p = i * 4; sum += 0.2126 * LINEAR[d[p]] + 0.7152 * LINEAR[d[p + 1]] + 0.0722 * LINEAR[d[p + 2]]; n++; } }
      const mean = Math.max(0.01, n ? sum / n : 0.2), color = hexRGB(item.color), amount = Math.min(1, item.amount);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x, a = alpha[i] * amount;
        if (a <= 0) continue;
        const p = i * 4, r = LINEAR[d[p]], gg = LINEAR[d[p + 1]], b = LINEAR[d[p + 2]];
        const shade = Math.min(1.6, (0.2126 * r + 0.7152 * gg + 0.0722 * b) / mean);
        const target = [color[0] * shade, color[1] * shade, color[2] * shade];
        d[p] = encode(r + (target[0] - r) * a); d[p + 1] = encode(gg + (target[1] - gg) * a); d[p + 2] = encode(b + (target[2] - b) * a);
      }
    }
    g.putImageData(pixels, 0, 0);
    // Tattoos: ink multiplied onto the skin, centred at their UV point.
    for (const tattoo of layers.tattoos ?? []) {
      const design = await inkedDesign(tattoo).catch(() => null);
      if (!design) continue;
      g.save();
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = Math.min(1, Math.max(0, tattoo.opacity ?? 0.9));
      g.translate(tattoo.u * W, (1 - tattoo.v) * H);
      g.rotate(tattoo.angle ?? 0);
      const size = (tattoo.size ?? 0.06) * W;
      g.drawImage(design, -size / 2, -size / 2, size, size);
      g.restore();
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace; texture.flipY = base.flipY; texture.needsUpdate = true;
    return texture;
  })();
  layered.set(key, promise);
  // Older layer combinations of this skin are let go (one drag makes many).
  for (const old of layered.keys()) if (old !== key && old.startsWith(`${base.uuid}|`)) layered.delete(old);
  return promise;
}
