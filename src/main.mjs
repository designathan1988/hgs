import { sculptNdc } from './sculpt.mjs';
import { Renderer } from './renderer-three.mjs';
import { StudioUI } from './ui.mjs';

const canvas = document.getElementById('stage');
const ui = new StudioUI();
let renderer;
let drag = null;
const sculptHit = event => renderer?.sculpt.hit(sculptNdc(event, canvas), renderer.viewCamera);
const groomPoint = event => {
  const rect = canvas.getBoundingClientRect();
  return { ndc: sculptNdc(event, canvas), pixel: { x: event.clientX - rect.left, y: event.clientY - rect.top, clone() { return { ...this }; } } };
};
const held = new Set();
window.addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId);
  // In Groom, a left press on hair or a handle uses the current tool.
  if (ui.grooming && event.button === 0 && !event.altKey) {
    const { ndc, pixel } = groomPoint(event);
    if (renderer.groom.pointerDown(ndc, pixel, renderer.viewCamera, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey })) { drag = { groom: true }; return; }
  }
  // In Sculpt, a left drag that starts on the model is a brush stroke.
  if (ui.sculpting && event.button === 0 && !event.shiftKey && !event.altKey) {
    const hit = sculptHit(event);
    if (hit) {
      const settings = renderer.sculpt.settings, invert = settings.invert;
      if (event.ctrlKey || event.metaKey) settings.invert = !invert;
      renderer.sculpt.begin(hit, sculptNdc(event, canvas), renderer.viewCamera);
      drag = { sculpt: true, restoreInvert: invert };
      return;
    }
  }
  drag = { x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button === 1 || event.button === 2 };
});
canvas.addEventListener('pointermove', event => {
  if (!renderer) return;
  if (ui.sculpting && !drag?.x) renderer.sculpt.showCursor(sculptHit(event), renderer.viewCamera);
  if (drag?.sculpt) { renderer.sculpt.move(sculptNdc(event, canvas), renderer.viewCamera); return; }
  if (ui.grooming && (drag?.groom || !drag)) { const { ndc, pixel } = groomPoint(event); renderer.groom.pointerMove(ndc, pixel, renderer.viewCamera); if (drag?.groom) return; }
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (drag.pan) renderer.camera.pan(dx, dy); else renderer.camera.orbit(dx, dy);
  drag.x = event.clientX; drag.y = event.clientY;
});
const release = () => {
  if (drag?.groom) renderer.groom.pointerUp({ pin: held.has('p') });
  if (drag?.sculpt) {
    const target = renderer.sculpt.end();
    renderer.sculpt.settings.invert = drag.restoreInvert;
    ui.commitSculpt(target);
  }
  drag = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => { if (renderer && !drag) renderer.sculpt.cursor.visible = false; });
window.addEventListener('keydown', event => {
  if (!event.target.matches?.('input, textarea, select')) held.add(event.key.toLowerCase());
  if (ui.grooming && (event.ctrlKey || event.metaKey)) {
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); renderer.groom.undo(); return; }
    if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); renderer.groom.redo(); return; }
  }
  if (!ui.sculpting || !(event.ctrlKey || event.metaKey) || event.target.matches('input[type=text], textarea')) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) { event.preventDefault(); ui.undoSculpt(); }
  else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); ui.redoSculpt(); }
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => { event.preventDefault(); renderer?.camera.zoom(event.deltaY); }, { passive: false });

try {
  renderer = await Renderer.create(canvas, message => ui.fail(message));
  ui.attachRenderer(renderer);
  let last = performance.now(), bucketStart = last, frames = 0, aggregate = 0;
  function frame(now) {
    const delta = Math.min(100, now - last); last = now;
    try {
      const stats = renderer.render(now / 1000);
      if (stats) {
        frames++; aggregate += delta;
        if (now - bucketStart >= 450) {
          const fps = Math.round(frames * 1000 / aggregate);
          ui.updateStats({ fps, frameTime: `${(aggregate / frames).toFixed(1)} ms`, vertices: stats.vertices.toLocaleString(), triangles: stats.triangles.toLocaleString(), drawCalls: stats.draws, visible: stats.visible, skeletons: stats.skeletons, faces: stats.faces, lod: stats.lod });
          frames = 0; aggregate = 0; bucketStart = now;
        }
      }
      requestAnimationFrame(frame);
    } catch (error) { ui.fail(error.message); console.error(error); }
  }
  requestAnimationFrame(frame);
} catch (error) { ui.fail(error.message); console.error(error); }
