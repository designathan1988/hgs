import { CanvasTexture, Color, DoubleSide, FrontSide, MeshPhysicalMaterial, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Hair cards, the representation games use for hair (Epic, "Setting up cards
 * and meshes for grooms"): each lock is a strip that follows its centre line,
 * textured with many strands whose alpha cuts the strip into hair. Alpha test
 * with alpha-to-coverage (MSAA) softens the cut edges without sorting; the
 * highlight is dim and tinted by the hair's colour.
 *
 * UV: u across the card (one column of the atlas per variant), v from the root
 * (0) to the tip (1).
 *
 * The atlas has ATLAS_COLUMNS columns: four straight variants, then one each
 * of wavy (2A–2C), curly (3C) and coily (4A–4C) strands, as curly card hair is
 * textured with curly strands, the curl too fine for the card's geometry, and
 * a last opaque column of parallel strands for solid hair (braids, dreads,
 * buns), whose shape is the geometry itself.
 */
export const CARD_VARIANTS = 4;
export const ATLAS_COLUMNS = 8;
const COLUMN = { wave: 4, curl: 5, coil: 6, solid: 7 };
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
export function cardFromSweep(sweep, lock, { vertex = null, tint = null } = {}) {
  const { M, line, tan, side, out, half, u } = sweep;
  const count = M * ACROSS;
  const pos = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2), color = new Float32Array(count * 3);
  // The base layer uses the dense (most opaque) variants, the hair over it all four; curled
  // hair its own column, mirrored on half the locks (two variants from one column).
  const hash = lockHash(lock), variants = String(lock.group ?? '').startsWith('base') ? 2 : CARD_VARIANTS;
  const texture = strandTextureOf(lock);
  const column = texture === 'straight' ? Math.floor(hash * variants) % variants : COLUMN[texture];
  let u0 = (column + 0.04) / ATLAS_COLUMNS, u1 = (column + 0.96) / ATLAS_COLUMNS;
  if (texture !== 'straight' && (hash * 13.7) % 1 < 0.5) [u0, u1] = [u1, u0];
  // Each lock a little lighter or darker than its neighbours; roots darker (shadowed by the hair above).
  // Divided by its largest value: glTF requires COLOR_0 in [0, 1], and the relative variation is what matters.
  // Gel and water darken hair (wet fibres reflect less diffusely).
  const jitter = (0.9 + 0.2 * ((hash * 7.31) % 1)) / 1.1 * (1 - 0.22 * (lock.gel ?? 0));
  // The middle of the card is raised outwards (an arch), so a card reads as a lock with volume and lights round;
  // gel presses a lock flat.
  const arch = 0.32 * (lock.volume ?? 0.2) / 0.2 * (1 - 0.6 * (lock.gel ?? 0));
  let v = 0;
  for (let j = 0; j < M; j++) {
    const o = j * 3, a = half[j], s = u[j];
    // A lock grown out of other hair (rootTaper) lies on top: no root shadow.
    const shade = lock.rootTaper ? jitter : jitter * (0.62 + 0.38 * smooth(0, 0.22, s));
    const rgb = tint ? tint(s) : null;
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
      if (rgb) { color[v * 3] = shade * rgb[0]; color[v * 3 + 1] = shade * rgb[1]; color[v * 3 + 2] = shade * rgb[2]; }
      else color[v * 3] = color[v * 3 + 1] = color[v * 3 + 2] = shade;
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

/**
 * Which strand texture a lock's cards use, from its curl type (locks.mjs
 * hairTypes, Andre Walker's 1–4C): the curl a card's geometry cannot follow
 * (tighter than about 2.5 cm a turn) is drawn in the texture instead.
 */
export function strandTextureOf(lock) {
  const type = lock.type ?? null;
  if (!type || type === '1') return 'straight';
  if (type[0] === '2' || type === '3a' || type === '3b') return 'wave';
  if (type === '3c') return 'curl';
  return 'coil';
}

/**
 * A closed tube of solid hair along a centre line (`line`, `tan`, frame `side`
 * and `out`, radius `radius` per sample, `u` 0..1 along it): braid strands,
 * dreads, twists and buns. UV: around the tube across the atlas's opaque
 * column, along it from 0 to 1 (strands run along the tube).
 */
export function tubeFromSweep({ M, line, tan, side, out, radius, u }, { sides = 8, vertex = null, tint = null, shade = 1, scaleX = null } = {}) {
  const ring = sides + 1, count = M * ring;
  const pos = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2), color = new Float32Array(count * 3);
  const c0 = (COLUMN.solid + 0.05) / ATLAS_COLUMNS, c1 = (COLUMN.solid + 0.95) / ATLAS_COLUMNS;
  let v = 0;
  for (let j = 0; j < M; j++) {
    const o = j * 3, r = radius[j], sx = scaleX ? scaleX[j] : 1, rgb = tint ? tint(u[j]) : [1, 1, 1];
    // Ends darker (they turn into the bundle), the middle lit.
    for (let k = 0; k <= sides; k++, v++) {
      const a = k / sides * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = side[o] * ca + out[o] * sa, ny = side[o + 1] * ca + out[o + 1] * sa, nz = side[o + 2] * ca + out[o + 2] * sa;
      const px = line[o] + (side[o] * ca * sx + out[o] * sa) * r, py = line[o + 1] + (side[o + 1] * ca * sx + out[o + 1] * sa) * r, pz = line[o + 2] + (side[o + 2] * ca * sx + out[o + 2] * sa) * r;
      pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      normal[v * 3] = nx / nl; normal[v * 3 + 1] = ny / nl; normal[v * 3 + 2] = nz / nl;
      uv[v * 2] = c0 + (c1 - c0) * (k / sides); uv[v * 2 + 1] = clamp(u[j], 0.01, 0.99);
      const s = shade * (0.82 + 0.18 * Math.max(0, sa));
      color[v * 3] = s * rgb[0]; color[v * 3 + 1] = s * rgb[1]; color[v * 3 + 2] = s * rgb[2];
      vertex?.(px, py, pz, u[j]);
    }
  }
  // The ends need no caps: callers taper the radius to (almost) nothing there.
  // With side = tan × out (locks.mjs lockSweep), (a, c, b) faces outwards.
  const index = new Uint32Array((M - 1) * sides * 6);
  let n = 0;
  for (let j = 0; j + 1 < M; j++) for (let k = 0; k < sides; k++) {
    const a = j * ring + k, b = a + 1, c = a + ring, d = c + 1;
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
  const columnWidth = 256, height = 1024, width = columnWidth * ATLAS_COLUMNS;
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
  drawCurledColumns(g, columnWidth, height, random);
  atlas = new CanvasTexture(canvas);
  atlas.colorSpace = SRGBColorSpace;
  atlas.flipY = false;
  atlas.anisotropy = 4;
  atlas.userData.shared = true;
  return atlas;
}

/**
 * The curled columns of the atlas and the solid one. A curl seen on a card is
 * a strand's helix projected on it: x = x0 + A·sin(2πy/λ + φ), brighter where
 * the strand turns towards the viewer. Strands of one clump share the phase,
 * so the clump reads as one wave, ringlet or coil (De la Mettrie et al. 2007:
 * curlier hair has a smaller curve diameter and more waves per length):
 * - wave (2A–3B): λ ≈ ⅙ of the card, small amplitude, S-shaped clumps;
 * - curl (3C): ringlets about as wide as a pencil on a 4 cm card;
 * - coil (4A–4C): tight coils and zig-zags with a frizzy halo, near opaque.
 * The solid column is opaque strands on a mid-grey base (braids, dreads).
 */
function drawCurledColumns(g, W, H, random) {
  const strand = (left, x0, amp, wave, phase, start, end, width, light, alpha, zig = 0) => {
    const steps = Math.max(24, Math.round((end - start) / Math.max(2, wave / 10)));
    for (let k = 0; k < steps; k++) {
      const ya = start + (k / steps) * (end - start), yb = start + ((k + 1) / steps) * (end - start);
      const pa = ya / wave * Math.PI * 2 + phase, pb = yb / wave * Math.PI * 2 + phase;
      // A zig-zag (4B) is a triangle wave; a coil a sine.
      const shape = p => zig ? (1 - zig) * Math.sin(p) + zig * (2 / Math.PI) * Math.asin(Math.sin(p)) : Math.sin(p);
      const xa = left + x0 + amp * shape(pa), xb = left + x0 + amp * shape(pb);
      // Turning towards the viewer (cos > 0) it catches the light.
      const lit = Math.round(light * (0.72 + 0.28 * Math.cos((pa + pb) / 2)));
      const fade = 1 - smooth(0.8, 1, (k + 0.5) / steps);
      g.strokeStyle = `rgba(${lit},${lit},${lit},${(alpha * fade).toFixed(3)})`;
      g.lineWidth = width;
      g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke();
    }
  };
  const ends = edge => H * (edge ? 0.4 + 0.5 * random() : 0.55 + 0.45 * Math.sqrt(random()));
  // Wave: five clumps side by side.
  {
    const left = COLUMN.wave * W;
    for (let s = 0; s < 320; s++) {
      const clump = Math.floor(random() * 5), centre = (clump + 0.5) / 5, edge = random() < 0.15;
      const x0 = W * (0.1 + 0.8 * (edge ? random() : centre + (random() - 0.5) * 0.22));
      strand(left, x0, 9 + 4 * random(), 170 + 20 * random(), clump * 1.3 + random() * 0.4, H * 0.04 * random(), ends(edge), 1.5 + 2.2 * random(), 150 + 105 * random(), edge ? 0.75 : 1);
    }
  }
  // Curl: three ringlets across the card.
  {
    const left = COLUMN.curl * W;
    for (let s = 0; s < 420; s++) {
      const clump = Math.floor(random() * 3), edge = random() < 0.12;
      const x0 = W * ((clump + 0.5) / 3) + (random() - 0.5) * W * 0.12;
      strand(left, x0, 20 + 6 * random(), 64 + 10 * random(), clump * 2.1 + random() * 0.6, H * 0.04 * random(), ends(edge), 1.6 + 2 * random(), 145 + 110 * random(), edge ? 0.7 : 1);
    }
  }
  // Coil: tight coils and zig-zags, dense, with short frizz at the sides.
  {
    const left = COLUMN.coil * W;
    for (let s = 0; s < 560; s++) {
      const edge = random() < 0.2, x0 = W * (edge ? 0.06 + 0.88 * random() : 0.5 + (random() + random() - 1) * 0.36);
      strand(left, x0, 6 + 6 * random(), 18 + 10 * random(), random() * 6.28, H * 0.04 * random(), ends(edge), 1.4 + 1.8 * random(), 140 + 115 * random(), edge ? 0.7 : 1, random() < 0.4 ? 0.8 : 0);
    }
    for (let s = 0; s < 260; s++) {
      const x = left + W * (random() < 0.5 ? 0.04 + 0.2 * random() : 0.76 + 0.2 * random()), y = H * 0.9 * random(), r = 3 + 6 * random(), light = Math.round(150 + 100 * random());
      g.strokeStyle = `rgba(${light},${light},${light},0.8)`; g.lineWidth = 1.2;
      g.beginPath(); g.arc(x, y, r, random() * 6.28, random() * 6.28 + 2.5); g.stroke();
    }
  }
  // Solid: opaque, strands along the whole height.
  {
    const left = COLUMN.solid * W;
    g.fillStyle = 'rgb(118,118,118)'; g.fillRect(left, 0, W, H);
    for (let s = 0; s < 700; s++) {
      const x0 = W * random(), light = Math.round(80 + 150 * random());
      g.strokeStyle = `rgba(${light},${light},${light},1)`; g.lineWidth = 1.5 + 2.5 * random();
      const wave = (random() - 0.5) * 10, phase = random() * 6.28;
      g.beginPath();
      for (let k = 0; k <= 32; k++) { const y = H * k / 32, x = left + x0 + Math.sin(y / H * 6 + phase) * wave; if (k) g.lineTo(Math.max(left, Math.min(left + W, x)), y); else g.moveTo(Math.max(left, Math.min(left + W, x)), y); }
      g.stroke();
    }
  }
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
/**
 * How much of its length the hair keeps in a fade (degradê, a taper) at a height on the head (head
 * radii from its centre): the hair gets shorter towards the lower edge of the sides and the nape, and
 * the amount is how high the fade goes (low at the nape, high up to the temples); it grows back over
 * 0.6 R above that. The locks are shortened by it (locks.mjs) and the cap thinned by it alike.
 */
export function fadeProfile(fade, height) {
  const top = -0.3 + 0.7 * fade;
  return fade > 0 ? smooth(top - 0.6, top, height) : 1;
}

export function hairCapPart(state, flow) {
  const { positions, normals, field, frame, data } = state;
  // The hairline fades over 1.2 cm: over 3 cm the cap was cut away (alpha test) 1.5 cm inside the
  // hairline, and the skin showed in stripes between the cards rooted there.
  const lift = 0.0008, tile = 0.04, fade = 0.012;
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
    // A fade (degradê): the clippers leave the hair shorter, and the skin shows, lower on the
    // sides and the nape; the cap's strands thin out there (alpha against the alpha test).
    const height = (p.y - frame.C.y) / frame.R, faded = fadeProfile(state.fade ?? 0, height);
    const alpha = smooth(-0.004, fade, field[v]) * faded;
    color.push(0.62, 0.62, 0.62, alpha);
    index.set(v, at);
    return at;
  };
  const quads = [];
  for (const f of frame.faces) {
    const ids = [0, 1, 2, 3].map(c => data.faces[f * 4 + c]);
    if (!ids.every(v => field[v] >= -0.004)) continue;
    quads.push(ids);
    const [a, b, c, d] = ids.map(vertex);
    faces.push(a, b, c, a, c, d);
  }
  // A volume shell (afro, puff): the same scalp pushed out by `shell` metres, the push
  // fading to nothing at the hairline so the shell meets the scalp there. Outward from
  // the head centre more than along the skin's normal, so the mass rounds out.
  const shell = state.shell ?? 0;
  if (shell > 0) {
    const lifted = new Map();
    const raise = v => {
      if (lifted.has(v)) return lifted.get(v);
      const i = index.get(v), x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      let dx = x - frame.C.x, dy = y - frame.C.y, dz = z - frame.C.z;
      const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      let ox = 0.4 * normal[i * 3] + 0.6 * dx, oy = 0.4 * normal[i * 3 + 1] + 0.6 * dy, oz = 0.4 * normal[i * 3 + 2] + 0.6 * dz;
      const ol = Math.hypot(ox, oy, oz) || 1; ox /= ol; oy /= ol; oz /= ol;
      const h = shell * smooth(-0.004, 0.05, field[v]);
      const at = pos.length / 3;
      pos.push(x + ox * h, y + oy * h, z + oz * h);
      normal.push(ox, oy, oz);
      uv.push(uv[i * 2] * 0.7, uv[i * 2 + 1] * 0.7);
      color.push(0.7, 0.7, 0.7, smooth(-0.004, fade, field[v]));
      lifted.set(v, at);
      return at;
    };
    for (const ids of quads) { const [a, b, c, d] = ids.map(raise); faces.push(a, b, c, a, c, d); }
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
  // The scalp under the cards is covered: an opaque base a little darker than the strands (tinted by
  // the hair colour like them), so the gaps between cards show hair, never skin (Reallusion: no bald
  // spots). The hairline still fades by the cap's vertex alpha.
  // Its alpha (0.75) is below the strands' (0.7–1 over it): where the hairline fades the base drops
  // out first and the strands thin out one by one, so the edge is strand by strand, not a step.
  g.fillStyle = 'rgba(150,150,150,0.75)'; g.fillRect(0, 0, size, size);
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
export function hairCardMaterial(color, { highlight = false, wet = false } = {}) {
  if (wet) {
    // Gel and water: a film over the fibres makes the reflection sharper and stronger
    // (lower roughness, more specular), as a wet coat does.
    const material = hairCardMaterial(color, { highlight });
    Object.assign(material, { roughness: 0.34, specularIntensity: 0.55 });
    material.name = 'HairWet';
    return material;
  }
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
