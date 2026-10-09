import { blendshapeNames } from './face-rig.mjs';
import { HairEditor, hairTools } from './hair-editor.mjs';
import { hairParts, partName } from './hair-parts.mjs';
import { lockLength } from './locks.mjs';
import { hairPresets, hairPresetData } from './hair-presets.mjs';
import { garmentTypes, garmentLabels, garmentPatterns, newGarment, normalizeGarment, costumeTypes, footwearTypes, MAX_GARMENTS } from './tailor.mjs';
import { fabricIds, fabricNames, fabrics } from './fabrics.mjs';
import { costumePresets, garmentPalette } from './costume.mjs';
import { garmentPictogram, fabricPictogram } from './garment-icons.mjs';
import { PatternEditor } from './pattern-editor.mjs';
import { createPatternTemplate, patternTypes } from './patterns.mjs';
import { icon, hairPictogram } from './icons.mjs';
import { h, group, row, iconButton, slider, sliderPair, segmented, chips, iconChoices, toggleChips, searchField, toggle, swatches, toolbar, popover, closePopovers, captureFocus, restoreFocus } from './ui-kit.mjs';
import { storage, defaultExport } from './store.mjs';
import { onlyGarmentColour } from './look.mjs';
import { libraryPose, poseLibrary } from './motion.mjs';
import { importAnimation } from './timeline.mjs';
import { categoryLabel, regionNames } from './shape-handles.mjs';
import { namedFeatures } from './renderer-three.mjs';
import { faceWeights, mixamoName } from './human-three.mjs';
import { beardStyles, makeupNames, tattooDesigns } from './skin-layers.mjs';
import { accessoryNames, accessoryStyles, metals } from './accessories.mjs';
import {
  defaultCharacter, randomCharacter, varyCharacter, normalizeCharacter, serializePreset, parsePreset, ageHeightReference,
  skinPalette, hairPalette, eyePalette, topPalette, bottomPalette, outfitNames, expressionNames, animationNames, lightingNames, hairBases,
} from './state.mjs';

/**
 * The studio's interface, driven by the global store (store.mjs): every
 * change is an action; this class reacts to the `change` event — it rebuilds
 * the panels once per batch, rebuilds or re-poses the character from the keys
 * that changed, and switches the viewport's editing mode in one place
 * (applyMode). Layout (Blender's editor regions; docs/INTERFACE.md): a rail of
 * sections in the order a person is made, the section's tools with their names
 * beside it, the active tool's options floating over the viewport, and an
 * inspector with the section's content. Each section frames the camera on what
 * it edits (MetaHuman Creator's Face/Body framings).
 */
const sections = [
  { id: 'personagem', name: 'Pessoa', icon: 'person', view: 'body', lead: 'Sexo, idade, altura, pele e origem. Comece por aqui ou sorteie.' },
  { id: 'corpo', name: 'Corpo', icon: 'body', view: 'body', lead: 'Puxe o corpo com Moldar ou use os controles de proporção.' },
  { id: 'rosto', name: 'Rosto', icon: 'face', view: 'face', lead: 'Formato, olhos, sobrancelhas, cílios e expressão.' },
  { id: 'cabelo', name: 'Cabelo', icon: 'hair', view: null, lead: 'Escolha um penteado e ajuste com as ferramentas à esquerda.' },
  { id: 'roupas', name: 'Roupas', icon: 'shirt', view: 'body', lead: 'Um conjunto pronto ou peças sob medida.' },
  { id: 'animacao', name: 'Animação', title: 'Pose e animação', icon: 'play', view: 'body', lead: 'Movimentos prontos, pose livre e sua própria animação.' },
  { id: 'esculpir', name: 'Esculpir', icon: 'sculpt', view: 'body', divider: true, lead: 'Pincéis livres sobre o corpo ou a roupa. Ctrl inverte o pincel.' },
];
const hints = {
  default: 'Botão direito: girar · botão do meio: mover · roda: zoom no cursor',
  esculpir: 'Arraste sobre o corpo para esculpir · Ctrl: inverter · botão direito: girar',
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
const presentationFields = new Set(['animation', 'animationSpeed', 'lighting', 'expression', 'expressionIntensity', 'faceShapes', 'posing', 'clip']);
// These change no mesh at all.
const metaFields = new Set(['name', 'creation', 'version']);
// Body shape: the character on screen follows at once (live.mjs); the full build refines it when the drag ends.
const liveShapeFields = new Set(['gender', 'age', 'ageYears', 'height', 'heightMeters', 'build', 'muscle', 'shoulders', 'waist', 'hips', 'legLength',
  'headSize', 'faceWidth', 'jaw', 'cheek', 'nose', 'eyeSize', 'eyeSpacing', 'proportions', 'african', 'asian', 'caucasian', 'cupsize', 'firmness', 'morphs']);
// Appearance: materials and textures only (look.mjs), never a rebuild. `colors` and `garments` are checked by `lookOnly`.
const liveLookFields = new Set(['skin', 'skinRoughness', 'hairColor', 'eyeColor', 'topColor', 'bottomColor', 'colors', 'garments', 'makeup', 'tattoos', 'beard']);
const liveColorKeys = new Set(['skin', 'hair', 'eyes', 'brows', 'lashes', 'top', 'bottom']);
/** True when only colours the live look can show changed (not a garment's cut). */
function lookOnly(prev, next, keys) {
  if (!keys.every(key => liveLookFields.has(key))) return false;
  if (keys.includes('colors')) for (const key of new Set([...Object.keys(prev.colors), ...Object.keys(next.colors)])) if (prev.colors[key] !== next.colors[key] && !liveColorKeys.has(key)) return false;
  return !keys.includes('garments') || onlyGarmentColour(prev.garments, next.garments);
}
// Viewing choices, not edits: they stay out of the undo history.
const noHistory = new Set(['lighting', 'animation', 'animationSpeed']);
// Camera framings (MetaHuman Creator: Face, Body…): [id, name, tooltip]. Not named like the sections.
const views = [['face', 'Rosto', 'Enquadrar o rosto'], ['body', 'Corpo inteiro', 'Corpo inteiro em ¾'], ['front', 'Frente', 'Corpo inteiro de frente'], ['side', 'Lado', 'Corpo inteiro de lado'], ['rear', 'Costas', 'Corpo inteiro de costas']];
// Hair tools by purpose: [id, name, icon, { shortcut }] (hair-editor.mjs).
const hairToolGroups = [
  ['Criar', [['brush', 'Pincel', 'sculpt', { shortcut: 'B' }], ['fill', 'Preencher', 'plus', { shortcut: 'F' }]]],
  ['Modelar', [['retouch', 'Retocar', 'comb', { shortcut: 'R' }], ['volume', 'Volume', 'inflate', { shortcut: 'V' }], ['cut', 'Cortar', 'cut', { shortcut: 'C' }], ['erase', 'Borracha', 'eraser', { shortcut: 'E', title: 'Borracha: apaga as mechas que o traço tocar (E)' }]]],
  ['Selecionar', [['select', 'Selecionar', 'select', { shortcut: 'S' }]]],
];
const sculptTools = [['Pincéis', [['draw', 'Desenhar', 'sculpt', { title: 'Desenhar: levanta (ou afunda, com Ctrl) a superfície' }], ['inflate', 'Inflar', 'inflate', { title: 'Inflar: incha a região (Ctrl desincha)' }], ['grab', 'Arrastar', 'grab', { title: 'Arrastar: puxa a região junto com o mouse' }], ['smooth', 'Suavizar', 'smooth', { title: 'Suavizar: alisa saliências' }], ['flatten', 'Achatar', 'flatten', { title: 'Achatar: aplaina a região' }], ['pinch', 'Pinçar', 'pinch', { title: 'Pinçar: junta a superfície numa dobra fina' }]]]];
const brushNames = Object.fromEntries(sculptTools[0][1].map(([id, name]) => [id, name]));
const clothToolGroups = [
  ['Ver', [['look', 'Só olhar', 'orbit', { title: 'Só olhar: o botão esquerdo gira a câmera' }]]],
  ['Peça', [['edges', 'Bordas', 'grow', { title: 'Bordas: arraste a barra, a manga, o decote ou a cintura no 3D' }], ['clothAdd', 'Cobrir', 'paintAdd', { title: 'Cobrir: pinte no corpo onde a peça deve chegar' }], ['clothErase', 'Descobrir', 'paintErase', { title: 'Descobrir: pinte no corpo onde a peça não deve cobrir' }]]],
  ['Molde', [['clothSculpt', 'Esculpir', 'sculpt', { title: 'Esculpir a roupa com os pincéis' }], ['clothPin', 'Fixar', 'pin', { title: 'Fixar: clique numa região do molde para prendê-la' }], ['clothUnpin', 'Soltar', 'unlock', { title: 'Soltar: clique numa região fixada' }]]],
];
// Cut-on-body garments edit edges and coverage; drafted (2D pattern) garments pin regions.
const surfaceOnly = ['edges', 'clothAdd', 'clothErase'], draftedOnly = ['clothPin', 'clothUnpin'];
const holderNames = { tie: 'Elástico', clip: 'Grampo', barrette: 'Fivela', band: 'Arco', tiara: 'Tiara' };
// [value, name, icon]: the choices show their icons, the names in the tooltips.
const shapes = { tips: [['round', 'Redondas', 'tipRound'], ['point', 'Finas', 'tipPoint'], ['flat', 'Retas', 'tipFlat']], forms: [['straight', 'Lisa', 'straight'], ['wavy', 'Ondulada', 'wavy'], ['curl', 'Cacheada', 'curly']] };
const choices = list => list.map(([, name, glyph]) => [name, glyph]);
const formOf = curl => curl > 0.6 ? 2 : curl > 0 ? 1 : 0;
const patternNames = { solid: 'Liso', stripes: 'Listras', pinstripe: 'Risca de giz', checks: 'Xadrez', gradient: 'Degradê' };
// The 52 ARKit face shapes in plain words (the ARKit name stays in the tooltip: it is what face-capture tools send).
const arkitWords = {
  eyeBlink: 'Piscar', eyeLookDown: 'Olhar para baixo', eyeLookIn: 'Olhar para dentro', eyeLookOut: 'Olhar para fora', eyeLookUp: 'Olhar para cima', eyeSquint: 'Apertar o olho', eyeWide: 'Arregalar',
  jawForward: 'Queixo para a frente', jawLeft: 'Mandíbula para a esquerda', jawRight: 'Mandíbula para a direita', jawOpen: 'Abrir a boca',
  mouthClose: 'Fechar os lábios', mouthFunnel: 'Boca em "ô"', mouthPucker: 'Bico', mouthLeft: 'Boca para a esquerda', mouthRight: 'Boca para a direita', mouthSmile: 'Sorriso', mouthFrown: 'Canto para baixo',
  mouthDimple: 'Covinha', mouthStretch: 'Esticar o canto', mouthRollLower: 'Enrolar o lábio de baixo', mouthRollUpper: 'Enrolar o lábio de cima', mouthShrugLower: 'Erguer o lábio de baixo',
  mouthShrugUpper: 'Erguer o lábio de cima', mouthPress: 'Apertar os lábios', mouthLowerDown: 'Baixar o lábio de baixo', mouthUpperUp: 'Subir o lábio de cima',
  browDown: 'Franzir', browInnerUp: 'Erguer o meio das sobrancelhas', browOuterUp: 'Erguer a ponta da sobrancelha',
  cheekPuff: 'Encher as bochechas', cheekSquint: 'Subir a bochecha', noseSneer: 'Torcer o nariz', tongueOut: 'Língua para fora',
};
const arkitLabel = name => {
  if (arkitWords[name]) return arkitWords[name];
  const base = name.replace(/(Left|Right)$/, '');
  return arkitWords[base] ? `${arkitWords[base]} (${name.endsWith('Left') ? 'esq.' : 'dir.'})` : name;
};
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
    window.addEventListener('keydown', event => this.onShortcut(event));
    this.render(); this.renderStatus();
  }
  /** Keys of the whole studio: 1–7 open the sections, ? lists keys and mouse (the hair tools' letters are in main.mjs). */
  onShortcut(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (event.target.matches?.('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]')) return;
    if (event.key === '?') { event.preventDefault(); if (this.shortcutsMenu.panel.hidden) this.shortcutsMenu.open(); else this.shortcutsMenu.close(true); return; }
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && sections[index] && /^[1-9]$/.test(event.key)) { event.preventDefault(); this.setSection(sections[index].id); }
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

  /**
   * The cards float over the stage: the renderer centres its projection in the
   * free area between them (renderer.centerShift, px), so the character is
   * framed in the middle of what the user sees, not behind the panel.
   */
  updateCenter() {
    if (!this.renderer) return;
    const view = this.app.querySelector('.viewport').getBoundingClientRect();
    const right = (box => box.width ? view.right - box.left : 0)(this.app.querySelector('.inspector').getBoundingClientRect());
    const left = Math.max(...[this.nav, this.toolRail].map(node => { const box = node.getBoundingClientRect(); return box.width ? box.right - view.left : 0; }));
    this.renderer.centerShift = (right - left) / 2;
  }
  attachRenderer(renderer) {
    this.renderer = renderer;
    window.addEventListener('resize', () => this.updateCenter());
    queueMicrotask(() => this.updateCenter());
    const editor = renderer.lockEditor;
    // The editor's callbacks are set once and feed the store's operations and status.
    // The hair editor has no background work (no live gravity): it only reports changes.
    editor.onChange = () => this.locksChanged();
    this.editorHistory = { undo: () => editor.undo(), redo: () => editor.redo(), canUndo: () => editor.undoStack.length > 0, canRedo: () => editor.redoStack.length > 0 };
    this.queueCharacter();
    this.applyMode();
    // The body (with hair, no clothes) shows in about 2 s while the garments drape; the dressed
    // character replaces it. A cached character arrives sooner, so the preview starts only if
    // nothing is on screen after 0.8 s (it would only compete for the CPU).
    setTimeout(() => {
      if (renderer.current) return;
      renderer.showPreview(this.snapshotPerson()).then(() => {
        if (!renderer.preview) return;
        this.store.progress('build', 'Vestindo a roupa…');
        this.updateMeta(); this.scheduleRender();
      });
    }, 800);
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
  /** Open a section and frame the camera on what it edits (the hair editor frames the head itself). */
  setSection(name) {
    closePopovers();
    if (name === this.section) return;
    const distance = this.renderer?.camera.distance;
    this.store.dispatch({ type: 'ui/set', changes: { section: name } });
    const view = sections.find(s => s.id === name)?.view;
    if (this.state.ui.crowd) return;
    if (view) this.chooseView(view);
    else if (this.renderer && this.renderer.camera.distance !== distance) this.viewMoved();
  }
  pickTool(id) { this.store.dispatch({ type: 'ui/tool', section: this.section, tool: this.section === 'roupas' && id === 'look' ? null : id }); }
  generateVariation() {
    this.setPerson(varyCharacter(this.snapshotPerson()));
    this.toast('Outra pessoa sorteada', 'info', this.undoAction());
  }
  /** A toast button that takes back the last change of the character (only while undo goes to the character). */
  undoAction() { return this.store.historyTarget ? null : { label: 'Desfazer', run: () => this.store.undo() }; }
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
    } else if (build.length && lookOnly(prev, next, build) && this.renderer?.current) {
      // Colours: on screen at once; a click or a closed picker bakes them into the textures.
      this.renderer.liveLook(next, { garments: build.includes('garments') });
      if (action.live) this.pendingBake = true; else this.renderer.bakeLook(next);
    } else if (build.length && action.rebuild !== false) this.queueCharacter(action.rebuild ?? 80);
    this.updateMeta();
    this.scheduleAutosave();
  }
  /** End of a drag: the full build (drape, hair gravity, facial rig) refines what was shown live. */
  commitLive() {
    if (this.pendingBake) { this.pendingBake = false; this.renderer?.bakeLook(this.person); }
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
    // Posing lives in Animação and only while the viewport is otherwise just for looking.
    r.setPoseMode(mode === 'view' && this.section === 'animacao' && Boolean(this.state.ui.posing));
    r.setMoldMode(mode === 'view' && ['corpo', 'rosto'].includes(this.section) && Boolean(this.state.ui.molding));
  }
  /** The viewport's left button pulls the body into shape (main.mjs). */
  get molding() { return Boolean(this.renderer?.moldMode); }
  /** A Moldar drag step: the adjustment that follows the pointer, shown live. */
  moldTo(change) {
    if (!change) return;
    this.setHint(`Moldando: ${change.label}`);
    // One drag is one undo step, however long it pauses: only its first change records the state before it.
    const gesture = this.renderer.shapeHandles.drag, first = gesture !== this.moldGesture;
    this.moldGesture = gesture;
    this.setMorph(change.key, Math.round(change.value * 1000) / 1000, { live: true, history: first ? true : false });
  }
  /** The viewport's left button picks bones and drags the gizmo while posing (main.mjs). */
  get posing() { return Boolean(this.renderer?.poseMode); }
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
  /** A short message over the viewport; `action` ({ label, run }) adds a button, e.g. "Desfazer" (NN/g: undo rather than confirm). */
  toast(text, level = 'info', action = null) {
    this.store.emit('toast', { text, level, action });
    if (level === 'error') this.notify(text, 'error');
  }
  showToast({ text, level, action }) {
    const host = document.getElementById('toasts');
    const node = h('div', { class: `toast ${level}`, role: level === 'error' ? 'alert' : 'status' }, icon(level === 'error' ? 'info' : 'check', 16), h('span', { text }),
      action ? h('button', { type: 'button', class: 'button small', onclick: () => { node.remove(); action.run(); } }, action.label) : null);
    host.append(node);
    while (host.childElementCount > 3) host.firstElementChild.remove();
    // A toast with a button stays long enough to reach it, and never leaves while the pointer is on it.
    let timer = setTimeout(() => node.remove(), action ? 10000 : level === 'error' ? 7000 : 3500);
    node.addEventListener('pointerenter', () => clearTimeout(timer));
    node.addEventListener('pointerleave', () => { timer = setTimeout(() => node.remove(), 2500); });
  }
  renderStatus() {
    const op = this.store.currentOperation;
    const text = op ? op.label : this.status.text, level = op ? 'busy' : this.status.level;
    document.querySelector('.status-dot').className = `status-dot ${level}`;
    document.getElementById('readyLabel').textContent = text;
    document.getElementById('cancelOperation').hidden = ![...this.store.operations.values()].some(o => o.cancellable);
    // The same work shown over the 3D view, where the change will appear (the footer announces it).
    document.getElementById('busyPill').hidden = !op;
    document.getElementById('busyText').textContent = op ? op.label : '';
  }
  fail(message) {
    this.notify('Erro no 3D', 'error');
    document.getElementById('errorText').textContent = message;
    document.getElementById('restoreCharacter').textContent = this.renderer?.current ? 'Manter personagem anterior' : 'Usar personagem padrão';
    document.getElementById('errorPanel').hidden = false;
  }
  updateMeta() {
    const measured = this.renderer?.current?.metrics.height ?? this.person.heightMeters, crowd = this.state.ui.crowd;
    const name = document.getElementById('characterName');
    if (document.activeElement !== name) name.value = this.person.name;
    name.style.width = `${Math.min(28, Math.max(10, Math.ceil(this.person.name.length * 1.15) + 3))}ch`;
    document.getElementById('characterMeta').textContent = `${measured.toFixed(2).replace('.', ',')} m${crowd ? ` · ${crowd + 1} pessoas` : ''}`;
  }
  updateHistoryButtons() {
    const undo = document.getElementById('undoButton'), redo = document.getElementById('redoButton');
    if (undo) undo.disabled = !this.store.canUndo;
    if (redo) redo.disabled = !this.store.canRedo;
  }
  updateStats(stats) {
    if (!stats) return;
    this.stats = stats;
    // Frame rate and triangles are diagnostics: they live in the Desempenho panel, not on screen all the time.
    const metrics = document.getElementById('crowdMetrics');
    if (metrics && !metrics.closest('[hidden]')) {
      const rows = [['Quadros por segundo', stats.fps], ['Quadro', `${stats.frameTime.toFixed(1)} ms`], ['Chamadas de desenho', stats.draws], ['Triângulos', stats.triangles.toLocaleString('pt-BR')],
        ['Esqueletos', stats.skeletons], ['Rostos com rig', stats.faces], ['Pessoas visíveis', stats.visible], ['LOD 0 / 1 / 2', stats.lod.slice(0, 3).join(' / ')]];
      metrics.replaceChildren(...rows.flatMap(([label, value]) => [h('span', { text: label }), h('b', { text: String(value) })]));
    }
  }

  // ------------------------------------------------------------ chrome
  buildNav() {
    sections.forEach((section, i) => {
      if (section.divider) this.nav.append(h('div', { class: 'rail-divider', role: 'separator' }));
      this.nav.append(h('button', { class: 'nav-item', type: 'button', 'data-section': section.id, title: `${section.title ?? section.name} (${i + 1}): ${section.lead}`, 'aria-keyshortcuts': String(i + 1), onclick: () => this.setSection(section.id) },
        icon(section.icon, 22), h('span', { class: 'nav-label', text: section.name })));
    });
  }
  bindChrome() {
    const $ = id => document.getElementById(id);
    for (const node of document.querySelectorAll('[data-icon]')) node.replaceWith(icon(node.dataset.icon, Number(node.dataset.size ?? 18)));
    // The name is edited in the top bar, where it is shown; Enter or leaving the field keeps it, Esc puts it back.
    const name = $('characterName');
    name.addEventListener('change', () => { const value = name.value.trim(); if (value && value !== this.person.name) this.update('name', value); else name.value = this.person.name; });
    name.addEventListener('keydown', event => {
      if (event.key === 'Enter') name.blur();
      if (event.key === 'Escape') { name.value = this.person.name; name.blur(); }
    });
    this.randomMenu = popover($('randomButton'), $('randomMenu'), () => this.renderRandomMenu());
    this.shortcutsMenu = popover($('shortcutsButton'), $('shortcutsMenu'), () => this.renderShortcutsMenu());
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
    for (const [id, label, title] of views) viewRow.append(h('button', { type: 'button', 'data-view': id, 'aria-pressed': 'false', title, onclick: () => this.chooseView(id), text: label }));
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
    )) : h('p', { class: 'menu-empty', text: 'Nenhum personagem salvo.' }));
    menu.replaceChildren(
      h('div', { class: 'menu-title', text: 'Personagens salvos' }), list,
      h('div', { class: 'menu-actions' },
        h('button', { type: 'button', class: 'button primary', onclick: () => { this.savePreset(); this.renderCharactersMenu(); } }, icon('save', 16), `Salvar "${this.person.name}"`),
        h('button', { type: 'button', class: 'button', title: 'Começar de novo pelo personagem padrão (dá para desfazer)', onclick: () => {
          this.setPerson(defaultCharacter); this.setCrowd(0); this.charactersMenu.close(true);
          this.toast('Novo personagem a partir do padrão', 'info', this.undoAction());
        } }, icon('plus', 16), 'Novo')),
    );
  }
  /** Sortear: one big action, and what to keep from the current person (chips that read as they work). */
  renderRandomMenu() {
    const menu = document.getElementById('randomMenu'), locks = this.person.creation.locks;
    menu.replaceChildren(
      h('div', { class: 'menu-title', text: 'Sortear outra pessoa' }),
      h('div', { class: 'menu-body' },
        h('p', { class: 'option-label', text: 'Manter da pessoa atual' }),
        toggleChips({ label: 'Manter da pessoa atual', items: [['Corpo e pele', locks.body], ['Rosto e olhos', locks.face], ['Cabelo', locks.hair], ['Roupa', locks.clothes]],
          onToggle: (i, on) => { const key = ['body', 'face', 'hair', 'clothes'][i]; this.patch({ creation: { locks: { ...this.person.creation.locks, [key]: on } } }, { history: false }); } }),
        h('button', { type: 'button', class: 'button primary wide big', onclick: () => { this.randomMenu.close(true); this.generateVariation(); } }, icon('dice', 18), 'Sortear'),
        h('p', { class: 'option-label', text: 'Sortear só uma parte' }),
        h('div', { class: 'button-row' },
          h('button', { type: 'button', class: 'button', onclick: () => { this.randomFace(); this.toast('Rosto sorteado', 'info', this.undoAction()); } }, 'Rosto'),
          h('button', { type: 'button', class: 'button', onclick: () => { this.randomBody(); this.toast('Corpo sorteado', 'info', this.undoAction()); } }, 'Corpo'),
          h('button', { type: 'button', class: 'button', onclick: () => { this.randomOutfit(); this.toast('Roupa sorteada', 'info', this.undoAction()); } }, 'Roupa'))),
    );
  }
  /** Keys and mouse for the whole studio and for the section and tool in use (MetaHuman Creator: the hotkeys list follows the tool). */
  renderShortcutsMenu() {
    const keys = list => h('dl', { class: 'shortcut-list' }, list.flatMap(([combo, text]) => [h('dt', {}, combo.split(' ').map(k => h('kbd', { text: k }))), h('dd', { text })]));
    const general = [['Ctrl Z', 'Desfazer'], ['Ctrl Y', 'Refazer'], ['1–7', 'Trocar de seção'], ['?', 'Esta lista'], ['Esc', 'Fechar menus']];
    const mouse = [['Direito', 'Girar em volta do ponto sob o cursor'], ['Meio', 'Mover a vista'], ['Roda', 'Zoom no cursor']];
    const tools = (this.toolGroups() ?? []).flatMap(([, list]) => list).filter(([, , , o]) => o?.shortcut).map(([, name, , o]) => [o.shortcut, name]);
    const section = sections.find(s => s.id === this.section);
    const extra = this.section === 'cabelo' ? [['[ ]', 'Diminuir / aumentar o círculo'], ['+ −', 'Alongar / encurtar as mechas escolhidas'], ['Delete', 'Apagar as mechas selecionadas'], ['Shift', 'Somar à seleção'], ['Ctrl', 'Tirar da seleção']]
      : this.section === 'esculpir' ? [['Ctrl', 'Inverter o pincel durante o traço']]
      : ['corpo', 'rosto'].includes(this.section) ? [['Alt', 'Moldar: muda só um lado']] : [];
    document.getElementById('shortcutsMenu').replaceChildren(
      h('div', { class: 'menu-title', text: 'Teclas e mouse' }),
      h('div', { class: 'shortcut-group', text: 'Sempre' }), keys(general),
      h('div', { class: 'shortcut-group', text: 'No 3D' }), keys(mouse),
      ...(tools.length || extra.length ? [h('div', { class: 'shortcut-group', text: section.title ?? section.name }), keys([...tools, ...extra])] : []),
    );
  }
  renderExportMenu() {
    const menu = document.getElementById('exportMenu'), options = this.state.ui.export;
    const set = changes => this.store.dispatch({ type: 'ui/export', changes, live: true });
    // Short names on the buttons; what each one means in its tooltip (no explanatory text in the menu).
    const choose = (label, key, entries, title) => {
      const node = segmented({ label, items: entries.map(e => e[1]), selected: entries.findIndex(e => e[0] === options[key]), onPick: i => set({ [key]: entries[i][0] }) });
      node.querySelectorAll('button').forEach((button, i) => { if (entries[i][2]) button.title = entries[i][2]; });
      if (title) node.title = title;
      return node;
    };
    const flag = (label, key, title) => toggle({ label, checked: options[key], title, onChange: on => set({ [key]: on }) });
    let triangles = 0, meshes = 0;
    this.renderer?.current?.group?.traverse(object => { if (object.isMesh && object.visible && object.geometry.index) { triangles += object.geometry.index.count / 3; meshes++; } });
    const face = this.renderer?.current?.faceMeshes?.[0];
    menu.replaceChildren(
      h('div', { class: 'menu-title', text: 'Exportar GLB para jogos' }),
      h('div', { class: 'menu-body' },
        choose('Esqueleto', 'skeleton', [['unreal', 'Unreal', 'Nomes do UE4 Mannequin (Unreal)'], ['mixamo', 'Mixamo', 'Nomes do Mixamo (Unity Humanoid, Godot, bibliotecas de animação)']]),
        choose('Detalhe', 'lod', [['high', 'Alto', 'LOD0: detalhe máximo'], ['medium', 'Médio', 'LOD1: metade dos triângulos, com expressões'], ['low', 'Baixo', 'LOD2: um décimo dos triângulos'], ['all', 'Pacote', 'Pacote LOD: LOD0, LOD1 e LOD2 num .zip, mesmo esqueleto, malhas _LODn']]),
        choose('Pelos', 'groom', [['cards', 'Cartões', 'Sobrancelhas e cílios em faixas com textura (leve)'], ['strands', 'Fios', 'Sobrancelhas e cílios em fios (mais detalhe)']], 'Sobrancelhas e cílios'),
        flag('Animações', 'animations', '16 clipes'),
        flag('Expressões faciais', 'blendshapes', '52 blendshapes ARKit (olhar, boca, língua…)'),
        flag('Otimizar', 'optimize', 'Solda vértices, junta as malhas em Body e Head e usa JPEG'),
        flag('Brilho dos olhos', 'cosmetic', 'Camadas extras de brilho dos olhos'),
        h('div', { class: 'metric-list', title: 'Medidas do personagem na tela; com Otimizar, o GLB junta as malhas em Body e Head' }, [['Triângulos', triangles.toLocaleString('pt-BR')], ['Malhas na tela', meshes], ['Ossos', this.renderer?.current?.body.skeleton.bones.length ?? '—'], ['Blendshapes', face ? Object.keys(face.morphTargetDictionary).length : 0]]
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
    this.heightField = null; this.openInRender = false;
    this.body.replaceChildren();
    const section = sections.find(s => s.id === this.section);
    document.getElementById('sectionTitle').textContent = section.title ?? section.name;
    // No descriptive line under the title (the user: no explanatory text in the panel); the section's purpose is in the rail tooltip.
    for (const button of this.nav.querySelectorAll('.nav-item')) {
      const active = button.dataset.section === this.section;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    this.setHint(hints.default);
    // The panel widens only for the 2D pattern editor, which needs the room; otherwise the 3D view keeps it.
    this.app.classList.toggle('pattern-mode', this.section === 'roupas' && this.person.outfit === 4 && this.isDrafted());
    ({
      personagem: () => this.renderCharacter(), corpo: () => this.renderBody(), rosto: () => this.renderFace(),
      cabelo: () => this.renderHair(), roupas: () => this.renderClothes(), esculpir: () => this.renderSculpt(),
      animacao: () => this.renderAnimation(),
    })[this.section]();
    this.renderTools();
    this.body.scrollTop = scroll;
    this.updateMeta(); this.updateHistoryButtons(); this.renderViewButtons();
    restoreFocus(this.app, focus);
    this.updateCenter();
  }
  /** The section's tools in the rail beside the sections, and the active tool's options over the viewport. */
  renderTools() {
    const groups = this.toolGroups();
    this.app.classList.toggle('has-tools', Boolean(groups));
    this.toolRail.hidden = !groups; this.toolCard.hidden = !groups;
    if (!groups) { this.toolRail.replaceChildren(); this.toolCard.replaceChildren(); return; }
    const active = this.activeTool(), section = sections.find(s => s.id === this.section);
    toolbar(this.toolRail, { groups, active, label: `Ferramentas: ${section.title ?? section.name}`, onPick: id => this.pickTool(id) });
    this.toolRail.title = this.toolNote() ?? '';
    const [name, glyph, extra] = groups.flatMap(([, list]) => list).find(([id]) => id === active)?.slice(1) ?? ['', null];
    const shortcut = extra?.shortcut;
    const options = h('div', { class: 'tool-card-body', id: 'toolCardBody' });
    if (this.section === 'cabelo') this.renderHairToolOptions(options, active);
    if (this.section === 'esculpir') this.renderSculptToolOptions(options);
    if (this.section === 'roupas') this.renderClothToolOptions(options, active);
    const open = this.state.ui.toolPanel, hasOptions = options.childElementCount > 0;
    this.toolCard.classList.toggle('collapsed', !open || !hasOptions);
    // replaceChildren turns null into the text "null": only real nodes are passed.
    this.toolCard.replaceChildren(...[
      h('div', { class: 'tool-card-head', title: extra?.title ?? name }, glyph ? icon(glyph, 18) : null, h('span', { class: 'tool-card-title', text: name }), shortcut ? h('kbd', { text: shortcut, title: `Tecla ${shortcut}` }) : null,
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
      // Only the tools this piece's construction offers; the note under the rail says why the others are missing.
      const drafted = this.isDrafted();
      return clothToolGroups.map(([label, list]) => [label, list.filter(([id]) => !(drafted && surfaceOnly.includes(id)) && !(!drafted && draftedOnly.includes(id)))]).filter(([, list]) => list.length);
    }
    return null;
  }
  toolNote() {
    if (this.section !== 'roupas' || this.person.outfit !== 4 || !this.currentGarment()) return null;
    return this.isDrafted() ? 'Peça feita por moldes: bordas e cobertura se mudam nos moldes.' : 'Fixar e soltar valem para peças feitas por moldes.';
  }
  activeTool() {
    if (this.section === 'roupas') return this.clothTool() ?? 'look';
    if (this.section === 'cabelo') return this.hairTool();
    return this.state.ui.tools[this.section];
  }
  /** The hair tool in effect (a tool saved by an older version falls back to the brush). */
  hairTool() { const tool = this.state.ui.tools.cabelo; return hairTools.includes(tool) ? tool : 'brush'; }
  // Controls bound to this UI: groups remember their state; sliders mark a drag in progress.
  group(title, { open = true, advanced = false, badge, key: id } = {}) {
    const key = `${this.section}:${id ?? title}`;
    // One group open per panel: the first one that asks to be open (saved or by default) wins.
    let saved = this.state.ui.groups[key] ?? open;
    if (saved && this.openInRender) saved = false;
    if (saved) this.openInRender = true;
    // An accordion: opening a group closes the others, so one section's controls are on screen at a time.
    const body = group(this.body, { title, open: saved, advanced, badge, onToggle: value => {
      this.store.dispatch({ type: 'ui/group', key, open: value, live: true });
      if (!value) return;
      for (const other of this.body.querySelectorAll(':scope > details.group[open]')) {
        if (other === body.parentElement) continue;
        other.open = false;
        this.store.dispatch({ type: 'ui/group', key: other.dataset.key, open: false, live: true });
      }
    } });
    body.parentElement.dataset.key = key;
    return body;
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
  range(parent, key, label, min, max, step = 0.01, unit = '', { ends, title } = {}) {
    // A slider between two named qualities reads as a percentage, not a raw −1…1 number.
    const percent = Boolean(ends) && !unit;
    return this.slide(parent, { label, title, ends, value: this.person[key], min, max, step, unit: percent ? '%' : unit, scale: percent ? 100 : 1, key, onInput: v => this.update(key, v, { live: true }), onEnd: () => { this.commitLive(); this.scheduleRender(); } });
  }
  /** A row of picture presets with short names (body types, ages): items are [name, glyph, apply]. */
  presetCards(parent, items, selected) {
    parent.append(h('div', { class: 'preset-row', role: 'group' }, items.map(([name, glyph, apply], i) => h('button', {
      type: 'button', class: `preset${i === selected ? ' on' : ''}`, 'aria-pressed': String(i === selected), title: name,
      onclick: () => { apply(); this.scheduleRender(); },
    }, icon(glyph, 26), h('span', { text: name })))));
  }
  /** Sliders between two named qualities: [key, label, [less, more], min = −1, max = 1]. */
  ranges(parent, list) { for (const [key, label, ends, min = -1, max = 1] of list) this.range(parent, key, label, min, max, 0.01, '', { ends }); }
  segmented(parent, label, items, selected, onPick) { parent.append(segmented({ label, items, selected, onPick: i => { onPick(i); this.scheduleRender(); } })); }
  toggle(parent, label, checked, onChange, title, id) { parent.append(toggle({ label, checked, onChange, title, id })); }
  colorSwatches(parent, key, label, palette, colorKey, names) {
    parent.append(swatches({
      label, palette, names, selected: key ? this.person[key] : null, custom: this.person.colors[colorKey] ?? null,
      onPick: i => { const colors = { ...this.person.colors }; delete colors[colorKey]; this.patch({ colors, ...(key ? { [key]: i } : {}) }, { history: `color:${colorKey}` }); },
      onCustom: (hex, { live = false } = {}) => this.patch({ colors: { ...this.person.colors, [colorKey]: hex } }, { history: `color:${colorKey}`, live }),
    }));
  }

  // ------------------------------------------------------------ sections
  /** Pessoa: who this is (sex, age, height), the skin and the ancestry blend; the name is edited in the top bar. */
  renderCharacter() {
    const id = this.group('Quem é');
    this.segmented(id, 'Sexo', ['Feminino', 'Masculino'], this.person.gender, v => this.update('gender', v));
    // Age as pictures first (The Sims' life stages), the exact age in the slider under them.
    const ages = [['Criança', 'ageChild', 8], ['Jovem', 'ageTeen', 17], ['Adulto', 'ageAdult', 35], ['Idoso', 'ageElder', 72]];
    const stage = this.person.ageYears < 13 ? 0 : this.person.ageYears < 25 ? 1 : this.person.ageYears < 60 ? 2 : 3;
    this.presetCards(id, ages.map(([name, glyph, years]) => [name, glyph, () => this.update('ageYears', years)]), stage);
    this.range(id, 'ageYears', 'Idade', 1, 90, 1, ' anos');
    const [min, max] = this.heightBounds();
    this.heightField = this.range(id, 'heightMeters', 'Altura', min, max, 0.01, ' m', { title: 'Altura (a idade sugere uma altura típica)' });
    const skin = this.group('Pele');
    this.colorSwatches(skin, 'skin', 'Tom', skinPalette, 'skin', ['Muito clara', 'Clara', 'Clara média', 'Média', 'Morena', 'Morena escura', 'Escura', 'Muito escura']);
    this.range(skin, 'skinRoughness', 'Acabamento', 0, 1, 0.01, '', { ends: ['Brilhante', 'Fosca'] });
    // Ancestry: traits of face and body; what counts is the proportion among the three (macro.mjs normalises them).
    const ancestry = this.group('Origem', { open: false });
    this.ranges(ancestry, [['african', 'Africana', ['Pouco', 'Muito'], 0, 1], ['asian', 'Asiática', ['Pouco', 'Muito'], 0, 1], ['caucasian', 'Europeia', ['Pouco', 'Muito'], 0, 1]]);
  }
  /** Value of a MakeHuman regional adjustment: its own field when it has one, else `morphs`. */
  morphValue(key) { const field = namedFeatures[key]; return field ? this.person[field] ?? 0 : this.person.morphs[key] ?? 0; }
  setMorph(key, value, { live = false, history = `morph:${key}` } = {}) {
    const field = namedFeatures[key];
    if (field) { this.patch({ [field]: value }, { history, live }); return; }
    const morphs = { ...this.person.morphs };
    if (value) morphs[key] = value; else delete morphs[key];
    this.patch({ morphs }, { history, live });
  }
  /**
   * Moldar: pull the body in the view (Sims 4's direct manipulation). A big
   * switch at the top of Corpo and Rosto that says what it does, with the
   * symmetry under it while it is on.
   */
  renderMoldCard(part) {
    // One line at the top of the panel: the switch and, beside it, symmetry (instructions go to the footer hint and the tooltip).
    const on = Boolean(this.state.ui.molding), handles = this.renderer?.shapeHandles;
    const mirror = h('button', { type: 'button', class: `icon-button${handles?.symmetry ? ' on' : ''}`, 'aria-pressed': String(Boolean(handles?.symmetry)), title: 'Simetria: os dois lados juntos', 'aria-label': 'Simetria',
      onclick: event => { if (!handles) return; handles.symmetry = !handles.symmetry; event.currentTarget.classList.toggle('on', handles.symmetry); event.currentTarget.setAttribute('aria-pressed', String(handles.symmetry)); } }, icon('mirror', 18));
    this.body.append(h('div', { class: 'group' }, h('div', { class: 'mode-row' },
      h('button', { type: 'button', class: `mode-card${on ? ' on' : ''}`, 'aria-pressed': String(on), title: `Moldar ${part}: arraste a parte no 3D (Alt: só um lado)`, onclick: () => this.store.dispatch({ type: 'ui/set', changes: { molding: !on } }) },
        icon('grab', 18), h('span', { text: on ? 'Moldando no 3D' : 'Moldar no 3D' })),
      on ? mirror : null)));
    if (on) this.setHint('Arraste a parte para mudá-la · Alt: só um lado · botão direito: girar');
  }
  /**
   * Every MakeHuman regional adjustment of `regions`, behind one advanced
   * group: a search by name across the regions and "only the changed ones"
   * (Character Creator's Morphs tab: search, Currently Used), else one region.
   */
  renderDetailed(regions, body) {
    const morpher = this.renderer?.current?.context.data.morpher;
    if (!morpher) { body.append(h('p', { class: 'empty-note', text: 'Carregando…' })); return; }
    const all = [...morpher.sliders].filter(([, { group }]) => regions.includes(group));
    const changed = all.filter(([name]) => this.morphValue(name)).length;
    const region = regions.includes(this.state.ui.morphRegion) ? this.state.ui.morphRegion : regions[0];
    const list = h('div', { class: 'morph-list' });
    // Typing filters the list in place (no panel rebuild, the caret stays where it is).
    const fill = () => {
      const query = (this.morphQuery ?? '').trim().toLowerCase(), only = Boolean(this.morphChanged);
      const words = query.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
      // categoryLabel drops the side prefix (l-/r-): put it back, or left and right read the same.
      // Short names: the region is already chosen (or shown before the name), so its word is not repeated; "measure" reads "medida".
      const bare = (name, group) => {
        const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const words = categoryLabel(name).replace(/^measure\s+/i, 'medida ').split(' '), region = fold(regionNames[group] ?? group);
        const kept = words.length > 1 && fold(words[0]) === region ? words.slice(1) : words;
        const text = kept.join(' ');
        return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
      };
      const named = (name, group) => `${bare(name, group)}${name.startsWith('l-') ? ' (esq.)' : name.startsWith('r-') ? ' (dir.)' : ''}`;
      const label = (name, group) => `${query || only ? `${regionNames[group] ?? group} · ` : ''}${named(name, group)}`;
      const matches = all.filter(([name, { group }]) => {
        if (only && !this.morphValue(name)) return false;
        if (!words.length) return only || group === region;
        const text = `${regionNames[group] ?? group} ${categoryLabel(name)} ${name}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        return words.every(word => text.includes(word));
      });
      list.replaceChildren();
      // Left and right of one adjustment share a line (two tracks, E and D).
      const shown = new Set(matches.map(([name]) => name));
      for (const [name, { group, category }] of matches.slice(0, 60)) {
        const min = category.opposites ? -1 : 0, end = () => { this.commitLive(); this.scheduleRender(); };
        if (name.startsWith('r-') && shown.has(`l-${name.slice(2)}`)) continue;
        if (name.startsWith('l-') && shown.has(`r-${name.slice(2)}`)) {
          const both = [name, `r-${name.slice(2)}`], pairLabel = `${query || only ? `${regionNames[group] ?? group} · ` : ''}${bare(name, group)}`;
          list.append(sliderPair({ label: pairLabel, title: `${regionNames[group] ?? group} · ${pairLabel} (${both.join(' / ')})`, min, onEnd: end, sides: both.map(n => ({ value: this.morphValue(n), onInput: v => this.setMorph(n, v, { live: true }) })) }));
          continue;
        }
        this.slide(list, { label: label(name, group), title: `${regionNames[group] ?? group} · ${named(name, group)} (${name})`, value: this.morphValue(name), min, max: 1, center: true,
          onInput: v => this.setMorph(name, v, { live: true }), onEnd: end });
      }
      if (!matches.length) list.append(h('p', { class: 'empty-note', text: only ? 'Nenhum ajuste alterado ainda.' : 'Nenhum ajuste com esse nome.' }));
      if (matches.length > 60) list.append(h('p', { class: 'empty-note', text: `Mostrando 60 de ${matches.length}. Refine a busca.` }));
      regionChips.hidden = Boolean(words.length || only);
    };
    const regionChips = chips({ label: 'Região', items: regions.map(id => regionNames[id] ?? id), selected: regions.indexOf(region), onPick: i => this.store.dispatch({ type: 'ui/set', changes: { morphRegion: regions[i] } }) });
    body.append(
      searchField({ label: 'Buscar ajuste', placeholder: 'Buscar: nariz, ponta, queixo…', value: this.morphQuery ?? '', onInput: value => { this.morphQuery = value; fill(); } }),
      toggleChips({ label: 'Filtro', items: [[`Só os alterados (${changed})`, this.morphChanged]], onToggle: (_, on) => { this.morphChanged = on; fill(); } }),
      regionChips, list);
    fill();
  }
  /**
   * The section's one "Avançado" group, last (NN/g progressive disclosure: two
   * levels, the second clearly named). Several parts take turns behind a
   * segmented switch instead of nesting further. `parts` is [[name, render(body)]].
   */
  renderAdvanced(parts) {
    const body = this.group('Avançado', { open: false, advanced: true });
    const at = Math.max(0, parts.findIndex(([name]) => name === this.advancedPart?.[this.section]));
    if (parts.length > 1) body.append(segmented({ items: parts.map(([name]) => name), selected: at, onPick: i => { this.advancedPart = { ...this.advancedPart, [this.section]: parts[i][0] }; this.scheduleRender(); } }));
    const holder = h('div', { class: 'advanced-part' });
    body.append(holder);
    parts[at][1](holder);
  }
  /** Corpo: pull it (Moldar), the main proportions with named ends, the bust, tattoos, then every regional adjustment. */
  renderBody() {
    this.renderMoldCard('o corpo');
    // Body type as pictures (one click sets weight, muscle and shoulders), then the fine proportions.
    const shape = this.group('Proporções');
    const types = [['Magro', 'bodyThin', { build: -0.6, muscle: 0.3, shoulders: -0.2 }], ['Médio', 'bodyAverage', { build: 0, muscle: 0.5, shoulders: 0 }],
      ['Atlético', 'bodyAthletic', { build: -0.1, muscle: 0.9, shoulders: 0.35 }], ['Forte', 'bodyStrong', { build: 0.45, muscle: 0.85, shoulders: 0.45 }], ['Pesado', 'bodyHeavy', { build: 0.85, muscle: 0.4, shoulders: 0.1 }]];
    const near = types.map(([, , t]) => Math.abs(t.build - this.person.build) + Math.abs(t.muscle - this.person.muscle) + Math.abs(t.shoulders - this.person.shoulders));
    const best = near.indexOf(Math.min(...near));
    this.presetCards(shape, types.map(([name, glyph, changes]) => [name, glyph, () => this.patch(changes, { history: 'bodyType' })]), near[best] < 0.25 ? best : -1);
    // The ends say what each named MakeHuman target does (renderer-three.mjs namedFeatures): `waist` widens the torso, `headSize` stretches the head.
    this.ranges(shape, [['build', 'Peso', ['Magro', 'Pesado']], ['muscle', 'Músculos', ['Pouco', 'Muito'], 0, 1], ['shoulders', 'Ombros', ['Estreitos', 'Largos']],
      ['waist', 'Tronco', ['Estreito', 'Largo']], ['hips', 'Quadril', ['Estreito', 'Largo']], ['legLength', 'Coxas', ['Curtas', 'Longas']], ['headSize', 'Cabeça', ['Curta', 'Alongada']],
      ['proportions', 'Proporções', ['Comuns', 'Idealizadas'], 0, 1]]);
    shape.append(h('div', { class: 'icon-bar' }, iconButton('dice', 'Sortear o corpo', () => { this.randomBody(); this.toast('Corpo sorteado', 'info', this.undoAction()); })));
    const bust = this.group('Busto', { open: false });
    this.ranges(bust, [['cupsize', 'Tamanho', ['Pequeno', 'Grande'], 0, 1], ['firmness', 'Firmeza', ['Menos', 'Mais'], 0, 1]]);
    this.renderTattoos();
    this.renderAdvanced([['Ajustes detalhados', body => this.renderDetailed(['neck', 'torso', 'stomach', 'hip', 'buttocks', 'pelvis', 'arms', 'hands', 'legs', 'feet'], body)]]);
  }
  /** Rosto: pull it (Moldar), shape, eyes, expression, brows, lashes, makeup, then every regional adjustment. */
  renderFace() {
    this.renderMoldCard('o rosto');
    const shape = this.group('Formato');
    this.ranges(shape, [['faceWidth', 'Largura', ['Estreito', 'Largo']], ['jaw', 'Queixo', ['Estreito', 'Largo']], ['cheek', 'Bochechas', ['Magras', 'Cheias']], ['nose', 'Nariz', ['Rente', 'Saliente']]]);
    shape.append(h('div', { class: 'icon-bar' }, iconButton('dice', 'Sortear o rosto', () => { this.randomFace(); this.toast('Rosto sorteado', 'info', this.undoAction()); })));
    const eyes = this.group('Olhos');
    this.ranges(eyes, [['eyeSize', 'Tamanho', ['Menores', 'Maiores']], ['eyeSpacing', 'Distância', ['Juntos', 'Afastados']]]);
    this.colorSwatches(eyes, 'eyeColor', 'Cor', eyePalette, 'eyes', ['Castanho escuro', 'Castanho claro', 'Cinza', 'Verde', 'Azul', 'Cinza claro']);
    this.renderExpression();
    const brows = this.group('Sobrancelhas', { open: false });
    this.segmented(brows, 'Formato', [['Natural', 'browNatural'], ['Reta', 'browStraight'], ['Arqueada', 'browArched'], ['Angulosa', 'browAngled']], this.person.browShape, v => this.update('browShape', v));
    this.range(brows, 'browAngle', 'Inclinação', -25, 25, 1, '°');
    this.ranges(brows, [['browArch', 'Arco', ['Menos', 'Mais']], ['browThickness', 'Espessura', ['Fina', 'Grossa'], 0.35, 2.1], ['browWidth', 'Comprimento', ['Curta', 'Longa'], 0.7, 1.4],
      ['browHeight', 'Altura', ['Mais baixa', 'Mais alta']], ['browDensity', 'Densidade', ['Rala', 'Cheia'], 0, 1]]);
    this.colorSwatches(brows, null, 'Cor', hairPalette, 'brows', ['Preto', 'Castanho muito escuro', 'Castanho escuro', 'Castanho', 'Castanho claro', 'Loiro', 'Ruivo', 'Cinza escuro', 'Platinado']);
    const lashes = this.group('Cílios', { open: false });
    this.ranges(lashes, [['lashLength', 'Comprimento', ['Curtos', 'Longos'], 0.4, 1.8], ['lashCurl', 'Curvatura', ['Retos', 'Curvados'], 0, 1], ['lashDensity', 'Densidade', ['Ralos', 'Cheios'], 0, 1]]);
    this.colorSwatches(lashes, null, 'Cor', ['#201915', '#3a2a22', '#5b4636', '#11131a'], 'lashes', ['Castanho muito escuro', 'Castanho escuro', 'Castanho', 'Preto azulado']);
    // Makeup layers painted into the skin texture (skin-layers.mjs): an amount and a colour per region.
    const makeup = this.group('Maquiagem', { open: false });
    for (const [region, name] of Object.entries(makeupNames)) {
      const set = (changes, options) => this.patch({ makeup: { ...this.person.makeup, [region]: { ...this.person.makeup[region], ...changes } } }, { history: `makeup:${region}`, ...options });
      // Amount and colour of one region on one line.
      const well = h('input', { type: 'color', class: 'color-well', value: this.person.makeup[region].color, 'aria-label': `Cor: ${name.toLowerCase()}`, title: `Cor: ${name.toLowerCase()}`, onchange: event => set({ color: event.target.value }) });
      this.slide(makeup, { label: name, title: `${name}: quantidade e cor`, value: this.person.makeup[region].amount, min: 0, max: 1, trailing: well, onInput: v => set({ amount: v }, { live: true }), onEnd: () => this.commitLive() });
    }
    // Beard painted on the skin (skin-layers.mjs): a style, how strong, how dense; the hair's colour unless one is chosen.
    const beard = this.group('Barba', { open: this.person.beard.style !== 'nenhuma' });
    const setBeard = (changes, options) => this.patch({ beard: { ...this.person.beard, ...changes } }, { history: 'beard', ...options });
    const styles = Object.keys(beardStyles);
    beard.append(chips({ label: 'Estilo', items: styles.map(id => beardStyles[id].name), selected: styles.indexOf(this.person.beard.style), onPick: i => { setBeard({ style: styles[i] }); this.scheduleRender(); } }));
    if (this.person.beard.style !== 'nenhuma') {
      const well = h('input', { type: 'color', class: 'color-well', value: this.person.beard.color ?? this.person.colors.hair ?? hairPalette[this.person.hairColor], 'aria-label': 'Cor da barba', title: 'Cor da barba', onchange: event => setBeard({ color: event.target.value }) });
      this.slide(beard, { label: 'Intensidade', title: 'Intensidade e cor da barba', value: this.person.beard.amount, min: 0, max: 1, trailing: well, onInput: v => setBeard({ amount: v }, { live: true }), onEnd: () => this.commitLive() });
      this.slide(beard, { label: 'Densidade', value: this.person.beard.density, min: 0, max: 1, ends: ['Rala', 'Cheia'], onInput: v => setBeard({ density: v }, { live: true }), onEnd: () => this.commitLive() });
    }
    // Glasses, earrings, hat and necklace (accessories.mjs): a style each, then its colour or metal on the same line.
    const worn = this.person.accessories, gear = this.group('Acessórios', { open: Object.values(worn).some(item => item.style !== 'nenhum') });
    const setGear = (kind, changes) => { this.patch({ accessories: { ...worn, [kind]: { ...worn[kind], ...changes } } }, { history: `accessory:${kind}` }); this.scheduleRender(); };
    // One line per accessory: its name, the style, then its colour or metal (and dark lenses for glasses).
    for (const [kind, name] of Object.entries(accessoryNames)) {
      const ids = Object.keys(accessoryStyles[kind]), item = worn[kind], on = item.style !== 'nenhum';
      const style = h('select', { 'aria-label': name, title: name }, ids.map(id => h('option', { value: id, text: accessoryStyles[kind][id] })));
      style.value = item.style;
      style.addEventListener('change', () => setGear(kind, { style: style.value }));
      const extra = !on ? [] : 'metal' in item
        ? [h('div', { class: 'swatches mini', role: 'group', 'aria-label': `${name}: metal` }, Object.entries(metals).map(([id, hexValue]) => h('button', { type: 'button', class: `swatch${item.metal === id ? ' on' : ''}`, style: `--swatch:${hexValue}`, title: id === 'rose' ? 'Rosé' : id[0].toUpperCase() + id.slice(1), 'aria-label': `Metal: ${id}`, 'aria-pressed': String(item.metal === id), onclick: () => setGear(kind, { metal: id }) })))]
        : [h('input', { type: 'color', class: 'color-well', value: item.color, 'aria-label': `Cor: ${name.toLowerCase()}`, title: `Cor: ${name.toLowerCase()}`, onchange: event => setGear(kind, { color: event.target.value }) }),
          ...('lens' in item ? [h('button', { type: 'button', class: `icon-button${item.lens === 'escura' ? ' on' : ''}`, title: 'Lentes escuras', 'aria-label': 'Lentes escuras', 'aria-pressed': String(item.lens === 'escura'), onclick: () => setGear(kind, { lens: item.lens === 'escura' ? 'clara' : 'escura' }) }, icon('sun', 16))] : [])];
      gear.append(h('div', { class: 'gear-row' }, h('span', { class: 'gear-name', text: name }), style, ...extra));
    }
    this.renderAdvanced([
      ['Formas do rosto', body => this.renderDetailed(['head', 'forehead', 'eyebrows', 'eyes', 'nose', 'mouth', 'chin', 'cheek', 'ears'], body)],
      ['Expressão fina', body => this.renderExpressionFine(body)],
    ]);
  }
  /** Expression: a preview on the face, also what a timeline key records. */
  renderExpression() {
    const face = this.group('Expressão');
    // Faces, not words (the user: icons where the choice is visual); the names are in the tooltips.
    const glyphs = ['exNeutral', 'exRelaxed', 'exHappy', 'exSmile', 'exLaugh', 'exSad', 'exAngry', 'exAnnoyed', 'exSurprised', 'exWorried', 'exTired', 'exTalking'];
    face.append(iconChoices({ label: 'Expressão', items: expressionNames.map((name, i) => [name, glyphs[i] ?? 'face']), selected: this.person.expression, onPick: i => this.update('expression', i) }));
    this.range(face, 'expressionIntensity', 'Intensidade', 0, 1, 0.01, '', { ends: ['Leve', 'Forte'] });
  }
  /** The 52 ARKit face shapes added to the expression (Rosto › Avançado); E and D are left and right. */
  renderExpressionFine(fine) {
    const touched = Object.values(this.person.faceShapes).filter(Boolean).length;
    const regions = [['Olhos e olhar', /^eye/], ['Sobrancelhas', /^brow/], ['Mandíbula', /^jaw/], ['Boca', /^mouth/], ['Bochechas e nariz', /^(cheek|nose)/], ['Língua', /^tongue/]];
    const setShape = name => v => this.patch({ faceShapes: { ...this.person.faceShapes, [name]: v } }, { history: `faceShapes:${name}`, live: true });
    for (const [title, test] of regions) {
      fine.append(h('div', { class: 'step-label', text: title }));
      const names = blendshapeNames.filter(shape => test.test(shape));
      // A Left/Right pair is one line with two tracks (the user: less height, label beside the control).
      for (const name of names) {
        if (name.endsWith('Right') && names.includes(name.replace(/Right$/, 'Left'))) continue;
        const right = name.replace(/Left$/, 'Right');
        if (name.endsWith('Left') && names.includes(right)) {
          const base = name.replace(/Left$/, '');
          fine.append(sliderPair({ label: arkitWords[base] ?? base, title: `${arkitWords[base] ?? base} (${name} / ${right})`, sides: [name, right].map(n => ({ value: this.person.faceShapes[n] ?? 0, onInput: setShape(n) })) }));
        } else this.slide(fine, { label: arkitLabel(name), title: `${arkitLabel(name)} (${name})`, value: this.person.faceShapes[name] ?? 0, min: -1, max: 1, center: true, onInput: setShape(name) });
      }
    }
    fine.append(h('div', { class: 'icon-bar' }, iconButton('reset', 'Zerar a expressão fina', () => this.patch({ faceShapes: {} }), { disabled: !touched })));
  }
  /** Tattoos: pick a design (or load an image), then click the skin where it goes; each placed one can be resized, turned, recoloured or removed. */
  renderTattoos() {
    const group = this.group('Tatuagens', { open: false });
    const keys = Object.keys(tattooDesigns);
    this.tattooDesign ??= 'estrela';
    group.append(chips({ label: 'Desenho', items: [...keys.map(key => tattooDesigns[key].name), 'Imagem'], selected: this.tattooImage ? keys.length : keys.indexOf(this.tattooDesign),
      onPick: i => { if (i < keys.length) { this.tattooDesign = keys[i]; this.tattooImage = null; } else this.chooseTattooImage(); this.scheduleRender(); } }));
    if (this.tattooDesign === 'texto' && !this.tattooImage) group.append(row('Texto', h('input', { type: 'text', maxlength: 14, value: this.tattooText ?? 'amor', oninput: event => { this.tattooText = event.target.value; } })));
    // Placing is a mode of the 3D view: one line, lit while on (the click on the skin is in main.mjs).
    group.append(h('div', { class: 'mode-row' }, h('button', { type: 'button', class: `mode-card${this.tattooing ? ' on' : ''}`, 'aria-pressed': String(Boolean(this.tattooing)), title: 'Clique na pele onde a tatuagem vai',
      onclick: () => { this.tattooing = !this.tattooing; this.setHint(this.tattooing ? 'Clique na pele onde a tatuagem vai' : hints.default); this.scheduleRender(); } }, icon('plus', 18), h('span', { text: this.tattooing ? 'Clique na pele…' : 'Colocar no corpo' }))));
    // The placed tattoos: one row each (pick, remove); the chosen one's size, turn and ink below.
    const tattoos = this.person.tattoos;
    if (!tattoos.length) return;
    const chosen = Math.min(this.tattooChosen ?? tattoos.length - 1, tattoos.length - 1);
    group.append(h('div', { class: 'piece-list' }, tattoos.map((tattoo, index) => h('div', { class: `piece${index === chosen ? ' on' : ''}` },
      h('button', { type: 'button', class: 'piece-pick', 'aria-pressed': String(index === chosen), onclick: () => { this.tattooChosen = index; this.scheduleRender(); } }, `${index + 1}. ${tattoo.image ? 'Imagem' : tattooDesigns[tattoo.design]?.name ?? ''}`),
      iconButton('close', 'Remover esta tatuagem', () => { this.patch({ tattoos: this.person.tattoos.filter((_, i) => i !== index) }, { history: true }); this.toast('Tatuagem removida', 'info', this.undoAction()); }, { danger: true, size: 16 })))));
    const tattoo = tattoos[chosen];
    const set = (changes, options) => this.patch({ tattoos: this.person.tattoos.map((t, i) => i === chosen ? { ...t, ...changes } : t) }, { history: `tattoo:${chosen}`, ...options });
    this.slide(group, { label: 'Tamanho', value: tattoo.size, min: 0.01, max: 0.3, step: 0.005, onInput: v => set({ size: v }, { live: true }), onEnd: () => this.commitLive() });
    this.slide(group, { label: 'Giro', value: tattoo.angle, min: -3.14, max: 3.14, step: 0.01, center: true, onInput: v => set({ angle: v }, { live: true }), onEnd: () => this.commitLive() });
    const ink = h('input', { type: 'color', class: 'color-well', value: tattoo.color, 'aria-label': 'Cor da tinta', title: 'Cor da tinta', onchange: event => set({ color: event.target.value }) });
    this.slide(group, { label: 'Tinta', title: 'Opacidade e cor da tinta', value: tattoo.opacity, min: 0, max: 1, trailing: ink, onInput: v => set({ opacity: v }, { live: true }), onEnd: () => this.commitLive() });
  }
  /** Load an image for a tattoo: scaled to 256 px (PNG with transparency is kept), stored with the character. */
  chooseTattooImage() {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const scale = Math.min(256 / image.width, 256 / image.height), w = image.width * scale, hh = image.height * scale;
        canvas.getContext('2d').drawImage(image, (256 - w) / 2, (256 - hh) / 2, w, hh);
        this.tattooImage = canvas.toDataURL('image/png'); URL.revokeObjectURL(image.src); this.scheduleRender();
      };
      image.src = URL.createObjectURL(file);
    };
    input.click();
  }
  /** Tattoo tool: a click on the skin puts the chosen design there (UV point of the hit). */
  get tattooingSkin() { return Boolean(this.tattooing); }
  placeTattoo(uv) {
    if (!uv) return;
    const tattoo = { design: this.tattooImage ? null : this.tattooDesign, image: this.tattooImage ?? null, text: this.tattooText ?? 'amor', u: uv.x, v: uv.y, size: 0.05, angle: 0, color: '#1d2430', opacity: 0.9 };
    this.patch({ tattoos: [...this.person.tattoos, tattoo] }, { history: true });
    this.tattooing = false; this.setHint('Tatuagem colocada: ajuste tamanho, giro e cor em Tatuagens');
    this.scheduleRender();
  }

  // ------------------------------------------------------------ hair
  /** Entering the hair section: the character's locks are edited live (animation frozen); undo goes to the editor. */
  startLocks() {
    const editor = this.renderer.lockEditor;
    this.hairEntry = { person: this.person, revision: editor.revision ?? 0 };
    this.hairDirty = false;
    const distance = this.renderer.camera.distance;
    this.renderer.setLocksMode(true);
    this.store.setHistoryTarget(this.editorHistory);
    // The editor frames the head: no framing button stays lit for a view the camera left.
    if (this.renderer.camera.distance !== distance) queueMicrotask(() => this.viewMoved());
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
    // The ready-made base belongs to the character on screen: it takes the colour at once too.
    this.renderer?.liveLook(this.person);
    if (this.renderer) this.renderer.hairColor = hex;
  }
  renderHair() {
    const editor = this.renderer?.lockEditor;
    if (!editor?.active) { this.group('Cabelo').append(h('p', { class: 'muted', text: 'Preparando o editor de cabelo…' })); return; }
    const settings = editor.settings;
    this.lockPanelKey = this.lockPanelState();

    // 1. What is used every time: the hairstyle (a ready-made mesh by an artist, one line; the editable
    // locks as a picture gallery laid over it) and the colour. No explanatory text: names and tooltips.
    const tint = this.person.colors.hair ?? hairPalette[this.person.hairColor];
    const style = this.group('Penteado');
    const baseIds = [null, ...hairBases.map(b => b.id)];
    const baseSelect = h('select', { 'aria-label': 'Cabelo pronto', title: 'Cabelo pronto feito por artista (as mechas entram por cima)' }, ['Nenhum', ...hairBases.map(b => b.name)].map((name, i) => h('option', { value: String(i), text: name })));
    baseSelect.value = String(Math.max(0, baseIds.indexOf(this.person.hairBase ?? null)));
    baseSelect.addEventListener('change', () => { this.hairDirty = true; this.patch({ hairBase: baseIds[Number(baseSelect.value)] }); });
    style.append(row('Pronto', baseSelect));
    style.append(h('div', { class: 'style-grid', style: `--hair-tint:${tint}`, role: 'group', 'aria-label': 'Mechas editáveis' }, hairPresets.map(p => h('button', {
      type: 'button', class: `style-card${this.person.hairPreset === p.id ? ' on' : ''}`, title: `Mechas: ${p.name}`, 'aria-pressed': String(this.person.hairPreset === p.id), onclick: () => this.applyHairPreset(p.id),
    }, hairPictogram(p.id), h('span', { text: p.name })))));
    style.append(swatches({ label: 'Cor', palette: hairPalette, selected: this.person.hairColor, custom: this.person.colors.hair ?? null, names: ['Preto', 'Castanho muito escuro', 'Castanho escuro', 'Castanho', 'Castanho claro', 'Loiro', 'Ruivo', 'Cinza escuro', 'Platinado'],
      onPick: i => this.setHairColor(i, null), onCustom: hex => this.setHairColor(null, hex) }));
    this.toggle(style, 'Couro escuro', Boolean(editor.state.scalp), on => { this.hairDirty = true; editor.setScalp(on); }, 'Pinta o couro entre as mechas com fios da cor do cabelo; desligado, aparece a pele');

    // Parts: build a hairstyle from pieces (base, bangs, sides, back, tails), each added over the hair there.
    const parts = this.group('Montar com peças', { open: false });
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
      this.slide(adjust, { label: 'Comprimento', value: lockLength(lock), min: 0.015, max: 1.1, step: 0.005, scale: 100, unit: 'cm', onStart: record, onInput: v => editor.setLength(v) });
      this.slide(adjust, { label: 'Largura', value: lock.width, min: 0.004, max: 0.09, step: 0.001, scale: 100, unit: 'cm', onStart: record, onInput: v => editor.setParam('width', v) });
      this.segmented(adjust, 'Forma', choices(shapes.forms), formOf(lock.curl), i => { record(); editor.setForm(shapes.forms[i][0]); });
      // Curvar works from the shape the locks have when the slider is taken; it rests at 0 again afterwards.
      this.slide(adjust, { label: 'Curvar', value: 0, min: -1, max: 1, step: 0.01, ends: ['Para fora', 'Para dentro'], onStart: () => { this.hairDirty = true; editor.beginBend(); }, onInput: v => editor.bendTo(v), onEnd: () => { editor.endBend(); this.scheduleRender(); }, title: 'Dobra as pontas para dentro ou para fora a partir da forma atual' });
      // Actions of the selection (or all): icons with their names in the tooltip, in one bar.
      adjust.append(h('div', { class: 'icon-bar' },
        iconButton('settle', 'Assentar com gravidade: as mechas caem sobre a cabeça, os ombros e a roupa e ficam assim', () => { this.hairDirty = true; editor.settle(); }),
        count ? iconButton('close', 'Limpar a seleção', () => editor.clearSelection()) : iconButton('select', 'Selecionar todas', () => editor.selectAll()),
        iconButton('play', 'Ver o cabelo andando (em Animação)', () => { this.update('animation', 1); this.setSection('animacao'); }),
        h('span', { class: 'spacer' }),
        count ? iconButton('trash', 'Apagar as selecionadas (Delete)', () => editor.deleteSelected(), { danger: true }) : null,
        iconButton('reset', 'Começar do zero: apaga todas as mechas (o cabelo pronto continua)', () => { if (confirm('Apagar todas as mechas deste penteado? O cabelo pronto continua.')) editor.clearAll(); }, { danger: true })));
    } else adjust.append(h('p', { class: 'empty-note', text: 'Sem mechas: escolha um estilo ou use o Pincel (B).' }));

    // 4. Technical settings, last and folded (one "Avançado"): the rarer lock shape values, the brush guide, files.
    this.renderAdvanced([
      ...(lock ? [['Mechas', more => {
        this.slide(more, { label: 'Volume', value: lock.volume, min: 0.12, max: 0.6, ends: ['Chata', 'Arredondada'], onStart: record, onInput: v => editor.setParam('volume', v), title: 'Volume: quanto a mecha se arredonda (arco do cartão)' });
        this.slide(more, { label: 'Afunilar', value: lock.taper, min: 0, max: 1, ends: ['Ponta larga', 'Ponta fina'], onStart: record, onInput: v => editor.setParam('taper', v), title: 'Afunilar: quanto a mecha afina até a ponta' });
        if (lock.curl > 0) this.slide(more, { label: 'Ondas', value: lock.turns, min: 0.5, max: 10, step: 0.1, ends: ['Poucas', 'Muitas'], onStart: record, onInput: v => editor.setParam('turns', v), title: 'Ondas: voltas ao longo da mecha' });
        this.slide(more, { label: 'Firmeza', value: lock.stiffness, min: 0, max: 1, ends: ['Solta', 'Firme'], onStart: record, onInput: v => editor.setParam('stiffness', v), title: 'Firmeza: quanto a mecha balança no movimento (ossos com mola no jogo)' });
        this.slide(more, { label: 'Torcer', value: lock.twist ?? 0, min: -3.14, max: 3.14, step: 0.01, center: true, onStart: () => { this.hairDirty = true; record(); }, onInput: v => editor.setParam('twist', v), title: 'Torcer: gira a mecha em volta do próprio eixo' });
      }]] : []),
      ['Guia', guide => {
        this.slide(guide, { label: 'Afastamento', value: settings.guideVolume, min: 0.002, max: 0.05, step: 0.001, scale: 100, unit: 'cm', onInput: v => editor.setGuide({ volume: v }), title: 'Distância entre a grade do Pincel e a cabeça' });
        this.slide(guide, { label: 'Comprimento', value: settings.guideLength, min: 0.1, max: 1, step: 0.01, scale: 100, unit: 'cm', onInput: v => editor.setGuide({ length: v }), title: 'Até onde a grade do Pincel desce' });
        this.toggle(guide, 'Mostrar a grade', settings.showGuide, on => { settings.showGuide = on; editor.updateHelpers(); });
      }],
      ['Arquivo', files => this.renderHairFiles(files, editor)],
    ]);
    this.updateLockStatus();
  }
  /** Save, load, export and import hairstyles (Cabelo › Avançado › Arquivo). */
  renderHairFiles(files, editor) {
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
      h('div', { class: 'icon-bar' },
        iconButton('save', 'Salvar o penteado com este nome', () => { const name = nameInput.value.trim() || 'Meu penteado'; this.lockSlot = name; if (editor.saveSlot(name)) this.toast(`Penteado "${name}" salvo`); else this.toast('Armazenamento indisponível', 'error'); this.scheduleRender(); }, { id: 'lockSave' }),
        iconButton('folder', 'Carregar o salvo escolhido', () => { const name = slotSelect.value; if (!name) return; this.lockSlot = name; if (editor.loadSlot(name)) this.notify(`Penteado "${name}" carregado`); else this.toast('Penteado não encontrado', 'error'); }, { id: 'lockLoad', disabled: !slots.length }),
        iconButton('export', 'Baixar como arquivo .json', () => download(new Blob([JSON.stringify(editor.serialize())], { type: 'application/json' }), `${slug(nameInput.value || 'penteado')}.mechas.json`)),
        iconButton('file', 'Abrir um arquivo .json', () => fileInput.click()),
        h('span', { class: 'spacer' }),
        slots.length ? iconButton('trash', 'Excluir o salvo escolhido', () => { const name = slotSelect.value; if (name && confirm(`Excluir o penteado salvo "${name}"?`)) { editor.deleteSlot(name); this.scheduleRender(); } }, { danger: true }) : null),
      fileInput);
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
    const changes = { garments: data.garments.slice(0, MAX_GARMENTS).map(normalizeGarment) };
    if (data.sculpt) changes.sculpt = { ...this.person.sculpt, outfit: data.sculpt };
    this.patch(changes, { history: true });
    this.store.dispatch({ type: 'ui/set', changes: { garment: 0 } });
    return true;
  }
  renderOutfitFiles(files) {
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
      h('div', { class: 'icon-bar' },
        iconButton('save', 'Salvar a roupa com este nome', () => { const name = nameInput.value.trim() || 'Minha roupa'; this.outfitSlot = name; if (storage.set(OUTFIT_PREFIX + name, JSON.stringify(this.outfitData()))) this.toast(`Roupa "${name}" salva`); else this.toast('Armazenamento indisponível', 'error'); this.scheduleRender(); }, { id: 'outfitSave' }),
        iconButton('folder', 'Carregar a salva escolhida', () => { const name = slotSelect.value; if (!name) return; this.outfitSlot = name; const json = storage.get(OUTFIT_PREFIX + name); if (json && this.loadOutfit(json)) this.notify(`Roupa "${name}" carregada`); else this.toast('Roupa não encontrada', 'error'); }, { id: 'outfitLoad', disabled: !slots.length }),
        iconButton('export', 'Baixar como arquivo .json', () => download(new Blob([JSON.stringify(this.outfitData())], { type: 'application/json' }), `${slug(nameInput.value || 'roupa')}.roupa.json`)),
        iconButton('file', 'Abrir um arquivo .json', () => fileInput.click()),
        h('span', { class: 'spacer' }),
        slots.length ? iconButton('trash', 'Excluir a salva escolhida', () => { const name = slotSelect.value; if (name && confirm(`Excluir a roupa salva "${name}"?`)) { storage.remove(OUTFIT_PREFIX + name); this.scheduleRender(); } }, { danger: true }) : null),
      fileInput);
  }
  /**
   * Roupas: the outfit first; made to measure lists the pieces (inner first, each
   * a row with its order and remove buttons), then the selected piece's cut and
   * fabric; how it is built (on the body or by 2D patterns), painting and files
   * are folded in one Avançado at the end.
   */
  renderClothes() {
    const outfit = this.group('Roupa');
    outfit.append(chips({ label: 'Roupa', items: outfitNames, selected: this.person.outfit, onPick: i => this.update('outfit', i) }));
    if (this.person.outfit !== 4) {
      this.colorSwatches(outfit, 'topColor', 'Em cima', topPalette, 'top');
      this.colorSwatches(outfit, 'bottomColor', 'Embaixo', bottomPalette, 'bottom');
      return;
    }
    const garments = this.person.garments, index = this.garmentIndex(), garment = garments[index];
    const drafted = this.isDrafted();
    this.setHint(clothHints[this.clothTool() ?? 'look']);
    const pieces = this.group('Peças', { badge: garments.length || null });
    const swap = (a, b) => { const g = [...garments]; [g[a], g[b]] = [g[b], g[a]]; this.setGarments(g, b); };
    pieces.append(h('div', { class: 'piece-list', role: 'list', 'aria-label': 'Peças, da mais perto da pele para a mais por fora' }, garments.map((g, i) => h('div', { class: `piece${i === index ? ' on' : ''}`, role: 'listitem' },
      h('button', { type: 'button', class: 'piece-pick', 'aria-pressed': String(i === index), title: 'Escolher esta peça (ou clique nela no 3D)', onclick: () => this.pickGarment(i) }, garmentLabels[g.type]),
      iconButton('inward', 'Para dentro (mais perto da pele)', () => swap(i, i - 1), { disabled: i < 1, size: 16 }),
      iconButton('outward', 'Para fora', () => swap(i, i + 1), { disabled: i >= garments.length - 1, size: 16 }),
      iconButton('close', `Remover ${garmentLabels[g.type].toLowerCase()}`, () => { this.setGarments(garments.filter((_, k) => k !== i), Math.max(0, index - (i <= index ? 1 : 0))); this.toast(`${garmentLabels[g.type]} removida`, 'info', this.undoAction()); }, { danger: true, size: 16 })))));
    if (!garments.length) pieces.append(h('p', { class: 'empty-note', text: 'Nenhuma peça: escolha uma na galeria abaixo.' }));
    // Gallery: one click dresses the piece over the others (everyday clothes, then carnival pieces),
    // or a whole carnival costume at once.
    const full = garments.length >= MAX_GARMENTS;
    const gallery = this.group('Adicionar peça', { open: garments.length < 3, key: 'galeria' });
    const card = type => h('button', { type: 'button', class: 'style-card', title: full ? `Limite de ${MAX_GARMENTS} peças` : `Vestir: ${garmentLabels[type]}`, disabled: full,
      onclick: () => { this.setGarments([...garments, newGarment(type)], garments.length); this.toast(`${garmentLabels[type]} vestida: ajuste no 3D com Bordas ou Pintar`, 'info'); } }, garmentPictogram(type), h('span', { text: garmentLabels[type] }));
    gallery.append(h('div', { class: 'step-label', text: 'Dia a dia' }), h('div', { class: 'style-grid', role: 'group', 'aria-label': 'Roupas do dia a dia' }, garmentTypes.filter(type => !costumeTypes.includes(type) && !footwearTypes.includes(type)).map(card)));
    gallery.append(h('div', { class: 'step-label', text: 'Calçados' }), h('div', { class: 'style-grid', role: 'group', 'aria-label': 'Calçados' }, footwearTypes.map(card)));
    gallery.append(h('div', { class: 'step-label', text: 'Carnaval' }), h('div', { class: 'style-grid', role: 'group', 'aria-label': 'Peças de carnaval' }, costumeTypes.map(card)));
    gallery.append(h('div', { class: 'button-row two' }, ...Object.entries(costumePresets).map(([id, preset]) => h('button', { type: 'button', class: 'button', title: preset.title,
      onclick: () => { this.setGarments(preset.garments(), 0); this.toast(`Fantasia "${preset.name}" vestida`, 'info', this.undoAction()); } }, preset.name))));
    if (!garment) return;
    const cut = this.group('Corte');
    const typeSelect = h('select', { 'aria-label': 'Tipo' }, garmentTypes.map(type => h('option', { value: type, text: garmentLabels[type] })));
    typeSelect.value = garment.type;
    typeSelect.addEventListener('change', () => {
      const value = { ...newGarment(typeSelect.value), paint: garment.paint, color: garment.color, color2: garment.color2, pattern: garment.pattern };
      if (drafted && patternTypes.includes(value.type)) { value.authoringMode = 'pattern'; value.patternData = createPatternTemplate(value.type, value); }
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
    // Carnival pieces: their own measures (bands, cups, cut of the legs, plumes and fringe).
    if (t === 'bikini_top') { field('length', 'Bojo'); field('neckline', 'Alças'); }
    if (t === 'bikini_bottom') { field('rise', 'Cintura'); field('leg', 'Cava'); }
    if (t === 'swimsuit') { field('neckline', 'Decote'); field('leg', 'Cava'); }
    if (t === 'armband') { field('sleeve', 'Posição no braço'); field('length', 'Largura'); }
    if (t === 'anklet') { field('leg', 'Posição na perna'); field('length', 'Largura'); }
    if (t === 'fringe') { field('rise', 'Altura da faixa'); field('length', 'Comprimento das franjas'); field('flare', 'Volume'); }
    if (t === 'backpiece' || t === 'headdress') { field('length', 'Tamanho das plumas'); field('flare', 'Abertura do leque'); }
    if (t === 'crown') field('length', 'Altura das pontas');
    if (t === 'boots') field('leg', 'Cano');
    if (!costumeTypes.includes(t) && t !== 'sandals') field('fit', 'Folga');
    if (!drafted) {
      const fabric = this.group('Tecido');
      // The fabric decides how the piece reflects light (sheen, metal, sequins, stones, a net) and its texture in the GLB.
      fabric.append(h('div', { class: 'style-grid', role: 'group', 'aria-label': 'Tecido' }, fabricIds.map(id => h('button', {
        type: 'button', class: `style-card${garment.fabric === id ? ' on' : ''}`, 'aria-pressed': String(garment.fabric === id), title: fabricNames[id],
        onclick: () => this.updateGarment({ fabric: id, roughness: fabrics[id].roughness }, { delay: 0, history: true }),
      }, fabricPictogram(id, garment.color), h('span', { text: fabricNames[id] })))));
      const tint = key => h('div', {}, swatches({ label: key === 'color' ? 'Cor' : ['backpiece', 'headdress', 'fringe'].includes(t) ? 'Cor das pontas' : footwearTypes.includes(t) ? 'Cor da sola' : 'Segunda cor', palette: garmentPalette, selected: garmentPalette.indexOf(garment[key]), custom: garmentPalette.includes(garment[key]) ? null : garment[key],
        onPick: i => this.updateGarment({ [key]: garmentPalette[i] }, { delay: 120, history: true }), onCustom: (hex, { live = false } = {}) => this.updateGarment({ [key]: hex }, { delay: 200, live }) }));
      fabric.append(tint('color'));
      const patternSelect = h('select', { 'aria-label': 'Padrão' }, garmentPatterns.map(name => h('option', { value: name, text: patternNames[name] ?? name })));
      patternSelect.value = garment.pattern;
      patternSelect.addEventListener('change', () => this.updateGarment({ pattern: patternSelect.value }, { history: true }));
      fabric.append(row('Padrão', patternSelect));
      if (['backpiece', 'headdress', 'fringe', ...footwearTypes].includes(t) || garment.pattern !== 'solid') fabric.append(tint('color2'));
      if (garment.pattern !== 'solid') this.slide(fabric, { label: 'Escala', value: garment.scale, min: 0, max: 1, ends: ['Miúdo', 'Graúdo'], onInput: v => this.updateGarment({ scale: v }, { delay: 250, live: true }) });
      this.slide(fabric, { label: 'Aspereza', value: garment.roughness, min: 0, max: 1, ends: ['Lisa', 'Áspera'], onInput: v => this.updateGarment({ roughness: v }, { delay: 250, live: true }) });
    }
    // How the piece is built, its 2D patterns, the painting and the files: technical, folded at the end.
    const method = parent => {
      parent.append(segmented({ label: 'Feita', items: ['No corpo', 'Por moldes'], selected: drafted ? 1 : 0, onPick: i => {
        this.updateGarment({ authoringMode: i ? 'pattern' : 'surface', ...(i && !garment.patternData ? { patternData: createPatternTemplate(garment.type, garment) } : {}) }, { delay: 0, history: true });
      } }));
    };
    const painted = Object.keys(garment.paint).length;
    this.renderAdvanced([
      // Carnival pieces and shoes are cut on the body (or built as plumes and fringe): no 2D pattern.
      ...(!patternTypes.includes(garment.type) ? [] : [['Moldes', body => {
        method(body);
        const canvas = h('div', { class: 'pattern-host' }); body.append(canvas);
        this.patternEditor = new PatternEditor(canvas, { garment, onChange: value => this.updateGarment({ ...value, authoringMode: 'pattern' }, { delay: 0, history: true }) });
      }]]),
      ...(drafted ? [] : [['Pintura', body => body.append(h('div', { class: 'icon-bar' }, iconButton('reset', `Limpar a pintura de cobertura (${painted} pontos)`, () => this.updateGarment({ paint: {} }, { delay: 0, history: true }), { disabled: !painted })))]]),
      ['Arquivo', body => this.renderOutfitFiles(body)],
    ]);
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
    // What to sculpt, one line each; the count of edits in the group's badge; undoing in an icon bar.
    const ui = this.state.ui;
    const { body, outfit } = this.person.sculpt;
    const count = Object.keys(body).length + Object.values(outfit).reduce((m, edits) => m + Object.keys(edits).length, 0) + this.person.garments.reduce((total, garment) => total + (garment.patternData?.edits.length ?? 0), 0);
    const target = this.group('Esculpir', { badge: count ? `${count.toLocaleString('pt-BR')} edições` : null });
    this.segmented(target, 'Em', [['Corpo e rosto', 'body'], ['Roupa', 'shirt']], ui.sculptTarget === 'outfit' ? 1 : 0, i => this.store.dispatch({ type: 'ui/set', changes: { sculptTarget: ['body', 'outfit'][i] } }));
    this.toggle(target, 'Sem roupa', ui.undress, on => this.store.dispatch({ type: 'ui/set', changes: { undress: on } }), 'Esculpe o corpo sem as roupas por cima');
    const clearPatterns = () => this.person.garments.map(garment => garment.patternData ? { ...garment, patternData: { ...garment.patternData, edits: [] } } : garment);
    target.append(h('div', { class: 'icon-bar' },
      iconButton('reset', ui.sculptTarget === 'body' ? 'Desfazer a escultura do corpo' : 'Desfazer a escultura desta roupa', () => {
        const sculpt = structuredClone(this.person.sculpt);
        if (ui.sculptTarget === 'body') sculpt.body = {}; else { const style = this.renderer.sculpt.target?.style; if (style) delete sculpt[ui.sculptTarget][style]; }
        this.patch({ sculpt, garments: ui.sculptTarget === 'outfit' ? clearPatterns() : this.person.garments }, { history: true });
        this.toast('Escultura desfeita', 'info', this.undoAction());
      }, { disabled: !count }),
      h('span', { class: 'spacer' }),
      iconButton('trash', 'Apagar toda a escultura (corpo e roupas)', () => {
        if (!confirm(`Apagar as ${count.toLocaleString('pt-BR')} edições de escultura do corpo e das roupas?`)) return;
        this.patch({ sculpt: {}, garments: clearPatterns() }, { history: true });
        this.toast('Escultura apagada', 'info', this.undoAction());
      }, { danger: true, disabled: !count })));
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
  /**
   * Timeline of the character's own clip ("Personalizada"): a key holds the
   * pose (Posar) and the face (expression and fine shapes) at a time; the
   * cursor shows the clip at that time; an imported .glb becomes keys.
   */
  renderTimeline() {
    const clip = this.person.clip, r = this.renderer, custom = animationNames.length - 1;
    const group = this.group('Linha do tempo', { open: clip.keys.length > 0 });
    this.timeAt = Math.min(this.timeAt ?? 0, clip.duration);
    const setClip = (changes, history = 'clip') => this.patch({ clip: { ...this.person.clip, ...changes } }, { history });
    this.slide(group, { label: 'Duração', value: clip.duration, min: 0.5, max: 20, step: 0.1, unit: ' s', onInput: v => setClip({ duration: Math.max(v, clip.keys.at(-1)?.t ?? 0) }, 'clip:duration'), onEnd: () => this.scheduleRender() });
    this.slide(group, { label: 'Tempo', value: this.timeAt, min: 0, max: clip.duration, step: 0.05, unit: ' s', onInput: v => { this.timeAt = v; r?.scrubUserClip(v); } });
    const near = key => Math.abs(key.t - this.timeAt) < 0.026;
    // The keys on a track (diamonds; click one to go to it), the cursor at the time above.
    const goTo = i => {
      this.timeAt = this.person.clip.keys[i].t;
      if (r?.poseEditor.active) { r.poseEditor.apply(this.person.clip.keys[i].pose); r.poseEditor.commit(); } else r?.scrubUserClip(this.timeAt);
      this.scheduleRender();
    };
    group.append(h('div', { class: 'timeline', role: 'group', 'aria-label': `Chaves (${clip.keys.length})` },
      h('span', { class: 'cursor', style: `left:${(this.timeAt / clip.duration) * 100}%` }),
      clip.keys.map((key, i) => h('button', { type: 'button', class: `key${near(key) ? ' on' : ''}`, style: `left:${(key.t / clip.duration) * 100}%`, title: `Chave em ${key.t.toFixed(2).replace('.', ',')} s`, 'aria-label': `Chave em ${key.t.toFixed(2)} segundos`, onclick: () => goTo(i) }))));
    group.append(h('div', { class: 'icon-bar' },
      iconButton('key', 'Gravar chave: a pose (Posar) e a expressão atuais neste tempo', () => {
        const pose = r?.poseEditor.active ? r.poseEditor.read() : this.person.posing;
        const face = faceWeights(this.person.expression, this.person.expressionIntensity ?? 0.5, this.person.faceShapes);
        const keys = [...this.person.clip.keys.filter(key => !near(key)), { t: Math.round(this.timeAt * 1000) / 1000, pose, face }];
        setClip({ keys, duration: Math.max(this.person.clip.duration, this.timeAt) }, true);
      }),
      iconButton('close', 'Apagar a chave deste tempo', () => setClip({ keys: this.person.clip.keys.filter(key => !near(key)) }, true), { disabled: !clip.keys.some(near) }),
      iconButton('play', 'Tocar a sua animação', () => { this.store.dispatch({ type: 'ui/set', changes: { posing: false } }); this.update('animation', custom); }, { disabled: !clip.keys.length }),
      iconButton('file', 'Importar animação (.glb do Mixamo)', () => file.click()),
      h('span', { class: 'spacer' }),
      iconButton('trash', 'Apagar todas as chaves', () => { if (confirm(`Apagar as ${clip.keys.length} chaves da sua animação?`)) setClip({ keys: [] }, true); }, { danger: true, disabled: !clip.keys.length })));
    // An animation from a file (Mixamo or this app's rig) becomes editable keys.
    const file = h('input', { type: 'file', accept: '.glb,.gltf', hidden: true });
    file.addEventListener('change', async () => {
      const chosen = file.files[0];
      file.value = '';
      if (!chosen || !/\.(glb|gltf)$/i.test(chosen.name) || !r?.current) { if (chosen) this.toast('Escolha um arquivo .glb ou .gltf', 'error'); return; }
      try {
        this.store.begin('import', { label: 'Importando animação…', cancellable: false });
        const imported = await importAnimation(await chosen.arrayBuffer(), r.current, { alias: mixamoName });
        this.patch({ clip: imported }, { history: true });
        this.update('animation', custom);
        this.toast(`Animação "${imported.name}" importada · ${imported.keys.length} chaves`);
      } catch (error) { this.toast(`Não foi possível importar: ${error.message}`, 'error'); }
      finally { this.store.end('import'); r.setPresentation(this.person); }
    });
    group.append(file);
  }
  /** Pose: click a bone to turn it with the gizmo; drag the orange handles to place hands and feet (IK). One line to switch it on. */
  renderPosing() {
    const r = this.renderer, editor = r?.poseEditor, on = Boolean(this.state.ui.posing);
    const group = this.group('Pose');
    const mirror = editor ? h('button', { type: 'button', class: `icon-button${editor.symmetry ? ' on' : ''}`, 'aria-pressed': String(editor.symmetry), title: 'Simetria: espelha o que você gira ou puxa', 'aria-label': 'Simetria',
      onclick: event => { editor.symmetry = !editor.symmetry; event.currentTarget.classList.toggle('on', editor.symmetry); event.currentTarget.setAttribute('aria-pressed', String(editor.symmetry)); } }, icon('mirror', 18)) : null;
    group.append(h('div', { class: 'mode-row' },
      h('button', { type: 'button', class: `mode-card${on ? ' on' : ''}`, 'aria-pressed': String(on), title: 'Posar: clique num osso e gire pelo anel; arraste as esferas laranja para levar mãos e pés',
        onclick: () => this.store.dispatch({ type: 'ui/set', changes: { posing: !on } }) }, icon('figure', 18), h('span', { text: on ? 'Posando no 3D' : 'Posar no 3D' })),
      on ? mirror : null));
    const names = { A: 'Repouso (A)', T: 'T', natural: 'Em pé', hips: 'Mãos na cintura', sit: 'Sentado', wave: 'Acenando', run: 'Correndo' };
    group.append(chips({ label: 'Poses prontas', items: poseLibrary.map(id => names[id]), selected: -1, onPick: i => {
      if (!r?.current) return;
      if (!on) this.store.dispatch({ type: 'ui/set', changes: { posing: true } });
      const posing = libraryPose(r.current.context.skeleton, poseLibrary[i]);
      r.poseEditor.apply(posing); this.patch({ posing }, { history: true });
    } }));
    if (!on || !editor) return;
    editor.onCommit = posing => this.patch({ posing }, { history: 'posing' });
    this.setHint('Clique num osso e gire pelo anel · arraste as esferas laranja: mãos e pés · botão direito: girar');
    group.append(h('div', { class: 'icon-bar' },
      iconButton('reset', 'Zerar o osso escolhido', () => editor.reset(false)),
      iconButton('mirrorToRight', 'Copiar o lado esquerdo para o direito', () => editor.mirrorSide('l')),
      iconButton('mirrorToLeft', 'Copiar o lado direito para o esquerdo', () => editor.mirrorSide('r')),
      h('span', { class: 'spacer' }),
      iconButton('figure', 'Voltar à pose de repouso (A)', () => { editor.reset(true); this.toast('Pose de repouso', 'info', this.undoAction()); }, { danger: true })));
  }
  /** Animação: what plays (with play/pause), how the body stands, posing, and the user's own clip. */
  renderAnimation() {
    const motion = this.group('Movimento');
    const action = () => this.renderer?.action;
    const playing = action() ? !action().paused : true;
    motion.append(h('div', { class: 'icon-bar' },
      iconButton(playing ? 'pause' : 'resume', playing ? 'Pausar' : 'Tocar', event => {
        const a = action(); if (!a) return;
        a.paused = !a.paused;
        const button = event.currentTarget;
        button.replaceChildren(icon(a.paused ? 'resume' : 'pause', 18)); button.title = a.paused ? 'Tocar' : 'Pausar'; button.setAttribute('aria-label', button.title);
      }),
      iconButton('reset', 'Repetir do início', () => this.renderer?.replay())));
    // While posing the movement is stopped: no movement is shown as playing (picking one leaves Posar).
    const posing = Boolean(this.state.ui.posing);
    motion.append(chips({ label: 'Movimento', items: animationNames, selected: posing ? -1 : this.person.animation, onPick: i => { if (posing) this.store.dispatch({ type: 'ui/set', changes: { posing: false } }); this.update('animation', i); } }));
    this.range(motion, 'animationSpeed', 'Velocidade', 0.4, 1.8, 0.01, '×');
    const pose = this.group('Postura', { open: false });
    pose.append(chips({ label: 'Postura parada', items: ['Natural', 'Relaxada', 'Confiante', 'Mãos na cintura'], selected: this.person.pose, onPick: v => this.update('pose', v) }));
    this.renderPosing();
    this.renderTimeline();
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
  async screenshot() {
    // The renderer draws and reads the frame in one call (the drawing buffer is not preserved).
    const url = this.renderer?.capture();
    const blob = url ? await (await fetch(url)).blob() : null;
    if (!blob) { this.toast('Captura indisponível', 'error'); return; }
    download(blob, `${slug(this.person.name)}.png`); this.toast('Captura salva');
  }
  async exportGLB() {
    this.exportMenu?.close();
    const controller = new AbortController();
    this.exportController?.abort(); this.exportController = controller;
    try {
      this.store.begin('export', { label: 'Exportando GLB…' });
      const options = { ...this.state.ui.export, person: this.snapshotPerson(), signal: controller.signal, onProgress: stage => this.store.progress('export', `Exportando · ${stage}`) };
      const file = `${slug(this.person.name)}-${this.person.seed}`;
      if (options.lod === 'all') {
        // One GLB per level in a .zip (renderer.exportLODPack).
        const { zip, levels } = await this.renderer.exportLODPack({ ...options, name: file });
        controller.signal.throwIfAborted();
        download(new Blob([zip], { type: 'application/zip' }), `${file}-LOD.zip`);
        this.toast(`Pacote LOD exportado · ${levels.map(l => `LOD${l.lod}: ${Math.round(l.triangles).toLocaleString('pt-BR')} triângulos${l.error ? ` (desvio ${(l.error * 100).toFixed(1)} cm)` : ''}`).join(' · ')}`);
        return;
      }
      const bytes = await this.renderer.exportGLB(options);
      controller.signal.throwIfAborted();
      download(new Blob([bytes], { type: 'model/gltf-binary' }), `${file}.glb`);
      this.toast('GLB exportado');
    } catch (error) { if (error.name !== 'AbortError') this.toast(`Falha ao exportar: ${error.message}`, 'error'); }
    finally { if (this.exportController === controller) { this.exportController = null; this.store.end('export'); } }
  }
}
