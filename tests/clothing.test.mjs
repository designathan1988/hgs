import test from 'node:test';
import assert from 'node:assert/strict';
import { SphereGeometry } from 'three';
import { SurfaceCollider, resolvePenetration, colliderFromGeometry } from '../src/collision.mjs';
import { drapeCloth } from '../src/cloth.mjs';
import { createHuman } from '../src/human-three.mjs';
import { newGarment } from '../src/tailor.mjs';

const skinCollider = human => {
  const p = human.body.geometry.getAttribute('position'), n = human.body.geometry.getAttribute('normal');
  const index = [];
  for (let f = 0; f < p.count / 4; f++) index.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  return new SurfaceCollider(0.012).add(p.array, n.array, index);
};
const inside = (geometry, collider) => {
  const p = geometry.getAttribute('position'), hit = {};
  let count = 0;
  for (let i = 0; i < p.count; i++) if (collider.closest(p.getX(i), p.getY(i), p.getZ(i), 0.03, hit) && hit.distance < -0.0025) count++;
  return count;
};

test('penetrating points are pushed out to the collision thickness', () => {
  const sphere = new SphereGeometry(0.1, 48, 32);
  const collider = colliderFromGeometry(sphere, new SurfaceCollider(0.01), { orient: false });
  const points = new Float32Array([0.05, 0, 0, 0, 0.098, 0, 0, 0, 0.2]);
  resolvePenetration(points, null, collider, { thickness: 0.004, depth: 0.08, smoothing: 0 });
  assert.ok(Math.hypot(points[0], points[1], points[2]) > 0.1035, 'a point inside ends outside');
  assert.ok(Math.hypot(points[3], points[4], points[5]) > 0.1035, 'a point on the surface gains the thickness');
  assert.ok(Math.abs(points[8] - 0.2) < 1e-6, 'free points are untouched');
});

test('draped cloth stays finite and outside the collider', () => {
  const ball = new SphereGeometry(0.1, 40, 24);
  const collider = colliderFromGeometry(ball, new SurfaceCollider(0.01), { orient: false });
  // A 10 × 10 sheet dropped onto the ball.
  const size = 10, points = [], index = [];
  for (let i = 0; i <= size; i++) for (let j = 0; j <= size; j++) points.push(-0.15 + 0.3 * i / size, 0.11, -0.15 + 0.3 * j / size);
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    const a = i * (size + 1) + j, b = a + 1, c = a + size + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const positions = Float32Array.from(points);
  drapeCloth(positions, index, collider, { thickness: 0.003, frames: 40, substeps: 4, radius: 0.05 });
  assert.ok(positions.every(Number.isFinite));
  for (let v = 0; v < positions.length / 3; v++) assert.ok(Math.hypot(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]) > 0.1, 'no particle inside the ball');
  assert.ok(positions[1] < 0.11, 'the corners sag under gravity');
});

test('tailored garments have smooth cut edges and never enter the skin', async () => {
  const human = await createHuman({ ageYears: 30, gender: 0.2, heightMeters: 1.7, clothing: { style: 'tailor', garments: [newGarment('tshirt'), newGarment('pants')] }, hair: { style: 'none' } });
  const outfit = human.group.getObjectByName('Outfit').geometry;
  assert.equal(inside(outfit, skinCollider(human)), 0);
  // Open edges follow the pattern's contour: almost no right-angle steps.
  const index = outfit.index.array, p = outfit.getAttribute('position'), uses = new Map(), next = new Map();
  for (let i = 0; i < index.length; i += 3) for (let e = 0; e < 3; e++) {
    const a = index[i + e], b = index[i + (e + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    uses.set(key, (uses.get(key) ?? 0) + 1); next.set(`${a}>${b}`, true);
  }
  const boundary = new Map();
  for (const [key, count] of uses) if (count === 1) { const [a, b] = key.split(':').map(Number); (boundary.get(a) ?? boundary.set(a, []).get(a)).push(b); (boundary.get(b) ?? boundary.set(b, []).get(b)).push(a); }
  const turns = [];
  for (const [v, list] of boundary) if (list.length === 2) {
    const [a, b] = list;
    const u = [p.getX(v) - p.getX(a), p.getY(v) - p.getY(a), p.getZ(v) - p.getZ(a)], w = [p.getX(b) - p.getX(v), p.getY(b) - p.getY(v), p.getZ(b) - p.getZ(v)];
    if (Math.hypot(...u) < 0.002 || Math.hypot(...w) < 0.002) continue;
    const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w) || 1);
    turns.push(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI);
  }
  turns.sort((a, b) => a - b);
  assert.ok(turns.length > 50);
  assert.ok(turns[Math.floor(turns.length * 0.9)] < 45, `90% of edge turns under 45° (got ${turns[Math.floor(turns.length * 0.9)].toFixed(1)}°)`);
  human.dispose();
});

test('ready-made outfits, shoes and hair are layered outside the skin', async () => {
  const human = await createHuman({ ageYears: 30, gender: 0.8, heightMeters: 1.8, clothing: { style: 'male_casualsuit02', color: 0x334455 }, hair: { style: 'short02' } });
  const collider = skinCollider(human);
  for (const name of ['Outfit', 'Hair']) assert.equal(inside(human.group.getObjectByName(name).geometry, collider), 0, `${name} stays outside`);
  human.dispose();
});

test('a garment edge dragged on the body: the right edge is picked and the preview field moves', async () => {
  const { garmentEdgeAt, garmentField, bodyLayout } = await import('../src/tailor.mjs');
  const human = await createHuman({ seed: 42, gender: 0, ageYears: 28, heightMeters: 1.72, hair: { style: 'none' }, clothing: { style: 'tailor', garments: [newGarment('tshirt'), newGarment('pants')] } });
  const context = human.context;
  context.body ??= human.body;
  const layout = bodyLayout(context), P = context.positions, count = P.length / 3;
  const tshirt = newGarment('tshirt'), pants = newGarment('pants');
  // A vertex on the forearm, on the lower neck, on the belly and on the shin.
  const find = test => { for (let v = 0; v < count; v++) if (test(v, P[v * 3], P[v * 3 + 1], P[v * 3 + 2])) return v; return -1; };
  const arm = find(v => layout.armW[v] > 0.9 && layout.arm[v] > layout.arms.l.l1 * 1.15 && layout.arm[v] < layout.arms.l.l1 + 0.7 * layout.arms.l.l2);
  const neck = find((v, x, y, z) => Math.abs(x) < 0.01 && z > 0 && y > (layout.chestY + layout.neckY) / 2 && y < layout.neckY && layout.headW[v] < 0.1);
  const belly = find((v, x, y, z) => Math.abs(x) < 0.01 && z > 0 && Math.abs(y - (layout.waistY + layout.hipY) / 2) < 0.02);
  const shin = find(v => layout.legW[v] > 0.9 && layout.leg[v] > layout.legs.l.l1 * 1.3);
  assert.equal(garmentEdgeAt(context, tshirt, arm).key, 'sleeve');
  assert.equal(garmentEdgeAt(context, tshirt, neck).key, 'neckline');
  assert.equal(garmentEdgeAt(context, tshirt, belly).key, 'length');
  assert.equal(garmentEdgeAt(context, pants, shin).key, 'leg');
  // Longer sleeves cover the forearm; shorter trousers uncover the shin.
  assert.ok(garmentField(context, tshirt)[arm] < 0 && garmentField(context, { ...tshirt, sleeve: 1 })[arm] > 0, 'sleeve reaches the forearm');
  assert.ok(garmentField(context, pants)[shin] > 0 && garmentField(context, { ...pants, leg: 0.3 })[shin] < 0, 'short legs uncover the shin');
});

test('every garment type can be made: it is built, stays outside the skin and is picked by clicking it', async () => {
  const { garmentTypes } = await import('../src/tailor.mjs');
  for (const type of garmentTypes) {
    const garment = newGarment(type);
    // A free garment starts empty: paint a patch on the belly to make it.
    if (type === 'paint') {
      const probe = await createHuman({ ageYears: 30, gender: 0.2, heightMeters: 1.7, clothing: { style: 'none' }, hair: { style: 'none' } });
      const P = probe.context.positions;
      for (let v = 0; v < P.length / 3; v++) if (P[v * 3 + 2] > 0.05 && Math.abs(P[v * 3]) < 0.1 && P[v * 3 + 1] > 0.95 && P[v * 3 + 1] < 1.2) garment.paint[v] = 1;
      probe.dispose();
      assert.ok(Object.keys(garment.paint).length > 20, 'a patch was painted');
    }
    const human = await createHuman({ ageYears: 30, gender: 0.2, heightMeters: 1.7, clothing: { style: 'tailor', garments: [newGarment('tank'), garment] }, hair: { style: 'none' } });
    const outfit = human.group.getObjectByName('Outfit')?.geometry;
    assert.ok(outfit && outfit.index.count > 30, `${type}: a garment mesh is built`);
    assert.equal(inside(outfit, skinCollider(human)), 0, `${type}: nothing inside the skin`);
    const of = outfit.userData.garmentOf;
    assert.equal(of.length, outfit.getAttribute('position').count, `${type}: every vertex knows its garment`);
    assert.ok(of.includes(1), `${type}: the garment's own vertices are tagged`);
    human.dispose();
  }
});
