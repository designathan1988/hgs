import { add, sub, cross, norm, scale, PI } from './math.mjs';

export class MeshBuilder {
  constructor() { this.data = []; this.triangles = 0; }
  vertex(p, n, color, roughness = 0.65, bone = 0, kind = 0, bone2 = bone, weight = 0) {
    this.data.push(...p, ...n, ...color, roughness, bone, bone2, weight, kind);
  }
  triangle(a, b, c, color, roughness = 0.65, bone = 0, kind = 0, normals = null, bone2 = bone, weight = 0) {
    const n = normals || [norm(cross(sub(b, a), sub(c, a)))];
    this.vertex(a, n[0], color, roughness, bone, kind, bone2, weight);
    this.vertex(b, n[1] || n[0], color, roughness, bone, kind, bone2, weight);
    this.vertex(c, n[2] || n[0], color, roughness, bone, kind, bone2, weight);
    this.triangles++;
  }
  quad(a, b, c, d, color, roughness = 0.65, bone = 0, kind = 0, normals = null) {
    this.triangle(a, b, c, color, roughness, bone, kind, normals && [normals[0], normals[1], normals[2]]);
    this.triangle(a, c, d, color, roughness, bone, kind, normals && [normals[0], normals[2], normals[3]]);
  }
  lathe(rings, sides, color, roughness = 0.65, bone = 0, kind = 0, start = 0, end = PI * 2) {
    for (let j = 0; j < rings.length - 1; j++) {
      const a = rings[j], b = rings[j + 1];
      for (let i = 0; i < sides; i++) {
        const t0 = start + (end - start) * i / sides, t1 = start + (end - start) * (i + 1) / sides;
        const point = (ring, t) => [ring[0] + Math.cos(t) * ring[3], ring[1], ring[2] + Math.sin(t) * ring[4]];
        const normal = t => norm([Math.cos(t), 0.05, Math.sin(t)]);
        const p00 = point(a, t0), p01 = point(a, t1), p10 = point(b, t0), p11 = point(b, t1);
        this.quad(p00, p10, p11, p01, color, roughness, bone, kind,
          [normal(t0), normal(t0), normal(t1), normal(t1)]);
      }
    }
  }
  ellipsoid(center, radii, color, roughness = 0.65, bone = 0, kind = 0, segments = 16, stacks = 10) {
    for (let j = 0; j < stacks; j++) {
      const v0 = -PI / 2 + PI * j / stacks, v1 = -PI / 2 + PI * (j + 1) / stacks;
      for (let i = 0; i < segments; i++) {
        const u0 = 2 * PI * i / segments, u1 = 2 * PI * (i + 1) / segments;
        const point = (u, v) => [center[0] + radii[0] * Math.cos(v) * Math.cos(u), center[1] + radii[1] * Math.sin(v), center[2] + radii[2] * Math.cos(v) * Math.sin(u)];
        const normal = (u, v) => norm([Math.cos(v) * Math.cos(u) / radii[0], Math.sin(v) / radii[1], Math.cos(v) * Math.sin(u) / radii[2]]);
        this.quad(point(u0, v0), point(u0, v1), point(u1, v1), point(u1, v0), color, roughness, bone, kind,
          [normal(u0, v0), normal(u0, v1), normal(u1, v1), normal(u1, v0)]);
      }
    }
  }
  ribbon(points, widths, color, roughness = 0.7, bone = 0, kind = 0, facing = [0, 0, 1]) {
    for (let i = 0; i < points.length - 1; i++) {
      const tangent = norm(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]));
      let across = norm(cross(tangent, facing));
      if (Math.hypot(...across) < 0.001) across = [1, 0, 0];
      const q = (p, w, s) => add(p, scale(across, w * s));
      const p0 = q(points[i], widths[i], -1), p1 = q(points[i], widths[i], 1);
      const p2 = q(points[i + 1], widths[i + 1], 1), p3 = q(points[i + 1], widths[i + 1], -1);
      this.quad(p0, p1, p2, p3, color, roughness, bone, kind);
    }
  }
  tube(points, radii, sides, color, roughness = 0.65, bone = 0, kind = 0) {
    if (points.length < 2) return;
    const rings = points.map((p, i) => {
      const tangent = norm(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]));
      const axis = Math.abs(tangent[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
      const u = norm(cross(tangent, axis)), v = norm(cross(tangent, u));
      return { p, u, v, r: radii[i] };
    });
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < sides; k++) {
      const sample = (ring, angle) => add(ring.p, add(scale(ring.u, Math.cos(angle) * ring.r), scale(ring.v, Math.sin(angle) * ring.r)));
      const a = 2 * PI * k / sides, b = 2 * PI * (k + 1) / sides;
      const p00 = sample(rings[i], a), p01 = sample(rings[i], b), p10 = sample(rings[i + 1], a), p11 = sample(rings[i + 1], b);
      this.quad(p00, p10, p11, p01, color, roughness, bone, kind,
        [norm(sub(p00, rings[i].p)), norm(sub(p10, rings[i + 1].p)), norm(sub(p11, rings[i + 1].p)), norm(sub(p01, rings[i].p))]);
    }
  }
  finish() { return { vertices: new Float32Array(this.data), triangles: this.triangles, vertexCount: this.data.length / 14 }; }
}
