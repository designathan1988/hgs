import { blendshapeNames } from './face-rig.mjs';
import { brushes } from './sculpt.mjs';
import { groomTools } from './groom-editor.mjs';
import { hairTextureTypes } from './groom.mjs';
import { garmentTypes, garmentLabels, garmentPatterns, newGarment } from './tailor.mjs';
import { defaultCharacter, randomCharacter, normalizeCharacter, serializePreset, parsePreset, ageHeightReference, skinPalette, hairPalette, eyePalette, topPalette, bottomPalette, outfitNames, hairNames, hairTextureNames, expressionNames, animationNames, lightingNames } from './state.mjs';

const sections = [
  ['Character', '♟', 'Identity and generation'], ['Body', '♙', 'Proportions and build'],
  ['Face', '◕', 'Facial structure'], ['Eyes', '◉', 'Gaze and colour'],
  ['Skin', '◐', 'Tone and surface'], ['Hair', '♧', 'Style and colour'], ['Groom', '✂', 'Scalp, partings, locks and hair physics'],
  ['Clothing', '▣', 'Outfit and palette'], ['Sculpt', '✎', 'Brushes for body, face, hair and clothes'],
  ['Expression', '☺', 'Facial character'],
  ['Pose', '♢', 'Standing attitude'], ['Animation', '↝', 'Motion preview'],
  ['Lighting', '☼', 'Studio ambience'], ['Performance', '▥', 'Crowd diagnostics'], ['Export', '⇪', 'Game-ready GLB'],
];
// These only change playback or lights, so they never rebuild the mesh.
const presentationFields = new Set(['animation', 'animationSpeed', 'lighting', 'expression', 'expressionIntensity']);
const meshFields = new Set(['gender', 'ageYears', 'heightMeters', 'build', 'muscle', 'shoulders', 'waist', 'hips', 'legLength', 'headSize',
  'faceWidth', 'jaw', 'cheek', 'nose', 'eyeSize', 'eyeSpacing', 'skin', 'skinDetail', 'skinRoughness', 'hairStyle', 'hairColor',
  'hairLength', 'eyeColor', 'outfit', 'topColor', 'bottomColor', 'pose',
  'browAngle', 'browShape', 'browArch', 'browThickness', 'browWidth', 'browHeight', 'browDensity',
  'hairTexture', 'hairCurl', 'hairVolume', 'lashLength', 'lashCurl', 'lashDensity']);
const viewLabels = { body: 'Perspective', front: 'Front', side: 'Profile', rear: 'Rear', face: 'Face close-up', crowd: 'Crowd overview' };
const PRESET_PREFIX = 'hgs.preset.';
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const storage = {
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};
const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';

export class StudioUI {
  constructor() {
    this.person = normalizeCharacter(defaultCharacter); this.section = 'Character'; this.undo = []; this.redo = [];
    // Body sculpting shows the body undressed unless the user turns it off.
    this.undressBody = true; this.renderer = null; this.crowdCount = 0; this.stats = null;
    this.body = document.getElementById('inspectorBody');
    this.nav = document.getElementById('sectionNav');
    this.buildNav(); this.bindToolbar(); this.render();
  }
  attachRenderer(renderer) { this.renderer = renderer; this.queueCharacter(); }
  ready(message, error = false) {
    const indicator = document.querySelector('.ready');
    indicator.classList.toggle('ok', !error); indicator.classList.toggle('error', error);
    document.getElementById('readyLabel').textContent = message;
  }
  fail(message) { this.ready('3D error', true); document.getElementById('errorText').textContent = message; document.getElementById('errorPanel').hidden = false; }
  queueCharacter() {
    clearTimeout(this.rebuildTimer);
    this.ready('Generating human…');
    this.rebuildTimer = setTimeout(async () => {
      if (await this.renderer?.setCharacter(this.person)) { this.ready('Ready'); this.updateMeta(); }
    }, 80);
  }
  buildNav() {
    for (const [name, symbol] of sections) {
      const button = el('button', 'nav-item'); button.type = 'button'; button.dataset.section = name;
      button.setAttribute('aria-label', name); button.title = name;
      button.append(el('span', 'nav-icon', symbol), el('span', 'nav-name', name));
      button.querySelector('.nav-icon').setAttribute('aria-hidden', 'true');
      button.addEventListener('click', () => this.setSection(name));
      this.nav.append(button);
    }
  }
  setSection(name) {
    if (this.clothBrush && name !== 'Clothing') this.setClothBrush(null);
    if (this.section === 'Groom' && name !== 'Groom') this.finishGroom();
    if (name === 'Groom' && this.section !== 'Groom') { this.section = name; this.startGroom(); this.render(); return; }
    const wasSculpting = this.section === 'Sculpt';
    this.section = name;
    if (wasSculpting !== (name === 'Sculpt')) {
      const undressed = this.renderer?.undressed;
      this.renderer?.setSculptMode(name === 'Sculpt');
      // Sculpting the body can show it undressed; leaving restores the outfit.
      if (this.renderer && name !== 'Sculpt' && undressed) { this.renderer.undressed = false; this.queueCharacter(); }
      if (this.renderer && name === 'Sculpt' && this.undressBody && this.renderer.sculpt.settings.target === 'body') { this.renderer.undressed = true; this.queueCharacter(); }
    }
    this.render();
  }
  get grooming() { return Boolean(this.renderer) && this.section === 'Groom' && this.renderer.groom.active; }
  /** Enter the Groom editor: the character switches to its custom groom (grown fresh the first time). */
  startGroom() {
    if (!this.renderer) return;
    const groomIndex = hairNames.indexOf('Custom groom');
    this.renderer.groom.onChange = () => { this.updateGroomStatus(); };
    if (this.person.hairStyle !== groomIndex) {
      this.person = normalizeCharacter({ ...this.person, hairStyle: groomIndex });
      this.renderer.groomMode = true;
      this.queueCharacter();
    } else this.renderer.setGroomMode(true);
  }
  /** Leave the editor: the styled guides are stored with the character and rebuilt as game cards. */
  finishGroom() {
    if (!this.renderer?.groomMode) return;
    const data = this.renderer.setGroomMode(false);
    if (data) { this.person = normalizeCharacter({ ...this.person, groom: data }); this.clearPresetSelection(); this.queueCharacter(); }
  }
  updateGroomStatus() {
    const node = document.getElementById('groomStatus'), editor = this.renderer?.groom;
    if (!node || !editor?.active) return;
    const s = editor.state, sections = new Set(s.sections).size;
    const clipped = s.guides.filter(g => g.clips.size).length, frozen = s.guides.filter(g => g.frozen).length;
    node.textContent = `${s.guides.length} guide strands · ${sections} sections · ${editor.selected.size} selected · ${clipped} clipped · ${frozen} frozen`;
  }
  renderGroom() {
    const editor = this.renderer?.groom;
    if (!editor?.active) { this.block('Groom', 'Preparing the scalp and growing guide strands…'); setTimeout(() => { if (this.section === 'Groom') this.render(); }, 400); return; }
    const settings = editor.settings;
    const tools = this.block('Tools', 'Hair is guide strands with physics: pull a lock, clip it, and the next one falls if not clipped. Drag empty space to orbit.');
    const names = { select: 'Select section', pull: 'Pull lock', comb: 'Comb', cut: 'Cut', tie: 'Tie (ponytail)', part: 'Draw parting', hairline: 'Hairline' };
    const toolRow = el('div', 'segmented'); toolRow.setAttribute('role', 'group'); toolRow.setAttribute('aria-label', 'Groom tool');
    for (const tool of groomTools) {
      const b = el('button', settings.tool === tool ? 'selected' : '', names[tool]); b.type = 'button'; b.setAttribute('aria-pressed', String(settings.tool === tool));
      b.addEventListener('click', () => { editor.setTool(tool); this.render(); });
      toolRow.append(b);
    }
    tools.append(toolRow);
    const hints = {
      select: 'Click a lock to select its section (sections are split by partings). Shift adds, Ctrl removes.',
      pull: 'Drag a lock (the strands within "Lock size" of the cursor, or the selected section). Release and it falls; hold P (or tick "Clip on release") to clip it where it is.',
      comb: 'Brush strands in the stroke direction. Turn gravity off to style without physics, or freeze what you combed.',
      cut: 'Scissors: strands are trimmed where the brush touches them.',
      tie: 'With locks selected, click where the hair tie goes (on the head, or in the air) — a ponytail or bun base.',
      part: 'Draw a parting line on the scalp. It splits sections and combs hair away from it.',
      hairline: 'Drag the yellow points to reshape the hairline; strands are added or removed to match.',
    };
    tools.append(el('p', 'section-note', hints[settings.tool]));
    const slider = (block, label, value, min, max, step, onInput, format = v => Number(v).toFixed(2)) => {
      const row = el('div', 'control'), id = `groom-${label.replace(/\W+/g, '-').toLowerCase()}`;
      const text = el('label', '', label); text.htmlFor = id;
      const input = el('input'); input.type = 'range'; input.id = id; input.min = min; input.max = max; input.step = step; input.value = value;
      const out = el('output'); out.htmlFor = id; out.value = format(value);
      input.addEventListener('input', () => { out.value = format(input.value); onInput(Number(input.value)); });
      row.append(text, input, out); block.append(row); return input;
    };
    if (settings.tool === 'pull') slider(tools, 'Lock size', settings.lock * 100, 0.5, 8, 0.1, v => { settings.lock = v / 100; }, v => `${Number(v).toFixed(1)}cm`);
    if (settings.tool === 'comb' || settings.tool === 'cut') {
      slider(tools, 'Brush size', settings.radius, 10, 150, 1, v => { settings.radius = v; }, v => `${Math.round(v)}px`);
      slider(tools, 'Strength', settings.strength, 0.05, 1, 0.01, v => { settings.strength = v; });
    }
    const check = (block, label, value, onChange) => {
      const row = el('label', 'check-row'); const box = el('input'); box.type = 'checkbox'; box.checked = value;
      box.addEventListener('change', () => onChange(box.checked)); row.append(box, el('span', '', label)); block.append(row);
    };
    check(tools, 'Gravity (physics)', settings.gravity, on => { settings.gravity = on; });
    check(tools, 'Clip on release', settings.pinOnRelease, on => { settings.pinOnRelease = on; });
    check(tools, 'Show guide strands', settings.showGuides !== false, on => { settings.showGuides = on; editor.update(false); });

    const lock = this.block('Selected locks');
    const status = el('p', 'section-note'); status.id = 'groomStatus'; lock.append(status);
    const actions = el('div', 'action-grid');
    const action = (label, fn) => { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', fn); actions.append(b); };
    action('Select all', () => editor.selectAll());
    action('Clear selection', () => editor.clearSelection());
    action('Clip in place', () => editor.clip());
    action('Release (falls)', () => editor.release());
    action('Freeze shape', () => editor.freeze(true));
    action('Unfreeze', () => editor.freeze(false));
    action('Braid', () => editor.braid(true));
    action('Unbraid', () => editor.braid(false));
    action('Longer', () => editor.setLength(1.12));
    action('Shorter', () => editor.setLength(0.88));
    action('More volume', () => editor.volume(1));
    action('Less volume', () => editor.volume(-0.6));
    lock.append(actions);
    const typeRow = el('div', 'segmented'); typeRow.setAttribute('role', 'group'); typeRow.setAttribute('aria-label', 'Hair type for selection');
    ['Straight', 'Wavy', 'Curly', 'Coily'].forEach((label, t) => {
      const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', () => editor.setStyle('t', t)); typeRow.append(b);
    });
    lock.append(el('div', 'swatch-label', 'Hair type (selection)'), typeRow);
    slider(lock, 'Curl strength', 0.5, 0, 1, 0.01, v => { for (const n of editor.selected) editor.state.guides[n].cu = v; editor.update(true); });
    slider(lock, 'Card width', 1, 0.4, 2.5, 0.01, v => { for (const n of editor.selected) editor.state.guides[n].w = v; editor.update(true); });
    void hairTextureTypes;

    const grow = this.block('Grow', 'Regrows every strand from the scalp (keeps hairline and partings).');
    let density = editor.state.groom.density, length = editor.state.groom.length;
    slider(grow, 'Density', density, 60, 500, 10, v => { density = v; }, v => `${Math.round(v)}`);
    slider(grow, 'Length', length, 0.03, 0.9, 0.01, v => { length = v; }, v => `${Math.round(v * 100)}cm`);
    const regrow = el('button', 'wide-button', 'Regrow hair'); regrow.type = 'button';
    regrow.addEventListener('click', () => { if (confirm('Regrow all strands? Styling is replaced (Undo brings it back).')) editor.regrow(density, length); });
    grow.append(regrow);
    const history = el('div', 'action-grid');
    const undo = el('button', '', 'Undo'); undo.type = 'button'; undo.addEventListener('click', () => editor.undo());
    const redo = el('button', '', 'Redo'); redo.type = 'button'; redo.addEventListener('click', () => editor.redo());
    const done = el('button', 'primary', 'Done – build game hair'); done.type = 'button';
    done.addEventListener('click', () => this.setSection('Hair'));
    const reset = el('button', '', 'Reset hairline & partings'); reset.type = 'button';
    reset.addEventListener('click', () => { if (confirm('Reset hairline, partings and all strands?')) { editor.checkpoint(); this.renderer.groom.restore(JSON.stringify(null)); } });
    history.append(undo, redo, reset, done);
    grow.append(history);
    this.updateGroomStatus();
  }
  get sculpting() { return Boolean(this.renderer) && (this.section === 'Sculpt' || (this.section === 'Clothing' && Boolean(this.clothBrush))); }
  /** Cloth painting borrows the sculpt session on the body, with a cloth brush. */
  setClothBrush(mode) {
    const settings = this.renderer?.sculpt.settings;
    if (!settings) return;
    if (mode && !this.clothBrush) this.savedBrush = { target: settings.target, brush: settings.brush, radius: settings.radius };
    this.clothBrush = mode;
    if (mode) {
      Object.assign(settings, { target: 'body', brush: mode, radius: Math.max(settings.radius, 0.04) });
      this.renderer.setSculptMode(true);
    } else {
      if (this.savedBrush) Object.assign(settings, this.savedBrush);
      this.renderer.setSculptMode(this.section === 'Sculpt');
    }
  }
  /** Store the offsets of a finished stroke and refit everything that depends on them. */
  commitSculpt(target) {
    if (!target) return;
    if (target.paint) { this.commitClothPaint(target.paint); return; }
    const changes = target.changes();
    const pinsBefore = JSON.stringify(this.person.sculpt.pins?.[target.style] ?? []);
    const pins = [...target.pinned].sort((a, b) => a - b);
    if (!changes.size && (target.kind !== 'hair' || JSON.stringify(pins) === pinsBefore)) return;
    this.undo.push(JSON.stringify(this.person.sculpt)); this.redo = [];
    if (this.undo.length > 60) this.undo.shift();
    const sculpt = structuredClone(this.person.sculpt);
    const store = target.kind === 'body' ? sculpt.body : (sculpt[target.kind][target.style] ??= {});
    for (const [unit, delta] of changes) {
      const old = store[unit] ?? [0, 0, 0];
      store[unit] = old.map((value, k) => value + delta[k]);
    }
    if (target.kind === 'hair') sculpt.pins[target.style] = pins;
    target.built.set(target.points);
    this.person = normalizeCharacter({ ...this.person, sculpt });
    this.clearPresetSelection();
    this.updateSculptButtons();
    this.updateSculptCount();
    // Body edits refit clothes, hair and the face rig once the stroke settles.
    clearTimeout(this.sculptTimer);
    this.sculptTimer = setTimeout(() => this.queueCharacter(), target.kind === 'body' ? 350 : 900);
  }
  commitClothPaint({ mode, weights }) {
    const garment = this.person.garments[this.garmentIndex ?? 0];
    if (!garment || !weights.size) return;
    const paint = { ...garment.paint };
    for (const [v, w] of weights) {
      const old = paint[v] ?? 0;
      paint[v] = mode === 'clothAdd' ? Math.max(old, w) : Math.min(old, -w);
    }
    this.updateGarment({ paint }, 0);
  }
  updateGarment(changes, delay = 120) {
    const garments = this.person.garments.map((g, i) => i === (this.garmentIndex ?? 0) ? { ...g, ...changes } : g);
    this.person = normalizeCharacter({ ...this.person, garments });
    this.clearPresetSelection();
    clearTimeout(this.garmentTimer);
    this.garmentTimer = setTimeout(() => this.queueCharacter(), delay);
  }
  setGarments(garments, index) {
    this.person = normalizeCharacter({ ...this.person, garments });
    this.garmentIndex = Math.max(0, Math.min(this.person.garments.length - 1, index));
    this.clearPresetSelection(); this.queueCharacter(); this.render();
  }
  renderTailor() {
    const garments = this.person.garments;
    this.garmentIndex = Math.max(0, Math.min(garments.length - 1, this.garmentIndex ?? 0));
    const list = this.block('Garments', 'Layers from the skin outwards. Each one is cut from the body, so it fits any shape you sculpt.');
    const row = el('div', 'segmented'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Garment layers');
    garments.forEach((g, i) => {
      const button = el('button', i === this.garmentIndex ? 'selected' : '', `${i + 1}. ${garmentLabels[g.type]}`); button.type = 'button';
      button.setAttribute('aria-pressed', String(i === this.garmentIndex));
      button.addEventListener('click', () => { this.garmentIndex = i; this.render(); });
      row.append(button);
    });
    list.append(row);
    const addRow = el('div', 'input-row'); const addLabel = el('label', '', 'New garment'); const addSelect = el('select'); addSelect.id = 'garment-new'; addLabel.htmlFor = addSelect.id;
    for (const type of garmentTypes) addSelect.add(new Option(garmentLabels[type], type));
    addRow.append(addLabel, addSelect); list.append(addRow);
    const actions = el('div', 'action-grid');
    const action = (label, fn, disabled = false) => { const b = el('button', '', label); b.type = 'button'; b.disabled = disabled; b.addEventListener('click', fn); actions.append(b); };
    action('Add garment', () => this.setGarments([...garments, newGarment(addSelect.value)], garments.length), garments.length >= 8);
    action('Remove', () => this.setGarments(garments.filter((_, i) => i !== this.garmentIndex), this.garmentIndex - 1), !garments.length);
    action('Move inward', () => { const g = [...garments], i = this.garmentIndex; [g[i - 1], g[i]] = [g[i], g[i - 1]]; this.setGarments(g, i - 1); }, this.garmentIndex < 1);
    action('Move outward', () => { const g = [...garments], i = this.garmentIndex; [g[i + 1], g[i]] = [g[i], g[i + 1]]; this.setGarments(g, i + 1); }, this.garmentIndex >= garments.length - 1);
    list.append(actions);
    const garment = garments[this.garmentIndex];
    if (!garment) return;
    const cut = this.block('Pattern');
    const typeRow = el('div', 'input-row'); const typeLabel = el('label', '', 'Type'); const typeSelect = el('select'); typeSelect.id = 'garment-type'; typeLabel.htmlFor = typeSelect.id;
    for (const type of garmentTypes) typeSelect.add(new Option(garmentLabels[type], type));
    typeSelect.value = garment.type;
    typeSelect.addEventListener('change', () => { this.updateGarment({ ...newGarment(typeSelect.value), paint: garment.paint, color: garment.color, color2: garment.color2, pattern: garment.pattern }); this.render(); });
    typeRow.append(typeLabel, typeSelect); cut.append(typeRow);
    const slider = (key, label, min = 0, max = 1) => {
      const row = el('div', 'control'), id = `garment-${key}`;
      const text = el('label', '', label); text.htmlFor = id;
      const input = el('input'); input.type = 'range'; input.id = id; input.min = min; input.max = max; input.step = 0.01; input.value = garment[key];
      const output = el('output'); output.htmlFor = id; output.value = Number(garment[key]).toFixed(2);
      input.addEventListener('input', () => { output.value = Number(input.value).toFixed(2); this.updateGarment({ [key]: Number(input.value) }, 250); });
      row.append(text, input, output); cut.append(row);
    };
    const t = garment.type;
    if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'dress'].includes(t)) { slider('sleeve', 'Sleeve length'); slider('neckline', 'Neckline'); }
    if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'skirt', 'dress'].includes(t)) slider('length', t === 'skirt' || t === 'dress' ? 'Hem length' : 'Body length');
    if (['pants', 'shorts', 'socks'].includes(t)) slider('leg', t === 'socks' ? 'Height' : 'Leg length');
    if (['pants', 'shorts', 'skirt'].includes(t)) slider('rise', 'Waist rise');
    if (['skirt', 'dress'].includes(t)) slider('flare', 'Flare');
    slider('fit', 'Looseness'); slider('roughness', 'Roughness');
    const look = this.block('Fabric');
    const patternRow = el('div', 'input-row'); const patternLabel = el('label', '', 'Pattern'); const patternSelect = el('select'); patternSelect.id = 'garment-pattern'; patternLabel.htmlFor = patternSelect.id;
    for (const name of garmentPatterns) patternSelect.add(new Option(name[0].toUpperCase() + name.slice(1), name));
    patternSelect.value = garment.pattern;
    patternSelect.addEventListener('change', () => { this.updateGarment({ pattern: patternSelect.value }); this.render(); });
    patternRow.append(patternLabel, patternSelect); look.append(patternRow);
    const colorRow = (key, label) => {
      const row = el('div', 'input-row'); const text = el('label', '', label); const input = el('input'); input.type = 'color'; input.id = `garment-${key}`; text.htmlFor = input.id; input.value = garment[key];
      input.addEventListener('input', () => this.updateGarment({ [key]: input.value }, 200));
      row.append(text, input); look.append(row);
    };
    colorRow('color', 'Main colour');
    if (garment.pattern !== 'solid') { colorRow('color2', 'Second colour'); const scale = this.block('Pattern scale'); const row = el('div', 'control'); const label = el('label', '', 'Scale'); const input = el('input'); input.type = 'range'; input.id = 'garment-scale'; label.htmlFor = input.id; input.min = 0; input.max = 1; input.step = 0.01; input.value = garment.scale; const out = el('output'); out.value = garment.scale.toFixed(2); input.addEventListener('input', () => { out.value = Number(input.value).toFixed(2); this.updateGarment({ scale: Number(input.value) }, 250); }); row.append(label, input, out); scale.append(row); }
    const paint = this.block('Cloth brush', 'Paint the garment onto any part of the body, or erase it, to cut your own shapes. Ctrl+Z undoes sculpting only.');
    const modes = el('div', 'segmented'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Cloth brush');
    for (const [mode, label] of [[null, 'Off'], ['clothAdd', 'Paint on'], ['clothErase', 'Erase']]) {
      const button = el('button', (this.clothBrush ?? null) === mode ? 'selected' : '', label); button.type = 'button';
      button.setAttribute('aria-pressed', String((this.clothBrush ?? null) === mode));
      button.addEventListener('click', () => { this.setClothBrush(mode); this.render(); });
      modes.append(button);
    }
    paint.append(modes);
    if (this.clothBrush) {
      const settings = this.renderer.sculpt.settings;
      const row = el('div', 'control'); const label = el('label', '', 'Brush size'); const input = el('input'); input.type = 'range'; input.id = 'cloth-radius'; label.htmlFor = input.id;
      input.min = 0.01; input.max = 0.15; input.step = 0.005; input.value = settings.radius; const out = el('output'); out.value = `${(settings.radius * 100).toFixed(1)}cm`;
      input.addEventListener('input', () => { settings.radius = Number(input.value); out.value = `${(settings.radius * 100).toFixed(1)}cm`; });
      row.append(label, input, out); paint.append(row);
      const mirror = el('label', 'check-row'); const box = el('input'); box.type = 'checkbox'; box.checked = settings.symmetry; box.addEventListener('change', () => { settings.symmetry = box.checked; });
      mirror.append(box, el('span', '', 'Mirror across the body')); paint.append(mirror);
    }
    const clear = el('button', 'wide-button', `Clear painting (${Object.keys(garment.paint).length} vertices)`); clear.type = 'button';
    clear.addEventListener('click', () => { this.updateGarment({ paint: {} }, 0); this.render(); });
    paint.append(clear);
  }
  get exportOptions() {
    return this.exportSettings ??= { skeleton: 'unreal', lod: 'high', groom: 'cards', animations: true, blendshapes: true, cosmetic: false, optimize: true };
  }
  renderExport() {
    const options = this.exportOptions;
    const b = this.block('GLB for games', 'One skinned mesh per part, one skeleton, real triangles only. Sculpting, tailoring, hair shaping and colours are baked in.');
    const choice = (key, label, entries) => {
      const row = el('div', 'input-row'); const text = el('label', '', label); const select = el('select'); select.id = `export-${key}`; text.htmlFor = select.id;
      for (const [value, name] of entries) select.add(new Option(name, value));
      select.value = options[key];
      select.addEventListener('change', () => { options[key] = select.value; });
      row.append(text, select); b.append(row);
    };
    choice('skeleton', 'Bone names', [['unreal', 'Unreal Mannequin (UE4/UE5)'], ['mixamo', 'Mixamo (Unity Humanoid, Godot)']]);
    choice('lod', 'Detail', [['high', 'High – hero, facial rig'], ['medium', 'Medium – ~36% triangles'], ['low', 'Low – ~12%, crowds']]);
    choice('groom', 'Brows & lashes', [['cards', 'Alpha cards (game, light)'], ['strands', 'Strands (cinematic, ~25k tris)']]);
    const toggle = (key, label) => {
      const row = el('label', 'check-row'); const box = el('input'); box.type = 'checkbox'; box.checked = options[key];
      box.addEventListener('change', () => { options[key] = box.checked; });
      row.append(box, el('span', '', label)); b.append(row);
    };
    toggle('animations', 'Include the 16 body clips (with blinking and talking)');
    toggle('blendshapes', 'Include the 32 ARKit facial blendshapes (High detail)');
    toggle('cosmetic', 'Include transparent eye-wetness layers (off for games)');
    toggle('optimize', 'Optimise: weld vertices, separate Head mesh for blendshapes, JPEG textures');
    const button = el('button', 'wide-button primary-wide', 'Export GLB'); button.type = 'button';
    button.addEventListener('click', () => this.exportGLB());
    b.append(button);
    const stats = this.block('Current character');
    const list = el('div', 'metric-list');
    const group = this.renderer?.current?.group;
    let triangles = 0, meshes = 0;
    group?.traverse(object => { if (object.isMesh && object.visible && object.geometry.index) { triangles += object.geometry.index.count / 3; meshes++; } });
    for (const [label, value] of [['Triangles', triangles.toLocaleString()], ['Meshes (draw calls)', meshes], ['Bones', this.renderer?.current?.body.skeleton.bones.length ?? '—'], ['Blendshapes', this.renderer?.current?.faceMeshes?.[0] ? Object.keys(this.renderer.current.faceMeshes[0].morphTargetDictionary).length : 0]]) list.append(el('span', '', label), el('b', '', String(value)));
    stats.append(list);
  }
  restoreSculpt(json) {
    this.person = normalizeCharacter({ ...this.person, sculpt: JSON.parse(json) });
    this.clearPresetSelection(); this.updateSculptButtons(); this.updateSculptCount(); this.queueCharacter();
  }
  undoSculpt() { if (this.undo.length) { this.redo.push(JSON.stringify(this.person.sculpt)); this.restoreSculpt(this.undo.pop()); } }
  redoSculpt() { if (this.redo.length) { this.undo.push(JSON.stringify(this.person.sculpt)); this.restoreSculpt(this.redo.pop()); } }
  updateSculptButtons() {
    const undo = document.getElementById('sculptUndo'), redo = document.getElementById('sculptRedo');
    if (undo) undo.disabled = !this.undo.length;
    if (redo) redo.disabled = !this.redo.length;
  }
  updateSculptCount() {
    const note = document.getElementById('sculptCount');
    if (!note) return;
    const { body, hair, outfit } = this.person.sculpt;
    const count = Object.keys(body).length + [hair, outfit].reduce((n, kind) => n + Object.values(kind).reduce((m, edits) => m + Object.keys(edits).length, 0), 0);
    note.textContent = `${count.toLocaleString()} sculpted vertices. They are saved with presets and baked into the exported GLB; no geometry is added.`;
  }
  renderSculpt() {
    const settings = this.renderer?.sculpt.settings;
    if (!settings) { this.block('Sculpt', 'The 3D view is still starting.'); return; }
    const b = this.block('Brush', 'Drag on the model to sculpt. Drag empty space to orbit, Shift-drag to pan. Hold Ctrl to invert; Ctrl+Z undoes.');
    const choose = (key, values, labels, label, after) => {
      const row = el('div', 'segmented'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', label);
      values.forEach((value, i) => {
        const button = el('button', settings[key] === value ? 'selected' : '', labels[i]); button.type = 'button';
        button.setAttribute('aria-pressed', String(settings[key] === value));
        button.addEventListener('click', () => { settings[key] = value; after?.(); this.render(); });
        row.append(button);
      });
      b.append(el('div', 'swatch-label', label), row);
    };
    choose('target', ['body', 'hair', 'outfit'], ['Body & face', 'Hair', 'Clothes'], 'Edit', () => {
      if (settings.target !== 'hair' && ['pin', 'unpin', 'cut'].includes(settings.brush)) settings.brush = 'draw';
      const undress = settings.target === 'body' && Boolean(this.undressBody);
      if (this.renderer.undressed !== undress) { this.renderer.undressed = undress; this.queueCharacter(); }
      else this.renderer.freezeForSculpt();
    });
    const available = brushes.filter(name => settings.target === 'hair' || !['pin', 'unpin', 'cut'].includes(name));
    const names = { draw: 'Draw', inflate: 'Inflate', grab: 'Grab', smooth: 'Smooth', flatten: 'Flatten', pinch: 'Pinch', pin: 'Pin', unpin: 'Unpin', cut: 'Cut' };
    choose('brush', available, available.map(name => names[name]), 'Brush');
    const slider = (key, label, min, max, step, format) => {
      const row = el('div', 'control'), id = `sculpt-${key}`;
      const text = el('label', '', label); text.htmlFor = id;
      const input = el('input'); input.type = 'range'; input.id = id; input.min = min; input.max = max; input.step = step; input.value = settings[key];
      const output = el('output'); output.htmlFor = id; output.value = format(settings[key]);
      input.addEventListener('input', () => { settings[key] = Number(input.value); output.value = format(settings[key]); });
      row.append(text, input, output); b.append(row);
    };
    slider('radius', 'Radius', 0.005, 0.15, 0.001, v => `${(v * 100).toFixed(1)}cm`);
    slider('strength', 'Strength', 0.05, 1, 0.01, v => v.toFixed(2));
    const toggle = (label, checked, onChange) => {
      const row = el('label', 'check-row'); const input = el('input'); input.type = 'checkbox'; input.checked = checked;
      input.addEventListener('change', () => onChange(input.checked));
      row.append(input, el('span', '', label)); b.append(row);
    };
    toggle('Mirror across the body (X symmetry)', settings.symmetry, on => { settings.symmetry = on; });
    toggle('Invert (dig in, deflate, spread)', settings.invert, on => { settings.invert = on; });
    toggle('Hide clothes and shoes while sculpting the body', Boolean(this.undressBody), on => {
      this.undressBody = on;
      const undress = on && settings.target === 'body';
      if (this.renderer.undressed !== undress) { this.renderer.undressed = undress; this.queueCharacter(); }
    });
    const actions = el('div', 'action-grid');
    const button = (label, id, fn) => { const node = el('button', '', label); node.type = 'button'; if (id) node.id = id; node.addEventListener('click', fn); actions.append(node); return node; };
    button('Undo', 'sculptUndo', () => this.undoSculpt());
    button('Redo', 'sculptRedo', () => this.redoSculpt());
    button('Reset this part', null, () => {
      const sculpt = structuredClone(this.person.sculpt);
      if (settings.target === 'body') sculpt.body = {};
      else { const style = this.renderer.sculpt.target?.style; if (style) { delete sculpt[settings.target][style]; delete sculpt.pins[style]; } }
      this.undo.push(JSON.stringify(this.person.sculpt)); this.redo = [];
      this.restoreSculpt(JSON.stringify(sculpt));
    });
    button('Reset all sculpting', null, () => { this.undo.push(JSON.stringify(this.person.sculpt)); this.redo = []; this.restoreSculpt('{}'); });
    b.append(actions);
    const note = el('p', 'section-note'); note.id = 'sculptCount'; b.append(note);
    this.updateSculptButtons(); this.updateSculptCount();
  }
  setPerson(person, rebuild = true) {
    // A different character starts a fresh sculpt history.
    if (person.seed !== this.person.seed || person.name !== this.person.name) { this.undo = []; this.redo = []; this.garmentIndex = 0; }
    this.person = normalizeCharacter(person);
    this.clearPresetSelection();
    if (rebuild) this.queueCharacter();
    this.render();
  }
  update(key, value) {
    if (key === 'ageYears') { this.updateAge(value); return; }
    this.person = normalizeCharacter({ ...this.person, [key]: value });
    if (key === 'heightMeters') this.person.height = Math.max(1.48, Math.min(1.98, this.person.heightMeters));
    this.clearPresetSelection();
    if (presentationFields.has(key)) this.renderer?.setPresentation(this.person);
    else if (meshFields.has(key)) this.queueCharacter();
    this.syncControls(key);
    this.updateMeta();
  }
  updateAge(ageYears) {
    this.person = normalizeCharacter({ ...this.person, ageYears,
      heightMeters: Number(ageHeightReference(ageYears, this.person.gender).toFixed(2)) });
    this.clearPresetSelection();
    // Update the height slider in place: re-rendering would drop the age slider mid-drag.
    this.syncHeightRange();
    this.queueCharacter();
    this.updateMeta();
  }
  heightBounds(height = this.person.heightMeters) {
    return [Math.max(0.55, Number((height * 0.7).toFixed(2))), Math.min(2.2, Number((height * 1.3).toFixed(2)))];
  }
  syncHeightRange() {
    const input = document.getElementById('control-heightMeters');
    if (!input) return;
    [input.min, input.max] = this.heightBounds();
    input.value = this.person.heightMeters;
    input.closest('.control').querySelector('output').value = `${this.person.heightMeters.toFixed(2)}m`;
  }
  /** Several controls can edit one field (a select and its quick buttons). */
  syncControls(key) {
    for (const node of this.body.querySelectorAll(`[data-key="${key}"]`)) {
      if (node.tagName === 'SELECT') node.value = String(this.person[key]);
      else if (node.classList.contains('segmented') || node.classList.contains('swatches')) {
        node.querySelectorAll('button').forEach(button => {
          const selected = Number(button.dataset.value) === this.person[key] && !node.classList.contains('custom');
          button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
        });
      }
    }
  }
  setCrowd(count) {
    this.crowdCount = count;
    this.ready(count ? 'Building crowd…' : 'Ready');
    this.renderer?.setCrowdCount(count, message => this.ready(message ?? 'Ready'));
    this.chooseView(count ? 'crowd' : 'body');
    this.updateMeta(); this.render();
  }
  bindToolbar() {
    document.getElementById('newButton').addEventListener('click', () => this.setPerson(randomCharacter()));
    document.getElementById('resetButton').addEventListener('click', () => { this.setPerson(defaultCharacter); this.setCrowd(0); });
    document.getElementById('saveButton').addEventListener('click', () => this.savePreset());
    document.getElementById('deletePresetButton').addEventListener('click', () => this.deletePreset());
    document.getElementById('presetSelect').addEventListener('change', event => {
      document.getElementById('deletePresetButton').disabled = !event.target.value;
      if (!event.target.value) return;
      const json = storage.get(`${PRESET_PREFIX}${event.target.value}`);
      if (!json) { this.ready('Preset not found', true); this.refreshPresets(); return; }
      try {
        this.person = parsePreset(json);
        this.undo = []; this.redo = []; this.garmentIndex = 0;
        this.queueCharacter(); this.render();
        this.ready('Preset loaded');
      } catch (error) { this.fail(`Preset cannot be loaded: ${error.message}`); }
    });
    document.getElementById('screenshotButton').addEventListener('click', () => this.screenshot());
    document.getElementById('exportButton').addEventListener('click', () => this.exportGLB());
    document.getElementById('crowdButton').addEventListener('click', () => { this.section = 'Performance'; this.setCrowd(this.crowdCount ? 0 : 99); });
    document.getElementById('viewSelect').addEventListener('change', event => this.chooseView(event.target.value));
    document.getElementById('frontButton').addEventListener('click', () => this.chooseView('front'));
    document.getElementById('bodyButton').addEventListener('click', () => this.chooseView('body'));
    document.getElementById('fitButton').addEventListener('click', () => this.chooseView(this.crowdCount ? 'crowd' : 'body'));
    document.getElementById('zoomIn').addEventListener('click', () => this.renderer?.camera.zoom(-180));
    document.getElementById('zoomOut').addEventListener('click', () => this.renderer?.camera.zoom(180));
    document.getElementById('retryButton').addEventListener('click', () => location.reload());
    this.refreshPresets();
  }
  chooseView(view) {
    this.renderer?.camera.view(view, this.renderer?.current?.metrics.height);
    document.getElementById('viewSelect').value = view;
    document.getElementById('viewLabel').textContent = viewLabels[view];
  }
  clearPresetSelection() {
    // The character no longer matches the preset, so the same preset can be picked again.
    document.getElementById('presetSelect').value = '';
    document.getElementById('deletePresetButton').disabled = true;
  }
  refreshPresets(selected = '') {
    const selector = document.getElementById('presetSelect');
    selector.replaceChildren(new Option('Select saved preset', ''));
    const names = storage.keys().filter(key => key.startsWith(PRESET_PREFIX)).map(key => key.slice(PRESET_PREFIX.length)).sort((a, b) => a.localeCompare(b));
    for (const name of names) selector.add(new Option(name, name));
    selector.value = names.includes(selected) ? selected : '';
    document.getElementById('deletePresetButton').disabled = !selector.value;
  }
  savePreset() {
    const name = this.person.name.trim() || 'Citizen';
    if (!storage.set(`${PRESET_PREFIX}${name}`, serializePreset(this.person))) { this.ready('Browser storage is unavailable', true); return; }
    this.refreshPresets(name); this.ready('Preset saved');
  }
  deletePreset() {
    const name = document.getElementById('presetSelect').value;
    if (!name || !confirm(`Delete the preset "${name}"?`)) return;
    storage.remove(`${PRESET_PREFIX}${name}`);
    this.refreshPresets(); this.ready('Preset deleted');
  }
  screenshot() {
    const canvas = document.getElementById('stage');
    canvas.toBlob(blob => {
      if (!blob) { this.ready('Screenshot unavailable', true); return; }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `human-generator-${slug(this.person.name)}.png`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); this.ready('Screenshot saved');
    }, 'image/png');
  }
  async exportGLB() {
    try {
      this.ready('Exporting GLB…');
      const bytes = await this.renderer.exportGLB(this.exportOptions);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${slug(this.person.name)}-${this.person.seed}.glb`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.ready('GLB exported');
    } catch (error) { this.fail(`GLB export failed: ${error.message}`); }
  }
  updateMeta() {
    const measured = this.renderer?.current?.metrics.height ?? this.person.heightMeters;
    document.getElementById('characterMeta').textContent = `${this.person.name} · ${measured.toFixed(2)} m${this.crowdCount ? ` · ${this.crowdCount + 1} people` : ''}`;
  }
  block(title, note) {
    const block = el('section', 'section-block');
    block.append(el('div', 'section-heading', title));
    if (note) block.append(el('p', 'section-note', note));
    this.body.append(block); return block;
  }
  actions(block) {
    const grid = el('div', 'action-grid');
    const items = [
      ['Random Person', () => this.setPerson(randomCharacter()), true],
      ['Random Face', () => this.randomFace()],
      ['Random Body', () => {
        const r = randomCharacter();
        // Keep the age: scale the random adult's relative stature to this age.
        const relative = r.heightMeters / ageHeightReference(r.ageYears, r.gender);
        const heightMeters = Number((ageHeightReference(this.person.ageYears, this.person.gender) * relative).toFixed(2));
        this.setPerson({ ...this.person, heightMeters, height: r.height, build: r.build, muscle: r.muscle, shoulders: r.shoulders, waist: r.waist, hips: r.hips, legLength: r.legLength });
      }],
      ['Random Outfit', () => { const r = randomCharacter(); this.setPerson({ ...this.person, outfit: r.outfit, topColor: r.topColor, bottomColor: r.bottomColor }); }],
    ];
    for (const [label, fn, primary] of items) { const button = el('button', primary ? 'primary' : '', label); button.type = 'button'; button.addEventListener('click', fn); grid.append(button); }
    block.append(grid);
  }
  randomFace() {
    const r = randomCharacter();
    this.setPerson({ ...this.person, faceWidth: r.faceWidth, jaw: r.jaw, cheek: r.cheek, nose: r.nose, eyeSize: r.eyeSize, eyeSpacing: r.eyeSpacing, eyeColor: r.eyeColor });
  }
  range(block, key, label, min, max, step = 0.01, suffix = '') {
    const row = el('div', 'control'), id = `control-${key}`;
    const text = el('label', '', label); text.htmlFor = id;
    const input = el('input'); input.type = 'range'; input.id = id; input.min = min; input.max = max; input.step = step; input.value = this.person[key];
    const output = el('output'); output.htmlFor = id;
    const format = value => `${step >= 1 ? Math.round(value) : Number(value).toFixed(2)}${suffix}`;
    output.value = format(this.person[key]);
    input.addEventListener('input', () => { output.value = format(input.value); this.update(key, Number(input.value)); });
    row.append(text, input, output); block.append(row);
  }
  faceShapeRange(block, name) {
    const row = el('div', 'control'), id = `shape-${name}`;
    const text = el('label', '', name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())); text.htmlFor = id;
    const input = el('input'); input.type = 'range'; input.id = id; input.min = -1; input.max = 1; input.step = 0.01; input.value = this.person.faceShapes[name] ?? 0;
    const output = el('output'); output.htmlFor = id; output.value = Number(input.value).toFixed(2);
    input.addEventListener('input', () => {
      output.value = Number(input.value).toFixed(2);
      this.person = normalizeCharacter({ ...this.person, faceShapes: { ...this.person.faceShapes, [name]: Number(input.value) } });
      this.clearPresetSelection();
      this.renderer?.setPresentation(this.person);
    });
    row.append(text, input, output); block.append(row);
  }
  select(block, key, label, options) {
    const row = el('div', 'input-row'), id = `select-${key}`, name = el('label', '', label), input = el('select');
    name.htmlFor = id; input.id = id; input.dataset.key = key;
    for (let i = 0; i < options.length; i++) input.add(new Option(options[i], String(i)));
    input.value = String(this.person[key]);
    input.addEventListener('change', () => this.update(key, Number(input.value)));
    row.append(name, input); block.append(row);
  }
  swatches(block, key, label, palette, colorKey) {
    const heading = el('div', 'swatch-label', label); heading.id = `swatches-${key ?? colorKey}`;
    const row = el('div', 'swatches'); if (key) row.dataset.key = key; row.setAttribute('role', 'group'); row.setAttribute('aria-labelledby', heading.id);
    for (let i = 0; i < palette.length; i++) {
      const button = el('button', 'swatch'); button.type = 'button'; button.dataset.value = i;
      button.style.setProperty('--swatch', palette[i]); button.title = `${label} ${i + 1}`; button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => {
        if (colorKey) { const colors = { ...this.person.colors }; delete colors[colorKey]; this.person = normalizeCharacter({ ...this.person, colors }); this.syncCustom(row, colorKey); }
        if (key) this.update(key, i); else this.queueCharacter();
      });
      row.append(button);
    }
    if (colorKey) {
      // Any colour: the picker overrides the palette until a swatch is chosen.
      const picker = el('input', 'swatch-picker'); picker.type = 'color'; picker.title = `Custom ${label.toLowerCase()}`; picker.setAttribute('aria-label', picker.title);
      picker.value = this.person.colors[colorKey] ?? palette[this.person[key]] ?? palette[0];
      picker.addEventListener('input', () => {
        this.person = normalizeCharacter({ ...this.person, colors: { ...this.person.colors, [colorKey]: picker.value } });
        this.clearPresetSelection(); this.syncCustom(row, colorKey); this.queueCharacter();
      });
      row.append(picker);
    }
    block.append(heading, row); if (key) this.syncControls(key); if (colorKey) this.syncCustom(row, colorKey);
  }
  syncCustom(row, colorKey) {
    const custom = this.person.colors[colorKey];
    row.classList.toggle('custom', Boolean(custom));
    if (custom) row.querySelectorAll('.swatch').forEach(button => { button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); });
    else if (row.dataset.key) this.syncControls(row.dataset.key);
  }
  segments(block, key, labels, label) {
    const row = el('div', 'segmented'); row.dataset.key = key; row.setAttribute('role', 'group'); row.setAttribute('aria-label', label);
    labels.forEach((text, index) => {
      const button = el('button', '', text); button.type = 'button'; button.dataset.value = index;
      button.addEventListener('click', () => this.update(key, index));
      row.append(button);
    });
    block.append(row); this.syncControls(key);
  }
  render() {
    this.body.replaceChildren();
    document.getElementById('sectionTitle').textContent = this.section;
    document.getElementById('sectionSubtitle').textContent = sections.find(s => s[0] === this.section)[2];
    this.nav.querySelectorAll('.nav-item').forEach(button => {
      const active = button.dataset.section === this.section;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    this.updateMeta();
    if (this.section === 'Character') {
      this.actions(this.block('Generate', 'Create a new identity or vary one part of the current citizen.'));
      const b = this.block('Basic parameters');
      const row = el('div', 'input-row'); const label = el('label', '', 'Name'); const input = el('input'); input.id = 'input-name'; label.htmlFor = input.id; input.value = this.person.name; input.maxLength = 42;
      input.addEventListener('change', () => { this.update('name', input.value); input.value = this.person.name; }); row.append(label, input); b.append(row);
      this.select(b, 'gender', 'Body type', ['Feminine', 'Masculine']); this.range(b, 'ageYears', 'Age', 1, 90, 1);
      const [min, max] = this.heightBounds();
      this.range(b, 'heightMeters', 'Height', min, max, 0.01, 'm');
    } else if (this.section === 'Body') {
      const b = this.block('Body proportions', 'Parameters stay within human ranges.');
      for (const [key, label] of [['build','Body weight'],['muscle','Muscularity'],['shoulders','Shoulders'],['waist','Waist'],['hips','Hips'],['legLength','Leg length'],['headSize','Head size']]) this.range(b, key, label, key === 'muscle' ? 0 : -1, 1);
    } else if (this.section === 'Face') {
      const b = this.block('Facial structure');
      for (const [key, label] of [['faceWidth','Face width'],['jaw','Jaw'],['cheek','Cheekbones'],['nose','Nose']]) this.range(b, key, label, -1, 1);
      const random = el('button', 'wide-button', 'Random Face'); random.type = 'button'; random.addEventListener('click', () => this.randomFace()); b.append(random);
    } else if (this.section === 'Eyes') {
      const b = this.block('Eyes and gaze'); this.range(b, 'eyeSize', 'Eye size', -1, 1); this.range(b, 'eyeSpacing', 'Spacing', -1, 1); this.swatches(b, 'eyeColor', 'Iris colour', eyePalette, 'eyes');
      const lashes = this.block('Eyelashes');
      this.range(lashes, 'lashLength', 'Length', 0.4, 1.8);
      this.range(lashes, 'lashCurl', 'Curl', 0, 1);
      this.range(lashes, 'lashDensity', 'Density', 0, 1);
      this.swatches(lashes, null, 'Lash colour', ['#201915', '#3a2a22', '#5b4636', '#11131a'], 'lashes');
      const brow = this.block('Eyebrows');
      this.select(brow, 'browShape', 'Shape', ['Natural', 'Straight', 'Arched', 'Angled']);
      this.range(brow, 'browAngle', 'Inclination', -25, 25, 1, '°');
      this.range(brow, 'browArch', 'Arch', -1, 1);
      this.range(brow, 'browThickness', 'Thickness', 0.35, 2.1);
      this.range(brow, 'browWidth', 'Width', 0.7, 1.4);
      this.range(brow, 'browHeight', 'Height', -1, 1);
      this.range(brow, 'browDensity', 'Density', 0, 1);
      this.swatches(brow, null, 'Brow colour (default follows hair)', hairPalette, 'brows');
    } else if (this.section === 'Skin') {
      const b = this.block('Skin surface'); this.swatches(b, 'skin', 'Skin tone', skinPalette, 'skin'); this.range(b, 'skinRoughness', 'Roughness', 0, 1);
    } else if (this.section === 'Hair') {
      const b = this.block('Hairstyle', 'Game-ready mesh hair. Shape it further with Sculpt → Hair (pull, cut, pin).'); this.select(b, 'hairStyle', 'Style', hairNames); this.range(b, 'hairLength', 'Length', 0, 1); this.range(b, 'hairVolume', 'Volume', 0, 1);
      this.swatches(b, 'hairColor', 'Hair colour', hairPalette, 'hair');
      const texture = this.block('Texture', 'Waves and curls bend the mesh itself, so they add no triangles.');
      this.segments(texture, 'hairTexture', hairTextureNames, 'Hair texture');
      this.range(texture, 'hairCurl', 'Curl strength', 0, 1);
    } else if (this.section === 'Clothing') {
      const b = this.block('Outfit'); this.select(b, 'outfit', 'Wardrobe', outfitNames);
      b.querySelector('select').addEventListener('change', () => { if (this.clothBrush && this.person.outfit !== 4) this.setClothBrush(null); this.render(); });
      if (this.person.outfit === 4) this.renderTailor();
      else { this.swatches(b, 'topColor', 'Upper colour', topPalette, 'top'); this.swatches(b, 'bottomColor', 'Lower colour', bottomPalette, 'bottom'); }
    } else if (this.section === 'Expression') {
      const b = this.block('Expression', 'Expressions are ARKit-named blendshapes, exported as GLB morph targets for facial animation.'); this.select(b, 'expression', 'Mood', expressionNames); this.range(b, 'expressionIntensity', 'Intensity', 0, 1); this.segments(b, 'expression', expressionNames.slice(0, 4), 'Quick moods');
      const shapes = this.block('Blendshapes', 'Add to the mood per shape. Negative values subtract.');
      for (const name of blendshapeNames) this.faceShapeRange(shapes, name);
      const clear = el('button', 'wide-button', 'Clear blendshape edits'); clear.type = 'button';
      clear.addEventListener('click', () => { this.person = normalizeCharacter({ ...this.person, faceShapes: {} }); this.renderer?.setPresentation(this.person); this.render(); });
      shapes.append(clear);
    } else if (this.section === 'Pose') {
      const b = this.block('Standing pose', 'Shapes the idle stance and the arms in talking, looking and phone clips.'); this.segments(b, 'pose', ['Natural','Relaxed','Confident','Hands on hips'], 'Standing pose');
    } else if (this.section === 'Animation') {
      const b = this.block('Motion preview'); this.select(b, 'animation', 'Action', animationNames); this.range(b, 'animationSpeed', 'Speed', 0.4, 1.8); this.segments(b, 'animation', animationNames.slice(0, 5), 'Quick actions');
      const replay = el('button', 'wide-button', 'Replay'); replay.type = 'button'; replay.addEventListener('click', () => this.renderer?.replay()); b.append(replay);
    } else if (this.section === 'Lighting') {
      const b = this.block('Lighting preset'); this.select(b, 'lighting', 'Preset', lightingNames); this.segments(b, 'lighting', lightingNames, 'Lighting presets');
    } else if (this.section === 'Sculpt') {
      this.renderSculpt();
    } else if (this.section === 'Groom') {
      this.renderGroom();
    } else if (this.section === 'Export') {
      this.renderExport();
    } else if (this.section === 'Performance') {
      const b = this.block('Crowd stress test', 'Use camera controls to inspect level transitions and density.');
      const row = el('div', 'segmented'); row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Total people');
      for (const count of [1, 10, 50, 100, 250, 500, 1000]) {
        const button = el('button', this.crowdCount === count - 1 ? 'selected' : '', String(count)); button.type = 'button';
        button.title = `${count} total people`; button.setAttribute('aria-pressed', String(this.crowdCount === count - 1));
        button.addEventListener('click', () => this.setCrowd(count - 1)); row.append(button);
      }
      b.append(row);
      const metrics = this.block('Live diagnostics');
      const list = el('div', 'metric-list');
      for (const [key, label] of [['fps','FPS'],['frameTime','Frame time'],['drawCalls','Draw calls'],['triangles','Triangles'],['skeletons','Active skeletons'],['faces','Active facial rigs'],['visible','Visible people']]) { list.append(el('span', '', label), el('b', `metric-${key}`, '—')); }
      metrics.append(list);
      const lod = el('div', 'lod-table'); for (let i = 0; i < 5; i++) { const cell = el('div', 'lod-cell'); cell.append(el('small', '', `LOD ${i}`), el('strong', `lod-${i}`, '0')); lod.append(cell); } metrics.append(lod);
      this.updateStats(this.stats);
    }
  }
  updateStats(stats) {
    if (!stats) return; this.stats = stats;
    for (const [key, value] of Object.entries(stats)) {
      if (key === 'lod') continue;
      const footer = document.getElementById(key); if (footer) footer.textContent = value;
      const metric = this.body.querySelector(`.metric-${key}`); if (metric) metric.textContent = value;
    }
    document.getElementById('lodCounts').textContent = stats.lod.join(' / ');
    stats.lod.forEach((n, i) => { const cell = this.body.querySelector(`.lod-${i}`); if (cell) cell.textContent = n; });
  }
}
