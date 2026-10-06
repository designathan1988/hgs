/**
 * Cloth draping with XPBD (Macklin, Müller & Chentanez 2016, on Müller et al.
 * 2006 position based dynamics): each substep predicts positions under
 * gravity, projects stretch and bending distance constraints with compliance
 * α̃ = α/Δt² (Δλ = (−C − α̃λ)/(w₁ + w₂ + α̃)), keeps every particle at least
 * `thickness` outside the collider, and applies friction to particles in
 * contact by cancelling most of their tangential motion.
 *
 * Rest lengths come from the garment's starting shape scaled by `slack`:
 * below 1 the fabric is under tension and bridges hollows (it does not sink
 * into the navel or between the breasts); above 1 it is loose and folds under
 * gravity.
 */
export function drapeCloth(positions, index, collider, {
  thickness = 0.003, slack = 1, stretchCompliance = 1e-7, bendCompliance = 2e-4, gravity = -9.81,
  frames = 36, substeps = 6, friction = 0.85, pinned = null, damping = 0.985, radius = 0.06, elastic = null, elasticity = 0.92, normals = null, rest = null,
} = {}) {
  const count = positions.length / 3;
  const x = Float32Array.from(positions), previous = Float32Array.from(positions), velocity = new Float32Array(count * 3);
  const inverseMass = new Float32Array(count).fill(1);
  if (pinned) for (let v = 0; v < count; v++) if (pinned[v]) inverseMass[v] = 0;
  // Stretch constraints on edges, bending constraints across shared edges.
  const edges = new Map(), opposite = new Map();
  const edgeKey = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
  for (let i = 0; i < index.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = index[i + k], b = index[i + (k + 1) % 3], c = index[i + (k + 2) % 3];
    const key = edgeKey(a, b);
    edges.set(key, [a, b]);
    if (!opposite.has(key)) opposite.set(key, []);
    opposite.get(key).push(c);
  }
  const constraints = [];
  // Rest shape: the drafted pattern when given, otherwise the starting shape.
  const r = rest ?? x;
  const length = (a, b) => Math.hypot(r[a * 3] - r[b * 3], r[a * 3 + 1] - r[b * 3 + 1], r[a * 3 + 2] - r[b * 3 + 2]);
  for (const [key, [a, b]] of edges) {
    // Elastic bands (waistbands, cuffs) are cut shorter so they grip.
    const band = elastic && elastic[a] && elastic[b] ? elasticity : 1;
    constraints.push(a, b, length(a, b) * slack * band, stretchCompliance);
    const across = opposite.get(key);
    if (across.length === 2) {
      // Fabric is flat at rest: the bending rest length is the distance
      // between the two opposite vertices with the triangle pair unfolded
      // into a plane, so stiffness smooths small bumps instead of keeping them.
      const [c, d] = across;
      const ex = r[b * 3] - r[a * 3], ey = r[b * 3 + 1] - r[a * 3 + 1], ez = r[b * 3 + 2] - r[a * 3 + 2];
      const el = Math.hypot(ex, ey, ez) || 1e-9;
      const flat = point => {
        const px = r[point * 3] - r[a * 3], py = r[point * 3 + 1] - r[a * 3 + 1], pz = r[point * 3 + 2] - r[a * 3 + 2];
        const along = (px * ex + py * ey + pz * ez) / el;
        const cx = py * ez - pz * ey, cy = pz * ex - px * ez, cz = px * ey - py * ex;
        return [along, Math.hypot(cx, cy, cz) / el];
      };
      const [ca, ch] = flat(c), [da, dh] = flat(d);
      constraints.push(c, d, Math.hypot(ca - da, ch + dh) * slack, bendCompliance);
    }
  }
  const n = constraints.length / 4;
  const lambda = new Float32Array(n);
  const dt = 1 / 60 / substeps;
  const contact = new Uint8Array(count), hit = {};
  const surface = new Float32Array(count * 4); // cached contact plane per frame: normal + offset
  const hasPlane = new Uint8Array(count);
  for (let frame = 0; frame < frames; frame++) {
    // Contact planes are refreshed once per frame (Müller et al.: collision
    // constraints are generated outside the solver loop).
    hasPlane.fill(0);
    for (let v = 0; v < count; v++) {
      const facing = normals ? [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]] : null;
      if (!collider.deepest(x[v * 3], x[v * 3 + 1], x[v * 3 + 2], radius, thickness, radius * 0.6, hit, facing)) continue;
      if (hit.distance > radius * 0.75) continue;
      surface[v * 4] = hit.nx; surface[v * 4 + 1] = hit.ny; surface[v * 4 + 2] = hit.nz;
      surface[v * 4 + 3] = hit.x * hit.nx + hit.y * hit.ny + hit.z * hit.nz + thickness;
      hasPlane[v] = 1;
    }
    for (let step = 0; step < substeps; step++) {
      for (let v = 0; v < count; v++) {
        if (!inverseMass[v]) continue;
        velocity[v * 3 + 1] += gravity * dt;
        for (let k = 0; k < 3; k++) {
          velocity[v * 3 + k] *= damping;
          previous[v * 3 + k] = x[v * 3 + k];
          x[v * 3 + k] += velocity[v * 3 + k] * dt;
        }
      }
      lambda.fill(0);
      const alphaScale = 1 / (dt * dt);
      for (let i = 0; i < n; i++) {
        const a = constraints[i * 4], b = constraints[i * 4 + 1], rest = constraints[i * 4 + 2];
        const wa = inverseMass[a], wb = inverseMass[b], w = wa + wb;
        if (!w) continue;
        const dx = x[a * 3] - x[b * 3], dy = x[a * 3 + 1] - x[b * 3 + 1], dz = x[a * 3 + 2] - x[b * 3 + 2];
        const length = Math.hypot(dx, dy, dz);
        if (length < 1e-9) continue;
        const alpha = constraints[i * 4 + 3] * alphaScale;
        const C = length - rest;
        const delta = (-C - alpha * lambda[i]) / (w + alpha);
        lambda[i] += delta;
        const sx = dx / length * delta, sy = dy / length * delta, sz = dz / length * delta;
        x[a * 3] += sx * wa; x[a * 3 + 1] += sy * wa; x[a * 3 + 2] += sz * wa;
        x[b * 3] -= sx * wb; x[b * 3 + 1] -= sy * wb; x[b * 3 + 2] -= sz * wb;
      }
      // Collision: C(p) = n·p − (n·q + thickness) ≥ 0, projected with stiffness 1.
      for (let v = 0; v < count; v++) {
        contact[v] = 0;
        if (!hasPlane[v] || !inverseMass[v]) continue;
        const nx = surface[v * 4], ny = surface[v * 4 + 1], nz = surface[v * 4 + 2];
        const C = x[v * 3] * nx + x[v * 3 + 1] * ny + x[v * 3 + 2] * nz - surface[v * 4 + 3];
        if (C >= 0) continue;
        x[v * 3] -= nx * C; x[v * 3 + 1] -= ny * C; x[v * 3 + 2] -= nz * C;
        contact[v] = 1;
      }
      for (let v = 0; v < count; v++) {
        if (!inverseMass[v]) { velocity[v * 3] = velocity[v * 3 + 1] = velocity[v * 3 + 2] = 0; continue; }
        let vx = (x[v * 3] - previous[v * 3]) / dt, vy = (x[v * 3 + 1] - previous[v * 3 + 1]) / dt, vz = (x[v * 3 + 2] - previous[v * 3 + 2]) / dt;
        if (contact[v]) {
          // Friction: keep the normal component, damp the tangential one.
          const nx = surface[v * 4], ny = surface[v * 4 + 1], nz = surface[v * 4 + 2];
          const vn = vx * nx + vy * ny + vz * nz;
          const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
          vx = vn * nx + tx * (1 - friction); vy = vn * ny + ty * (1 - friction); vz = vn * nz + tz * (1 - friction);
          if (vn < 0) { vx -= vn * nx; vy -= vn * ny; vz -= vn * nz; }
        }
        velocity[v * 3] = vx; velocity[v * 3 + 1] = vy; velocity[v * 3 + 2] = vz;
      }
    }
  }
  positions.set(x);
  return positions;
}
