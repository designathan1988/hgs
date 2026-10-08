import { CanvasTexture, Color, DoubleSide, MeshPhysicalMaterial, SRGBColorSpace } from 'three';

/**
 * Hair cards, the representation games use for hair (Epic, "Setting up cards
 * and meshes for grooms"): each lock is a strip that follows its centre line,
 * textured with many strands whose alpha cuts the strip into hair. Alpha test
 * with alpha-to-coverage (MSAA) softens the cut edges without sorting, and
 * an anisotropic highlight runs along the strands (KHR_materials_anisotropy,
 * exported to the GLB).
 *
 * UV: u across the card (one quarter of the atlas per variant), v from the root
 * (0) to the tip (1). Without a tangent attribute three.js builds the tangent
 * frame from the UV derivatives (tangent = ∂p/∂u, across the card), so the
 * anisotropy is turned a quarter turn to lie along v, the strands.
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
  const hash = lockHash(lock), variant = Math.floor(hash * CARD_VARIANTS) % CARD_VARIANTS;
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
      const lift = across === 0 ? a * Math.min(0.6, arch) : 0;
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
    const strands = 260 + c * 30;
    for (let s = 0; s < strands; s++) {
      const edge = random() < 0.18;
      const t = edge ? random() : 0.5 + (random() - 0.5) * 0.78;
      const x0 = left + 4 + t * (columnWidth - 8);
      // Most strands reach far down; a few stop early so the tip is ragged.
      const end = height * (edge ? 0.45 + 0.5 * random() : 0.66 + 0.34 * Math.sqrt(random()));
      const strandWidth = 1.5 + random() * 2.5, light = Math.round(150 + random() * 105), wave = (random() - 0.5) * 8, phase = random() * 6.28;
      const steps = 20;
      for (let k = 0; k < steps; k++) {
        const ya = (k / steps) * end, yb = ((k + 1) / steps) * end;
        const xa = x0 + Math.sin(ya / height * 5 + phase) * wave, xb = x0 + Math.sin(yb / height * 5 + phase) * wave;
        // Opaque along most of the strand, fading over its last fifth.
        const fade = 1 - smooth(0.78, 1, (k + 0.5) / steps);
        g.strokeStyle = `rgba(${light},${light},${light},${((edge ? 0.75 : 1) * fade).toFixed(3)})`;
        g.lineWidth = strandWidth * (1 - 0.5 * (k / steps));
        g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke();
      }
    }
    // A solid band at the root so a card starts covered (the scalp never shows at the parting of a lock).
    const band = g.createLinearGradient(0, 0, 0, height * 0.18);
    band.addColorStop(0, 'rgba(185,185,185,1)'); band.addColorStop(1, 'rgba(185,185,185,0)');
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = band; g.fillRect(left + columnWidth * 0.08, 0, columnWidth * 0.84, height * 0.18);
    g.globalCompositeOperation = 'source-over';
  }
  atlas = new CanvasTexture(canvas);
  atlas.colorSpace = SRGBColorSpace;
  atlas.flipY = false;
  atlas.anisotropy = 4;
  atlas.userData.shared = true;
  return atlas;
}

/** The hair card material (editor and game mesh alike); `highlight` tints the selected locks. */
export function hairCardMaterial(color, { highlight = false } = {}) {
  // The highlight takes the hair's own colour (hair fibres tint their reflection, Marschner's TRT lobe),
  // so dark hair shines brown, not silver.
  const tint = new Color(color);
  const material = new MeshPhysicalMaterial({
    color, vertexColors: true, map: hairStrandTexture(),
    alphaTest: 0.4, alphaToCoverage: true, side: DoubleSide,
    roughness: 0.58, metalness: 0, specularIntensity: 0.35, specularColor: tint.clone().lerp(new Color(0xffffff), 0.45),
    anisotropy: 0.45, anisotropyRotation: Math.PI / 2,
  });
  if (highlight) { material.emissive = new Color(0xf27a2e); material.emissiveIntensity = 0.28; }
  return material;
}
