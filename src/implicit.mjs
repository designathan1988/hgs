import { clamp, mix, sub, norm, cross, dot } from './math.mjs';

export function sdEllipsoid(point, center, radii) {
  const q = [(point[0] - center[0]) / radii[0], (point[1] - center[1]) / radii[1], (point[2] - center[2]) / radii[2]];
  return (Math.hypot(...q) - 1) * Math.min(...radii);
}

export function sdTaperedCapsule(point, start, end, firstRadius, lastRadius) {
  const span = sub(end, start), rel = sub(point, start);
  const t = clamp(dot(rel, span) / dot(span, span), 0, 1);
  return Math.hypot(rel[0] - span[0] * t, rel[1] - span[1] * t, rel[2] - span[2] * t) - mix(firstRadius, lastRadius, t);
}

export function smoothUnion(a, b, width) {
  const h = clamp(0.5 + 0.5 * (b - a) / width, 0, 1);
  return mix(b, a, h) - width * h * (1 - h);
}

const cube = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];

export function addIsosurface(mesh, sdf, min, max, step, color, roughness, kind, skinning) {
  const nx = Math.ceil((max[0] - min[0]) / step), ny = Math.ceil((max[1] - min[1]) / step), nz = Math.ceil((max[2] - min[2]) / step);
  const sx = (max[0] - min[0]) / nx, sy = (max[1] - min[1]) / ny, sz = (max[2] - min[2]) / nz;
  const index = (x, y, z) => (z * (ny + 1) + y) * (nx + 1) + x;
  const field = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  for (let z = 0; z <= nz; z++) for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    field[index(x, y, z)] = sdf([min[0] + x * sx, min[1] + y * sy, min[2] + z * sz]);
  }
  const gradient = p => {
    const e = step * 0.35;
    return norm([
      sdf([p[0] + e, p[1], p[2]]) - sdf([p[0] - e, p[1], p[2]]),
      sdf([p[0], p[1] + e, p[2]]) - sdf([p[0], p[1] - e, p[2]]),
      sdf([p[0], p[1], p[2] + e]) - sdf([p[0], p[1], p[2] - e]),
    ]);
  };
  const interpolate = (a, b, va, vb) => {
    const t = clamp(va / (va - vb), 0, 1);
    return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  };
  const emit = (a, b, c) => {
    const na = gradient(a), nb = gradient(b), nc = gradient(c);
    if (dot(cross(sub(b, a), sub(c, a)), na) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      const n = gradient(p), [boneA, boneB, weight] = skinning(p);
      mesh.vertex(p, n, color, roughness, boneA, kind, boneB, weight);
    }
    mesh.triangles++;
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const pos = cube.map(v => [min[0] + (x + v[0]) * sx, min[1] + (y + v[1]) * sy, min[2] + (z + v[2]) * sz]);
    const values = cube.map(v => field[index(x + v[0], y + v[1], z + v[2])]);
    if (values.every(v => v >= 0) || values.every(v => v < 0)) continue;
    for (const tetra of tetrahedra) {
      const inside = tetra.filter(i => values[i] < 0), outside = tetra.filter(i => values[i] >= 0);
      if (!inside.length || !outside.length) continue;
      const edge = (i, j) => interpolate(pos[i], pos[j], values[i], values[j]);
      if (inside.length === 1) emit(edge(inside[0], outside[0]), edge(inside[0], outside[1]), edge(inside[0], outside[2]));
      else if (inside.length === 3) emit(edge(outside[0], inside[0]), edge(outside[0], inside[1]), edge(outside[0], inside[2]));
      else {
        const a = edge(inside[0], outside[0]), b = edge(inside[0], outside[1]), c = edge(inside[1], outside[0]), d = edge(inside[1], outside[1]);
        emit(a, b, c); emit(b, d, c);
      }
    }
  }
  return mesh;
}
