import { MeshBuilder } from './geometry.mjs';
import { buildHuman } from './human.mjs';
import { randomCharacter, rng } from './state.mjs';
import { hexColor, shade, PI, sub, norm, dot } from './math.mjs';

const ARCHETYPES = [1829, 732, 88103, 42145];
const LOD_LIMITS = [300, 145, 68, 26];

function distantHuman(person, level) {
  const mesh = new MeshBuilder();
  const skin = hexColor(['#f0c9ad', '#dfad8b', '#c98c66', '#b77850', '#97603f', '#75472f', '#563524', '#39261d'][person.skin]);
  const hair = hexColor(['#181514', '#30231e', '#4b3327', '#70503a', '#a1784c', '#c9a977', '#823d2d', '#474343', '#ddd2bf'][person.hairColor]);
  const coat = hexColor(['#45403d', '#293b49', '#a66141', '#94837a', '#292d37', '#75836a'][person.outfit]);
  const pants = hexColor(['#626152', '#343944', '#4d554d', '#4b5361', '#30343c', '#c0a98d'][person.outfit]);
  const sides = level === 4 ? 5 : 7;
  mesh.lathe([[0, 0.92, 0, 0.25, 0.13], [0, 1.15, 0, 0.23, 0.13], [0, 1.46, 0, 0.34, 0.15], [0, 1.57, 0, 0.23, 0.11]], sides, coat, 0.85, 0, 3);
  mesh.tube([[0, 1.55, 0], [0, 1.68, 0]], [0.06, 0.06], sides, skin, 0.63, 0, 1);
  mesh.ellipsoid([0, 1.84, 0], [0.14, 0.207, 0.13], skin, 0.62, 0, 1, sides + 2, 5);
  mesh.ellipsoid([0, 1.955, -0.012], [0.145, 0.085, 0.13], hair, 0.82, 0, 2, sides + 2, 4);
  for (const s of [-1, 1]) {
    mesh.tube([[s * 0.34, 1.48, 0], [s * 0.51, 1.13, 0], [s * 0.57, 0.91, 0]], [0.075, 0.057, 0.043], sides, coat, 0.86, 0, 3);
    mesh.ellipsoid([s * 0.57, 0.83, 0], [0.039, 0.079, 0.025], skin, 0.62, 0, 1, sides, 5);
    mesh.tube([[s * 0.15, 0.91, 0], [s * 0.16, 0.5, 0], [s * 0.17, 0.13, 0]], [0.13, 0.096, 0.082], sides, pants, 0.88, 0, 3);
    mesh.ellipsoid([s * 0.17, 0.07, 0.06], [0.09, 0.06, 0.15], shade(coat, 0.8), 0.73, 0, 3, sides + 2, 5);
  }
  return mesh.finish();
}

export class Crowd {
  constructor(renderer) {
    this.renderer = renderer; this.people = []; this.groups = [];
    for (let level = 0; level < 5; level++) for (let archetype = 0; archetype < (level >= 3 ? 2 : 4); archetype++) {
      const person = randomCharacter(ARCHETYPES[archetype]);
      const mesh = level >= 2 ? distantHuman(person, level) : buildHuman(person, level + 1);
      this.groups.push({ level, archetype, mesh: renderer.uploadMesh(mesh), instanceBuffer: renderer.device.createBuffer({ size: 1000 * 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }), count: 0 });
    }
    this.setCount(0);
  }
  setCount(count) {
    this.people = [];
    const random = rng(179 + count * 31);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996323 + random() * 0.16;
      const radius = 1.6 + Math.sqrt(i + 1) * (count > 250 ? 1.1 : 0.87);
      this.people.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, scale: 0.9 + random() * 0.19, tint: [0.84 + random() * 0.2, 0.82 + random() * 0.22, 0.82 + random() * 0.2], phase: random() * PI * 2, archetype: i % 4 });
    }
    this.count = count;
  }
  update(camera, viewportHeight) {
    const eye = camera.eye(), target = camera.target, forward = norm(sub(target, eye));
    const buckets = new Map(this.groups.map(g => [`${g.level}-${g.archetype}`, []]));
    const counts = [0, 0, 0, 0, 0];
    let visible = 0;
    for (const p of this.people) {
      const d = [p.x - eye[0], 1.1 - eye[1], p.z - eye[2]];
      const distance = Math.hypot(...d);
      const facing = dot(norm(d), forward);
      if (facing < 0.46 || distance > 105) continue;
      const pixels = (2.05 * p.scale / distance) * viewportHeight / (2 * Math.tan(camera.fov / 2));
      const lod = pixels >= LOD_LIMITS[0] ? 0 : pixels >= LOD_LIMITS[1] ? 1 : pixels >= LOD_LIMITS[2] ? 2 : pixels >= LOD_LIMITS[3] ? 3 : 4;
      const archetype = lod >= 3 ? p.archetype % 2 : p.archetype;
      buckets.get(`${lod}-${archetype}`).push(p.x, 0, p.z, p.scale, ...p.tint, p.phase);
      counts[lod]++; visible++;
    }
    for (const g of this.groups) {
      const data = buckets.get(`${g.level}-${g.archetype}`);
      g.count = data.length / 8;
      if (g.count) this.renderer.device.queue.writeBuffer(g.instanceBuffer, 0, new Float32Array(data));
    }
    return { counts, visible };
  }
  render(pass) {
    let draws = 0, triangles = 0;
    for (const g of this.groups) if (g.count) {
      pass.setVertexBuffer(0, g.mesh.buffer);
      pass.setVertexBuffer(1, g.instanceBuffer);
      pass.draw(g.mesh.vertexCount, g.count);
      draws++; triangles += g.mesh.triangles * g.count;
    }
    return { draws, triangles };
  }
}
