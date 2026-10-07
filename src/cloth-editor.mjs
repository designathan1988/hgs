import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh, Raycaster } from 'three';
import { bodyLayout, garmentEdgeAt, garmentField } from './tailor.mjs';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Editing a made-to-measure garment directly on the body: drag one of its
 * edges (hem, sleeve, neckline, waistband, legs) up or down. Cutting and
 * draping a garment takes a couple of seconds, so while dragging the new edge
 * is drawn on the body from the garment's coverage field (its zero contour,
 * as pattern-making tools show a pattern line), and the garment is rebuilt
 * when the mouse is released.
 */
export class ClothEditor {
  constructor(renderer) {
    this.renderer = renderer;
    this.raycaster = new Raycaster();
    this.line = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xffc94d, depthTest: false, transparent: true, opacity: 0.95 }));
    this.line.renderOrder = 30; this.line.visible = false; this.line.frustumCulled = false;
    renderer.scene.add(this.line);
    this.garment = null; this.drag = null;
  }
  get human() { return this.renderer.current; }
  /** The built character's context, with the body mesh the pattern layout reads. */
  get context() { const human = this.human; if (human?.context) human.context.body ??= human.body; return human?.context ?? null; }
  /** Show the edges of `garment` on the body (null hides them). */
  show(garment) { this.garment = garment; this.drag = null; this.refresh(); }
  /** Draw the zero contour of the garment's coverage (the side facing the camera). */
  refresh(garment = this.drag?.preview ?? this.garment) {
    const context = this.context;
    if (!garment || !context) { this.line.visible = false; return; }
    const layout = bodyLayout(context), field = garmentField(context, garment), { data, positions } = context;
    const eye = this.renderer.camera.eye(), k = layout.k, pos = [];
    const cross = (a, b) => {
      const t = field[a] / (field[a] - field[b]), out = [];
      for (let c = 0; c < 3; c++) {
        const n = layout.normals[a * 3 + c] * (1 - t) + layout.normals[b * 3 + c] * t;
        out.push(positions[a * 3 + c] * (1 - t) + positions[b * 3 + c] * t + n * 0.012 * k);
      }
      return out;
    };
    for (const face of layout.faces) {
      const ids = [0, 1, 2, 3].map(c => data.faces[face * 4 + c]);
      const points = [];
      for (let e = 0; e < 4; e++) { const a = ids[e], b = ids[(e + 1) % 4]; if ((field[a] >= 0) !== (field[b] >= 0)) points.push(cross(a, b)); }
      if (points.length < 2) continue;
      const a = ids[0], nx = layout.normals[a * 3], ny = layout.normals[a * 3 + 1], nz = layout.normals[a * 3 + 2];
      if ((eye.x - positions[a * 3]) * nx + (eye.y - positions[a * 3 + 1]) * ny + (eye.z - positions[a * 3 + 2]) * nz < 0) continue;
      for (let s = 0; s + 1 < points.length; s += 2) pos.push(...points[s], ...points[s + 1]);
    }
    this.line.geometry.dispose();
    this.line.geometry = new BufferGeometry();
    this.line.geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.line.visible = pos.length > 0;
  }
  hide() { this.garment = null; this.drag = null; this.line.visible = false; }
  /** The body vertex under the cursor (on the skin or on the clothes over it). */
  vertexAt(ndc, camera) {
    const human = this.human;
    if (!human) return -1;
    const meshes = [human.body, human.group.getObjectByName('Outfit')].filter(Boolean);
    const probes = meshes.map(mesh => { const probe = new Mesh(mesh.geometry, mesh.material); probe.matrixWorld.copy(mesh.matrixWorld); return probe; });
    this.raycaster.setFromCamera(ndc, camera);
    const [hit] = this.raycaster.intersectObjects(probes, false);
    if (!hit) return -1;
    const { positions } = human.context, p = hit.point;
    let best = -1, bestD = Infinity;
    for (let v = 0; v < positions.length / 3; v++) {
      const d = (positions[v * 3] - p.x) ** 2 + (positions[v * 3 + 1] - p.y) ** 2 + (positions[v * 3 + 2] - p.z) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }
  /** Start dragging the edge under the cursor; null when there is none. */
  down(ndc, camera, clientY) {
    if (!this.garment) return null;
    const v = this.vertexAt(ndc, camera);
    const edge = v >= 0 ? garmentEdgeAt(this.context, this.garment, v) : null;
    if (!edge) return null;
    this.drag = { ...edge, start: this.garment[edge.key], y: clientY, value: this.garment[edge.key], preview: this.garment };
    return this.drag;
  }
  /** Moving down lengthens (raises, for the waistband); half the view height is the whole range. */
  move(clientY, height) {
    const drag = this.drag;
    if (!drag) return null;
    drag.value = Math.round(clamp(drag.start + (clientY - drag.y) / (0.5 * height) * drag.sign, 0, 1) * 1000) / 1000;
    drag.preview = { ...this.garment, [drag.key]: drag.value };
    this.refresh();
    return drag;
  }
  /** End the drag: the edge's new value (null if unchanged). */
  up() {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.value === drag.start) { this.refresh(); return null; }
    return { key: drag.key, label: drag.label, value: drag.value };
  }
}
