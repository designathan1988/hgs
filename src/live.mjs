import { Matrix3, Matrix4, Vector3 } from 'three';
import { shapeHuman } from './parametric.mjs';
import { applyOffsets } from './sculpt.mjs';
import { fitProxy, loadProxy } from './proxy.mjs';
import { makeSkeleton, resolvedSpec } from './human-three.mjs';
import { SurfaceCollider } from './collision.mjs';

/**
 * Live reshaping: while a body slider is dragged, the character on screen
 * follows in place instead of being rebuilt. Every skinned mesh is tied to the
 * base mesh the way MakeHuman ties clothes to it (a point in a triangle of
 * basemesh vertices, w1·r1 + w2·r2 + w3·r3 + offset; MakeHuman file formats,
 * .mhclo), and the skeleton takes the new rest pose with the bind matrices
 * recomputed from it (three.js Skeleton.calculateInverses). Everything is
 * relative to the last full build, so nothing accumulates; the full build
 * (drape, hair gravity, facial rig) refines the result when the drag ends.
 *
 * Modes per mesh:
 * - base: built from base vertices (`baseIds`: body, mouth): v = P[id];
 * - proxy: a MakeHuman proxy of the same vertex count: v = v₀ + fit(P) − fit(P₀),
 *   which keeps what the build did after fitting (collision, sculpt);
 * - surface: tied to the nearest skin triangle (tailored clothes, child layers):
 *   v = v₀ + Σ bᵢ (P[refᵢ] − P₀[refᵢ]);
 * - head: weighted to head, neck or hair joints (hair, cap, clips, brows, lashes,
 *   eyes): the least-squares affine map of the head skin from P₀ to P, which
 *   follows a larger or narrower head, not just a moved one.
 */

const HEADISH = /^(head|neck_01|hair_)/;

/** Smooth vertex normals of a triangle list over flat positions. */
function vertexNormals(P, index) {
  const n = new Float32Array(P.length);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += x; n[o + 1] += y; n[o + 2] += z; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

/** Body triangles in base-vertex ids (each quad split a,b,c / a,c,d as makeBodyGeometry does). */
function bodyTriangles(data) {
  const body = data.base.faceGroups.indexOf('body'), out = [];
  for (let f = 0; f < data.faceGroup.length; f++) if (data.faceGroup[f] === body) {
    const o = f * 4;
    out.push(data.faces[o], data.faces[o + 1], data.faces[o + 2], data.faces[o], data.faces[o + 2], data.faces[o + 3]);
  }
  return Uint32Array.from(out);
}

/** Least-squares affine map taking `before` to `after` over the vertices `ids` (4×4 normal equations, three right-hand sides). */
function bestAffine(ids, before, after) {
  const N = new Array(16).fill(0), r = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const v of ids) {
    const q = [before[v * 3], before[v * 3 + 1], before[v * 3 + 2], 1];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) N[i * 4 + j] += q[i] * q[j];
      for (let k = 0; k < 3; k++) r[k][i] += q[i] * after[v * 3 + k];
    }
  }
  // N is symmetric, so its column-major and row-major readings are the same matrix.
  const inv = new Matrix4().fromArray(N).invert().elements;
  const row = k => [0, 1, 2, 3].map(i => inv[i * 4] * r[k][0] + inv[i * 4 + 1] * r[k][1] + inv[i * 4 + 2] * r[k][2] + inv[i * 4 + 3] * r[k][3]);
  return new Matrix4().set(...row(0), ...row(1), ...row(2), 0, 0, 0, 1);
}

export class LiveShape {
  /** Tie every skinned mesh of a freshly built character to its body (async only for loading proxies). */
  static async create(human) {
    const live = new LiveShape(human);
    await live.bind();
    return live;
  }
  constructor(human) {
    this.human = human;
    const { data, positions } = human.context;
    this.data = data; this.P0 = Float32Array.from(positions);
    const head = data.skeleton.bones.findIndex(bone => bone.name === 'head');
    this.headIds = [];
    for (let v = 0; v < this.P0.length / 3; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (data.joints[v * 4 + k] === head) w += data.weights[v * 4 + k];
      if (w > 0.5 * 65535) this.headIds.push(v);
    }
  }
  async bind() {
    const meshes = [];
    this.human.group.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
    const bones = this.human.body.skeleton.bones;
    let surface = null;
    this.parts = [];
    for (const mesh of meshes) {
      const g = mesh.geometry, position = g.getAttribute('position'), normal = g.getAttribute('normal');
      const part = { mesh, v0: Float32Array.from(position.array), n0: normal ? Float32Array.from(normal.array) : null };
      const proxy = mesh.userData.style && g.userData.proxyVertexCount === position.count ? await loadProxy(mesh.userData.style).catch(() => null) : null;
      if (g.userData.baseIds?.length === position.count) Object.assign(part, { mode: 'base', ids: g.userData.baseIds });
      else if (proxy && proxy.refs.length / 3 === position.count) Object.assign(part, { mode: 'proxy', proxy, fit0: fitProxy(proxy, this.P0) });
      else if (this.headish(g, bones)) part.mode = 'head';
      else {
        if (!surface) { const triangles = bodyTriangles(this.data); surface = new SurfaceCollider().add(this.P0, vertexNormals(this.P0, triangles), triangles); }
        const refs = new Uint32Array(position.count * 3), bary = new Float32Array(position.count * 3), hit = {}, v0 = part.v0;
        for (let i = 0; i < position.count; i++) {
          // A vertex with no skin within 30 cm keeps its place (zero weights).
          if (!surface.closest(v0[i * 3], v0[i * 3 + 1], v0[i * 3 + 2], 0.3, hit)) continue;
          refs[i * 3] = hit.a; refs[i * 3 + 1] = hit.b; refs[i * 3 + 2] = hit.c;
          bary[i * 3] = hit.u; bary[i * 3 + 1] = hit.v; bary[i * 3 + 2] = hit.w;
        }
        Object.assign(part, { mode: 'surface', refs, bary });
      }
      this.parts.push(part);
    }
  }
  /** True when (almost) all of the mesh's skin weight is on the head, the neck or hair joints. */
  headish(geometry, bones) {
    const index = geometry.getAttribute('skinIndex'), weight = geometry.getAttribute('skinWeight');
    if (!index || !weight) return false;
    let on = 0, all = 0;
    for (let i = 0; i < index.count; i++) for (let k = 0; k < 4; k++) {
      const w = weight.getComponent(i, k);
      all += w;
      if (HEADISH.test(bones[index.getComponent(i, k)]?.name ?? '')) on += w;
    }
    return all > 0 && on / all > 0.95;
  }
  /**
   * Reshape to `spec` (a studioSpec): base mesh, skeleton rest and bind pose,
   * then every tied mesh. `springs` (hair joints) are put back at rest first so
   * the bind matrices are taken at rest. Returns the new standing height.
   */
  update(spec, springs = null) {
    spec = resolvedSpec(spec);
    const { data } = this, height = spec.heightMeters ?? 1.7;
    const P = shapeHuman(data, spec);
    const unsculpted = spec.sculpt?.body && Object.keys(spec.sculpt.body).length ? P.slice() : null;
    applyOffsets(P, spec.sculpt?.body, height);
    const next = makeSkeleton(data, P, unsculpted, height);
    const skeleton = this.human.body.skeleton;
    next.bones.forEach((bone, i) => {
      const target = skeleton.bones[i];
      target.position.copy(bone.position); target.quaternion.copy(bone.quaternion); target.scale.set(1, 1, 1);
    });
    springs?.reset();
    const A = bestAffine(this.headIds, this.P0, P), normalA = new Matrix3().getNormalMatrix(A), p = new Vector3();
    for (const part of this.parts) {
      const g = part.mesh.geometry, position = g.getAttribute('position'), out = position.array, v0 = part.v0;
      if (part.mode === 'base') {
        for (let i = 0; i < part.ids.length; i++) { const s = part.ids[i] * 3; out[i * 3] = P[s]; out[i * 3 + 1] = P[s + 1]; out[i * 3 + 2] = P[s + 2]; }
      } else if (part.mode === 'proxy') {
        const fit = fitProxy(part.proxy, P);
        for (let i = 0; i < out.length; i++) out[i] = v0[i] + fit[i] - part.fit0[i];
      } else if (part.mode === 'surface') {
        const { refs, bary } = part, P0 = this.P0;
        for (let i = 0; i < out.length / 3; i++) for (let k = 0; k < 3; k++) {
          let d = 0;
          for (let j = 0; j < 3; j++) { const r = refs[i * 3 + j] * 3 + k; d += bary[i * 3 + j] * (P[r] - P0[r]); }
          out[i * 3 + k] = v0[i * 3 + k] + d;
        }
      } else {
        for (let i = 0; i < out.length; i += 3) p.fromArray(v0, i).applyMatrix4(A).toArray(out, i);
      }
      position.needsUpdate = true;
      const normal = g.getAttribute('normal');
      if (!normal) continue;
      if (part.mode === 'base') this.baseNormals(g, part.ids, P);
      else if (part.mode === 'head' && part.n0) {
        for (let i = 0; i < normal.array.length; i += 3) p.fromArray(part.n0, i).applyMatrix3(normalA).normalize().toArray(normal.array, i);
        normal.needsUpdate = true;
      } else g.computeVertexNormals();
    }
    // The new rest pose is the bind pose (three.js Skeleton.calculateInverses: from the current world matrices).
    this.human.group.updateMatrixWorld(true);
    const skeletons = new Set(this.parts.map(part => part.mesh.skeleton).filter(Boolean));
    for (const each of skeletons) each.calculateInverses();
    Object.assign(this.human.context.skeleton, { heads: next.heads, tails: next.tails, rest: next.rest });
    P.unitScale = P.unitScale ?? this.human.context.positions.unitScale;
    this.human.context.positions = P;
    this.human.context.height = height;
    return height;
  }
  /** Body normals averaged per base vertex so UV seams stay smooth (as makeBodyGeometry). */
  baseNormals(geometry, ids, P) {
    const acc = new Float32Array(P.length), index = geometry.index?.array, normal = geometry.getAttribute('normal');
    if (!index) { geometry.computeVertexNormals(); return; }
    for (let t = 0; t < index.length; t += 3) {
      const a = ids[index[t]] * 3, b = ids[index[t + 1]] * 3, c = ids[index[t + 2]] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      for (const o of [a, b, c]) { acc[o] += x; acc[o + 1] += y; acc[o + 2] += z; }
    }
    const n = normal.array;
    for (let i = 0; i < ids.length; i++) {
      const s = ids[i] * 3, l = Math.hypot(acc[s], acc[s + 1], acc[s + 2]);
      if (!l) continue;
      n[i * 3] = acc[s] / l; n[i * 3 + 1] = acc[s + 1] / l; n[i * 3 + 2] = acc[s + 2] / l;
    }
    normal.needsUpdate = true;
  }
}
