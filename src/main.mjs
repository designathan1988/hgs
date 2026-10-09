import { sculptNdc } from './sculpt.mjs';
import { Renderer } from './renderer-three.mjs';
import { StudioUI, restoredSession } from './ui.mjs';
import { Store, createState } from './store.mjs';

const canvas = document.getElementById('stage');
// The global state starts from the last session's character and panel preferences.
const store = new Store(createState(restoredSession()));
const ui = new StudioUI(store);
let renderer;
let drag = null;
const sculptHit = event => renderer?.sculpt.hit(sculptNdc(event, canvas), renderer.viewCamera);
const held = new Set();
window.addEventListener('keyup', event => { held.delete(event.key.toLowerCase()); if (renderer) renderer.lockEditor.fixHeld = held.has('f'); });
// Navigation: the wheel zooms towards the point under the cursor, the middle
// button (wheel pressed) pans and the right button orbits around the point
// under the cursor (Blender's Auto Depth / Zoom to Mouse Position). While editing hair or
// sculpting, the left button belongs to the tool and never moves the camera;
// elsewhere a left drag also orbits.
canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 1 || event.button === 2) {
    event.preventDefault();
    // Right button: orbit around the point under the cursor (the view centre over empty space).
    const orbit = event.button === 2;
    const pivot = orbit && renderer ? renderer.pivotAt(sculptNdc(event, canvas)) ?? renderer.camera.target.clone() : null;
    drag = { x: event.clientX, y: event.clientY, pan: !orbit, pivot };
    return;
  }
  if (event.button !== 0) { drag = null; return; }
  // Tattoo tool (Corpo → Tatuagens): a click on the skin places the chosen design there.
  if (ui.tattooingSkin) { ui.placeTattoo(renderer.bodyUVAt(sculptNdc(event, canvas))); drag = null; return; }
  // Posing: the gizmo (TransformControls, its own listener) owns the pointer when it is under the cursor.
  if (ui.posing && renderer.poseEditor.grabs(event)) { drag = null; return; }
  // Posing: a press on an orange IK handle drags the hand or foot directly.
  if (ui.posing && renderer.poseEditor.grabHandle(sculptNdc(event, canvas))) { drag = { pose: true }; return; }
  // Moldar: a press on the body pulls it into shape; elsewhere the left button still orbits.
  if (ui.molding && renderer.shapeHandles.begin(sculptNdc(event, canvas), key => ui.morphValue(key))) { drag = { mold: true }; return; }
  if (ui.pinning) {
    ui.pinCloth(sculptNdc(event, canvas), renderer.viewCamera); drag = null; return;
  }
  if (ui.tailoring) {
    // Clothes: drag an edge of the garment under the cursor (hem, sleeve, neckline, waistband, legs).
    ui.pickGarment(renderer.clothEditor.garmentAt(sculptNdc(event, canvas), renderer.viewCamera));
    drag = renderer.clothEditor.down(sculptNdc(event, canvas), renderer.viewCamera, event.clientY) ? { cloth: true } : null;
    if (drag) ui.clothEdgeStart();
    return;
  }
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
  drag = { x: event.clientX, y: event.clientY, pan: false, startX: event.clientX, startY: event.clientY, ndc: sculptNdc(event, canvas) };
});
canvas.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
canvas.addEventListener('auxclick', event => event.preventDefault());
// The hair brushes' circle follows the cursor.
const combRing = document.createElement('div');
combRing.style.cssText = 'position:fixed;pointer-events:none;border:1.5px solid rgba(255,255,255,.75);border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.35);display:none;z-index:5';
document.body.append(combRing);
const ringTools = new Set(['fill', 'retouch', 'volume', 'erase']);
function showRing(event) {
  // The circle marks the hair a brush takes (radius in NDC height units: its diameter is radius × viewport height).
  const editor = renderer?.lockEditor, tool = editor?.settings.tool;
  const on = Boolean(ui.locking && ringTools.has(tool));
  combRing.style.display = on ? 'block' : 'none';
  if (!on) return;
  const size = editor.settings.radius * canvas.getBoundingClientRect().height;
  combRing.style.width = combRing.style.height = `${size}px`;
  combRing.style.left = `${event.clientX - size / 2}px`; combRing.style.top = `${event.clientY - size / 2}px`;
}
canvas.addEventListener('pointerleave', () => {
  combRing.style.display = 'none';
  if (renderer && !drag) { renderer.shapeHandles.highlight(null); renderer.shapeHandles.hoverVertex = undefined; }
});
canvas.addEventListener('pointermove', event => {
  if (!renderer) return;
  showRing(event);
  if (ui.sculpting && !drag?.x) renderer.sculpt.showCursor(sculptHit(event), renderer.viewCamera);
  if (ui.locking && !drag) renderer.lockEditor.hover(sculptNdc(event, canvas), renderer.viewCamera);
  if (ui.molding && !drag) renderer.shapeHandles.hover(sculptNdc(event, canvas));
  if (drag?.locks) { renderer.lockEditor.pointerMove(sculptNdc(event, canvas), renderer.viewCamera, { alt: event.altKey }); return; }
  if (drag?.pose) { renderer.poseEditor.dragHandle(sculptNdc(event, canvas)); return; }
  if (drag?.mold) { ui.moldTo(renderer.shapeHandles.move(sculptNdc(event, canvas), { single: event.altKey })); return; }
  if (drag?.cloth) { ui.clothEdgeMove(renderer.clothEditor.move(event.clientY, canvas.clientHeight)); return; }
  if (drag?.sculpt) { renderer.sculpt.move(sculptNdc(event, canvas), renderer.viewCamera); return; }
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!dx && !dy) return;
  // The camera leaves the view chosen in the toolbar.
  ui.viewMoved();
  if (drag.pan) renderer.camera.pan(dx, dy); else renderer.camera.orbit(dx, dy, drag.pivot);
  drag.x = event.clientX; drag.y = event.clientY;
});
const release = event => {
  // A click (no drag) on a made-to-measure garment selects that piece.
  if (drag?.ndc && ui.dressing && event && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) ui.pickGarment(renderer.clothEditor.garmentAt(drag.ndc, renderer.viewCamera));
  // A click (no drag) while posing picks the bone or IK handle under the cursor.
  if (drag?.ndc && ui.posing && event && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) renderer.poseEditor.pick(drag.ndc);
  if (drag?.pose) renderer.poseEditor.releaseHandle();
  if (drag?.locks) renderer.lockEditor.pointerUp();
  if (drag?.mold) { renderer.shapeHandles.end(); ui.commitLive(); }
  if (drag?.cloth) ui.clothEdgeEnd(renderer.clothEditor.up());
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
  const typing = event.target.matches?.('input[type=text], input[type=number], input:not([type]), textarea, select');
  if (!typing) held.add(event.key.toLowerCase());
  if (typing) return;
  const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
  // One history for the whole studio: the store sends it to the hair editor while it is open.
  if (command && key === 'z' && !event.shiftKey) { event.preventDefault(); if (!drag) store.undo(); return; }
  if (command && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); if (!drag) store.redo(); return; }
  if (ui.locking) {
    const editor = renderer.lockEditor;
    if (key === 'delete' || key === 'backspace') { event.preventDefault(); editor.deleteSelected(); return; }
    // One key per hair tool (the letters in the tool tooltips).
    const tool = !command && !event.repeat && { b: 'brush', f: 'fill', r: 'retouch', c: 'cut', e: 'erase', v: 'volume', s: 'select' }[key];
    if (tool && !drag) { ui.pickTool(tool); return; }
    // [ and ] resize the brush circle (Photoshop, Krita).
    if (!command && (key === '[' || key === ']')) { editor.settings.radius = Math.max(0.02, Math.min(0.6, editor.settings.radius * (key === ']' ? 1.15 : 1 / 1.15))); ui.scheduleRender(); return; }
    if (!command && (key === '+' || key === '=')) { event.preventDefault(); editor.scaleLength(1.1); return; }
    if (!command && (key === '-' || key === '_')) { event.preventDefault(); editor.scaleLength(1 / 1.1); return; }
  }
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  if (renderer) { renderer.camera.zoomAt(event.deltaY, renderer.pointUnder(sculptNdc(event, canvas))); ui.viewMoved(); }
}, { passive: false });

try {
  renderer = await Renderer.create(canvas, message => ui.fail(message));
  ui.attachRenderer(renderer);
  // Handle for inspecting the editor from the browser console.
  window.__studio = { ui, renderer, store };
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
