import { blendshapeNames } from './face-rig.mjs';
import { HairEditor, hairTools } from './hair-editor.mjs';
import { hairParts, partName } from './hair-parts.mjs';
import { lockLength } from './locks.mjs';
import { hairPresets, hairPresetData } from './hair-presets.mjs';
import { garmentTypes, garmentLabels, garmentPatterns, newGarment, normalizeGarment } from './tailor.mjs';
import { PatternEditor } from './pattern-editor.mjs';
import { createPatternTemplate } from './patterns.mjs';
import { icon, hairPictogram } from './icons.mjs';
import { h, group, row, iconButton, slider, segmented, chips, toggle, swatches, toolbar, popover, closePopovers, captureFocus, restoreFocus } from './ui-kit.mjs';
import { storage, defaultExport } from './store.mjs';
import {
  defaultCharacter, randomCharacter, varyCharacter, normalizeCharacter, serializePreset, parsePreset, ageHeightReference,
  skinPalette, hairPalette, eyePalette, topPalette, bottomPalette, outfitNames, expressionNames, animationNames, lightingNames,
} from './state.mjs';

/**
 * The studio's interface, driven by the global store (store.mjs): every
 * change is an action; this class reacts to the `change` event — it rebuilds
 * the panels once per batch, rebuilds or re-poses the character from the keys
 * that changed, and switches the viewport's editing mode in one place
 * (applyMode). Layout (Blender's editor regions): a rail of sections, a rail
 * of the section's tools beside it, the active tool's options floating over the
 * viewport, and an inspector with the section's content.
 */
const sections = [
  { id: 'personagem', name: 'Personagem', icon: 'person' },
  { id: 'corpo', name: 'Corpo', icon: 'body' },
  { id: 'rosto', name: 'Rosto', icon: 'face' },
  { id: 'cabelo', name: 'Cabelo', icon: 'hair' },
  { id: 'roupas', name: 'Roupas', icon: 'shirt' },
  { id: 'esculpir', name: 'Esculpir', icon: 'sculpt' },
  { id: 'animacao', name: 'Animação', icon: 'play' },
];
const hints = {
  default: 'Roda: zoom no cursor · botão direito: girar · botão do meio: mover',
  esculpir: 'Arraste sobre o corpo para esculpir · Ctrl inverte · botão direito: girar',
  brush: 'Desenhe a mecha da raiz até a ponta, sobre a grade · cada traço fica por cima dos anteriores',
  fill: 'Pinte o couro com o círculo: planta mechas espaçadas, penteadas como as vizinhas',
  retouch: 'Passe o círculo sobre mechas e arraste: elas seguem o traço · começar na ponta alonga',
  cut: 'Passe a tesoura sobre as mechas',
  erase: 'Passe sobre as mechas para apagá-las inteiras',
  volume: 'Pincel: afasta o cabelo da cabeça · Ctrl achata',
  select: 'Clique ou pinte sobre as mechas · Shift soma · Ctrl tira · Delete apaga',
};
const clothHints = {
  look: hints.default,
  edges: 'Arraste a barra, a manga, o decote, a cintura ou a perna da peça para cima ou para baixo',
  clothAdd: 'Pinte no corpo onde a peça deve cobrir',
  clothErase: 'Pinte no corpo onde a peça não deve cobrir',
  clothSculpt: 'Esculpa a roupa; as edições ficam nas coordenadas do molde',
  clothPin: 'Clique na roupa para fixar a região do molde',
  clothUnpin: 'Clique numa região fixada para liberá-la',
};
// Changing these only re-poses or relights the character; it is never rebuilt.
const presentationFields = new Set(['animation', 'animationSpeed', 'lighting', 'expression', 'expressionIntensity', 'faceShapes']);
// These change no mesh at all.
const metaFields = new Set(['name', 'creation', 'version']);
// Body shape: the character on screen follows at once (live.mjs); the full build refines it when the drag ends.
const liveShapeFields = new Set(['gender', 'age', 'ageYears', 'height', 'heightMeters', 'build', 'muscle', 'shoulders', 'waist', 'hips', 'legLength',
  'headSize', 'faceWidth', 'jaw', 'cheek', 'nose', 'eyeSize', 'eyeSpacing', 'proportions', 'ancestry', 'cupsize', 'firmness', 'morphs']);
// Viewing choices, not edits: they stay out of the undo history.
const noHistory = new Set(['lighting', 'animation', 'animationSpeed']);
const views = [['front', 'Frente'], ['side', 'Lado'], ['rear', 'Costas'], ['face', 'Rosto'], ['body', 'Corpo']];
// Hair tools by purpose: [id, name, icon, { shortcut }] (hair-editor.mjs).
const hairToolGroups = [
  ['Criar', [['brush', 'Pincel', 'sculpt', { shortcut: 'B' }], ['fill', 'Preencher', 'plus', { shortcut: 'F' }]]],
  ['Modelar', [['retouch', 'Retocar', 'comb', { shortcut: 'R' }], ['volume', 'Volume', 'inflate', { shortcut: 'V' }], ['cut', 'Cortar', 'cut', { shortcut: 'C' }], ['erase', 'Apagar', 'trash', { shortcut: 'E' }]]],
  ['Selecionar', [['select', 'Selecionar', 'select', { shortcut: 'S' }]]],
];
const sculptTools = [['Pincéis', [['draw', 'Desenhar', 'sculpt'], ['inflate', 'Inflar', 'inflate'], ['grab', 'Arrastar', 'grab'], ['smooth', 'Suavizar', 'smooth'], ['flatten', 'Achatar', 'flatten'], ['pinch', 'Pinçar', 'pinch']]]];
const brushNames = Object.fromEntries(sculptTools[0][1].map(([id, name]) => [id, name]));
const clothToolGroups = [
  ['Ver', [['look', 'Girar a câmera', 'orbit']]],
  ['Peça', [['edges', 'Bordas', 'grow'], ['clothAdd', 'Pintar cobertura', 'paintAdd'], ['clothErase', 'Apagar cobertura', 'paintErase']]],
  ['Molde', [['clothSculpt', 'Esculpir', 'sculpt'], ['clothPin', 'Fixar', 'pin'], ['clothUnpin', 'Soltar', 'unlock']]],
];
// Cut-on-body garments edit edges and coverage; drafted (2D pattern) garments pin regions.
const surfaceOnly = ['edges', 'clothAdd', 'clothErase'], draftedOnly = ['clothPin', 'clothUnpin'];
const holderNames = { tie: 'Elástico', clip: 'Grampo', barrette: 'Fivela', band: 'Arco', tiara: 'Tiara' };
// [value, name, icon]: the choices show their icons, the names in the tooltips.
const shapes = { tips: [['round', 'Redondas', 'tipRound'], ['point', 'Finas', 'tipPoint'], ['flat', 'Retas', 'tipFlat']], forms: [['straight', 'Lisa', 'straight'], ['wavy', 'Ondulada', 'wavy'], ['curl', 'Cacheada', 'curly']] };
const choices = list => list.map(([, name, glyph]) => [name, glyph]);
const formOf = curl => curl > 0.6 ? 2 : curl > 0 ? 1 : 0;
const patternNames = { solid: 'Liso', stripes: 'Listras', pinstripe: 'Risca de giz', checks: 'Xadrez', gradient: 'Degradê' };
const PRESET_PREFIX = 'hgs.preset.', OUTFIT_PREFIX = 'hgs.outfit.', AUTOSAVE_KEY = 'hgs.autosave', PREFS_KEY = 'hgs.ui';
const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'personagem';
const hexOf = value => `#${value.toString(16).padStart(6, '0')}`;
const download = (blob, name) => {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
};

/** The character and panel preferences saved by the last session, for the store's first state. */
export function restoredSession() {
  let person = defaultCharacter;
  const saved = storage.get(AUTOSAVE_KEY);
  if (saved) { try { person = parsePreset(saved); } catch { storage.remove(AUTOSAVE_KEY); } }
  const ui = {};
  try {
    const prefs = JSON.parse(storage.get(PREFS_KEY) ?? 'null');
    if (prefs && typeof prefs === 'object') {
      if (prefs.groups && typeof prefs.groups === 'object') ui.groups = Object.fromEntries(Object.entries(prefs.groups).filter(([, open]) => typeof open === 'boolean'));
      ui.export = Object.fromEntries(Object.entries(defaultExport).map(([key, value]) => [key, typeof prefs.export?.[key] === typeof value ? prefs.export[key] : value]));
      ui.toolPanel = prefs.toolPanel !== false;
    }
  } catch { /* no preferences */ }
  return { person, ui };
}

export class StudioUI {
  constructor(store) {
    this.store = store;
    this.renderer = null; this.stats = null; this.mode = 'view'; this.buildRevision = 0;
    this.status = { text: 'Iniciando', level: 'busy' };
    this.app = document.querySelector('.app');
    this.body = document.getElementById('inspectorBody');
    this.nav = document.getElementById('sectionNav');
    this.toolRail = document.getElementById('toolRail');
    this.toolCard = document.getElementById('toolCard');
    this.buildNav(); this.bindChrome();
    store.addEventListener('change', event => this.onChange(event.detail));
    store.on('operations', () => this.renderStatus());
    store.on('history', () => this.updateHistoryButtons());
    store.on('toast', detail => this.showToast(detail));
    window.addEventListener('pagehide', () => this.autosave());
    this.render(); this.renderStatus();
  }
  get state() { return this.store.state; }
  get person() { return this.store.state.person; }
  get section() { return this.store.state.ui.section; }
  // The viewport's interaction, read by main.mjs for the pointer and the keyboard.
  get locking() { return this.mode === 'hair' && Boolean(this.renderer?.lockEditor.active); }
  get sculpting() { return this.mode === 'sculpt' || ['cloth:clothAdd', 'cloth:clothErase', 'cloth:clothSculpt'].includes(this.mode); }
  get dressing() { return Boolean(this.renderer) && this.section === 'roupas' && this.person.outfit === 4; }
  get tailoring() { return this.mode === 'cloth:edges'; }
  get pinning() { return this.mode === 'cloth:clothPin' || this.mode === 'cloth:clothUnpin'; }

  attachRenderer(renderer) {
    this.renderer = renderer;
    const editor = renderer.lockEditor;
    // The editor's callbacks are set once and feed the store's operations and status.
    // The hair editor has no background work (no live gravity): it only reports changes.
    editor.onChange = () => this.locksChanged();
    this.editorHistory = { undo: () => editor.undo(), redo: () => editor.redo(), canUndo: () => editor.undoStack.length > 0, canRedo: () => editor.redoStack.length > 0 };
    this.queueCharacter();
    this.applyMode();
  }

  // ------------------------------------------------------------ actions
  /** Change fields of the character. `history`: a group key (consecutive changes of one key are one undo step). */
  patch(changes, { history = true, live = false, rebuild } = {}) {
    this.store.dispatch({ type: 'person/patch', changes, history, live, rebuild });
  }
  update(key, value, { live = false } = {}) {
    const changes = { [key]: value };
    if (key === 'ageYears') changes.heightMeters = Number(ageHeightReference(value, this.person.gender).toFixed(2));
    if (key === 'heightMeters') changes.height = Math.max(1.48, Math.min(1.98, value));
    this.patch(changes, { history: noHistory.has(key) ? false : key, live });
    // The age sets a typical height: the height slider follows while the age is dragged.
    if (key === 'ageYears' && this.heightField?.isConnected) this.heightField.setValue(this.person.heightMeters, this.heightBounds());
  }
  setPerson(person, { history = true } = {}) {
    // A new character brings its own hair: the hair editor reloads it after the rebuild.
    if (this.mode === 'hair' && this.renderer?.locksMode) this.renderer.lockEditor.end();
    this.store.dispatch({ type: 'person/set', person, history });
    if (this.mode === 'hair') this.hairEntry = { person: this.person, revision: this.renderer?.lockEditor.revision ?? 0 };
  }
  setSection(name) { closePopovers(); this.store.dispatch({ type: 'ui/set', changes: { section: name } }); }
  pickTool(id) { this.store.dispatch({ type: 'ui/tool', section: this.section, tool: this.section === 'roupas' && id === 'look' ? null : id }); }
  generateVariation() { this.setPerson(varyCharacter(this.snapshotPerson())); }
  randomFace() { const r = randomCharacter(); this.patch({ faceWidth: r.faceWidth, jaw: r.jaw, cheek: r.cheek, nose: r.nose, eyeSize: r.eyeSize, eyeSpacing: r.eyeSpacing, eyeColor: r.eyeColor }); }
  randomBody() {
    const r = randomCharacter();
    const relative = r.heightMeters / ageHeightReference(r.ageYears, r.gender);
    const heightMeters = Number((ageHeightReference(this.person.ageYears, this.person.gender) * relative).toFixed(2));
    this.patch({ heightMeters, height: r.height, build: r.build, muscle: r.muscle, shoulders: r.shoulders, waist: r.waist, hips: r.hips, legLength: r.legLength });
  }
  randomOutfit() { const r = randomCharacter(); this.patch({ outfit: r.outfit, topColor: r.topColor, bottomColor: r.bottomColor }); }
  heightBounds(height = this.person.heightMeters) { return [Math.max(0.55, Number((height * 0.7).toFixed(2))), Math.min(2.2, Number((height * 1.3).toFixed(2)))]; }

  // ------------------------------------------------------------ reactions
  onChange({ action, prev, next }) {
    if (next.person !== prev.person) this.personChanged(prev.person, next.person, action);
    if (next.ui !== prev.ui) this.uiChanged(prev.ui, next.ui);
    this.applyMode(action);
    if (!action.live) this.scheduleRender();
    this.updateHistoryButtons();
  }
  personChanged(prev, next, action) {
    const keys = Object.keys(next).filter(key => prev[key] !== next[key]);
    if (keys.some(key => presentationFields.has(key))) this.renderer?.setPresentation(next);
    const build = keys.filter(key => !presentationFields.has(key) && !metaFields.has(key));
    if (build.length && action.rebuild !== false && action.origin !== 'history' && build.every(key => liveShapeFields.has(key)) && this.renderer?.canLive) {
      // Shape: shown on the next frame; a drag refines on release (commitLive), a click right away.
      this.renderer.liveShape(next);
      if (action.live) this.pendingRefine = true; else this.queueCharacter(action.rebuild ?? 150);
    } else if (build.length && action.rebuild !== false) this.queueCharacter(action.rebuild ?? 80);
    this.updateMeta();
    this.scheduleAutosave();
  }
  /** End of a drag: the full build (drape, hair gravity, facial rig) refines what was shown live. */
  commitLive() {
    if (!this.pendingRefine) return;
    this.pendingRefine = false;
    this.queueCharacter(150);
  }
  uiChanged(prev, next) {
    if (prev.crowd !== next.crowd) this.applyCrowd(next.crowd);
    if (prev.view !== next.view) this.renderViewButtons();
    if (prev.groups !== next.groups || prev.export !== next.export || prev.toolPanel !== next.toolPanel) {
      storage.set(PREFS_KEY, JSON.stringify({ groups: next.groups, export: next.export, toolPanel: next.toolPanel }));
    }
  }
  scheduleRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => this.render());
  }
  scheduleAutosave() { clearTimeout(this.autosaveTimer); this.autosaveTimer = setTimeout(() => this.autosave(), 1000); }
  autosave() { storage.set(AUTOSAVE_KEY, serializePreset(this.snapshotPerson())); }

  // ------------------------------------------------------------ viewport modes
  currentGarment(state = this.state) {
    const garments = state.person.garments;
    return garments[Math.max(0, Math.min(garments.length - 1, state.ui.garment))] ?? null;
  }
  garmentIndex(state = this.state) { return Math.max(0, Math.min(state.person.garments.length - 1, state.ui.garment)); }
  isDrafted(state = this.state) { const garment = this.currentGarment(state); return garment?.authoringMode === 'pattern' && Boolean(garment.patternData?.panels.length); }
  /** The clothes tool in effect: none for ready-made outfits or a tool the garment's construction does not offer. */
  clothTool(state = this.state) {
    const tool = state.ui.tools.roupas;
    if (state.person.outfit !== 4 || !tool) return null;
    const drafted = this.isDrafted(state);
    return (drafted && surfaceOnly.includes(tool)) || (!drafted && draftedOnly.includes(tool)) ? null : tool;
  }
  modeOf(state = this.state) {
    const section = state.ui.section;
    if (section === 'cabelo') return 'hair';
    if (section === 'esculpir') return 'sculpt';
    const cloth = section === 'roupas' ? this.clothTool(state) : null;
    return cloth ? `cloth:${cloth}` : 'view';
  }
  /** Put the viewport in the mode the state asks for: hair editor, sculpting, clothes tools or looking around. */
  applyMode(action = {}) {
    const r = this.renderer;
    if (!r) return;
    const mode = this.modeOf(), previous = this.mode;
    if (mode !== previous) {
      this.mode = mode;
      if (previous === 'hair') this.finishLocks();
      if (previous.startsWith('cloth:')) {
        if (this.savedBrush) { Object.assign(r.sculpt.settings, this.savedBrush); this.savedBrush = null; }
        r.clothEditor.hide(); this.shownGarment = null;
      }
    }
    const sculptOn = mode === 'sculpt' || mode.startsWith('cloth:'), wasOn = r.sculptMode;
    const retarget = this.syncEngines(mode, action);
    if (sculptOn !== wasOn) r.setSculptMode(sculptOn);
    const rebuilt = this.syncUndress();
    if (sculptOn && wasOn && retarget && !rebuilt) r.freezeForSculpt();
    if (mode === 'hair' && previous !== 'hair') this.startLocks();
  }
  /** Hand the store's active tools to the engines; true when the sculpt target changed. */
  syncEngines(mode, action) {
    const r = this.renderer, ui = this.state.ui, s = r.sculpt.settings;
    let retarget = false;
    if (mode === 'hair') {
      const editor = r.lockEditor, target = this.hairTool();
      if (editor.settings.tool !== target) editor.setTool(target);
    }
    if (mode === 'sculpt') {
      s.brush = ui.tools.esculpir;
      if (s.target !== ui.sculptTarget) { s.target = ui.sculptTarget; retarget = true; }
    }
    if (mode.startsWith('cloth:')) {
      const tool = mode.slice(6), garment = this.currentGarment();
      if (tool === 'clothAdd' || tool === 'clothErase') {
        this.savedBrush ??= { target: s.target, brush: s.brush, radius: s.radius };
        if (s.target !== 'body') retarget = true;
        Object.assign(s, { target: 'body', brush: tool, radius: Math.max(s.radius, 0.04) });
      } else {
        if (this.savedBrush) { Object.assign(s, this.savedBrush); this.savedBrush = null; }
        if (tool === 'clothSculpt' && s.target !== 'outfit') { s.target = 'outfit'; retarget = true; }
      }
      if (tool === 'edges') {
        // The edge lines follow the garment (not on every tick of a slider).
        if (this.shownGarment !== garment && !action.live) { r.clothEditor.show(garment); this.shownGarment = garment; }
      } else {
        if (this.shownGarment) { r.clothEditor.hide(); this.shownGarment = null; }
        if (draftedOnly.includes(tool)) r.clothEditor.garment = garment;
      }
    }
    return retarget;
  }
  /** Sculpting the body can hide the clothes (a rebuild without them). */
  syncUndress() {
    const r = this.renderer, ui = this.state.ui;
    const undress = this.mode === 'sculpt' && ui.undress && ui.sculptTarget === 'body';
    if (r.undressed === undress) return false;
    r.undressed = undress; this.queueCharacter();
    return true;
  }

  // ------------------------------------------------------------ build, status
  queueCharacter(delay = 80) {
    clearTimeout(this.rebuildTimer);
    this.renderer?.lockEditor.cancelGravity?.();
    this.renderer?.cancelBuild();
    const revision = ++this.buildRevision;
    this.store.begin('build', { label: 'Gerando…' });
    this.rebuildTimer = setTimeout(async () => {
      this.rebuildTimer = null;
      const success = await this.renderer?.setCharacter(this.snapshotPerson(), {
        getLatest: () => this.snapshotPerson(),
        onProgress: stage => { if (revision === this.buildRevision) this.store.progress('build', `Gerando · ${stage}`); },
      });
      if (revision !== this.buildRevision) return;
      this.store.end('build');
      if (!success) return;
      document.getElementById('errorPanel').hidden = true;
      this.notify('Pronto');
      this.updateMeta();
      this.exportMenu?.refresh();
      // The edge lines follow the rebuilt garment; the hair panel needs the editor started with it.
      if (this.tailoring) { this.shownGarment = this.currentGarment(); this.renderer.clothEditor.show(this.shownGarment); }
      if (this.section === 'cabelo') this.scheduleRender();
    }, delay);
  }
  snapshotPerson() {
    const editor = this.renderer?.lockEditor;
    return normalizeCharacter({ ...this.person, ...(editor?.active ? { locks: editor.serialize() } : {}) });
  }
  cancelOperation({ restoreCharacter = false } = {}) {
    const restore = restoreCharacter || Boolean(this.rebuildTimer) || Boolean(this.renderer?.buildController);
    clearTimeout(this.rebuildTimer); this.rebuildTimer = null;
    this.buildRevision++; this.renderer?.cancelBuild(); this.renderer?.lockEditor.cancelOperation?.(); this.exportController?.abort();
    for (const id of ['build', 'export', 'hair']) this.store.end(id);
    if (restore && this.renderer?.person) {
      // Back to the character on screen, keeping the presentation chosen since.
      const presentation = Object.fromEntries(['name', 'animation', 'animationSpeed', 'lighting', 'expression', 'expressionIntensity', 'faceShapes', 'creation'].map(key => [key, this.person[key]]));
      const person = normalizeCharacter({ ...this.renderer.person, ...presentation });
      this.renderer.person = normalizeCharacter(person);
      this.store.dispatch({ type: 'person/set', person, rebuild: false });
      this.renderer.setPresentation(person);
    }
    this.notify(this.renderer?.current ? 'Cancelado · última prévia mantida' : 'Geração cancelada');
  }
  notify(text, level = 'ok') { this.status = { text, level }; this.renderStatus(); }
  toast(text, level = 'info') {
    this.store.emit('toast', { text, level });
    if (level === 'error') this.notify(text, 'error');
  }
  showToast({ text, level }) {
    const host = document.getElementById('toasts');
    const node = h('div', { class: `toast ${level}`, role: level === 'error' ? 'alert' : 'status' }, icon(level === 'error' ? 'info' : 'check', 16), h('span', { text }));
    host.append(node);
    while (host.childElementCount > 3) host.firstElementChild.remove();
    setTimeout(() => node.remove(), level === 'error' ? 7000 : 3500);
  }
  renderStatus() {
    const op = this.store.currentOperation;
    const text = op ? op.label : this.status.text, level = op ? 'busy' : this.status.level;
    document.querySelector('.status-dot').className = `status-dot ${level}`;
    document.getElementById('readyLabel').textContent = text;
    document.getElementById('cancelOperation').hidden = ![...this.store.operations.values()].some(o => o.cancellable);
  }
  fail(message) {
    this.notify('Erro no 3D', 'error');
    document.getElementById('errorText').textContent = message;
    document.getElementById('restoreCharacter').textContent = this.renderer?.current ? 'Manter personagem anterior' : 'Usar personagem padrão';
    document.getElementById('errorPanel').hidden = false;
  }
  updateMeta() {
    const measured = this.renderer?.current?.metrics.height ?? this.person.heightMeters, crowd = this.state.ui.crowd;
    document.getElementById('characterName').textContent = this.person.name;
    document.getElementById('characterMeta').textContent = `${measured.toFixed(2)} m${crowd ? ` · ${crowd + 1} pessoas` : ''}`;
  }
  updateHistoryButtons() {
    const undo = document.getElementById('undoButton'), redo = document.getElementById('redoButton');
    if (undo) undo.disabled = !this.store.canUndo;
    if (redo) redo.disabled = !this.store.canRedo;
  }
  updateStats(stats) {
    if (!stats) return;
    this.stats = stats;
    document.getElementById('fps').textContent = `${stats.fps} FPS`;
    document.getElementById('triangles').textContent = `${Math.round(stats.triangles / 1000).toLocaleString('pt-BR')} mil triângulos`;
    const metrics = document.getElementById('crowdMetrics');
    if (metrics && !metrics.closest('[hidden]')) {
      const rows = [['Quadro', `${stats.frameTime.toFixed(1)} ms`], ['Chamadas de desenho', stats.draws], ['Triângulos', stats.triangles.toLocaleString('pt-BR')],
        ['Esqueletos', stats.skeletons], ['Rostos com rig', stats.faces], ['Pessoas visíveis', stats.visible], ['LOD 0 / 1 / 2', stats.lod.slice(0, 3).join(' / ')]];
      metrics.replaceChildren(...rows.flatMap(([label, value]) => [h('span', { text: label }), h('b', { text: String(value) })]));
    }
  }

  // ------------------------------------------------------------ chrome
  buildNav() {
    for (const section of sections) {
      this.nav.append(h('button', { class: 'nav-item', type: 'button', 'data-section': section.id, title: section.name, onclick: () => this.setSection(section.id) },
        icon(section.icon, 22), h('span', { class: 'nav-label', text: section.name })));
    }
  }
  bindChrome() {
    const $ = id => document.getElementById(id);
    for (const node of document.querySelectorAll('[data-icon]')) node.replaceWith(icon(node.dataset.icon, Number(node.dataset.size ?? 18)));
    $('randomButton').addEventListener('click', () => this.generateVariation());
    $('undoButton').addEventListener('click', () => this.store.undo());
    $('redoButton').addEventListener('click', () => this.store.redo());
    $('cancelOperation').addEventListener('click', () => this.cancelOperation());
    $('restoreCharacter').addEventListener('click', () => {
      $('errorPanel').hidden = true;
      if (this.renderer?.current) this.cancelOperation({ restoreCharacter: true }); else this.setPerson(defaultCharacter);
    });
    // Try again rebuilds the character; only a failed start reloads the page.
    $('retryButton').addEventListener('click', () => { $('errorPanel').hidden = true; if (this.renderer) this.queueCharacter(); else location.reload(); });
    $('screenshotButton').addEventListener('click', () => this.screenshot());
    $('zoomIn').addEventListener('click', () => { this.renderer?.camera.zoom(-180); this.viewMoved(); });
    $('zoomOut').addEventListener('click', () => { this.renderer?.camera.zoom(180); this.viewMoved(); });
    $('fitButton').addEventListener('click', () => this.chooseView(this.state.ui.crowd ? 'crowd' : 'body'));
    const viewRow = $('viewButtons');
    for (const [id, name] of views) viewRow.append(h('button', { type: 'button', 'data-view': id, 'aria-pressed': 'false', onclick: () => this.chooseView(id), text: name }));
    this.renderViewButtons();
    this.charactersMenu = popover($('charactersButton'), $('charactersMenu'), () => this.renderCharactersMenu());
    this.exportMenu = popover($('exportButton'), $('exportMenu'), () => this.renderExportMenu());
    this.lightMenu = popover($('lightButton'), $('lightMenu'), () => this.renderLightMenu());
    this.crowdMenu = popover($('crowdButton'), $('crowdMenu'), () => this.renderCrowdMenu());
    this.updateHistoryButtons();
  }
  chooseView(view) {
    this.renderer?.camera.view(view, this.renderer?.current?.metrics.height);
    this.store.dispatch({ type: 'ui/set', changes: { view }, live: true });
  }
  /** The camera left the chosen view (orbit, pan, zoom). */
  viewMoved() { if (this.state.ui.view) this.store.dispatch({ type: 'ui/set', changes: { view: null }, live: true }); }
  renderViewButtons() {
    for (const button of document.querySelectorAll('#viewButtons button')) {
      const on = button.dataset.view === this.state.ui.view;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on));
    }
  }
  setHint(text) { document.getElementById('viewportHint').textContent = text; }

  // ------------------------------------------------------------ menus
  renderCharactersMenu() {
    const menu = document.getElementById('charactersMenu');
    const names = storage.keys().filter(key => key.startsWith(PRESET_PREFIX)).map(key => key.slice(PRESET_PREFIX.length)).sort((a, b) => a.localeCompare(b));
    const list = h('div', { class: 'menu-list' }, names.length ? names.map(name => h('div', { class: 'menu-row' },
      h('button', { type: 'button', class: 'menu-item', onclick: () => { this.loadPreset(name); this.charactersMenu.close(true); } }, icon('person', 16), h('span', { text: name })),
      iconButton('trash', `Excluir "${name}"`, () => { if (confirm(`Excluir o personagem "${name}"?`)) { storage.remove(PRESET_PREFIX + name); this.renderCharactersMenu(); } }, { danger: true, size: 16 }),
    )) : h('p', { class: 'menu-empty', text: 'Nenhum personagem salvo ainda' }));
    menu.replaceChildren(
      h('div', { class: 'menu-title', text: 'Personagens salvos' }), list,
      h('div', { class: 'menu-actions' },
        h('button', { type: 'button', class: 'button primary', onclick: () => { this.savePreset(); this.renderCharactersMenu(); } }, icon('save', 16), `Salvar "${this.person.name}"`),
        h('button', { type: 'button', class: 'button', title: 'Voltar ao personagem padrão', onclick: () => { this.setPerson(defaultCharacter); this.setCrowd(0); this.charactersMenu.close(true); } }, icon('reset', 16), 'Padrão')),
    );
  }
  renderExportMenu() {
    const menu = document.getElementById('exportMenu'), options = this.state.ui.export;
    const set = changes => this.store.dispatch({ type: 'ui/export', changes, live: true });
    const choose = (label, key, entries) => segmented({ label, items: entries.map(e => e[1]), selected: entries.findIndex(e => e[0] === options[key]), onPick: i => set({ [key]: entries[i][0] }) });
    const flag = (label, key, title) => toggle({ label, checked: options[key], title, onChange: on => set({ [key]: on }) });
    let triangles = 0, meshes = 0;
    this.renderer?.current?.group?.traverse(object => { if (object.isMesh && object.visible && object.geometry.index) { triangles += object.geometry.index.count / 3; meshes++; } });
    const face = this.renderer?.current?.faceMeshes?.[0];
    menu.replaceChildren(
      h('div', { class: 'menu-title', text: 'Exportar GLB para jogos' }),
      h('div', { class: 'menu-body' },
        choose('Esqueleto', 'skeleton', [['unreal', 'Unreal'], ['mixamo', 'Mixamo']]),
        choose('Detalhe', 'lod', [['high', 'Alto'], ['medium', 'Médio'], ['low', 'Baixo']]),
        choose('Pelos do rosto', 'groom', [['cards', 'Cartões'], ['strands', 'Fios']]),
        flag('Animações', 'animations', '16 clipes'),
        flag('Expressões faciais', 'blendshapes', '32 blendshapes com nomes ARKit'),
        flag('Otimizar', 'optimize', 'Solda vértices, junta as malhas em Body e Head e usa JPEG'),
        flag('Brilho dos olhos', 'cosmetic', 'Camadas extras de brilho dos olhos'),
        h('div', { class: 'metric-list' }, [['Triângulos', triangles.toLocaleString('pt-BR')], ['Malhas', meshes], ['Ossos', this.renderer?.current?.body.skeleton.bones.length ?? '—'], ['Blendshapes', face ? Object.keys(face.morphTargetDictionary).length : 0]]
          .flatMap(([label, value]) => [h('span', { text: label }), h('b', { text: String(value) })]))),
      h('button', { type: 'button', class: 'button primary wide big', disabled: !this.renderer?.current, onclick: () => this.exportGLB() }, icon('export', 18), 'Exportar GLB'),
    );
  }
  renderLightMenu() {
    const menu = document.getElementById('lightMenu');
    menu.replaceChildren(h('div', { class: 'menu-title', text: 'Iluminação' }), h('div', { class: 'menu-list' }, lightingNames.map((name, i) => h('button', {
      type: 'button', class: `menu-item${this.person.lighting === i ? ' on' : ''}`, 'aria-pressed': String(this.person.lighting === i),
      onclick: () => { this.update('lighting', i); this.renderLightMenu(); },
    }, h('span', { text: name }), this.person.lighting === i ? icon('check', 16) : null))));
  }
  renderCrowdMenu() {
    const menu = document.getElementById('crowdMenu'), counts = [1, 10, 50, 100, 250, 500, 1000];
    menu.replaceChildren(
      h('div', { class: 'menu-title', text: 'Teste de multidão' }),
      chips({ label: 'Pessoas em cena', items: counts.map(String), selected: counts.indexOf(this.state.ui.crowd + 1), onPick: i => this.setCrowd(counts[i] - 1) }),
      h('div', { class: 'metric-list', id: 'crowdMetrics' }),
    );
    this.updateStats(this.stats);
  }
  setCrowd(count) { this.store.dispatch({ type: 'ui/set', changes: { crowd: count }, live: true }); }
  applyCrowd(count) {
    if (count) this.store.begin('crowd', { label: 'Montando multidão…', cancellable: false });
    // The operation ends when this request settles, also when a rebuild supersedes it.
    if (this.renderer) this.renderer.setCrowdCount(count, message => { if (message) this.store.progress('crowd', message); }).finally(() => this.store.end('crowd'));
    else this.store.end('crowd');
    this.chooseView(count ? 'crowd' : 'body');
    this.updateMeta();
  }

  // ------------------------------------------------------------ rendering
  render() {
    this.renderQueued = false;
    const focus = captureFocus(this.app);
    const fresh = this.lastSection !== this.section, scroll = fresh ? 0 : this.body.scrollTop;
    this.lastSection = this.section;
    this.patternEditor?.destroy(); this.patternEditor = null;
    this.heightField = null;
    this.body.replaceChildren();
    const section = sections.find(s => s.id === this.section);
    document.getElementById('sectionTitle').textContent = section.name;
    for (const button of this.nav.querySelectorAll('.nav-item')) {
      const active = button.dataset.section === this.section;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    this.setHint(hints.default);
    this.app.classList.toggle('pattern-mode', this.section === 'roupas' && this.person.outfit === 4);
    ({
      personagem: () => this.renderCharacter(), corpo: () => this.renderBody(), rosto: () => this.renderFace(),
      cabelo: () => this.renderHair(), roupas: () => this.renderClothes(), esculpir: () => this.renderSculpt(),
      animacao: () => this.renderAnimation(),
    })[this.section]();
    this.renderTools();
    this.body.scrollTop = scroll;
    this.updateMeta(); this.updateHistoryButtons(); this.renderViewButtons();
    restoreFocus(this.app, focus);
  }
  /** The section's tools in the rail beside the sections, and the active tool's options over the viewport. */
  renderTools() {
    const groups = this.toolGroups();
    this.app.classList.toggle('has-tools', Boolean(groups));
    this.toolRail.hidden = !groups; this.toolCard.hidden = !groups;
    if (!groups) { this.toolRail.replaceChildren(); this.toolCard.replaceChildren(); return; }
    const active = this.activeTool(), section = sections.find(s => s.id === this.section);
    toolbar(this.toolRail, { groups, active, label: `Ferramentas: ${section.name}`, onPick: id => this.pickTool(id) });
    const [name, glyph] = groups.flatMap(([, list]) => list).find(([id]) => id === active)?.slice(1) ?? ['', null];
    const options = h('div', { class: 'tool-card-body', id: 'toolCardBody' });
    if (this.section === 'cabelo') this.renderHairToolOptions(options, active);
    if (this.section === 'esculpir') this.renderSculptToolOptions(options);
    if (this.section === 'roupas') this.renderClothToolOptions(options, active);
    const open = this.state.ui.toolPanel, hasOptions = options.childElementCount > 0;
    this.toolCard.classList.toggle('collapsed', !open || !hasOptions);
    // replaceChildren turns null into the text "null": only real nodes are passed.
    this.toolCard.replaceChildren(...[
      h('div', { class: 'tool-card-head' }, glyph ? icon(glyph, 18) : null, h('span', { class: 'tool-card-title', text: name }),
        hasOptions ? h('button', {
          type: 'button', class: 'icon-button small', title: open ? 'Recolher as opções' : 'Mostrar as opções', 'aria-label': open ? 'Recolher as opções' : 'Mostrar as opções',
          'aria-expanded': String(open), 'aria-controls': 'toolCardBody', onclick: () => this.store.dispatch({ type: 'ui/set', changes: { toolPanel: !open } }),
        }, icon('chevronDown', 16)) : null),
      hasOptions && open ? options : null,
    ].filter(Boolean));
  }
  toolGroups() {
    if (this.section === 'cabelo') {
      if (!this.renderer?.lockEditor.active) return null;
      return hairToolGroups;
    }
    if (this.section === 'esculpir') return this.renderer ? sculptTools : null;
    if (this.section === 'roupas' && this.person.outfit === 4) {
      const drafted = this.isDrafted();
      return clothToolGroups.map(([label, list]) => [label, list.map(([id, name, glyph]) => [id, name, glyph, { disabled: (drafted && surfaceOnly.includes(id)) || (!drafted && draftedOnly.includes(id)) }])]);
    }
    return null;
  }
  activeTool() {
    if (this.section === 'roupas') return this.clothTool() ?? 'look';
    if (this.section === 'cabelo') return this.hairTool();
    return this.state.ui.tools[this.section];
  }
  /** The hair tool in effect (a tool saved by an older version falls back to the brush). */
  hairTool() { const tool = this.state.ui.tools.cabelo; return hairTools.includes(tool) ? tool : 'brush'; }
  // Controls bound to this UI: groups remember their state; sliders mark a drag in progress.
  group(title, { open = true } = {}) {
    const key = `${this.section}:${title}`, saved = this.state.ui.groups[key];
    return group(this.body, { title, open: saved ?? open, onToggle: value => this.store.dispatch({ type: 'ui/group', key, open: value, live: true }) });
  }
  slide(parent, { onStart, onEnd, ...options }) {
    const node = slider({
      ...options,
      onStart: () => { this.sliding = true; onStart?.(); },
      onEnd: () => {
        this.sliding = false; onEnd?.(); this.updateLockStatus();
        if (this.locking && this.lockPanelState() !== this.lockPanelKey) this.scheduleRender();
      },
    });
    parent.append(node);
    return node;
  }
  /** Slider bound to a character field (one undo step per drag). */
  range(parent, key, label, min, max, step = 0.01, unit = '') {
    return this.slide(parent, { label, value: this.person[key], min, max, step, unit, key, onInput: v => this.update(key, v, { live: true }), onEnd: () => { this.commitLive(); this.scheduleRender(); } });
  }
  segmented(parent, label, items, selected, onPick) { parent.append(segmented({ label, items, selected, onPick: i => { onPick(i); this.scheduleRender(); } })); }
  toggle(parent, label, checked, onChange, title, id) { parent.append(toggle({ label, checked, onChange, title, id })); }
  colorSwatches(parent, key, label, palette, colorKey) {
    parent.append(swatches({
      label, palette, selected: key ? this.person[key] : null, custom: this.person.colors[colorKey] ?? null,
      onPick: i => { const colors = { ...this.person.colors }; delete colors[colorKey]; this.patch({ colors, ...(key ? { [key]: i } : {}) }, { history: `color:${colorKey}` }); },
      onCustom: hex => this.patch({ colors: { ...this.person.colors, [colorKey]: hex } }, { history: `color:${colorKey}` }),
    }));
  }

  // ------------------------------------------------------------ sections
  renderCharacter() {
    const id = this.group('Identidade');
    const name = h('input', { type: 'text', value: this.person.name, maxlength: 42, 'aria-label': 'Nome' });
    name.addEventListener('change', () => this.update('name', name.value));
    id.append(row('Nome', name));
    this.segmented(id, 'Corpo', ['Feminino', 'Masculino'], this.person.gender, v => this.update('gender', v));
    this.range(id, 'ageYears', 'Idade', 1, 90, 1, ' anos');
    const [min, max] = this.heightBounds();
    this.heightField = this.range(id, 'heightMeters', 'Altura', min, max, 0.01, ' m');
    this.colorSwatches(id, 'skin', 'Pele', skinPalette, 'skin');
    const vary = this.group('Variações');
    vary.append(h('p', { class: 'muted', text: 'Gera outra pessoa e mantém o que estiver marcado.' }));
    for (const [key, label] of [['body', 'corpo e pele'], ['face', 'rosto e olhos'], ['hair', 'cabelo editado'], ['clothes', 'roupa editada']]) {
      this.toggle(vary, `Manter ${label}`, this.person.creation.locks[key], on => this.patch({ creation: { locks: { ...this.person.creation.locks, [key]: on } } }, { history: false }));
    }
    vary.append(
      h('button', { type: 'button', class: 'button primary wide', onclick: () => this.generateVariation() }, icon('dice', 16), 'Gerar variação'),
      h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'button', onclick: () => this.randomFace() }, 'Só rosto'),
        h('button', { type: 'button', class: 'button', onclick: () => this.randomBody() }, 'Só corpo'),
        h('button', { type: 'button', class: 'button', onclick: () => this.randomOutfit() }, 'Só roupa')));
  }
  renderBody() {
    const shape = this.group('Proporções');
    for (const [key, label] of [['build', 'Peso'], ['muscle', 'Músculos'], ['shoulders', 'Ombros'], ['waist', 'Cintura'], ['hips', 'Quadril'], ['legLength', 'Pernas'], ['headSize', 'Cabeça']]) this.range(shape, key, label, key === 'muscle' ? 0 : -1, 1);
    shape.append(h('button', { type: 'button', class: 'button wide', onclick: () => this.randomBody() }, icon('dice', 16), 'Corpo aleatório'));
    const skin = this.group('Pele', { open: false });
    this.range(skin, 'skinRoughness', 'Brilho ↔ fosco', 0, 1);
  }
  renderFace() {
    const shape = this.group('Formato');
    for (const [key, label] of [['faceWidth', 'Largura'], ['jaw', 'Queixo'], ['cheek', 'Bochechas'], ['nose', 'Nariz']]) this.range(shape, key, label, -1, 1);
    shape.append(h('button', { type: 'button', class: 'button wide', onclick: () => this.randomFace() }, icon('dice', 16), 'Rosto aleatório'));
    const eyes = this.group('Olhos');
    this.range(eyes, 'eyeSize', 'Tamanho', -1, 1); this.range(eyes, 'eyeSpacing', 'Distância', -1, 1);
    this.colorSwatches(eyes, 'eyeColor', 'Cor', eyePalette, 'eyes');
    const brows = this.group('Sobrancelhas', { open: false });
    this.segmented(brows, 'Formato', ['Natural', 'Reta', 'Arqueada', 'Angulosa'], this.person.browShape, v => this.update('browShape', v));
    this.range(brows, 'browAngle', 'Inclinação', -25, 25, 1, '°');
    this.range(brows, 'browArch', 'Arco', -1, 1); this.range(brows, 'browThickness', 'Espessura', 0.35, 2.1);
    this.range(brows, 'browWidth', 'Largura', 0.7, 1.4); this.range(brows, 'browHeight', 'Altura', -1, 1);
    this.range(brows, 'browDensity', 'Densidade', 0, 1);
    this.colorSwatches(brows, null, 'Cor (padrão: a do cabelo)', hairPalette, 'brows');
    const lashes = this.group('Cílios', { open: false });
    this.range(lashes, 'lashLength', 'Comprimento', 0.4, 1.8); this.range(lashes, 'lashCurl', 'Curvatura', 0, 1);
    this.range(lashes, 'lashDensity', 'Densidade', 0, 1);
    this.colorSwatches(lashes, null, 'Cor', ['#201915', '#3a2a22', '#5b4636', '#11131a'], 'lashes');
  }

  // ------------------------------------------------------------ hair
  /** Entering the hair section: the character's locks are edited live (animation frozen); undo goes to the editor. */
  startLocks() {
    const editor = this.renderer.lockEditor;
    this.hairEntry = { person: this.person, revision: editor.revision ?? 0 };
    this.hairDirty = false;
    this.renderer.setLocksMode(true);
    this.store.setHistoryTarget(this.editorHistory);
  }
  /** Leaving: the locks are stored with the character (the whole visit is one undo step) and built as one game mesh. */
  finishLocks() {
    this.store.setHistoryTarget(null);
    if (!this.renderer?.locksMode) return;
    const editor = this.renderer.lockEditor, data = this.renderer.setLocksMode(false);
    const changed = this.hairDirty || (editor.revision ?? 0) !== this.hairEntry?.revision;
    if (data) this.store.dispatch({ type: 'person/patch', changes: { locks: data }, history: changed, historyBase: this.hairEntry?.person });
    else this.queueCharacter();
    this.hairEntry = null;
  }
  lockPanelState() {
    const editor = this.renderer.lockEditor;
    return `${[...editor.selected].sort((a, b) => a - b).join(',')}|${editor.locks.length}|${editor.settings.tool}|${editor.revision ?? 0}|${editor.state?.accessories?.length ?? 0}`;
  }
  locksChanged() {
    const editor = this.renderer?.lockEditor;
    if (!editor?.active || this.mode !== 'hair') return;
    this.updateHistoryButtons();
    this.scheduleAutosave();
    if (this.lockPanelState() !== this.lockPanelKey && !this.sliding) { this.scheduleRender(); return; }
    this.updateLockStatus();
  }
  /** The lock count over the hair panel. */
  updateLockStatus() {
    const node = document.getElementById('lockStatus'), editor = this.renderer?.lockEditor;
    if (!node || !editor?.active) return;
    const s = editor.summary();
    node.textContent = `${s.count} ${s.count === 1 ? 'mecha' : 'mechas'}${s.selected ? ` · ${s.selected} ${s.selected > 1 ? 'selecionadas' : 'selecionada'}` : ''}`;
  }
  applyHairPreset(id) {
    const editor = this.renderer?.lockEditor, data = hairPresetData(id);
    this.hairDirty = true;
    // The editor shows the style at once; the character is rebuilt when the section is left.
    this.patch({ hairPreset: id, locks: null }, { history: false, rebuild: false });
    if (editor?.active) { if (data) editor.load(JSON.stringify(data)); else editor.clearAll(); }
  }
  setHairColor(index, custom) {
    const colors = { ...this.person.colors };
    if (custom) colors.hair = custom; else delete colors.hair;
    this.hairDirty = true;
    this.patch({ hairColor: index ?? this.person.hairColor, colors }, { history: false, rebuild: false });
    const hex = parseInt((custom ?? hairPalette[this.person.hairColor]).slice(1), 16);
    this.renderer?.lockEditor.setColor(hex);
    if (this.renderer) this.renderer.hairColor = hex;
  }
  renderHair() {
    const editor = this.renderer?.lockEditor;
    if (!editor?.active) { this.group('Cabelo').append(h('p', { class: 'muted', text: 'Preparando o editor de cabelo…' })); return; }
    const settings = editor.settings;
    this.lockPanelKey = this.lockPanelState();

    // 1. The hairstyle to start from and its colour.
    const style = this.group('Penteado');
    const tint = this.person.colors.hair ?? hairPalette[this.person.hairColor];
    style.append(h('div', { class: 'style-grid', style: `--hair-tint:${tint}` }, hairPresets.map(p => h('button', {
      type: 'button', class: `style-card${this.person.hairPreset === p.id ? ' on' : ''}`, title: p.name, 'aria-pressed': String(this.person.hairPreset === p.id), onclick: () => this.applyHairPreset(p.id),
    }, hairPictogram(p.id), h('span', { text: p.name })))));
    style.append(swatches({ label: 'Cor', palette: hairPalette, selected: this.person.hairColor, custom: this.person.colors.hair ?? null, onPick: i => this.setHairColor(i, null), onCustom: hex => this.setHairColor(null, hex) }));
    this.toggle(style, 'Base de fios sobre o couro', Boolean(editor.state.scalp), on => { this.hairDirty = true; editor.setScalp(on); }, 'Cobre o couro entre as mechas com fios penteados na mesma direção');

    // 1b. Parts: build a hairstyle from pieces (base, bangs, sides, back, tails), each added over the hair there.
    const parts = this.group('Montar com peças');
    parts.append(h('p', { class: 'muted', text: 'Comece por Careca e some peças: cada uma entra por cima das anteriores.' }));
    this.partLength ??= {};
    parts.append(h('div', { class: 'part-grid' }, hairParts.map(part => h('button', {
      type: 'button', class: 'part-card', title: `Adicionar ${part.name.toLowerCase()}`,
      onclick: () => { this.hairDirty = true; const made = editor.addPart(part.id, { length: this.partLength[part.id] }); if (!made) this.toast('Não coube nesta cabeça', 'error'); },
    }, icon('plus', 14), h('span', { text: part.name })))));
    const groups = editor.partGroups();
    if (groups.length) {
      parts.append(h('div', { class: 'holder-list' }, groups.map(({ group, kind, count }) => h('div', { class: 'holder-item' },
        h('span', { class: 'holder-dot', style: `--swatch:${this.person.colors.hair ?? hairPalette[this.person.hairColor]}` }),
        h('span', { text: `${kind ? partName(kind) : 'Desenhado'} · ${count} ${count === 1 ? 'mecha' : 'mechas'}` }),
        iconButton('select', 'Selecionar esta peça', () => { editor.selectGroup(group); this.pickTool('select'); }, { size: 14 }),
        iconButton('close', 'Remover esta peça', () => { this.hairDirty = true; editor.removeGroup(group); }, { size: 14 })))));
    }

    // 2. The ties, clips and bands on the hair, each with a button to take it off.
    if (editor.state.accessories?.length) {
      const holders = this.group('Prendedores');
      const counts = new Map();
      for (const lock of editor.locks) for (const pin of lock.pins.values()) if (pin.holder) counts.set(pin.holder, (counts.get(pin.holder) ?? 0) + 1);
      holders.append(h('div', { class: 'holder-list' }, editor.state.accessories.map(acc => {
        const name = holderNames[acc.type === 'band' && acc.style === 'tiara' ? 'tiara' : acc.type];
        return h('div', { class: 'holder-item' },
          h('span', { class: 'holder-dot', style: `--swatch:${hexOf(acc.color)}` }),
          h('span', { text: `${name}${counts.get(acc.id) ? ` · ${counts.get(acc.id)} mechas` : ''}` }),
          iconButton('close', `Tirar ${name.toLowerCase()}`, () => editor.removeHolder(acc.id), { size: 14 }));
      })));
    }

    // 3. Adjust the selected locks, or all of them.
    const count = editor.selected.size, lock = editor.summary().first;
    const record = () => editor.checkpoint();
    const adjust = this.group('Ajustar mechas');
    adjust.append(h('p', { class: 'status-line', id: 'lockStatus' }));
    if (lock) {
      adjust.append(h('p', { class: 'muted', text: count ? 'Os ajustes valem para as mechas selecionadas' : 'Sem seleção: os ajustes valem para todas (S seleciona)' }));
      this.slide(adjust, { label: 'Comprimento', value: lockLength(lock), min: 0.015, max: 1.1, step: 0.005, scale: 100, unit: 'cm', onStart: record, onInput: v => editor.setLength(v) });
      this.slide(adjust, { label: 'Largura', value: lock.width, min: 0.004, max: 0.09, step: 0.001, scale: 100, unit: 'cm', onStart: record, onInput: v => editor.setParam('width', v) });
      this.slide(adjust, { label: 'Volume', value: lock.volume, min: 0.12, max: 0.6, onStart: record, onInput: v => editor.setParam('volume', v), title: 'Quanto a mecha se arredonda (arco do cartão)' });
      this.slide(adjust, { label: 'Afunilar', value: lock.taper, min: 0, max: 1, onStart: record, onInput: v => editor.setParam('taper', v), title: 'Quanto a mecha afina até a ponta' });
      this.segmented(adjust, 'Forma', choices(shapes.forms), formOf(lock.curl), i => { record(); editor.setForm(shapes.forms[i][0]); });
      if (lock.curl > 0) this.slide(adjust, { label: 'Ondas', value: lock.turns, min: 0.5, max: 10, step: 0.1, onStart: record, onInput: v => editor.setParam('turns', v), title: 'Quantas voltas ao longo da mecha' });
      this.slide(adjust, { label: 'Firmeza', value: lock.stiffness, min: 0, max: 1, onStart: record, onInput: v => editor.setParam('stiffness', v), title: 'Quanto a mecha balança no movimento (0 solta, 1 firme)' });
      adjust.append(h('div', { class: 'actions' },
        count ? iconButton('close', 'Limpar seleção', () => editor.clearSelection()) : iconButton('select', 'Selecionar todas', () => editor.selectAll()),
        count ? iconButton('trash', 'Apagar as selecionadas (Delete)', () => editor.deleteSelected(), { danger: true }) : null,
        iconButton('reset', 'Começar do zero (sem cabelo)', () => { if (confirm('Apagar todo o cabelo?')) editor.clearAll(); }, { danger: true })));
    } else adjust.append(h('p', { class: 'muted', text: 'Sem cabelo. Escolha um penteado acima ou desenhe com o Pincel (B).' }));

    // 4. The guide the brush draws on: how far from the head and how far down.
    const guide = this.group('Guia do pincel', { open: false });
    guide.append(h('p', { class: 'muted', text: 'A grade em volta da cabeça onde o Pincel desenha: mais volume afasta o cabelo da cabeça.' }));
    this.slide(guide, { label: 'Volume', value: settings.guideVolume, min: 0.002, max: 0.05, step: 0.001, scale: 100, unit: 'cm', onInput: v => editor.setGuide({ volume: v }) });
    this.slide(guide, { label: 'Comprimento', value: settings.guideLength, min: 0.1, max: 1, step: 0.01, scale: 100, unit: 'cm', onInput: v => editor.setGuide({ length: v }) });
    this.toggle(guide, 'Mostrar a grade', settings.showGuide, on => { settings.showGuide = on; editor.updateHelpers(); });

    // 5. Movement: the hair sways with spring bones in the game; see it walking.
    const motion = this.group('Movimento', { open: false });
    motion.append(h('p', { class: 'muted', text: 'No jogo o cabelo balança por ossos com mola. "Firmeza" em Ajustar mechas controla quanto.' }),
      h('button', { type: 'button', class: 'button wide', onclick: () => { this.update('animation', 1); this.setSection('animacao'); } }, icon('play', 16), 'Ver o cabelo andando'));

    // 7. Files.
    const files = this.group('Arquivo', { open: false });
    const nameInput = h('input', { type: 'text', id: 'lockSlotName', value: this.lockSlot ?? 'Meu penteado', maxlength: 40, 'aria-label': 'Nome do penteado' });
    const slots = HairEditor.slots();
    const slotSelect = h('select', { id: 'lockSlots', 'aria-label': 'Penteados salvos' }, slots.map(name => h('option', { value: name, text: name })));
    if (this.lockSlot && slots.includes(this.lockSlot)) slotSelect.value = this.lockSlot;
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0]; if (!file) return;
      if (editor.load(await file.text())) this.notify(`"${file.name}" carregado`); else this.toast('Arquivo não é um penteado', 'error');
      fileInput.value = '';
    });
    files.append(
      row('Nome', nameInput),
      slots.length ? row('Salvos', slotSelect) : null,
      h('div', { class: 'actions' },
        iconButton('save', 'Salvar com este nome', () => { const name = nameInput.value.trim() || 'Meu penteado'; this.lockSlot = name; if (editor.saveSlot(name)) this.toast(`Penteado "${name}" salvo`); else this.toast('Armazenamento indisponível', 'error'); this.scheduleRender(); }, { id: 'lockSave' }),
        iconButton('folder', 'Carregar o salvo escolhido', () => { const name = slotSelect.value; if (!name) return; this.lockSlot = name; if (editor.loadSlot(name)) this.notify(`Penteado "${name}" carregado`); else this.toast('Penteado não encontrado', 'error'); }, { id: 'lockLoad', disabled: !slots.length }),
        iconButton('export', 'Exportar arquivo .json', () => download(new Blob([JSON.stringify(editor.serialize())], { type: 'application/json' }), `${slug(nameInput.value || 'penteado')}.mechas.json`)),
        iconButton('file', 'Importar arquivo .json', () => fileInput.click()),
        slots.length ? iconButton('trash', 'Excluir o salvo escolhido', () => { const name = slotSelect.value; if (name && confirm(`Excluir "${name}"?`)) { editor.deleteSlot(name); this.scheduleRender(); } }, { danger: true }) : null),
      fileInput);
    this.updateLockStatus();
  }
  /** The active hair tool's options (the card over the viewport): only what that tool uses. */
  renderHairToolOptions(options, activeTool) {
    const editor = this.renderer.lockEditor, settings = editor.settings;
    this.setHint(hints[activeTool] ?? hints.default);
    const circle = () => this.slide(options, { label: 'Círculo', value: settings.radius, min: 0.02, max: 0.6, step: 0.01, onInput: v => { settings.radius = v; }, title: 'Tamanho do círculo · [ e ] também mudam' });
    const mirror = () => this.toggle(options, 'Espelhar no outro lado', settings.mirror, on => { settings.mirror = on; });
    if (activeTool === 'brush') {
      this.slide(options, { label: 'Largura', value: settings.width, min: 0.006, max: 0.06, step: 0.001, scale: 100, unit: 'cm', onInput: v => { settings.width = v; }, title: 'Largura de cada mecha do traço' });
      this.slide(options, { label: 'Mechas por traço', value: settings.strands, min: 1, max: 7, step: 1, onInput: v => { settings.strands = v; }, title: 'Quantas mechas lado a lado cada traço cria' });
      this.segmented(options, 'Forma', choices(shapes.forms), ['straight', 'wavy', 'curl'].indexOf(settings.form), i => { settings.form = shapes.forms[i][0]; });
      mirror();
    }
    if (activeTool === 'fill') {
      circle();
      this.slide(options, { label: 'Distância entre mechas', value: settings.spacing, min: 0.01, max: 0.05, step: 0.001, scale: 100, unit: 'cm', onInput: v => { settings.spacing = v; } });
      this.toggle(options, 'Imitar as mechas vizinhas', settings.imitate, on => { settings.imitate = on; this.scheduleRender(); }, 'Direção, comprimento e largura das mechas ao redor');
      if (!settings.imitate) this.slide(options, { label: 'Comprimento', value: settings.length, min: 0.04, max: 0.8, step: 0.005, scale: 100, unit: 'cm', onInput: v => { settings.length = v; } });
      mirror();
    }
    if (activeTool === 'retouch') circle();
    if (activeTool === 'volume') {
      circle();
      this.slide(options, { label: 'Força', value: settings.strength, min: 0.05, max: 1, onInput: v => { settings.strength = v; } });
    }
    if (activeTool === 'select' && editor.locks.length) {
      options.append(h('div', { class: 'button-row two' },
        h('button', { type: 'button', class: 'button', onclick: () => editor.selectAll() }, 'Todas'),
        h('button', { type: 'button', class: 'button', disabled: !editor.selected.size, onclick: () => editor.clearSelection() }, 'Nenhuma')));
    }
  }

  // ------------------------------------------------------------ clothes
  /** Change the current made-to-measure garment; a drag of one field is one undo step. */
  updateGarment(changes, { delay = 120, history, live = false } = {}) {
    const index = this.garmentIndex(), garments = this.person.garments.map((g, i) => i === index ? { ...g, ...changes } : g);
    this.patch({ garments }, { history: history ?? `garment:${index}:${Object.keys(changes).join(',')}`, rebuild: delay, live });
  }
  setGarments(garments, index) {
    this.patch({ garments }, { history: true });
    this.store.dispatch({ type: 'ui/set', changes: { garment: Math.max(0, Math.min(this.person.garments.length - 1, index)) } });
  }
  /** Select the garment at `index` (a click on it in the viewport); -1 keeps the selection. */
  pickGarment(index) {
    if (index < 0 || index === this.garmentIndex() || index >= this.person.garments.length) return;
    this.store.dispatch({ type: 'ui/set', changes: { garment: index } });
  }
  pinCloth(ndc, camera) {
    const editor = this.renderer.clothEditor;
    this.pickGarment(editor.garmentAt(ndc, camera));
    editor.garment = this.currentGarment();
    const garment = editor.pinAt(ndc, camera, this.mode === 'cloth:clothPin', this.renderer.sculpt.settings.radius);
    if (garment) this.updateGarment(garment, { delay: 0, history: true });
  }
  clothEdgeStart() { this.notify('Arraste para cima ou para baixo', 'busy'); }
  clothEdgeMove(drag) { if (drag) this.notify(`${drag.label}: ${Math.round(drag.value * 100)}%`, 'busy'); }
  clothEdgeEnd(result) {
    if (!result) { this.notify('Pronto'); return; }
    this.updateGarment({ [result.key]: result.value }, { delay: 0, history: true });
  }
  commitClothPaint({ mode, weights }) {
    const garment = this.currentGarment();
    if (!garment || !weights.size) return;
    const paint = { ...garment.paint };
    for (const [v, w] of weights) { const old = paint[v] ?? 0; paint[v] = mode === 'clothAdd' ? Math.max(old, w) : Math.min(old, -w); }
    this.updateGarment({ paint }, { delay: 0, history: true });
  }
  /** Saved made-to-measure outfits (all pieces, cut, fabric and painting). */
  static outfitSlots() { return storage.keys().filter(k => k.startsWith(OUTFIT_PREFIX)).map(k => k.slice(OUTFIT_PREFIX.length)).sort((a, b) => a.localeCompare(b)); }
  outfitData() { return { format: 'hgs-outfit', v: 2, garments: this.person.garments, sculpt: this.person.sculpt.outfit }; }
  /** Load an outfit (JSON text); false if it is not one. */
  loadOutfit(json) {
    let data;
    try { data = JSON.parse(json); } catch { return false; }
    if (!data || data.format !== 'hgs-outfit' || !Array.isArray(data.garments)) return false;
    const changes = { garments: data.garments.slice(0, 8).map(normalizeGarment) };
    if (data.sculpt) changes.sculpt = { ...this.person.sculpt, outfit: data.sculpt };
    this.patch(changes, { history: true });
    this.store.dispatch({ type: 'ui/set', changes: { garment: 0 } });
    return true;
  }
  renderOutfitFiles() {
    const files = this.group('Arquivo', { open: false });
    const nameInput = h('input', { type: 'text', id: 'outfitSlotName', value: this.outfitSlot ?? 'Minha roupa', maxlength: 40, 'aria-label': 'Nome da roupa' });
    const slots = StudioUI.outfitSlots();
    const slotSelect = h('select', { id: 'outfitSlots', 'aria-label': 'Roupas salvas' }, slots.map(name => h('option', { value: name, text: name })));
    if (this.outfitSlot && slots.includes(this.outfitSlot)) slotSelect.value = this.outfitSlot;
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0]; if (!file) return;
      if (this.loadOutfit(await file.text())) this.notify(`"${file.name}" carregado`); else this.toast('Arquivo não é uma roupa', 'error');
      fileInput.value = '';
    });
    files.append(
      row('Nome', nameInput),
      slots.length ? row('Salvas', slotSelect) : null,
      h('div', { class: 'actions' },
        iconButton('save', 'Salvar com este nome', () => { const name = nameInput.value.trim() || 'Minha roupa'; this.outfitSlot = name; if (storage.set(OUTFIT_PREFIX + name, JSON.stringify(this.outfitData()))) this.toast(`Roupa "${name}" salva`); else this.toast('Armazenamento indisponível', 'error'); this.scheduleRender(); }, { id: 'outfitSave' }),
        iconButton('folder', 'Carregar a salva escolhida', () => { const name = slotSelect.value; if (!name) return; this.outfitSlot = name; const json = storage.get(OUTFIT_PREFIX + name); if (json && this.loadOutfit(json)) this.notify(`Roupa "${name}" carregada`); else this.toast('Roupa não encontrada', 'error'); }, { id: 'outfitLoad', disabled: !slots.length }),
        iconButton('export', 'Exportar arquivo .json', () => download(new Blob([JSON.stringify(this.outfitData())], { type: 'application/json' }), `${slug(nameInput.value || 'roupa')}.roupa.json`)),
        iconButton('file', 'Importar arquivo .json', () => fileInput.click()),
        slots.length ? iconButton('trash', 'Excluir a salva escolhida', () => { const name = slotSelect.value; if (name && confirm(`Excluir "${name}"?`)) { storage.remove(OUTFIT_PREFIX + name); this.scheduleRender(); } }, { danger: true }) : null),
      fileInput);
  }
  renderClothes() {
    const outfit = this.group('Roupa');
    outfit.append(chips({ label: 'Roupa', items: outfitNames, selected: this.person.outfit, onPick: i => this.update('outfit', i) }));
    if (this.person.outfit !== 4) {
      const colors = this.group('Cores');
      this.colorSwatches(colors, 'topColor', 'Parte de cima', topPalette, 'top');
      this.colorSwatches(colors, 'bottomColor', 'Parte de baixo', bottomPalette, 'bottom');
      return;
    }
    const garments = this.person.garments, index = this.garmentIndex(), garment = garments[index];
    const drafted = this.isDrafted();
    this.setHint(clothHints[this.clothTool() ?? 'look']);
    if (garment) {
      const method = this.group('Construção');
      this.segmented(method, 'Criar por', ['Corte no corpo', 'Moldes 2D'], drafted ? 1 : 0, i => {
        this.updateGarment({ authoringMode: i ? 'pattern' : 'surface', ...(i && !garment.patternData ? { patternData: createPatternTemplate(garment.type, garment) } : {}) }, { delay: 0, history: true });
      });
    }
    const pieces = this.group('Peças');
    pieces.append(chips({ label: 'Peças', items: garments.map((g, i) => `${i + 1}. ${garmentLabels[g.type]}`), selected: index, onPick: i => this.pickGarment(i) }));
    const addSelect = h('select', { 'aria-label': 'Nova peça' }, garmentTypes.map(type => h('option', { value: type, text: garmentLabels[type] })));
    pieces.append(row('Nova peça', addSelect), h('div', { class: 'actions' },
      iconButton('plus', 'Adicionar a peça escolhida', () => this.setGarments([...garments, newGarment(addSelect.value)], garments.length), { disabled: garments.length >= 8 }),
      iconButton('trash', 'Remover a peça atual', () => this.setGarments(garments.filter((_, i) => i !== index), index - 1), { disabled: !garments.length, danger: true }),
      iconButton('inward', 'Para dentro (mais perto da pele)', () => { const g = [...garments]; [g[index - 1], g[index]] = [g[index], g[index - 1]]; this.setGarments(g, index - 1); }, { disabled: index < 1 }),
      iconButton('outward', 'Para fora (mais por fora)', () => { const g = [...garments]; [g[index + 1], g[index]] = [g[index], g[index + 1]]; this.setGarments(g, index + 1); }, { disabled: index >= garments.length - 1 })));
    if (!garment) return;
    const pattern = this.group('Moldes 2D e costura');
    const canvas = h('div', { class: 'pattern-host' }); pattern.append(canvas);
    this.patternEditor = new PatternEditor(canvas, { garment, onChange: value => this.updateGarment({ ...value, authoringMode: 'pattern' }, { delay: 0, history: true }) });
    const cut = this.group('Modelagem');
    const typeSelect = h('select', { 'aria-label': 'Tipo' }, garmentTypes.map(type => h('option', { value: type, text: garmentLabels[type] })));
    typeSelect.value = garment.type;
    typeSelect.addEventListener('change', () => {
      const value = { ...newGarment(typeSelect.value), paint: garment.paint, color: garment.color, color2: garment.color2, pattern: garment.pattern };
      if (drafted) { value.authoringMode = 'pattern'; value.patternData = createPatternTemplate(value.type, value); }
      this.updateGarment(value, { history: true });
    });
    cut.append(row('Tipo', typeSelect));
    const field = (key, label) => { if (!drafted || key === 'fit') this.slide(cut, { label, value: garment[key], min: 0, max: 1, onInput: v => this.updateGarment({ [key]: v }, { delay: 250, live: true }), onEnd: () => this.scheduleRender() }); };
    const t = garment.type;
    if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'dress'].includes(t)) { field('sleeve', 'Manga'); field('neckline', 'Decote'); }
    if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'skirt', 'dress'].includes(t)) field('length', t === 'skirt' || t === 'dress' ? 'Barra' : 'Comprimento');
    if (['pants', 'shorts', 'socks'].includes(t)) field('leg', t === 'socks' ? 'Altura' : 'Perna');
    if (['pants', 'shorts', 'skirt'].includes(t)) field('rise', 'Cintura');
    if (['skirt', 'dress'].includes(t)) field('flare', 'Rodado');
    field('fit', 'Folga');
    if (drafted) { this.renderOutfitFiles(); return; }
    const fabric = this.group('Tecido');
    const patternSelect = h('select', { 'aria-label': 'Padrão' }, garmentPatterns.map(name => h('option', { value: name, text: patternNames[name] ?? name })));
    patternSelect.value = garment.pattern;
    patternSelect.addEventListener('change', () => this.updateGarment({ pattern: patternSelect.value }, { history: true }));
    fabric.append(row('Padrão', patternSelect));
    const colorInput = key => { const input = h('input', { type: 'color', value: garment[key] }); input.addEventListener('input', () => this.updateGarment({ [key]: input.value }, { delay: 200, live: true })); return input; };
    fabric.append(row('Cor', colorInput('color')));
    if (garment.pattern !== 'solid') {
      fabric.append(row('Segunda cor', colorInput('color2')));
      this.slide(fabric, { label: 'Escala', value: garment.scale, min: 0, max: 1, onInput: v => this.updateGarment({ scale: v }, { delay: 250, live: true }) });
    }
    this.slide(fabric, { label: 'Aspereza', value: garment.roughness, min: 0, max: 1, onInput: v => this.updateGarment({ roughness: v }, { delay: 250, live: true }) });
    const paint = this.group('Pintura', { open: false });
    paint.append(h('button', { type: 'button', class: 'button wide', disabled: !Object.keys(garment.paint).length, onclick: () => this.updateGarment({ paint: {} }, { delay: 0, history: true }) }, `Limpar pintura (${Object.keys(garment.paint).length})`));
    this.renderOutfitFiles();
  }
  renderClothToolOptions(options, tool) {
    this.setHint(clothHints[tool] ?? hints.default);
    const settings = this.renderer?.sculpt.settings;
    if (!settings) return;
    if (tool === 'clothAdd' || tool === 'clothErase') {
      this.slide(options, { label: 'Tamanho do pincel', value: settings.radius, min: 0.01, max: 0.15, step: 0.005, scale: 100, unit: 'cm', onInput: v => { settings.radius = v; } });
      this.toggle(options, 'Espelhar no corpo', settings.symmetry, on => { settings.symmetry = on; });
    }
    if (tool === 'clothSculpt') {
      options.append(chips({ label: 'Pincel', items: Object.values(brushNames), selected: Object.keys(brushNames).indexOf(settings.brush), onPick: i => { settings.brush = Object.keys(brushNames)[i]; } }));
      this.slide(options, { label: 'Raio', value: settings.radius, min: 0.005, max: 0.15, step: 0.005, scale: 100, unit: 'cm', onInput: v => { settings.radius = v; } });
      this.slide(options, { label: 'Força', value: settings.strength, min: 0.05, max: 1, onInput: v => { settings.strength = v; } });
      this.toggle(options, 'Espelhar escultura', settings.symmetry, on => { settings.symmetry = on; });
      this.toggle(options, 'Inverter pincel', settings.invert, on => { settings.invert = on; });
    }
  }

  // ------------------------------------------------------------ sculpt
  commitSculpt(target) {
    if (!target) return;
    if (target.paint) { this.commitClothPaint(target.paint); return; }
    const changes = target.changes();
    const spatial = target.patternChanges();
    if (!changes.size && !spatial.length) return;
    const sculpt = structuredClone(this.person.sculpt);
    const store = target.kind === 'body' ? sculpt.body : (sculpt[target.kind][target.style] ??= {});
    for (const [unit, delta] of changes) { const old = store[unit] ?? [0, 0, 0]; store[unit] = old.map((value, k) => value + delta[k]); }
    let garments;
    try {
      garments = this.person.garments.map((garment, index) => {
        const edits = spatial.filter(edit => edit.garment === index && edit.pattern === garment.patternData?.id).map(({ garment: _garment, pattern: _pattern, ...edit }) => edit);
        if (!edits.length) return garment;
        const combined = [...garment.patternData.edits, ...edits];
        if (combined.length > 20000) throw new Error('Limite de escultura deste molde atingido. Salve uma cópia e desfaça ou redefina a escultura para continuar.');
        return { ...garment, patternData: { ...garment.patternData, edits: combined } };
      });
    } catch (error) {
      target.points.set(target.built); target.write(Array.from({ length: target.unitCount }, (_, index) => index)); target.finish();
      this.toast(error.message, 'error'); return;
    }
    target.built.set(target.points);
    this.patch({ sculpt, garments }, { history: true, rebuild: target.kind === 'body' ? 350 : 900 });
  }
  renderSculpt() {
    if (!this.renderer) { this.group('Esculpir').append(h('p', { class: 'muted', text: 'Iniciando o 3D…' })); return; }
    const ui = this.state.ui;
    const target = this.group('Alvo');
    this.segmented(target, 'Esculpir', ['Corpo e rosto', 'Roupas'], ui.sculptTarget === 'outfit' ? 1 : 0, i => this.store.dispatch({ type: 'ui/set', changes: { sculptTarget: ['body', 'outfit'][i] } }));
    this.toggle(target, 'Esconder roupas', ui.undress, on => this.store.dispatch({ type: 'ui/set', changes: { undress: on } }), 'Esculpe o corpo sem as roupas por cima');
    const { body, outfit } = this.person.sculpt;
    const count = Object.keys(body).length + Object.values(outfit).reduce((m, edits) => m + Object.keys(edits).length, 0) + this.person.garments.reduce((total, garment) => total + (garment.patternData?.edits.length ?? 0), 0);
    const reset = this.group('Redefinir', { open: count > 0 });
    const clearPatterns = () => this.person.garments.map(garment => garment.patternData ? { ...garment, patternData: { ...garment.patternData, edits: [] } } : garment);
    reset.append(h('p', { class: 'muted', text: `${count.toLocaleString('pt-BR')} edições de escultura` }), h('div', { class: 'button-grid' },
      h('button', { type: 'button', class: 'button', onclick: () => {
        const sculpt = structuredClone(this.person.sculpt);
        if (ui.sculptTarget === 'body') sculpt.body = {}; else { const style = this.renderer.sculpt.target?.style; if (style) delete sculpt[ui.sculptTarget][style]; }
        this.patch({ sculpt, garments: ui.sculptTarget === 'outfit' ? clearPatterns() : this.person.garments }, { history: true });
      } }, 'Esta parte'),
      h('button', { type: 'button', class: 'button danger', onclick: () => this.patch({ sculpt: {}, garments: clearPatterns() }, { history: true }) }, 'Tudo')));
  }
  renderSculptToolOptions(options) {
    const settings = this.renderer?.sculpt.settings;
    if (!settings) return;
    this.setHint(hints.esculpir);
    this.slide(options, { label: 'Raio', value: settings.radius, min: 0.005, max: 0.15, step: 0.001, scale: 100, unit: 'cm', onInput: v => { settings.radius = v; } });
    this.slide(options, { label: 'Força', value: settings.strength, min: 0.05, max: 1, onInput: v => { settings.strength = v; } });
    this.toggle(options, 'Simetria', settings.symmetry, on => { settings.symmetry = on; }, 'Espelha o pincel do outro lado (eixo X)');
    this.toggle(options, 'Inverter', settings.invert, on => { settings.invert = on; }, 'Afunda e desinfla · também segurando Ctrl');
  }

  // ------------------------------------------------------------ animation
  renderAnimation() {
    const motion = this.group('Movimento');
    motion.append(chips({ label: 'Movimento', items: animationNames, selected: this.person.animation, onPick: i => this.update('animation', i) }));
    this.range(motion, 'animationSpeed', 'Velocidade', 0.4, 1.8, 0.01, '×');
    motion.append(h('button', { type: 'button', class: 'button wide', onclick: () => this.renderer?.replay() }, icon('reset', 16), 'Repetir do início'));
    const pose = this.group('Postura');
    this.segmented(pose, null, ['Natural', 'Relaxada', 'Confiante', 'Mãos na cintura'], this.person.pose, v => this.update('pose', v));
    const face = this.group('Expressão');
    face.append(chips({ label: 'Expressão', items: expressionNames, selected: this.person.expression, onPick: i => this.update('expression', i) }));
    this.range(face, 'expressionIntensity', 'Intensidade', 0, 1);
    const fine = this.group('Ajuste fino do rosto', { open: false });
    for (const name of blendshapeNames) {
      this.slide(fine, { label: name, value: this.person.faceShapes[name] ?? 0, min: -1, max: 1, onInput: v => this.patch({ faceShapes: { ...this.person.faceShapes, [name]: v } }, { history: `faceShapes:${name}`, live: true }) });
    }
    fine.append(h('button', { type: 'button', class: 'button wide', onclick: () => this.patch({ faceShapes: {} }) }, 'Zerar ajustes'));
  }

  // ------------------------------------------------------------ files and export
  loadPreset(name) {
    const json = storage.get(PRESET_PREFIX + name);
    if (!json) { this.toast('Personagem não encontrado', 'error'); return; }
    try { this.setPerson(parsePreset(json)); this.notify(`"${name}" carregado`); }
    catch (error) { this.toast(`Não foi possível carregar: ${error.message}`, 'error'); }
  }
  savePreset() {
    const name = this.person.name.trim() || 'Personagem';
    if (storage.set(PRESET_PREFIX + name, serializePreset(this.snapshotPerson()))) this.toast(`"${name}" salvo`); else this.toast('Armazenamento indisponível', 'error');
  }
  screenshot() {
    document.getElementById('stage').toBlob(blob => {
      if (!blob) { this.toast('Captura indisponível', 'error'); return; }
      download(blob, `${slug(this.person.name)}.png`); this.toast('Captura salva');
    }, 'image/png');
  }
  async exportGLB() {
    this.exportMenu?.close();
    const controller = new AbortController();
    this.exportController?.abort(); this.exportController = controller;
    try {
      this.store.begin('export', { label: 'Exportando GLB…' });
      const bytes = await this.renderer.exportGLB({ ...this.state.ui.export, person: this.snapshotPerson(), signal: controller.signal, onProgress: stage => this.store.progress('export', `Exportando · ${stage}`) });
      controller.signal.throwIfAborted();
      download(new Blob([bytes], { type: 'model/gltf-binary' }), `${slug(this.person.name)}-${this.person.seed}.glb`);
      this.toast('GLB exportado');
    } catch (error) { if (error.name !== 'AbortError') this.toast(`Falha ao exportar: ${error.message}`, 'error'); }
    finally { if (this.exportController === controller) { this.exportController = null; this.store.end('export'); } }
  }
}
