export const PI = Math.PI;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const mix = (a, b, t) => a + (b - a) * t;
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(...a);
export const norm = a => scale(a, 1 / (length(a) || 1));
export const m4identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function m4mul(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}
export function m4translation(x, y, z) { const m = m4identity(); m[12] = x; m[13] = y; m[14] = z; return m; }
export function m4rotationX(a) { const m = m4identity(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
export function m4rotationY(a) { const m = m4identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
export function m4rotationZ(a) { const m = m4identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
export function around(p, rotation) { return m4mul(m4translation(...p), m4mul(rotation, m4translation(-p[0], -p[1], -p[2]))); }
export function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), out = new Float32Array(16);
  out[0] = f / aspect; out[5] = f; out[10] = far / (near - far); out[11] = -1; out[14] = far * near / (near - far);
  return out;
}
export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x), out = m4identity();
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2]; out[12] = -dot(x, eye);
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2]; out[13] = -dot(y, eye);
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2]; out[14] = -dot(z, eye);
  return out;
}
export function hexColor(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
export const shade = (c, f) => c.map(v => clamp(v * f, 0, 1));
