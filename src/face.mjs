import { PI, clamp, hexColor, shade, mix, sub, cross, norm } from './math.mjs';
import { skinPalette, eyePalette, expressionNames } from './state.mjs';

const eyesWhite = [0.88, 0.86, 0.83];
const eyeDark = [0.045, 0.05, 0.055];

export function addFace(mesh, person, quality = 0) {
  const detail = quality < 2;
  const skin = hexColor(skinPalette[person.skin]);
  const warmSkin = [clamp(skin[0] * 1.025, 0, 1), skin[1] * 0.94, skin[2] * 0.92];
  const lip = [clamp(skin[0] * 0.67 + 0.21, 0, 1), skin[1] * 0.55 + 0.12, skin[2] * 0.56 + 0.13];
  const headScale = 1 + person.headSize * 0.08;
  const width = (0.145 + person.faceWidth * 0.012) * headScale;
  const depth = (0.126 + person.cheek * 0.008) * headScale;
  const bottom = 1.622, top = 2.051;
  const wAt = v => {
    const dome = Math.pow(Math.max(0, Math.sin(PI * v)), 0.55);
    const jaw = v < 0.42 ? mix(0.78 + person.jaw * 0.075, 1, v / 0.42) : 1;
    return width * dome * jaw;
  };
  const zAt = (v, angle) => {
    const dome = Math.pow(Math.max(0, Math.sin(PI * v)), 0.55);
    const cheek = 1 + person.cheek * 0.07 * Math.exp(-Math.pow((v - 0.47) * 7, 2));
    const brow = 1 + 0.07 * Math.exp(-Math.pow((v - 0.64) * 12, 2));
    return depth * dome * cheek * (Math.sin(angle) > 0 ? brow : 1);
  };
  const gauss = (x, y, cx, cy, sx, sy) => Math.exp(-Math.pow((x - cx) / sx, 2) - Math.pow((y - cy) / sy, 2));
  const point = (v, a) => {
    const y = bottom + v * (top - bottom), x = Math.cos(a) * wAt(v);
    const front = Math.max(0, Math.sin(a));
    let z = Math.sin(a) * zAt(v, a);
    if (front > 0.15) {
      let sculpture = 0;
      sculpture += 0.009 * gauss(x, y, 0, 1.813, 0.022, 0.062);
      sculpture += (0.035 + person.nose * 0.009) * gauss(x, y, 0, 1.77, 0.021, 0.022);
      sculpture += 0.010 * (gauss(x, y, -0.022, 1.758, 0.015, 0.012) + gauss(x, y, 0.022, 1.758, 0.015, 0.012));
      sculpture += 0.009 * (gauss(x, y, -0.082, 1.793, 0.042, 0.038) + gauss(x, y, 0.082, 1.793, 0.042, 0.038));
      sculpture += 0.006 * (gauss(x, y, -0.069, 1.874, 0.04, 0.024) + gauss(x, y, 0.069, 1.874, 0.04, 0.024));
      sculpture -= 0.008 * (gauss(x, y, -0.069, 1.838, 0.034, 0.023) + gauss(x, y, 0.069, 1.838, 0.034, 0.023));
      sculpture += 0.010 * gauss(x, y, 0, 1.713, 0.043, 0.021);
      z += sculpture * front * front;
    }
    return [x, y, z];
  };
  const normal = (v, a) => {
    const dv = sub(point(Math.min(0.998, v + 0.002), a), point(Math.max(0.002, v - 0.002), a));
    const da = sub(point(v, a + 0.002), point(v, a - 0.002));
    return norm(cross(dv, da));
  };
  const surfaceAt = (x, y) => {
    const v = clamp((y - bottom) / (top - bottom), 0.004, 0.996);
    const angle = Math.acos(clamp(x / Math.max(wAt(v), 0.005), -0.98, 0.98));
    return point(v, angle)[2];
  };
  const stacks = detail ? 48 : 16, slices = detail ? 64 : 20;
  for (let j = 0; j < stacks; j++) {
    const v0 = Math.max(0.004, j / stacks), v1 = Math.min(0.996, (j + 1) / stacks);
    for (let i = 0; i < slices; i++) {
      const a0 = 2 * PI * i / slices, a1 = 2 * PI * (i + 1) / slices;
      mesh.quad(point(v0, a0), point(v1, a0), point(v1, a1), point(v0, a1), skin, person.skinRoughness, 14, 1,
        [normal(v0, a0), normal(v1, a0), normal(v1, a1), normal(v0, a1)]);
    }
  }
  // Ears have a distinct rim and recess, with the lobes aligned to the nose.
  for (const s of [-1, 1]) {
    mesh.ellipsoid([s * (width * 0.99), 1.802, -0.008], [0.022, 0.045, 0.020], skin, 0.58, 14, 1, 12, 9);
    mesh.ellipsoid([s * (width * 1.1), 1.805, 0.009], [0.005, 0.026, 0.006], shade(skin, 0.76), 0.68, 14, 1, 8, 6);
  }
  const eyeY = 1.838, eyeX = 0.069 + person.eyeSpacing * 0.007;
  const eyeR = 0.021 * (1 + person.eyeSize * 0.13);
  const surprised = person.expression === 8 ? person.expressionIntensity : 0;
  const tired = person.expression === 10 ? person.expressionIntensity : 0;
  const smile = [2, 3, 4].includes(person.expression) ? person.expressionIntensity : 0;
  const angry = [6, 7].includes(person.expression) ? person.expressionIntensity : 0;
  for (const s of [-1, 1]) {
    const x = s * eyeX, z = surfaceAt(x, eyeY) - 0.004;
    const eyeBone = s < 0 ? 15 : 16, lidBone = s < 0 ? 17 : 18;
    mesh.ellipsoid([x, eyeY, z], [eyeR * 1.13, eyeR * 0.78, eyeR * 0.66], eyesWhite, 0.13, 14, 0, detail ? 16 : 9, 8);
    const iris = hexColor(eyePalette[person.eyeColor]);
    mesh.ellipsoid([x, eyeY, z + eyeR * 0.63], [eyeR * 0.48, eyeR * 0.49, eyeR * 0.13], iris, 0.19, eyeBone, 0, detail ? 12 : 8, 7);
    mesh.ellipsoid([x, eyeY, z + eyeR * 0.77], [eyeR * 0.23, eyeR * 0.27, eyeR * 0.07], eyeDark, 0.1, eyeBone, 0, 9, 6);
    if (detail) mesh.ellipsoid([x - eyeR * 0.13, eyeY + eyeR * 0.17, z + eyeR * 0.82], [0.0028, 0.0032, 0.001], [1, 0.99, 0.94], 0.05, eyeBone, 0, 8, 5);
    const upper = [], lower = [], brow = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, u = (t - 0.5) * 2;
      const ey = eyeY + Math.sqrt(Math.max(0, 1 - u * u)) * eyeR * (0.46 + surprised * 0.26 - tired * 0.24);
      const ux = x + u * eyeR * 1.24;
      const ly = eyeY - Math.sqrt(Math.max(0, 1 - u * u)) * eyeR * 0.43;
      const by = eyeY + 0.038 + Math.sin(PI * t) * 0.004 + surprised * 0.008 - angry * (s * u < 0 ? 0.008 : 0);
      const bx = x + u * eyeR * 1.44;
      upper.push([ux, ey, surfaceAt(ux, ey) + 0.009]);
      lower.push([x + u * eyeR * 1.22, ly, surfaceAt(x + u * eyeR * 1.22, ly) + 0.009]);
      brow.push([bx, by, surfaceAt(bx, by) + 0.006]);
    }
    mesh.tube(upper, upper.map(() => 0.0042), 5, warmSkin, 0.54, lidBone, 1);
    mesh.tube(lower, lower.map(() => 0.0027), 4, shade(skin, 0.8), 0.42, 14, 1);
    if (detail) {
      const hairBrow = shade(hexColor(['#181514','#30231e','#4b3327','#70503a','#a1784c','#c9a977','#823d2d','#474343','#ddd2bf'][person.hairColor]), 0.8);
      for (let strand = 0; strand < 13; strand++) {
        const t = strand / 12, index = Math.min(7, Math.floor(t * 8)), base = brow[index];
        mesh.tube([[base[0], base[1], base[2]], [base[0] + s * 0.003, base[1] + 0.006, base[2] + 0.002]], [0.00085, 0.0004], 3, hairBrow, 0.75, 14, 2);
      }
      for (let lash = 0; lash < 8; lash++) {
        const t = lash / 7, index = Math.min(7, Math.floor(t * 8)), base = upper[index];
        mesh.tube([base, [base[0] + s * 0.003, base[1] + 0.006 * Math.sin(PI * t), base[2] + 0.001]], [0.00085, 0.0001], 3, shade(hairBrow, 0.62), 0.5, lidBone, 2);
      }
    }
    mesh.tube(brow, brow.map((_, i) => 0.002 + 0.002 * Math.sin(PI * i / 8)), 5,
      shade(hexColor(['#181514','#30231e','#4b3327','#70503a','#a1784c','#c9a977','#823d2d','#474343','#ddd2bf'][person.hairColor]), 0.78), 0.78, 14, 2);
  }
  const noseSize = 1 + person.nose * 0.24;
  for (const s of [-1, 1]) {
    if (detail) mesh.ellipsoid([s * 0.018 * noseSize, 1.752, surfaceAt(s * 0.018 * noseSize, 1.752) + 0.002], [0.005, 0.0017, 0.003], shade(skin, 0.43), 0.7, 14, 1, 8, 5);
  }
  const mouthY = 1.713, mouthW = 0.038 + smile * 0.006, open = [4, 8, 11].includes(person.expression) ? person.expressionIntensity * 0.009 : 0.0015;
  const upperLip = [], lowerLip = [], mouthLine = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 6 - 1, x = u * mouthW, arch = 1 - u * u;
    const corner = smile * Math.abs(u) * 0.009 - (person.expression === 5 ? person.expressionIntensity * Math.abs(u) * 0.006 : 0);
    const uy = mouthY + 0.005 * arch + corner, ly = mouthY - 0.006 * arch - open + corner, my = mouthY - open * 0.4 + corner;
    upperLip.push([x, uy, surfaceAt(x, uy) + 0.004 + 0.003 * arch]);
    lowerLip.push([x, ly, surfaceAt(x, ly) + 0.004 + 0.003 * arch]);
    mouthLine.push([x, my, surfaceAt(x, my) + 0.009 + 0.002 * arch]);
  }
  mesh.tube(upperLip, upperLip.map((_, i) => 0.002 + 0.0035 * Math.sin(PI * i / 12)), 6, lip, 0.36, 14, 1);
  mesh.tube(lowerLip, lowerLip.map((_, i) => 0.002 + 0.0045 * Math.sin(PI * i / 12)), 6, shade(lip, 1.05), 0.4, 14, 1);
  mesh.tube(mouthLine, mouthLine.map(() => 0.0013), 4, shade(lip, 0.48), 0.55, 14, 1);
  if (open > 0.004 && detail) mesh.ellipsoid([0, mouthY - open * 0.45, surfaceAt(0, mouthY) + 0.01], [mouthW * 0.76, open * 0.35, 0.003], [0.84, 0.76, 0.67], 0.31, 14, 0, 12, 6);
  if (detail && person.age > 42) {
    const crease = shade(skin, 0.79);
    for (const s of [-1, 1]) for (let i = 0; i < Math.min(3, Math.floor((person.age - 38) / 10)); i++) {
      const y = 1.81 - i * 0.009;
      mesh.tube([[s * 0.101, y, 0.108], [s * 0.126, y - 0.003, 0.083]], [0.0008, 0.0001], 3, crease, 0.72, 14, 1);
    }
  }
}
