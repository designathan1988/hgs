import { hexColor, shade, PI } from './math.mjs';

const outfits = [
  { top: '#45403d', inner: '#e4d8c5', bottom: '#626152', shoe: '#d3c8b5', type: 'jacket', leg: 'trouser' },
  { top: '#293b49', inner: '#d8d6ca', bottom: '#343944', shoe: '#503c32', type: 'blazer', leg: 'trouser' },
  { top: '#a66141', inner: '#d0be9b', bottom: '#4d554d', shoe: '#6b4b34', type: 'shirt', leg: 'cargo' },
  { top: '#94837a', inner: '#d6cec0', bottom: '#4b5361', shoe: '#e8e4db', type: 'sweater', leg: 'jeans' },
  { top: '#292d37', inner: '#e8e7e2', bottom: '#30343c', shoe: '#342b27', type: 'blazer', leg: 'formal' },
  { top: '#75836a', inner: '#c3ac84', bottom: '#c0a98d', shoe: '#ddd5c7', type: 'tee', leg: 'summer' },
];
const colors = ['#45403d', '#293b49', '#a66141', '#94837a', '#75836a', '#7c6474'];
const bottoms = ['#626152', '#343944', '#4d554d', '#4b5361', '#a3947e', '#393634'];

export function outfitInfo(person) {
  const basic = outfits[person.outfit];
  return { ...basic, top: person.topColor ? colors[person.topColor] : basic.top, bottom: person.bottomColor ? bottoms[person.bottomColor] : basic.bottom };
}

export function addClothing(mesh, person, quality = 0) {
  const outfit = outfitInfo(person), top = hexColor(outfit.top), inner = hexColor(outfit.inner), bottom = hexColor(outfit.bottom), shoe = hexColor(outfit.shoe);
  const build = person.build * 0.036, shoulder = person.shoulders * 0.027 + person.gender * 0.018, hip = person.hips * 0.023;
  const outerRings = [
    [0, 0.955, 0, 0.247 + build + hip, 0.131 + build * 0.5],
    [0, 1.04, 0, 0.254 + build + hip, 0.137 + build * 0.5],
    [0, 1.16, 0, 0.218 + build + person.waist * 0.022, 0.132 + build * 0.45],
    [0, 1.36, 0, 0.279 + build + shoulder * 0.5, 0.157 + build * 0.48],
    [0, 1.49, 0, 0.329 + build + shoulder, 0.16 + build * 0.5],
    [0, 1.55, 0, 0.25 + build + shoulder * 0.7, 0.118],
  ];
  const jacket = ['jacket', 'blazer'].includes(outfit.type);
  mesh.lathe(outerRings, quality < 2 ? 24 : 12, jacket ? top : inner, jacket ? 0.8 : 0.88, 0, 3);
  if (jacket) {
    const openings = [0.102, 0.102, 0.089, 0.073, 0.061, 0.047];
    const panelPoint = (ring, opening, side) => {
      const x = side * opening;
      return [x, ring[1] + 0.002, ring[4] * Math.sqrt(1 - Math.pow(x / ring[3], 2)) + 0.009];
    };
    for (let i = 0; i < outerRings.length - 1; i++) {
      const a = outerRings[i], b = outerRings[i + 1];
      mesh.quad(panelPoint(a, openings[i], 1), panelPoint(b, openings[i + 1], 1), panelPoint(b, openings[i + 1], -1), panelPoint(a, openings[i], -1), inner, 0.8, 0, 3,
        [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]]);
    }
    for (const s of [-1, 1]) {
      const edge = outerRings.map((ring, i) => panelPoint(ring, openings[i], s));
      mesh.tube(edge, edge.map(() => 0.0035), 5, shade(top, 1.19), 0.84, 0, 3);
      mesh.tube([[s * 0.162, 1.22, 0.119], [s * 0.164, 1.08, 0.111]], [0.0015, 0.0015], 4, shade(top, 0.65), 0.9, 0, 3);
    }
  } else if (outfit.type === 'shirt') {
    mesh.ribbon([[-0.05, 1.548, 0.118], [0, 1.46, 0.157]], [0.03, 0.003], shade(inner, 1.1), 0.84, 0, 3);
    mesh.ribbon([[0.05, 1.548, 0.118], [0, 1.46, 0.157]], [0.03, 0.003], shade(inner, 1.1), 0.84, 0, 3);
  } else if (outfit.type === 'sweater') {
    mesh.tube([[0, 1.54, 0.07], [0, 1.548, 0.12]], [0.071, 0.07], 12, shade(inner, 0.87), 0.96, 0, 3);
  }
  mesh.lathe([[0, 0.961, 0, 0.245 + build + hip, 0.134], [0, 0.986, 0, 0.247 + build + hip, 0.138]], 22, shade(bottom, 0.73), 0.88, 0, 3);
  if (quality < 2) {
    mesh.tube([[-0.02, 1.042, outerRings[1][4] + 0.004], [0.02, 1.042, outerRings[1][4] + 0.004]], [0.002, 0.002], 4, shade(top, 0.68), 0.9, 0, 3);
    for (const s of [-1, 1]) mesh.tube([[s * 0.205, 1.33, 0.1], [s * 0.19, 1.305, 0.124]], [0.0018, 0.0018], 4, shade(top, 0.74), 0.91, 0, 3);
  }
  const bareArm = outfit.type === 'tee';
  for (const s of [-1, 1]) {
    const upperBone = s < 0 ? 2 : 5, lowerBone = s < 0 ? 3 : 6;
    const sleeveTop = [s * (0.332 + shoulder), 1.49, 0], sleeveElbow = [s * (0.49 + shoulder), 1.205, 0], wrist = [s * (0.56 + shoulder), 0.934, 0.012];
    const sleeveEnd = bareArm ? [s * (0.435 + shoulder), 1.336, 0] : sleeveElbow;
    mesh.tube([sleeveTop, [s * (0.408 + shoulder), 1.40, 0], sleeveEnd], [0.091, 0.079, bareArm ? 0.076 : 0.067], quality < 2 ? 13 : 7, top, 0.88, upperBone, 3);
    if (!bareArm) {
      mesh.ellipsoid([s * (0.493 + shoulder), 1.188, 0], [0.069, 0.079, 0.069], top, 0.89, lowerBone, 3, 12, 8);
      mesh.tube([[s * (0.486 + shoulder), 1.225, 0], [s * (0.532 + shoulder), 1.03, 0.005], wrist], [0.069, 0.055, 0.047], quality < 2 ? 12 : 7, top, 0.86, lowerBone, 3);
      mesh.tube([[s * (0.548 + shoulder), 0.957, 0.012], wrist], [0.050, 0.050], 10, shade(top, 0.74), 0.88, lowerBone, 3);
    } else {
      mesh.tube([[s * (0.43 + shoulder), 1.346, 0], sleeveEnd], [0.078, 0.077], 11, shade(top, 0.78), 0.88, upperBone, 3);
    }
    if (quality === 0 && !bareArm) {
      mesh.tube([[s * (0.415 + shoulder), 1.38, 0.078], [s * (0.47 + shoulder), 1.26, 0.063]], [0.0014, 0.0014], 4, shade(top, 0.7), 0.93, upperBone, 3);
      mesh.tube([[s * (0.508 + shoulder), 1.1, 0.052], [s * (0.55 + shoulder), 0.965, 0.048]], [0.0013, 0.0013], 4, shade(top, 0.74), 0.93, lowerBone, 3);
    }
  }
  const summerDress = outfit.leg === 'summer' && !person.gender;
  const formalSkirt = outfit.leg === 'formal' && !person.gender;
  mesh.lathe([[0, 0.875, 0, 0.205 + hip + build, 0.12], [0, 0.95, 0, 0.242 + hip + build, 0.133]], quality < 2 ? 18 : 9, bottom, 0.87, 0, 3);
  if (summerDress || formalSkirt) {
    const skirtColor = summerDress ? top : bottom;
    mesh.lathe([[0, 0.94, 0, 0.24 + hip + build, 0.14], [0, 0.82, 0, 0.3 + hip + build, 0.17], [0, summerDress ? 0.48 : 0.61, 0, summerDress ? 0.38 : 0.31, summerDress ? 0.21 : 0.18]], quality < 2 ? 24 : 12, skirtColor, 0.84, 0, 3);
    for (const s of [-1, 1]) mesh.tube([[s * 0.29, 0.8, 0.082], [s * 0.34, summerDress ? 0.49 : 0.62, 0.105]], [0.0017, 0.0017], 4, shade(skirtColor, 0.72), 0.92, 0, 3);
  }
  for (const s of [-1, 1]) {
    const thighBone = s < 0 ? 8 : 11, calfBone = s < 0 ? 9 : 12, footBone = s < 0 ? 10 : 13;
    const x = s * (0.156 + hip * 0.4), knee = s * (0.17 + hip * 0.2), ankle = s * (0.172 + hip * 0.1);
    if (!summerDress && !formalSkirt) {
      const short = outfit.leg === 'summer';
      mesh.tube([[x, 0.92, 0], [s * 0.17, 0.75, 0], [knee, short ? 0.54 : 0.52, 0]], [0.137 + build * 0.3, 0.125 + build * 0.2, short ? 0.106 : 0.098], quality < 2 ? 15 : 8, bottom, 0.87, thighBone, 3);
      if (!short) {
        mesh.tube([[knee, 0.54, 0], [s * 0.176, 0.34, 0], [ankle, 0.11, 0.002]], [0.105, 0.097, 0.087], quality < 2 ? 14 : 8, bottom, 0.85, calfBone, 3);
        mesh.tube([[ankle, 0.14, 0], [ankle, 0.115, 0]], [0.091, 0.088], 10, shade(bottom, 0.77), 0.89, calfBone, 3);
      } else {
        mesh.tube([[knee, 0.55, 0], [knee, 0.535, 0]], [0.112, 0.112], 10, shade(bottom, 0.72), 0.9, thighBone, 3);
      }
      if (quality === 0) {
        mesh.tube([[x + s * 0.111, 0.86, 0.022], [knee + s * 0.086, short ? 0.56 : 0.53, 0.02]], [0.0015, 0.0015], 4, shade(bottom, 0.73), 0.92, thighBone, 3);
        if (outfit.leg === 'cargo') mesh.quad([x + s * 0.118, 0.67, 0.04], [x + s * 0.119, 0.57, 0.04], [x + s * 0.12, 0.57, -0.035], [x + s * 0.12, 0.67, -0.035], shade(bottom, 0.91), 0.91, thighBone, 3);
      }
    }
    // Two-piece shoe: rubber/leather sole, upper and toe cap, all moving with the foot bone.
    mesh.ellipsoid([ankle, 0.067, 0.067], [0.092, 0.065, 0.158], shoe, 0.67, footBone, 3, quality < 2 ? 18 : 9, 8);
    mesh.ellipsoid([ankle, 0.026, 0.076], [0.097, 0.024, 0.164], shade(shoe, outfit.shoe === '#d3c8b5' || outfit.shoe === '#e8e4db' ? 0.82 : 0.68), 0.82, footBone, 3, quality < 2 ? 16 : 8, 5);
    if (quality < 2) {
      for (let lace = 0; lace < 4; lace++) {
        const z = 0.04 + lace * 0.026;
        mesh.tube([[ankle - 0.025, 0.123 - lace * 0.008, z], [ankle + 0.025, 0.123 - lace * 0.008, z]], [0.0016, 0.0016], 4, shade(shoe, 1.28), 0.8, footBone, 3);
      }
    }
  }
}
