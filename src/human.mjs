import { MeshBuilder } from './geometry.mjs';
import { hexColor, shade } from './math.mjs';
import { skinPalette } from './state.mjs';
import { addFace } from './face.mjs';
import { addHair } from './hair.mjs';
import { addClothing } from './garments.mjs';

export function buildHuman(person, quality = 0) {
  const mesh = new MeshBuilder(), skin = hexColor(skinPalette[person.skin]);
  const shoulder = person.shoulders * 0.027 + person.gender * 0.018;
  const muscle = person.muscle * 0.014;
  // Neck and collarbones are exposed above real garment geometry.
  mesh.lathe([[0, 1.535, 0, 0.073, 0.071], [0, 1.59, 0, 0.063, 0.063], [0, 1.675, 0, 0.068, 0.063]], quality < 2 ? 15 : 9, skin, person.skinRoughness, 14, 1);
  for (const s of [-1, 1]) {
    const upperBone = s < 0 ? 2 : 5, lowerBone = s < 0 ? 3 : 6, handBone = s < 0 ? 4 : 7;
    mesh.tube([[s * (0.36 + shoulder), 1.49, 0], [s * (0.48 + shoulder), 1.19, 0]], [0.07 + muscle, 0.05 + muscle * 0.5], quality < 2 ? 12 : 7, skin, person.skinRoughness, upperBone, 1);
    mesh.ellipsoid([s * (0.485 + shoulder), 1.181, 0], [0.055, 0.06, 0.055], skin, 0.59, lowerBone, 1, 10, 6);
    mesh.tube([[s * (0.49 + shoulder), 1.18, 0], [s * (0.548 + shoulder), 0.92, 0.012]], [0.053, 0.036], quality < 2 ? 12 : 7, skin, person.skinRoughness, lowerBone, 1);
    mesh.ellipsoid([s * (0.57 + shoulder), 0.849, 0.018], [0.045, 0.075, 0.024], shade(skin, 0.98), 0.6, handBone, 1, quality < 2 ? 13 : 8, 8);
    const fingerOffsets = [-0.027, -0.009, 0.009, 0.027];
    for (let f = 0; f < 4; f++) {
      const fx = s * (0.57 + shoulder) + fingerOffsets[f];
      const len = [0.055, 0.068, 0.064, 0.049][f];
      mesh.tube([[fx, 0.805, 0.033], [fx + fingerOffsets[f] * 0.09, 0.805 - len * 0.56, 0.037], [fx + fingerOffsets[f] * 0.13, 0.805 - len, 0.026]], [0.010, 0.008, 0.006], quality < 2 ? 7 : 5, skin, 0.54, handBone, 1);
      if (quality === 0) mesh.ellipsoid([fx + fingerOffsets[f] * 0.13, 0.808 - len, 0.032], [0.0054, 0.008, 0.0015], shade(skin, 1.14), 0.3, handBone, 1, 7, 5);
    }
    mesh.tube([[s * (0.541 + shoulder), 0.876, 0.04], [s * (0.517 + shoulder), 0.842, 0.056], [s * (0.517 + shoulder), 0.811, 0.048]], [0.016, 0.012, 0.008], quality < 2 ? 8 : 5, skin, 0.55, handBone, 1);
    const knee = s * 0.17, ankle = s * 0.172;
    mesh.tube([[s * 0.156, 0.91, 0], [knee, 0.52, 0]], [0.112 + muscle, 0.072 + muscle * 0.5], quality < 2 ? 12 : 7, skin, 0.69, s < 0 ? 8 : 11, 1);
    mesh.ellipsoid([knee, 0.516, 0.02], [0.072, 0.065, 0.069], skin, 0.7, s < 0 ? 9 : 12, 1, 10, 7);
    mesh.tube([[knee, 0.52, 0], [ankle, 0.13, 0]], [0.07, 0.038], quality < 2 ? 11 : 7, skin, 0.67, s < 0 ? 9 : 12, 1);
  }
  addClothing(mesh, person, quality);
  if (quality < 3) addFace(mesh, person, quality);
  else mesh.ellipsoid([0, 1.838, 0], [0.14, 0.21, 0.13], skin, 0.6, 14, 1, 9, 7);
  if (quality < 4) addHair(mesh, person, quality);
  const finished = mesh.finish();
  if (person.legLength) {
    const delta = person.legLength * 0.06;
    for (let i = 1; i < finished.vertices.length; i += 14) {
      const y = finished.vertices[i];
      finished.vertices[i] = y < 0.95 ? y * (1 + delta) : y + 0.95 * delta;
    }
  }
  return finished;
}
