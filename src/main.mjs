import { sculptNdc } from './sculpt.mjs';
import { Renderer } from './renderer-three.mjs';
import { StudioUI } from './ui.mjs';

const canvas = document.getElementById('stage');
const ui = new StudioUI();
let renderer;
let drag = null;
const sculptHit = event => renderer?.sculpt.hit(sculptNdc(event, canvas), renderer.viewCamera);
const held = new Set();
window.addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
// Navigation (as in 3ds Max): the wheel zooms, the middle button (wheel
// pressed) pans and Alt + middle button orbits around the character. While editing hair or
// sculpting, the left button belongs to the tool and never moves the camera;
// elsewhere a left drag also orbits.
canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 1) {
    event.preventDefault();
    // Orbit around the point under the cursor (around the view centre over empty space).
    const pivot = event.altKey ? renderer?.pivotAt(sculptNdc(event, canvas)) : null;
    drag = { x: event.clientX, y: event.clientY, pan: !event.altKey, pivot };
    return;
  }
  if (event.button !== 0) { drag = null; return; }
  if (ui.locking) {
    const editor = renderer.lockEditor, ndc = sculptNdc(event, canvas);
    drag = editor.pointerDown(ndc, renderer.viewCamera, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }) ? { locks: true } : null;
    return;
  }
  if (ui.sculpting) {
    const hit = sculptHit(event);
    drag = null;
    if (hit) {
      const settings = renderer.sculpt.settings, invert = settings.invert;
      if (event.ctrlKey || event.metaKey) settings.invert = !invert;
      renderer.sculpt.begin(hit, sculptNdc(event, canvas), renderer.viewCamera);
      drag = { sculpt: true, restoreInvert: invert };
    }
    return;
  }
  drag = { x: event.clientX, y: event.clientY, pan: false };
});
canvas.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
canvas.addEventListener('auxclick', event => event.preventDefault());
canvas.addEventListener('pointermove', event => {
  if (!renderer) return;
  if (ui.sculpting && !drag?.x) renderer.sculpt.showCursor(sculptHit(event), renderer.viewCamera);
  if (ui.locking && !drag) renderer.lockEditor.hover(sculptNdc(event, canvas), renderer.viewCamera);
  if (drag?.locks) { renderer.lockEditor.pointerMove(sculptNdc(event, canvas), renderer.viewCamera); return; }
  if (drag?.sculpt) { renderer.sculpt.move(sculptNdc(event, canvas), renderer.viewCamera); return; }
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (drag.pan) renderer.camera.pan(dx, dy); else renderer.camera.orbit(dx, dy, drag.pivot);
  drag.x = event.clientX; drag.y = event.clientY;
});
const release = () => {
  if (drag?.locks) renderer.lockEditor.pointerUp({ pin: held.has('p') });
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
// Alt belongs to orbiting: it must not open the browser's menu bar.
window.addEventListener('keyup', event => { if (event.key === 'Alt') event.preventDefault(); });
window.addEventListener('keydown', event => {
  if (event.key === 'Alt') event.preventDefault();
  const typing = event.target.matches?.('input[type=text], input[type=number], input:not([type]), textarea, select');
  if (!typing) held.add(event.key.toLowerCase());
  if (typing) return;
  const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
  if (ui.locking) {
    const editor = renderer.lockEditor;
    if (command && key === 'z' && !event.shiftKey) { event.preventDefault(); editor.undo(); return; }
    if (command && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); editor.redo(); return; }
    if (key === 'delete') { event.preventDefault(); editor.deleteSelected(); return; }
    if (!command && (key === '+' || key === '=')) { event.preventDefault(); editor.scaleLength(1.1); return; }
    if (!command && (key === '-' || key === '_')) { event.preventDefault(); editor.scaleLength(1 / 1.1); return; }
  }
  if (ui.sculpting && command) {
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); ui.undoSculpt(); }
    else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); ui.redoSculpt(); }
  }
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => { event.preventDefault(); renderer?.camera.zoom(event.deltaY); }, { passive: false });

try {
  renderer = await Renderer.create(canvas, message => ui.fail(message));
  ui.attachRenderer(renderer);
  // Handle for inspecting the editor from the browser console.
  window.__studio = { ui, renderer };
  let last = performance.now(), bucketStart = last, frames = 0, aggregate = 0;
  function frame(now) {
    const delta = Math.min(100, now - last); last = now;
    try {
      const stats = renderer.render(now / 1000);
      if (stats) {
        frames++; aggregate += delta;
        if (now - bucketStart >= 450) {
          ui.updateStats({ ...stats, fps: Math.round(frames * 1000 / aggregate), frameTime: aggregate / frames });
          frames = 0; aggregate = 0; bucketStart = now;
        }
      }
      requestAnimationFrame(frame);
    } catch (error) { ui.fail(error.message); console.error(error); }
  }
  requestAnimationFrame(frame);
} catch (error) { ui.fail(error.message); console.error(error); }
