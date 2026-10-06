import { PI, hexColor, shade, mix } from './math.mjs';
import { hairPalette, rng } from './state.mjs';

export function addHair(mesh, person, quality = 0) {
  const random = rng(person.seed ^ 0x918e55);
  const base = hexColor(hairPalette[person.hairColor]);
  const style = person.hairStyle;
  const dense = quality === 0 ? 1 : quality === 1 ? 0.62 : 0.23;
  const count = Math.round((style === 8 ? 115 : 210) * dense);
  const short = [0, 1, 8].includes(style), curl = [3, 4].includes(style), long = [5, 6, 7].includes(style);
  const rootY = 1.916;
  // A close-fitting underlayer gives roots continuity; the visible silhouette is built by cards and strands.
  mesh.ellipsoid([0, 1.969, -0.008], [0.148, 0.081, 0.128], shade(base, 0.72), 0.84, 14, 2, quality < 2 ? 28 : 12, quality < 2 ? 12 : 5);
  for (let i = 0; i < count; i++) {
    const band = i / count;
    const phi = 2 * PI * ((i * 0.61803398875) % 1);
    const front = Math.sin(phi) > -0.2;
    const crownRadius = Math.sqrt(random()) * 0.13;
    const root = [Math.cos(phi) * crownRadius, 1.973 + 0.055 * (1 - crownRadius / 0.13), Math.sin(phi) * crownRadius - 0.011];
    const direction = style === 1 ? 1 : (person.seed % 2 ? -1 : 1);
    const length = short ? (style === 8 ? 0.043 : 0.072 + random() * 0.025) : long ? (0.18 + person.hairLength * 0.33) : (0.12 + person.hairLength * 0.09);
    const color = shade(base, 0.78 + random() * 0.44 + (band % 0.06 < 0.008 ? 0.12 : 0));
    const pts = [];
    const segments = curl ? 9 : 5;
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const fall = Math.max(0, t - 0.37) / 0.63;
      const tied = style === 6 || style === 7;
      const fallLength = tied || style === 5 ? 0.037 : front ? Math.min(length, 0.085) : length;
      let x = mix(root[0], Math.cos(phi) * (long ? 0.168 : 0.153) + direction * (style === 1 ? 0.05 : 0.005), t);
      let z = mix(root[2], tied ? -0.13 : Math.sin(phi) * (long ? 0.145 : 0.135) - 0.005, t);
      let y = root[1] + Math.sin(t * PI) * (short ? 0.014 : 0.012) - fallLength * fall;
      if (style === 5 && front) x = (x < 0 ? -1 : 1) * Math.max(Math.abs(x), 0.158 * t);
      if (curl) { x += Math.sin(t * 18 * PI + i * 2.8) * 0.008 * t; z += Math.cos(t * 18 * PI + i * 2.8) * 0.008 * t; }
      if (style === 4) { x += Math.sin(t * 24 * PI + i) * 0.01 * t; y += 0.022 * t; }
      if (style === 8 && !front) y = root[1] - 0.02 * t;
      if (style === 6 && t > 0.65) { x *= 1 - (t - 0.65) * 0.8; z -= 0.05 * (t - 0.65); }
      if (style === 7 && t > 0.55) { x *= 0.9; z -= 0.06 * (t - 0.55); y += 0.02 * (t - 0.55); }
      pts.push([x, y, z]);
    }
    const widths = pts.map((_, j) => (0.003 + random() * 0.0024) * Math.pow(1 - j / segments, 0.65) + 0.00015);
    mesh.ribbon(pts, widths, color, 0.76, 14, 2, [Math.cos(phi), 0, Math.sin(phi)]);
  }
  if (quality < 2) {
    // Dedicated face-framing clumps and flyaways prevent a cap-like contour.
    if (style === 5) for (const s of [-1, 1]) for (let i = 0; i < 12; i++) {
      const z = -0.09 + i * 0.011, x = s * (0.16 + 0.006 * Math.sin(i * 2.3));
      mesh.ribbon([[x * 0.87, 1.977, z], [x, 1.83, z - 0.004], [x + s * 0.01, 1.51 - random() * 0.15, z + 0.011]], [0.006, 0.013, 0.002], shade(base, 0.68 + random() * 0.31), 0.83, 14, 2, [s, 0, 0]);
    }
    for (let s of [-1, 1]) for (let i = 0; i < (long ? 27 : 14) * dense; i++) {
      const t = i / Math.max(1, Math.floor((long ? 27 : 14) * dense) - 1), variation = (random() - 0.5) * 0.008;
      const x = s * (0.155 + t * 0.024) + variation;
      const y = 1.957 - t * 0.055;
      const tipY = style === 5 ? 1.46 - random() * 0.15 : 1.8 + random() * 0.09;
      const z = style === 5 ? -0.055 + t * 0.102 : 0.03;
      const pts = [[x, y, z], [x + s * 0.012, 1.89, z - 0.01], [x + s * 0.014, tipY, z + 0.012 + random() * 0.012]];
      if (curl) pts[1][0] += Math.sin(i * 2) * 0.012;
      mesh.ribbon(pts, [0.0028, 0.0035, 0.0001], shade(base, 0.8 + random() * 0.35), 0.72, 14, 2, [0, 0, 1]);
    }
  }
  if (style === 6 && quality < 2) {
    const tieColor = [0.09, 0.09, 0.1];
    mesh.tube([[0, 1.893, -0.135], [0, 1.876, -0.16]], [0.018, 0.019], 10, tieColor, 0.66, 14, 3);
    for (let i = 0; i < 35 * dense; i++) {
      const a = 2 * PI * random(), r = Math.sqrt(random()) * 0.044;
      mesh.ribbon([[Math.cos(a) * r, 1.875, -0.17], [Math.cos(a) * r * 1.4, 1.72, -0.18], [Math.cos(a) * r * 1.5, 1.49 - random() * 0.08, -0.17]], [0.004, 0.003, 0.0001], shade(base, 0.7 + random() * 0.45), 0.75, 14, 2, [0, 0, 1]);
    }
  }
  if (style === 7 && quality < 2) {
    for (let i = 0; i < 65 * dense; i++) {
      const a = 2 * PI * i / Math.max(1, Math.floor(65 * dense)), b = a + 0.7;
      mesh.ribbon([[Math.cos(a) * 0.034, 1.984 + Math.sin(a) * 0.03, -0.135], [Math.cos(b) * 0.057, 2.004 + Math.sin(b) * 0.038, -0.16], [Math.cos(b + 0.6) * 0.015, 2.013, -0.178]], [0.004, 0.005, 0.0002], shade(base, 0.73 + random() * 0.38), 0.78, 14, 2, [0, 0, -1]);
    }
  }
  if (person.gender && quality === 0 && person.age > 24 && person.seed % 3 === 0) {
    for (let s of [-1, 1]) for (let i = 0; i < 21; i++) {
      const a = i / 20;
      mesh.tube([[s * (0.059 + a * 0.04), 1.72 - a * 0.04, 0.11 - a * 0.008], [s * (0.058 + a * 0.04), 1.71 - a * 0.04, 0.116 - a * 0.007]], [0.0009, 0.0001], 3, shade(base, 0.82 + random() * 0.2), 0.9, 14, 2);
    }
  }
}
