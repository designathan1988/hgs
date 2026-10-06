import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshBuilder } from '../src/geometry.mjs';
import { addIsosurface } from '../src/implicit.mjs';

test('an implicit surface follows its signed boundary with outward normals', () => {
  const mesh = new MeshBuilder();
  addIsosurface(mesh, p => Math.hypot(...p) - 0.5, [-0.6, -0.6, -0.6], [0.6, 0.6, 0.6], 0.075, [0.5, 0.4, 0.3], 0.7, 3, () => [0, 0, 0]);
  const result = mesh.finish();
  assert.ok(result.triangles > 400);
  for (let i = 0; i < result.vertices.length; i += 14) {
    const p = Array.from(result.vertices.slice(i, i + 3));
    const n = Array.from(result.vertices.slice(i + 3, i + 6));
    assert.ok(Math.abs(Math.hypot(...p) - 0.5) < 0.02);
    assert.ok(p.reduce((sum, value, axis) => sum + value * n[axis], 0) > 0);
  }
});
