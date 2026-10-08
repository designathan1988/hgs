import { CanvasTexture, Color, DoubleSide, FrontSide, MeshPhysicalMaterial, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Hair cards, the representation games use for hair (Epic, "Setting up cards
 * and meshes for grooms"): each lock is a strip that follows its centre line,
 * textured with many strands whose alpha cuts the strip into hair. Alpha test
 * with alpha-to-coverage (MSAA) softens the cut edges without sorting; the
 * highlight is dim and tinted by the hair's colour.
 *
 * UV: u across the card (one quarter of the atlas per variant), v from the root
 * (0) to the tip (1).
 */
export const CARD_VARIANTS = 4;
const ACROSS = 3; // vertices across a card: left edge, raised middle, right edge
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** A stable small hash of a lock (its root), for the strand variant and a shade jitter. */
function lockHash(lock) {
  const r = lock.rootP ?? { x: 0, y: 0, z: 0 };
  const h = Math.sin(r.x * 12.9898 + r.y * 78.233 + r.z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Card geometry from a lock's swept centre line (`sweep` from locks.mjs:
 * samples `line`, unit tangent `tan`, width axis `side`, outward axis `out`,
 * half-width `half`, arc parameter `u` per sample). Returns the same typed
 * arrays as the tube did (pos, normal, uv, color, index), so geometryFrom and
 * updateGeometry merge and refresh cards unchanged. `vertex(x, y, z, u)` is
 * called per vertex (skin weights).
 */
export function cardFromSweep(sweep, lock, { vertex = null } = {}) {
  const { M, line, tan, side, out, half, u } = sweep;
  const count = M * ACROSS;
  const pos = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2), color = new Float32Array(count * 3);
  // The base layer uses the dense (most opaque) variants, the hair over it all four.
  const hash = lockHash(lock), variants = String(lock.group ?? '').startsWith('base') ? 2 : CARD_VARIANTS;
  const variant = Math.floor(hash * variants) % variants;
  const u0 = (variant + 0.04) / CARD_VARIANTS, u1 = (variant + 0.96) / CARD_VARIANTS;
  // Each lock a little lighter or darker than its neighbours; roots darker (shadowed by the hair above).
  const jitter = 0.9 + 0.2 * ((hash * 7.31) % 1);
  // The middle of the card is raised outwards (an arch), so a card reads as a lock with volume and lights round.
  const arch = 0.32 * (lock.volume ?? 0.2) / 0.2;
  let v = 0;
  for (let j = 0; j < M; j++) {
    const o = j * 3, a = half[j], s = u[j];
    const shade = jitter * (0.62 + 0.38 * smooth(0, 0.22, s));
    for (let k = 0; k < ACROSS; k++, v++) {
      const across = k - 1; // -1, 0, 1
      // Flat at the root (it lies on the scalp), arched further on (a lock with volume).
      const lift = across === 0 ? a * Math.min(0.6, arch) * smooth(0.04, 0.3, s) : 0;
      const px = line[o] + side[o] * a * across + out[o] * lift;
      const py = line[o + 1] + side[o + 1] * a * across + out[o + 1] * lift;
      const pz = line[o + 2] + side[o + 2] * a * across + out[o + 2] * lift;
      // Normals of a rounded lock: outward in the middle, tilted towards the sides at the edges.
      let nx = out[o] + side[o] * across * 0.7, ny = out[o + 1] + side[o + 1] * across * 0.7, nz = out[o + 2] + side[o + 2] * across * 0.7;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
      normal[v * 3] = nx; normal[v * 3 + 1] = ny; normal[v * 3 + 2] = nz;
      uv[v * 2] = u0 + (u1 - u0) * (k / (ACROSS - 1)); uv[v * 2 + 1] = s;
      color[v * 3] = color[v * 3 + 1] = color[v * 3 + 2] = shade;
      vertex?.(px, py, pz, s);
    }
  }
  const index = new Uint32Array((M - 1) * (ACROSS - 1) * 6);
  let n = 0;
  for (let j = 0; j + 1 < M; j++) for (let k = 0; k + 1 < ACROSS; k++) {
    const a = j * ACROSS + k, b = a + 1, c = a + ACROSS, d = c + 1;
    index[n++] = a; index[n++] = c; index[n++] = b; index[n++] = b; index[n++] = c; index[n++] = d;
  }
  return { pos, normal, uv, color, index };
}

let atlas;
/**
 * The strand atlas, drawn once on a canvas: CARD_VARIANTS columns side by
 * side, root at v = 0 (flipY off). White strands of varied brightness and
 * width; alpha is full near the root and thins out towards the tip and the
 * card's edges, so a card ends in loose strands, not a cut. Page only (the
 * generation worker has no canvas; the page attaches it, see appearance.mjs).
 */
export function hairStrandTexture() {
  if (atlas) return atlas;
  if (typeof document === 'undefined') return null;
  const columnWidth = 256, height = 1024, width = columnWidth * CARD_VARIANTS;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, width, height);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  g.lineCap = 'round';
  for (let c = 0; c < CARD_VARIANTS; c++) {
    const left = c * columnWidth;
    // A clump: a dense core of strands (the card reads as a lock, not as see-through wisps)
    // whose strands end at different lengths, and sparser loose strands at the edges.
    // Variants 0-1 dense (the base layer: near opaque), 2-3 lighter (breakup layers over it).
    const strands = c < 2 ? 380 : 250;
    for (let s = 0; s < strands; s++) {
      // Dense in the middle, thinning out towards the card's sides and never at its very edge:
      // a card has no straight side where it overlaps another (or the skin shows in a hard line).
      const edge = random() < 0.2;
      const t = edge ? 0.08 + 0.84 * random() : 0.5 + (random() + random() - 1) * 0.36;
      const x0 = left + t * columnWidth;
      // Strands stop at very different lengths over the last half, so a card ends in a ragged point, not a cut.
      const end = height * (edge ? 0.35 + 0.55 * random() : 0.5 + 0.5 * Math.sqrt(random()));
      const strandWidth = 1.5 + random() * 2.5, light = Math.round(150 + random() * 105), wave = (random() - 0.5) * 8, phase = random() * 6.28;
      // Strands start at slightly different heights, so the root end of a card is soft, not a cut line.
      const start = height * 0.05 * random(), steps = 20;
      for (let k = 0; k < steps; k++) {
        const ya = start + (k / steps) * (end - start), yb = start + ((k + 1) / steps) * (end - start);
        const xa = x0 + Math.sin(ya / height * 5 + phase) * wave, xb = x0 + Math.sin(yb / height * 5 + phase) * wave;
        // Opaque along most of the strand, fading over its last fifth.
        const fade = 1 - smooth(0.78, 1, (k + 0.5) / steps);
        g.strokeStyle = `rgba(${light},${light},${light},${((edge ? 0.75 : 1) * fade).toFixed(3)})`;
        g.lineWidth = strandWidth * (1 - 0.5 * (k / steps));
        g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke();
      }
    }
  }
  atlas = new CanvasTexture(canvas);
  atlas.colorSpace = SRGBColorSpace;
  atlas.flipY = false;
  atlas.anisotropy = 4;
  atlas.userData.shared = true;
  return atlas;
}

/**
 * The hair cap: the scalp covered with the same strands, combed the way the
 * hair goes, so the skin never shows between cards or at the parting, and the
 * hairline fades out strand by strand (games put this under hair cards as a
 * scalp texture). A mesh 0.8 mm over the scalp's quads (base-mesh vertices,
 * `field` ≥ 0 inside the hairline); `flow(p, n)` gives the combing direction
 * at a point (unit, in the skin's plane). UV: a tileable strand texture laid
 * along the flow, 4 cm per tile. Colour RGBA: darker than the hair (it lies
 * under it) and alpha fading out across the hairline.
 */
export function hairCapPart(state, flow) {
  const { positions, normals, field, frame, data } = state;
  const lift = 0.0008, tile = 0.04, fade = 0.03;
  const index = new Map(), pos = [], normal = [], uv = [], color = [], faces = [];
  const p = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };
  const vertex = v => {
    if (index.has(v)) return index.get(v);
    p.x = positions[v * 3]; p.y = positions[v * 3 + 1]; p.z = positions[v * 3 + 2];
    n.x = normals[v * 3]; n.y = normals[v * 3 + 1]; n.z = normals[v * 3 + 2];
    const along = flow(p, n), across = [n.y * along[2] - n.z * along[1], n.z * along[0] - n.x * along[2], n.x * along[1] - n.y * along[0]];
    const at = pos.length / 3;
    pos.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift);
    normal.push(n.x, n.y, n.z);
    // World position projected on the local (across, along) frame: continuous where the flow turns slowly.
    uv.push((p.x * across[0] + p.y * across[1] + p.z * across[2]) / tile, (p.x * along[0] + p.y * along[1] + p.z * along[2]) / tile);
    const alpha = smooth(-0.004, fade, field[v]);
    color.push(0.62, 0.62, 0.62, alpha);
    index.set(v, at);
    return at;
  };
  for (const f of frame.faces) {
    const ids = [0, 1, 2, 3].map(c => data.faces[f * 4 + c]);
    if (!ids.every(v => field[v] >= -0.004)) continue;
    const [a, b, c, d] = ids.map(vertex);
    faces.push(a, b, c, a, c, d);
  }
  return { pos: new Float32Array(pos), normal: new Float32Array(normal), uv: new Float32Array(uv), color: new Float32Array(color), index: new Uint32Array(faces) };
}

let capAtlas;
/** A tileable square of dense parallel strands (vertical, wrapping at every edge) for the hair cap. */
export function hairCapTexture() {
  if (capAtlas) return capAtlas;
  if (typeof document === 'undefined') return null;
  const size = 512, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.lineCap = 'round';
  let seed = 11;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let s = 0; s < 900; s++) {
    const x = random() * size, y = random() * size, length = size * (0.3 + 0.5 * random()), light = Math.round(140 + random() * 115), width = 1.2 + random() * 2.2;
    g.strokeStyle = `rgba(${light},${light},${light},${(0.7 + 0.3 * random()).toFixed(2)})`; g.lineWidth = width;
    // Drawn at every wrapped offset so the tile repeats without seams.
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + (random() - 0.5) * 3, y + dy + length); g.stroke(); }
  }
  capAtlas = new CanvasTexture(canvas);
  capAtlas.colorSpace = SRGBColorSpace;
  capAtlas.wrapS = capAtlas.wrapT = RepeatWrapping;
  capAtlas.anisotropy = 4;
  capAtlas.userData.shared = true;
  return capAtlas;
}

/** The hair cap's material: the cards' shading on the cap texture, alpha from the texture and the hairline fade. */
export function hairCapMaterial(color) {
  const material = hairCardMaterial(color);
  Object.assign(material, { map: hairCapTexture(), side: FrontSide, alphaTest: 0.45 });
  return material;
}

/** The hair card material (editor and game mesh alike); `highlight` tints the selected locks. */
export function hairCardMaterial(color, { highlight = false } = {}) {
  // The highlight takes the hair's own colour (hair fibres tint their reflection, Marschner's TRT lobe),
  // so dark hair shines brown, not silver.
  const tint = new Color(color);
  const material = new MeshPhysicalMaterial({
    color, vertexColors: true, map: hairStrandTexture(),
    alphaTest: 0.4, alphaToCoverage: true, side: DoubleSide,
    // No anisotropy: tested in the app, its stretched highlight turned locks that cross at many angles
    // (a ponytail gathering, the base) into silver patches; a dim, hair-tinted highlight reads as hair.
    roughness: 0.82, metalness: 0, specularIntensity: 0.1, specularColor: tint.clone().lerp(new Color(0xffffff), 0.12),
  });
  if (highlight) { material.emissive = new Color(0xf27a2e); material.emissiveIntensity = 0.28; }
  return material;
}
