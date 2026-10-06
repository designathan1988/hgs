import { addIsosurface, sdEllipsoid, sdTaperedCapsule, smoothUnion } from './implicit.mjs';
import { hexColor, shade, clamp, mix } from './math.mjs';

const wardrobes = [
  { top: '#45403d', inner: '#d8cbb7', bottom: '#626152', shoe: '#c8bba8', type: 'jacket' },
  { top: '#293b49', inner: '#d9d8d3', bottom: '#343944', shoe: '#503c32', type: 'blazer' },
  { top: '#a66141', inner: '#d0be9b', bottom: '#4d554d', shoe: '#6b4b34', type: 'shirt' },
  { top: '#94837a', inner: '#d6cec0', bottom: '#4b5361', shoe: '#e8e4db', type: 'sweater' },
  { top: '#292d37', inner: '#e8e7e2', bottom: '#30343c', shoe: '#342b27', type: 'blazer' },
  { top: '#75836a', inner: '#c3ac84', bottom: '#c0a98d', shoe: '#ddd5c7', type: 'tee' },
];
const topColours = ['#45403d', '#293b49', '#a66141', '#94837a', '#75836a', '#7c6474'];
const bottomColours = ['#626152', '#343944', '#4d554d', '#4b5361', '#a3947e', '#393634'];

function outfit(person) {
  const base = wardrobes[person.outfit];
  return { ...base, top: person.topColor ? topColours[person.topColor] : base.top, bottom: person.bottomColor ? bottomColours[person.bottomColor] : base.bottom };
}
const smooth = (lo, hi, value) => { const t = clamp((value - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); };

function makeTopField(person, style) {
  const bulk = person.build * 0.024 + person.muscle * 0.012;
  const shoulders = person.shoulders * 0.021 + person.gender * 0.018;
  const waist = person.waist * 0.019;
  const tee = style.type === 'tee';
  return p => {
    const lower = sdEllipsoid(p, [0, 1.093, 0], [0.236 + bulk + waist, 0.205, 0.132 + bulk * 0.4]);
    const upper = sdEllipsoid(p, [0, 1.378, 0], [0.31 + bulk + shoulders, 0.198, 0.153 + bulk * 0.45]);
    let torso = smoothUnion(lower, upper, 0.105);
    torso = Math.max(torso, 0.963 - p[1], p[1] - 1.556);
    const neckOpening = sdEllipsoid(p, [0, 1.562, 0.013], [0.074, 0.092, 0.075]);
    torso = Math.max(torso, -neckOpening);
    let garment = torso;
    for (const s of [-1, 1]) {
      const shoulder = [s * (0.328 + shoulders), 1.478, 0];
      const elbow = [s * (0.481 + shoulders), 1.186, 0.002];
      const wrist = [s * (0.551 + shoulders), 0.929, 0.012];
      let sleeve = sdTaperedCapsule(p, shoulder, tee ? [s * (0.417 + shoulders), 1.335, 0] : elbow, 0.093 + bulk * 0.2, tee ? 0.073 : 0.068);
      if (!tee) sleeve = smoothUnion(sleeve, sdTaperedCapsule(p, elbow, wrist, 0.069, 0.052), 0.028);
      sleeve = Math.max(sleeve, (tee ? 1.326 : 0.919) - p[1]);
      garment = smoothUnion(garment, sleeve, 0.054);
    }
    return garment;
  };
}

function makeBottomField(person) {
  const bulk = person.build * 0.023 + person.muscle * 0.012;
  const hips = person.hips * 0.021;
  const short = person.outfit === 5;
  return p => {
    let trousers = sdEllipsoid(p, [0, 0.87, 0], [0.238 + hips + bulk, 0.126, 0.145 + bulk * 0.3]);
    trousers = Math.max(trousers, p[1] - 0.973);
    for (const s of [-1, 1]) {
      const thigh = sdTaperedCapsule(p, [s * 0.15, 0.866, 0], [s * 0.17, short ? 0.54 : 0.503, 0], 0.132 + bulk * 0.3, short ? 0.107 : 0.10);
      let leg = Math.max(thigh, (short ? 0.535 : 0.42) - p[1]);
      if (!short) {
        const calf = sdTaperedCapsule(p, [s * 0.17, 0.513, 0], [s * 0.172, 0.139, 0.004], 0.10, 0.085);
        leg = smoothUnion(leg, calf, 0.035);
        leg = Math.max(leg, 0.115 - p[1]);
      }
      trousers = smoothUnion(trousers, leg, 0.051);
    }
    return trousers;
  };
}

function topSkinning(p) {
  const side = p[0] < 0 ? -1 : 1, a = side < 0 ? 2 : 5, b = a + 1;
  const amount = smooth(0.256, 0.39, Math.abs(p[0])) * (1 - smooth(1.5, 1.6, p[1]));
  if (amount < 0.001) return [0, 0, 0];
  if (p[1] > 1.26) return [0, a, amount];
  const elbow = 1 - smooth(1.115, 1.245, p[1]);
  if (elbow < 0.001) return [0, a, amount];
  return [a, b, elbow];
}

function bottomSkinning(p) {
  const a = p[0] < 0 ? 8 : 11, b = a + 1;
  if (p[1] > 0.75) return [0, a, 1 - smooth(0.75, 0.92, p[1])];
  if (p[1] > 0.57) return [a, a, 0];
  return [a, b, 1 - smooth(0.42, 0.57, p[1])];
}

function findFrontSurface(sdf, x, y) {
  let lo = 0, hi = 0.36;
  for (let i = 0; i < 18; i++) {
    const z = (lo + hi) / 2;
    if (sdf([x, y, z]) < 0) lo = z; else hi = z;
  }
  return lo + 0.003;
}

function topDetails(mesh, person, style, topSdf, top) {
  const jacket = style.type === 'jacket' || style.type === 'blazer';
  const inner = hexColor(style.inner);
  if (jacket) {
    const rows = [[1.004, 0.100], [1.15, 0.092], [1.36, 0.074], [1.495, 0.05]];
    const samples = 9;
    for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < samples; i++) {
      const sample = (row, t) => {
        const x = mix(-row[1], row[1], t);
        return [x, row[0], findFrontSurface(topSdf, x, row[0])];
      };
      const a = sample(rows[r], i / samples), b = sample(rows[r + 1], i / samples);
      const c = sample(rows[r + 1], (i + 1) / samples), d = sample(rows[r], (i + 1) / samples);
      mesh.quad(d, c, b, a, inner, 0.86, 0, 3, [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]]);
    }
    for (const s of [-1, 1]) {
      const edge = rows.map(row => [s * row[1], row[0], findFrontSurface(topSdf, s * row[1], row[0]) + 0.003]);
      mesh.tube(edge, edge.map(() => 0.003), 6, shade(top, 1.14), 0.78, 0, 3);
      mesh.tube([[s * 0.19, 1.26, findFrontSurface(topSdf, s * 0.19, 1.26) + 0.004], [s * 0.19, 1.12, findFrontSurface(topSdf, s * 0.19, 1.12) + 0.004]], [0.0013, 0.0013], 4, shade(top, 0.7), 0.9, 0, 3);
    }
  }
  mesh.lathe([[0, 0.965, 0, 0.23 + person.build * 0.02, 0.135], [0, 0.984, 0, 0.236 + person.build * 0.02, 0.138]], 24, shade(top, 0.77), 0.92, 0, 3);
  for (const s of [-1, 1]) {
    const lowerBone = s < 0 ? 3 : 6;
    const shoulder = person.shoulders * 0.021 + person.gender * 0.018;
    if (style.type !== 'tee') mesh.ellipsoid([s * (0.551 + shoulder), 0.939, 0.012], [0.052, 0.017, 0.052], shade(top, 0.8), 0.92, lowerBone, 3, 12, 6);
  }
}

function bottomDetails(mesh, person, style, bottom) {
  mesh.lathe([[0, 0.951, 0, 0.235 + person.hips * 0.02, 0.138], [0, 0.978, 0, 0.235 + person.hips * 0.02, 0.138]], 24, shade(bottom, 0.68), 0.9, 0, 3);
  for (const s of [-1, 1]) {
    const thighBone = s < 0 ? 8 : 11, calfBone = s < 0 ? 9 : 12, footBone = s < 0 ? 10 : 13;
    const x = s * 0.17, ankle = s * 0.172;
    mesh.tube([[s * 0.255, 0.848, 0.072], [s * 0.239, 0.776, 0.088]], [0.0015, 0.0015], 4, shade(bottom, 0.67), 0.93, thighBone, 3);
    if (person.outfit !== 5) {
      mesh.tube([[x + s * 0.094, 0.72, 0.031], [x + s * 0.091, 0.53, 0.031]], [0.0012, 0.0012], 4, shade(bottom, 0.75), 0.91, thighBone, 3);
      mesh.ellipsoid([ankle, 0.125, 0], [0.087, 0.015, 0.085], shade(bottom, 0.74), 0.9, calfBone, 3, 12, 6);
    }
    const shoe = hexColor(style.shoe);
    mesh.ellipsoid([ankle, 0.071, 0.066], [0.084, 0.057, 0.151], shoe, 0.68, footBone, 3, 20, 9);
    mesh.ellipsoid([ankle, 0.027, 0.077], [0.09, 0.024, 0.158], shade(shoe, 0.75), 0.87, footBone, 3, 18, 5);
    for (let i = 0; i < 3; i++) {
      const z = 0.025 + i * 0.024;
      mesh.tube([[ankle - 0.021, 0.117 - i * 0.007, z], [ankle + 0.021, 0.117 - i * 0.007, z]], [0.0012, 0.0012], 4, shade(shoe, 1.23), 0.7, footBone, 3);
    }
  }
}

export function addClothing(mesh, person, quality = 0) {
  const style = outfit(person), top = hexColor(style.top), bottom = hexColor(style.bottom);
  const step = quality === 0 ? 0.029 : quality === 1 ? 0.045 : 0.07;
  const topSdf = makeTopField(person, style);
  addIsosurface(mesh, topSdf, [-0.76, 0.88, -0.29], [0.76, 1.62, 0.29], step, top, 0.86, 3, topSkinning);
  topDetails(mesh, person, style, topSdf, top);
  const skirt = !person.gender && (person.outfit === 4 || person.outfit === 5);
  if (skirt) {
    const hem = person.outfit === 5 ? 0.47 : 0.6;
    mesh.lathe([[0, 0.95, 0, 0.24, 0.14], [0, 0.78, 0, 0.29, 0.17], [0, hem, 0, person.outfit === 5 ? 0.36 : 0.315, 0.2]], quality < 2 ? 26 : 12, person.outfit === 5 ? top : bottom, 0.87, 0, 3);
  } else {
    addIsosurface(mesh, makeBottomField(person), [-0.4, 0.1, -0.23], [0.4, 1.02, 0.23], step, bottom, 0.88, 3, bottomSkinning);
    bottomDetails(mesh, person, style, bottom);
  }
}
