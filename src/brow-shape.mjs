const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function browSettings(value = {}) {
  return {
    angle: bounded(value.angle, 0, -25, 25),
    shape: ['natural', 'straight', 'arched', 'angled'].includes(value.shape) ? value.shape : 'natural',
    arch: bounded(value.arch, 0, -1, 1), thickness: bounded(value.thickness, 1, 0.35, 2.1),
    width: bounded(value.width, 1, 0.7, 1.4), height: bounded(value.height, 0, -1, 1),
    density: bounded(value.density, 1, 0, 1),
  };
}

/** Reshape around the authored follicle centreline, symmetrically on each side. */
export function browTransform(roots, settings, surfaceZ) {
  const sides = [-1, 1].map(sign => {
    const side = roots.filter(p => Math.sign(p.x) === sign);
    const xs = side.map(p => Math.abs(p.x));
    const min = Math.min(...xs), max = Math.max(...xs), span = max - min;
    const bins = Array.from({ length: 12 }, () => ({ sum: 0, count: 0 }));
    for (const p of side) {
      const bin = bins[Math.min(11, Math.floor((Math.abs(p.x) - min) / span * 12))];
      bin.sum += p.y; bin.count++;
    }
    const centres = bins.map(bin => bin.count ? bin.sum / bin.count : null);
    for (let i = 0; i < centres.length; i++) if (centres[i] === null) {
      const nearest = bins.map((b, k) => ({ k, distance: b.count ? Math.abs(k - i) : Infinity })).sort((a, b) => a.distance - b.distance)[0].k;
      centres[i] = bins[nearest].sum / bins[nearest].count;
    }
    const lineAt = u => {
      const t = Math.max(0, Math.min(11, u * 12 - 0.5)), i = Math.floor(t);
      return centres[i] + (centres[Math.min(11, i + 1)] - centres[i]) * (t - i);
    };
    return { min, max, span, midX: (min + max) / 2, midY: lineAt(0.5), lineAt };
  });
  const angle = settings.angle * Math.PI / 180;
  return point => {
    const sign = point.x < 0 ? -1 : 1, side = sides[sign < 0 ? 0 : 1];
    const u = Math.max(0, Math.min(1, (Math.abs(point.x) - side.min) / side.span));
    const sourceLine = side.lineAt(u);
    const baseline = side.lineAt(0) + (side.lineAt(1) - side.lineAt(0)) * u;
    let targetLine = sourceLine;
    if (settings.shape === 'straight') targetLine = baseline;
    if (settings.shape === 'arched') targetLine = baseline + side.span * 0.17 * 4 * u * (1 - u);
    if (settings.shape === 'angled') targetLine = baseline + side.span * 0.17 * (u < 0.68 ? u / 0.68 : (1 - u) / 0.32);
    targetLine += settings.arch * side.span * 0.13 * 4 * u * (1 - u);
    const dx = (Math.abs(point.x) - side.midX) * settings.width;
    const dy = targetLine + (point.y - sourceLine) * settings.thickness - side.midY;
    const result = point.clone();
    result.x = sign * (side.midX + dx * Math.cos(angle) - dy * Math.sin(angle));
    result.y = side.midY + dx * Math.sin(angle) + dy * Math.cos(angle) + settings.height * side.span * 0.12;
    result.z = surfaceZ(result.x, result.y, point.z) + 0.00025;
    return result;
  };
}
