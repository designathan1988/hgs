import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshStandardMaterial,
  SkinnedMesh, Uint16BufferAttribute, Vector3,
} from 'three';
import { fitProxy, loadProxy } from './proxy.mjs';
import { browSettings, browTransform } from './brow-shape.mjs';

function surfaceAt(points, faces, eyes, frontOnly = false) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < eyes.length; i += 3) {
    x0 = Math.min(x0, eyes[i]); x1 = Math.max(x1, eyes[i]);
    y0 = Math.min(y0, eyes[i + 1]); y1 = Math.max(y1, eyes[i + 1]);
  }
  const triangles = [];
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i], b = faces[i + 1], c = faces[i + 2];
    const ax = points[a * 3], ay = points[a * 3 + 1], bx = points[b * 3], by = points[b * 3 + 1], cx = points[c * 3], cy = points[c * 3 + 1];
    if (frontOnly && (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 0) continue;
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    if (maxX < x0 - 0.06 || minX > x1 + 0.06 || maxY < y0 - 0.02 || minY > y1 + 0.08) continue;
    triangles.push({ ax, ay, az: points[a * 3 + 2], bx, by, bz: points[b * 3 + 2], cx, cy, cz: points[c * 3 + 2], minX, maxX, minY, maxY });
  }
  // Bin triangles on a 2 mm (x, y) grid so each query tests only its cell.
  const cell = 0.002, bins = new Map(), key = (i, j) => i * 100003 + j;
  for (const t of triangles) {
    for (let i = Math.floor(t.minX / cell); i <= Math.floor(t.maxX / cell); i++) for (let j = Math.floor(t.minY / cell); j <= Math.floor(t.maxY / cell); j++) {
      const k = key(i, j);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(t);
    }
  }
  return (x, y, fallback) => {
    let front = -Infinity;
    for (const t of bins.get(key(Math.floor(x / cell), Math.floor(y / cell))) ?? []) {
      if (x < t.minX || x > t.maxX || y < t.minY || y > t.maxY) continue;
      const divisor = (t.by - t.cy) * (t.ax - t.cx) + (t.cx - t.bx) * (t.ay - t.cy);
      if (Math.abs(divisor) < 1e-12) continue;
      const u = ((t.by - t.cy) * (x - t.cx) + (t.cx - t.bx) * (y - t.cy)) / divisor;
      const v = ((t.cy - t.ay) * (x - t.cx) + (t.ax - t.cx) * (y - t.cy)) / divisor;
      if (u < 0 || v < 0 || u + v > 1) continue;
      front = Math.max(front, u * t.az + v * t.bz + (1 - u - v) * t.cz);
    }
    return front > -Infinity ? front : fallback;
  };
}

function eyeBounds(eyes, sign) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, front = -Infinity;
  let x = 0, y = 0, count = 0;
  for (let i = 0; i < eyes.length; i += 3) {
    if (Math.sign(eyes[i]) !== sign) continue;
    x += eyes[i]; y += eyes[i + 1]; count++;
    minX = Math.min(minX, eyes[i]); maxX = Math.max(maxX, eyes[i]);
    minY = Math.min(minY, eyes[i + 1]); maxY = Math.max(maxY, eyes[i + 1]);
    front = Math.max(front, eyes[i + 2]);
  }
  return { cx: x / count, cy: y / count, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2, front };
}

const random = n => { const value = Math.sin(n * 12.9898) * 43758.5453; return value - Math.floor(value); };

function groom(context, label, strands, color, headIndex) {
  const positions = [], joints = [], weights = [], indices = [];
  const vertex = point => {
    const index = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    joints.push(headIndex, 0, 0, 0); weights.push(1, 0, 0, 0);
    return index;
  };
  const segments = context.lod === 'medium' ? 2 : 4, stride = segments * 4 + 1;
  for (const { root, tip, bend, radius } of strands) {
    const axis = tip.clone().sub(root).normalize();
    const side = new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    const up = new Vector3().crossVectors(axis, side).normalize();
    let previous;
    for (let step = 0; step < segments; step++) {
      const t = step / segments;
      const centre = root.clone().lerp(tip, t).addScaledVector(bend, 4 * t * (1 - t));
      const ring = [];
      for (let k = 0; k < 4; k++) {
        const angle = k * Math.PI / 2;
        ring.push(vertex(centre.clone().addScaledVector(side, Math.cos(angle) * radius * (1 - t)).addScaledVector(up, Math.sin(angle) * radius * (1 - t))));
      }
      if (previous) for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        indices.push(previous[k], previous[n], ring[k], previous[n], ring[n], ring[k]);
      }
      previous = ring;
    }
    const end = vertex(tip);
    for (let k = 0; k < 4; k++) indices.push(previous[k], previous[(k + 1) % 4], end);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.strandStride = stride;
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ color, roughness: 0.9, side: DoubleSide }));
  mesh.name = label;
  context.group.add(mesh);
  mesh.bind(context.body.skeleton, context.body.bindMatrix);
}

export async function addFaceGroom(context, hairColor, seed = 1, eyebrows = {}, lashSettings = {}, strands = true) {
  const lashLength = Math.max(0.4, Math.min(1.8, lashSettings.length ?? 1));
  const lashCurl = Math.max(0, Math.min(1, lashSettings.curl ?? 0.5));
  const lashDensity = Math.max(0, Math.min(1, lashSettings.density ?? 1));
  const settings = browSettings(eyebrows);
  const eyeProxy = await loadProxy('eyes');
  const eyes = fitProxy(eyeProxy, context.positions);
  const surfaceZ = surfaceAt(context.body.geometry.getAttribute('position').array, context.body.geometry.index.array, eyes, true);
  const eyeZ = surfaceAt(eyes, eyeProxy.index, eyes);
  const head = context.data.skeleton.bones.findIndex(bone => bone.name === 'head');
  const brows = [], lashes = [];
  const eyebrow = await loadProxy('eyebrow002');
  const browPositions = fitProxy(eyebrow, context.positions);
  const url = new URL('../assets/proxies/eyebrow-follicles.json', import.meta.url);
  let follicles;
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    follicles = JSON.parse(await readFile(url, 'utf8')).follicles;
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Missing brow follicles: HTTP ${response.status}`);
    follicles = (await response.json()).follicles;
  }
  const sourceRoots = follicles.map(follicle => {
    const root = new Vector3();
    for (let k = 0; k < 3; k++) root.addScaledVector(new Vector3().fromArray(browPositions, follicle.vertices[k] * 3), follicle.weights[k]);
    return root;
  });
  const deform = browTransform(sourceRoots, settings, surfaceZ);
  // Roots are sampled from the authored CC0 brow alpha mask, fitted through
  // its own barycentric references, rather than an arbitrary rectangle.
  for (const [i, follicle] of follicles.entries()) {
    if (context.lod === 'medium' && i % 3 !== 0) continue;
    if (settings.density === 0 || random(i * 13.17 + seed) >= settings.density) continue;
    const root = sourceRoots[i].clone();
    const sign = Math.sign(root.x), e = eyeBounds(eyes, sign);
    const outer = Math.max(0, Math.min(1, (Math.abs(root.x) - Math.abs(e.cx) + e.rx) / (e.rx * 2)));
    const length = e.rx * (0.055 + 0.055 * random(i + seed));
    const tip = root.clone().add(new Vector3(sign * length * (0.2 + outer * 0.8), length * (0.9 - outer * 0.85), 0));
    const fittedTip = deform(tip); fittedTip.z += 0.0001;
    brows.push({ root: deform(root), tip: fittedTip, bend: new Vector3(0, 0, e.rx * 0.012), radius: e.rx * 0.0035 });
  }
  for (const sign of [-1, 1]) {
    const { cx, cy, rx, ry, front } = eyeBounds(eyes, sign);
    const clearance = (x, y) => {
      const eye = eyeZ(x, y, -Infinity);
      return Number.isFinite(eye) ? eye - surfaceZ(x, y, front) : -1;
    };
    for (const upper of [true, false]) {
      const count = Math.round((context.lod === 'medium' ? (upper ? 26 : 12) : (upper ? 58 : 26)) * lashDensity);
      for (let i = 0; i < count; i++) {
      const t = -0.85 + 1.7 * (i + 0.5) / count;
      const x = cx + rx * t;
      const visible = [];
      for (let k = 0; k <= 100; k++) {
        const y = cy - ry + k / 100 * ry * 2;
        if (clearance(x, y) > 0) visible.push(y);
      }
      if (!visible.length) continue;
      let inside = upper ? visible.at(-1) : visible[0];
      let outside = inside + (upper ? 1 : -1) * ry * 0.025;
      for (let k = 0; k < 12; k++) {
        const mid = (inside + outside) * 0.5;
        if (clearance(x, mid) > 0) inside = mid; else outside = mid;
      }
      // Sample the skin side of the junction, not the hollow socket side.
      const y = outside + (upper ? 1 : -1) * ry * 0.0001;
      const z = surfaceZ(x, y, front) + 0.00012;
      const length = rx * (upper ? 0.43 : 0.19) * lashLength * (0.7 + 0.3 * (1 - Math.abs(t))) * (0.85 + random(i + seed) * 0.3);
      // Curl lifts the tip up and away from the eye; 0.5 is the authored look.
      const lift = 0.35 + lashCurl * 0.6;
      lashes.push({
        root: new Vector3(x, y, z),
        tip: new Vector3(x + t * length * 0.45, y + (upper ? 1 : -1) * length * lift, z + length * (1.05 - lift * 0.75)),
        bend: new Vector3(0, (upper ? -1 : 1) * length * 0.2 * lashCurl, length * 0.18),
        radius: rx * (upper ? 0.008 : 0.0045),
      });
      }
    }
  }
  const brow = new Color(hairColor).lerp(new Color(0x775a46), 0.15);
  if (strands && brows.length) groom(context, 'Brows', brows, brow, head);
  if (strands && lashes.length) groom(context, 'Lashes', lashes, lashSettings.color ?? 0x201915, head);
  return { deform, density: settings.density };
}
