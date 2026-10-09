import { BufferGeometry, DoubleSide, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Spherical, Vector3 } from 'three';

/**
 * The hair guide: a cage around the head that strokes are drawn on, as in
 * VRoid Studio's hair editor ("you can draw hair directly on the guide mesh
 * generated around the head"). Its shape gives the hair its volume and fall
 * without any simulation:
 * - the cap: the head's own outline (the farthest head vertex in each
 *   direction from the head centre, θ around the vertical, φ from the top),
 *   raised by the volume;
 * - the veil: from the head's widest outline the guide falls straight down,
 *   kept outside the neck, shoulders and back (the arms are left out: hair
 *   falls in front of or behind them), and never narrows going down.
 * Points of the hair are measured against it (`frame`): the outward
 * direction and the height above the guide's axis, so a new stroke can be
 * laid over the ones already there.
 */
const THETA = 72, PHI = 18, ROW = 0.02;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Bones whose skin the veil keeps out of (the arms and legs are left out). */
const veilBones = /^(head|neck|spine|pelvis|clavicle)/;

export class HairGuide {
  constructor(state, { volume = 0.008, length = 0.6, outline = null } = {}) {
    this.state = state;
    this.C = state.frame.C.clone();
    // Positions of hair already on the head as a mesh (a ready-made base): the guide wraps it too.
    this.outline = outline;
    this.measure();
    this.build(volume, length);
  }
  /** Head outline per (θ, φ) bin and body outline per (θ, height) row, from the body's own vertices. */
  measure() {
    const { positions, frame, data } = this.state, C = this.C, count = positions.length / 3;
    const bones = data.skeleton.bones.map(bone => bone.name), head = bones.indexOf('head');
    const cap = new Float32Array(THETA * (PHI + 1)), wide = new Float32Array(THETA);
    const rows = Math.ceil(1.0 / ROW), body = new Float32Array(THETA * rows);
    const s = new Spherical(), d = new Vector3();
    for (let v = 0; v < count; v++) {
      if (!frame.used[v]) continue;
      let headWeight = 0, best = -1, bestWeight = 0;
      for (let k = 0; k < 4; k++) {
        const joint = data.joints[v * 4 + k], weight = data.weights[v * 4 + k] / 65535;
        if (joint === head) headWeight += weight;
        if (weight > bestWeight) { bestWeight = weight; best = joint; }
      }
      d.set(positions[v * 3] - C.x, positions[v * 3 + 1] - C.y, positions[v * 3 + 2] - C.z);
      s.setFromVector3(d);
      const t = ((Math.floor((s.theta + Math.PI) / TAU * THETA) % THETA) + THETA) % THETA;
      if (headWeight > 0.5 && d.y >= 0) {
        const p = clamp(Math.round(s.phi / (Math.PI / 2) * PHI), 0, PHI);
        cap[t * (PHI + 1) + p] = Math.max(cap[t * (PHI + 1) + p], s.radius);
      }
      const horizontal = Math.hypot(d.x, d.z);
      if (headWeight > 0.5) wide[t] = Math.max(wide[t], horizontal);
      if (d.y < 0 && best >= 0 && veilBones.test(bones[best])) {
        const row = Math.floor(-d.y / ROW);
        if (row < rows) body[t * rows + row] = Math.max(body[t * rows + row], horizontal);
      }
    }
    // The base hair: over the head centre it widens the cap and the widest outline; below it, the veil rows.
    const outline = this.outline ?? [];
    for (let v = 0; v < outline.length; v += 3) {
      d.set(outline[v] - C.x, outline[v + 1] - C.y, outline[v + 2] - C.z);
      s.setFromVector3(d);
      const t = ((Math.floor((s.theta + Math.PI) / TAU * THETA) % THETA) + THETA) % THETA, horizontal = Math.hypot(d.x, d.z);
      if (d.y >= 0) {
        const p = clamp(Math.round(s.phi / (Math.PI / 2) * PHI), 0, PHI);
        cap[t * (PHI + 1) + p] = Math.max(cap[t * (PHI + 1) + p], s.radius);
        wide[t] = Math.max(wide[t], horizontal);
      } else {
        const row = Math.floor(-d.y / ROW);
        if (row < rows) body[t * rows + row] = Math.max(body[t * rows + row], horizontal);
      }
    }
    // Fill empty bins from their neighbours (around θ first, then down φ), then smooth with a max-biased blur.
    const R = this.state.frame.R;
    for (let p = 0; p <= PHI; p++) for (let pass = 0; pass < THETA; pass++) {
      let empty = false;
      for (let t = 0; t < THETA; t++) {
        const i = t * (PHI + 1) + p;
        if (cap[i]) continue;
        const a = cap[((t + THETA - 1) % THETA) * (PHI + 1) + p], b = cap[((t + 1) % THETA) * (PHI + 1) + p];
        if (a || b) cap[i] = Math.max(a, b); else empty = true;
      }
      if (!empty) break;
    }
    for (let i = 0; i < cap.length; i++) if (!cap[i]) cap[i] = R;
    this.cap = blur(cap, THETA, PHI + 1, 2);
    for (let t = 0; t < THETA; t++) if (!wide[t]) wide[t] = R;
    this.wide = blurRing(wide, 2);
    this.body = body; this.rows = rows;
  }
  /** (Re)build the guide surface for a volume (m above the head) and a length (m below the head centre). */
  build(volume = this.volume, length = this.length) {
    this.volume = volume; this.length = length;
    const C = this.C, rowsDown = Math.max(1, Math.ceil(length / ROW));
    const pos = [];
    // Cap: rows from the top (φ = 0) to the equator (φ = π/2).
    for (let p = 0; p <= PHI; p++) for (let t = 0; t < THETA; t++) {
      const phi = p / PHI * Math.PI / 2, theta = (t + 0.5) / THETA * TAU - Math.PI;
      // Near the equator the cap widens to the head's widest outline, where the veil starts.
      const r = Math.max(this.cap[t * (PHI + 1) + p], p === PHI ? this.wide[t] : 0) + volume;
      pos.push(C.x + Math.sin(phi) * Math.sin(theta) * r, C.y + Math.cos(phi) * r, C.z + Math.sin(phi) * Math.cos(theta) * r);
    }
    // Veil: straight down from the widest outline, outside the body, never narrowing.
    const radius = Float32Array.from(this.wide, w => w + volume);
    for (let k = 1; k <= rowsDown; k++) {
      const y = C.y - k * ROW, row = Math.min(this.rows - 1, k - 1);
      for (let t = 0; t < THETA; t++) {
        const around = Math.max(this.body[t * this.rows + row], this.body[((t + 1) % THETA) * this.rows + row], this.body[((t + THETA - 1) % THETA) * this.rows + row]);
        radius[t] = Math.max(radius[t], around + volume + 0.01);
      }
      const smooth = blurRing(radius, 1);
      for (let t = 0; t < THETA; t++) {
        radius[t] = Math.max(radius[t], smooth[t] * 0.98);
        const theta = (t + 0.5) / THETA * TAU - Math.PI;
        pos.push(C.x + Math.sin(theta) * radius[t], y, C.z + Math.cos(theta) * radius[t]);
      }
    }
    const rings = PHI + 1 + rowsDown, index = [];
    for (let r = 0; r + 1 < rings; r++) for (let t = 0; t < THETA; t++) {
      const a = r * THETA + t, b = r * THETA + (t + 1) % THETA, c = a + THETA, e = b + THETA;
      index.push(a, c, b, b, c, e);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    this.mesh?.geometry.dispose();
    this.mesh ??= new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide, visible: false }));
    this.mesh.geometry = geometry;
    // A light wire cage shown while drawing (every third line around and down).
    const lines = [];
    for (let r = 0; r < rings; r++) for (let t = 0; t < THETA; t += 3) {
      const a = r * THETA + t, b = r * THETA + (t + 3) % THETA;
      if (r % 2 === 0) lines.push(...pos.slice(a * 3, a * 3 + 3), ...pos.slice(b * 3, b * 3 + 3));
      if (r + 1 < rings) lines.push(...pos.slice(a * 3, a * 3 + 3), ...pos.slice((a + THETA) * 3, (a + THETA) * 3 + 3));
    }
    const wire = new BufferGeometry();
    wire.setAttribute('position', new Float32BufferAttribute(lines, 3));
    this.wire?.geometry.dispose();
    this.wire ??= new LineSegments(wire, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
    this.wire.geometry = wire;
    this.wire.renderOrder = 5;
  }
  /**
   * The outward direction at `p` and its height: from the head centre on the
   * cap, horizontally from the vertical axis on the veil. A hair point with a
   * larger height lies over one with a smaller height.
   */
  frame(p, out = new Vector3()) {
    const C = this.C;
    if (p.y >= C.y) { out.copy(p).sub(C); const h = out.length() || 1; out.divideScalar(h); return h; }
    out.set(p.x - C.x, 0, p.z - C.z); const h = out.length() || 1; out.divideScalar(h); return h;
  }
  dispose() { this.mesh?.geometry.dispose(); this.mesh?.material.dispose(); this.wire?.geometry.dispose(); this.wire?.material.dispose(); }
}

/** Blur a (ring × rows) grid around the ring and along the rows, keeping each value at least 97% of its maximum. */
function blur(grid, ring, rows, passes) {
  let a = Float32Array.from(grid);
  for (let pass = 0; pass < passes; pass++) {
    const b = new Float32Array(a.length);
    for (let t = 0; t < ring; t++) for (let r = 0; r < rows; r++) {
      let sum = 0, n = 0, most = 0;
      for (let dt = -1; dt <= 1; dt++) for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr; if (rr < 0 || rr >= rows) continue;
        const v = a[((t + dt + ring) % ring) * rows + rr]; sum += v; n++; most = Math.max(most, v);
      }
      b[t * rows + r] = Math.max(sum / n, most * 0.97);
    }
    a = b;
  }
  return a;
}
function blurRing(ring, passes) {
  let a = Float32Array.from(ring);
  for (let pass = 0; pass < passes; pass++) {
    const b = new Float32Array(a.length);
    for (let t = 0; t < a.length; t++) {
      const l = a[(t + a.length - 1) % a.length], r = a[(t + 1) % a.length];
      b[t] = Math.max((l + a[t] + r) / 3, Math.max(l, a[t], r) * 0.97);
    }
    a = b;
  }
  return a;
}
