import { Triangle, Vector3 } from 'three';

/**
 * One static triangle surface for proximity queries: the closest point, its
 * smooth (barycentric) normal and the signed distance along it. Vertices are
 * binned in a uniform grid; the nearest vertex's triangles are tested exactly.
 */
class SurfaceLayer {
  constructor(cell = 0.012) {
    this.cell = cell; this.grid = new Map();
    this.positions = []; this.normals = []; this.triangles = []; this.incident = [];
    this.tri = new Triangle(); this.point = new Vector3(); this.bary = new Vector3(); this.query = new Vector3();
  }
  // Numeric spatial hash; a rare clash only adds extra candidates.
  key(x, y, z) { return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0; }
  /** Add a mesh: positions and smooth vertex normals (flat arrays) and a triangle index. */
  add(positions, normals, index) {
    const base = this.positions.length / 3, c = this.cell;
    this.built = false;
    const used = new Uint8Array(positions.length / 3);
    for (let i = 0; i < index.length; i++) used[index[i]] = 1;
    for (let i = 0; i < positions.length; i++) { this.positions.push(positions[i]); this.normals.push(normals[i]); }
    this.min ??= [Infinity, Infinity, Infinity]; this.max ??= [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < positions.length / 3; v++) {
      this.incident.push([]);
      if (!used[v]) continue;
      for (let k = 0; k < 3; k++) { this.min[k] = Math.min(this.min[k], positions[v * 3 + k]); this.max[k] = Math.max(this.max[k], positions[v * 3 + k]); }
      const k = this.key(Math.floor(positions[v * 3] / c), Math.floor(positions[v * 3 + 1] / c), Math.floor(positions[v * 3 + 2] / c));
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, list = []);
      list.push(base + v);
    }
    for (let i = 0; i < index.length; i += 3) {
      const t = this.triangles.length / 3;
      this.triangles.push(base + index[i], base + index[i + 1], base + index[i + 2]);
      this.incident[base + index[i]].push(t); this.incident[base + index[i + 1]].push(t); this.incident[base + index[i + 2]].push(t);
    }
    return this;
  }
  /**
   * The query structure (Ten Minute Physics 11, dense grid): positions and
   * normals in typed arrays and the binned vertices in a dense grid over the
   * layer's box (cellStart counted then summed, cellEntries filled), so a cell
   * is an array index instead of a hash lookup. Rebuilt after any `add`.
   */
  build() {
    const c = this.cell, used = [];
    this.p = Float32Array.from(this.positions); this.n = Float32Array.from(this.normals);
    for (const list of this.grid.values()) for (const v of list) used.push(v);
    const lo = this.min.map(v => Math.floor(v / c)), hi = this.max.map(v => Math.floor(v / c));
    const nx = hi[0] - lo[0] + 1, ny = hi[1] - lo[1] + 1, nz = hi[2] - lo[2] + 1;
    const start = new Int32Array(nx * ny * nz + 1), entries = new Int32Array(used.length), cellOf = new Int32Array(used.length);
    used.forEach((v, e) => {
      const i = Math.floor(this.p[v * 3] / c) - lo[0], j = Math.floor(this.p[v * 3 + 1] / c) - lo[1], k = Math.floor(this.p[v * 3 + 2] / c) - lo[2];
      cellOf[e] = (k * ny + j) * nx + i; start[cellOf[e]]++;
    });
    for (let i = 1; i < start.length; i++) start[i] += start[i - 1];
    for (let e = used.length - 1; e >= 0; e--) entries[--start[cellOf[e]]] = used[e];
    Object.assign(this, { lo, nx, ny, nz, start, entries, built: true });
  }
  /**
   * Nearest surface vertex within the radius, searched in growing shells of
   * cells (only each shell's surface cells are visited). Once the best hit is
   * closer than the shell distance, no farther shell can beat it.
   */
  nearestVertex(x, y, z, radius, facing = null) {
    if (!this.built) this.build();
    const c = this.cell, p = this.p, n = this.n, { lo, nx, ny, nz, start, entries } = this;
    const cx = Math.floor(x / c) - lo[0], cy = Math.floor(y / c) - lo[1], cz = Math.floor(z / c) - lo[2];
    let best = -1, distance = radius * radius;
    const rings = Math.ceil(radius / c);
    for (let r = 0; r <= rings; r++) {
      for (let i = -r; i <= r; i++) {
        const xi = cx + i;
        if (xi < 0 || xi >= nx) continue;
        for (let j = -r; j <= r; j++) {
          const yj = cy + j;
          if (yj < 0 || yj >= ny) continue;
          // On the shell's faces every k; inside it only the two caps k = ±r.
          const full = i === r || i === -r || j === r || j === -r, step = full ? 1 : 2 * r || 1;
          for (let k = -r; k <= r; k += step) {
            const zk = cz + k;
            if (zk < 0 || zk >= nz) continue;
            const cell = (zk * ny + yj) * nx + xi;
            for (let e = start[cell], end = start[cell + 1]; e < end; e++) {
              const v = entries[e];
              // Ignore surfaces facing away (the other thigh, the inside of an arm).
              if (facing && n[v * 3] * facing[0] + n[v * 3 + 1] * facing[1] + n[v * 3 + 2] * facing[2] < 0.1) continue;
              const dx = p[v * 3] - x, dy = p[v * 3 + 1] - y, dz = p[v * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
              if (d < distance) { distance = d; best = v; }
            }
          }
        }
      }
      if (best >= 0 && distance <= (r * c) ** 2) break;
    }
    return best;
  }
  /**
   * Closest surface point within `radius` of (x, y, z): the nearest vertex's
   * incident triangles are tested exactly. Writes { x, y, z, nx, ny, nz,
   * distance } (distance signed along the smooth normal) into `out`.
   */
  closest(x, y, z, radius, out, facing = null) {
    // Nothing of this surface within the radius of its bounding box.
    if (x < this.min[0] - radius || x > this.max[0] + radius || y < this.min[1] - radius || y > this.max[1] + radius || z < this.min[2] - radius || z > this.max[2] + radius) return false;
    const nearest = this.nearestVertex(x, y, z, radius, facing);
    if (nearest < 0) return false;
    const p = this.p, n = this.n, tri = this.tri;
    const query = this.query.set(x, y, z);
    let best = Infinity, found = -1, bx = 0, by = 0, bz = 0;
    for (const t of this.incident[nearest]) {
      const a = this.triangles[t * 3], b = this.triangles[t * 3 + 1], d = this.triangles[t * 3 + 2];
      tri.a.set(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]); tri.b.set(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]); tri.c.set(p[d * 3], p[d * 3 + 1], p[d * 3 + 2]);
      tri.closestPointToPoint(query, this.point);
      const dd = this.point.distanceToSquared(query);
      if (dd < best) { best = dd; found = t; bx = this.point.x; by = this.point.y; bz = this.point.z; }
    }
    if (found < 0) return false;
    const a = this.triangles[found * 3], b = this.triangles[found * 3 + 1], d = this.triangles[found * 3 + 2];
    tri.a.set(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]); tri.b.set(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]); tri.c.set(p[d * 3], p[d * 3 + 1], p[d * 3 + 2]);
    tri.getBarycoord(this.point.set(bx, by, bz), this.bary);
    const u = this.bary.x, v = this.bary.y, w = this.bary.z;
    let nx = n[a * 3] * u + n[b * 3] * v + n[d * 3] * w, ny = n[a * 3 + 1] * u + n[b * 3 + 1] * v + n[d * 3 + 1] * w, nz = n[a * 3 + 2] * u + n[b * 3 + 2] * v + n[d * 3 + 2] * w;
    const length = Math.hypot(nx, ny, nz) || 1; nx /= length; ny /= length; nz /= length;
    out.x = bx; out.y = by; out.z = bz; out.nx = nx; out.ny = ny; out.nz = nz;
    out.distance = (x - bx) * nx + (y - by) * ny + (z - bz) * nz;
    // Triangle corners (collider vertex ids) and barycentric weights, for
    // transferring per-vertex data such as skin weights.
    out.a = a; out.b = b; out.c = d; out.u = u; out.v = v; out.w = w;
    return true;
  }
}

/**
 * Layered collision surfaces (the skin, then each garment added on top). Each
 * layer is queried on its own, so a sparse layer (a sock over dense skin) is
 * never hidden behind the nearest vertex of a denser one.
 */
export class SurfaceCollider {
  constructor(cell = 0.012) { this.cell = cell; this.layers = []; this.scratch = {}; }
  /**
   * Add a mesh as a new layer: positions and smooth vertex normals (flat
   * arrays) and a triangle index. Wearables are often double-sided or wound
   * inconsistently, so with `orient` each normal is turned to agree with the
   * skin beneath it (layer 0): "outside" then always means away from the body.
   */
  add(positions, normals, index, { orient = false } = {}) {
    if (orient && this.layers.length) {
      normals = Float32Array.from(normals);
      const skin = this.layers[0], hit = {};
      for (let v = 0; v < positions.length / 3; v++) {
        if (!skin.closest(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], 0.1, hit)) continue;
        if (normals[v * 3] * hit.nx + normals[v * 3 + 1] * hit.ny + normals[v * 3 + 2] * hit.nz < 0) {
          normals[v * 3] *= -1; normals[v * 3 + 1] *= -1; normals[v * 3 + 2] *= -1;
        }
      }
    }
    this.layers.push(new SurfaceLayer(this.cell).add(positions, normals, index));
    this.layers.at(-1).id = this.layers.length - 1;
    return this;
  }
  /** Closest point over every layer (see SurfaceLayer.closest); `out.layer` names it. */
  closest(x, y, z, radius, out, facing = null) {
    let found = false, best = Infinity;
    for (const layer of this.layers) {
      if (!layer.closest(x, y, z, radius, this.scratch, facing)) continue;
      const d = (this.scratch.x - x) ** 2 + (this.scratch.y - y) ** 2 + (this.scratch.z - z) ** 2;
      if (d < best) { best = d; found = true; Object.assign(out, this.scratch); out.layer = layer.id; }
    }
    return found;
  }
  /**
   * The layer that most needs this point moved to keep it `thickness`
   * outside every surface (ignoring hits deeper than `depth`). Falls back to
   * the closest surface when no push is needed.
   */
  deepest(x, y, z, radius, thickness, depth, out, facing = null) {
    let found = false, push = 0;
    for (const layer of this.layers) {
      if (!layer.closest(x, y, z, radius, this.scratch, facing)) continue;
      const need = thickness - this.scratch.distance;
      if (this.scratch.distance < -depth) continue;
      if (!found || need > push) { push = need; found = true; Object.assign(out, this.scratch); out.layer = layer.id; }
    }
    return found;
  }
}

/**
 * Remove triangles of an inner layer that lie behind an outer layer (a sock
 * inside a trouser leg): every corner must be under the outer surface. Like
 * removing covered skin, it costs nothing visible and nothing can show through.
 */
export function cullCovered(inner, outer, skin, { reach = 0.04, margin = 0.0005 } = {}) {
  if (!outer.getAttribute('normal')) outer.computeVertexNormals();
  // The outer layer's normals are oriented away from the skin before testing.
  const collider = new SurfaceCollider(0.012);
  collider.layers.push(skin.layers[0]);
  collider.add(outer.getAttribute('position').array, outer.getAttribute('normal').array, outer.index.array, { orient: true });
  collider.layers.shift();
  // Only what the outer layer wraps can be hidden: points under its lower edge
  // (a heel below a trouser hem) stay, even if they are behind its surface.
  const outerPosition = outer.getAttribute('position');
  const lowest = (x, z) => {
    let y = Infinity;
    for (let i = 0; i < outerPosition.count; i++) if (Math.hypot(outerPosition.getX(i) - x, outerPosition.getZ(i) - z) < 0.08) y = Math.min(y, outerPosition.getY(i));
    return y;
  };
  const hems = new Map();
  const position = inner.getAttribute('position'), hit = {};
  const behind = new Uint8Array(position.count);
  for (let v = 0; v < position.count; v++) {
    const x = position.getX(v), y = position.getY(v), z = position.getZ(v);
    if (!collider.closest(x, y, z, reach, hit)) continue;
    // Behind the outer surface, or wrapped well inside it (above its lower edge,
    // where a coarse outer mesh can't be trusted to be in front everywhere).
    if (hit.distance >= -margin && hit.distance > 0.006) continue;
    const cellKey = `${Math.round(x * 25)},${Math.round(z * 25)}`;
    if (!hems.has(cellKey)) hems.set(cellKey, lowest(x, z));
    if (y > hems.get(cellKey) + 0.02) behind[v] = 1;
  }
  const old = inner.index.array, kept = [];
  for (let i = 0; i < old.length; i += 3) if (!(behind[old[i]] && behind[old[i + 1]] && behind[old[i + 2]])) kept.push(old[i], old[i + 1], old[i + 2]);
  if (kept.length !== old.length) inner.setIndex(kept);
  return old.length / 3 - kept.length / 3;
}

/** Collider from a BufferGeometry (rest pose), using its normals. */
export function colliderFromGeometry(geometry, collider = new SurfaceCollider(), options = { orient: true }) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  if (!normal) geometry.computeVertexNormals();
  const index = geometry.index ? geometry.index.array : Array.from({ length: position.count }, (_, i) => i);
  return collider.add(position.array, geometry.getAttribute('normal').array, index, options);
}

/**
 * Push vertices that lie closer than `thickness` to the surface (or inside
 * it, up to `depth`) back out along the surface normal, then relax the
 * correction across neighbours so the result has no creases. Returns the
 * number of vertices moved.
 */
export function resolvePenetration(positions, index, collider, { thickness = 0.002, depth = 0.04, smoothing = 3, weights = null, normals = null } = {}) {
  const count = positions.length / 3, hit = {};
  const facing = v => normals ? [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]] : null;
  const correction = new Float32Array(count * 3);
  let moved = 0;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (!collider.deepest(x, y, z, depth, thickness, depth, hit, facing(v))) continue;
    const push = thickness - hit.distance;
    if (push <= 0) continue;
    correction[v * 3] = hit.nx * push; correction[v * 3 + 1] = hit.ny * push; correction[v * 3 + 2] = hit.nz * push;
    moved++;
  }
  if (!moved) return 0;
  // Spread corrections to neighbours (never reducing any vertex's own push),
  // so the surface lifts smoothly rather than in single-vertex spikes.
  if (smoothing && index) {
    const neighbours = Array.from({ length: count }, () => []);
    for (let i = 0; i < index.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = index[i + k], b = index[i + (k + 1) % 3];
      neighbours[a].push(b); neighbours[b].push(a);
    }
    for (let pass = 0; pass < smoothing; pass++) {
      const next = correction.slice();
      for (let v = 0; v < count; v++) {
        if (!neighbours[v].length) continue;
        let sx = 0, sy = 0, sz = 0;
        for (const u of neighbours[v]) { sx += correction[u * 3]; sy += correction[u * 3 + 1]; sz += correction[u * 3 + 2]; }
        const m = neighbours[v].length;
        const ax = sx / m, ay = sy / m, az = sz / m;
        if (ax * ax + ay * ay + az * az > next[v * 3] ** 2 + next[v * 3 + 1] ** 2 + next[v * 3 + 2] ** 2) {
          next[v * 3] = (next[v * 3] + ax) / 2; next[v * 3 + 1] = (next[v * 3 + 1] + ay) / 2; next[v * 3 + 2] = (next[v * 3 + 2] + az) / 2;
        }
      }
      correction.set(next);
    }
  }
  for (let v = 0; v < count; v++) {
    const w = weights ? weights[v] : 1;
    positions[v * 3] += correction[v * 3] * w; positions[v * 3 + 1] += correction[v * 3 + 1] * w; positions[v * 3 + 2] += correction[v * 3 + 2] * w;
  }
  // Final exact passes guarantee the thickness after smoothing. With normals,
  // a second check also lifts cloth out of any other body part it has entered
  // (the inside of an arm against the side of the torso).
  // In concave spots (behind the knee, the heel) one push can land inside a
  // neighbouring face, so the exact pass repeats until nothing moves.
  for (let pass = 0; pass < (normals ? 5 : 4); pass++) {
    for (let v = 0; v < count; v++) {
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      const other = normals && pass % 2 === 1;
      if (!collider.deepest(x, y, z, other ? 0.015 : depth, thickness, other ? 0.015 : depth, hit, other ? null : facing(v))) continue;
      const push = thickness - hit.distance;
      if (push > 0) { positions[v * 3] += hit.nx * push; positions[v * 3 + 1] += hit.ny * push; positions[v * 3 + 2] += hit.nz * push; }
    }
  }
  return moved;
}
