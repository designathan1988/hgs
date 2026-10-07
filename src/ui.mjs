import { blendshapeNames } from './face-rig.mjs';
import { LockEditor, lockTools } from './lock-editor.mjs';
import { lockLength } from './locks.mjs';
import { hairPresets, hairPresetData } from './hair-presets.mjs';
import { garmentTypes, garmentLabels, garmentPatterns, newGarment } from './tailor.mjs';
import { icon, hairPictogram } from './icons.mjs';
import {
  defaultCharacter, randomCharacter, normalizeCharacter, serializePreset, parsePreset, ageHeightReference,
  skinPalette, hairPalette, eyePalette, topPalette, bottomPalette, outfitNames, expressionNames, animationNames, lightingNames,
} from './state.mjs';

/**
 * The studio's interface: a navigation rail with eight sections, a slim
 * inspector of collapsible groups (advanced groups start closed), a floating
 * viewport toolbar (views, light, screenshot, crowd) and a one-line status.
 * Help lives in tooltips and one contextual hint, not in paragraphs.
 */
const sections = [
  { id: 'personagem', name: 'Personagem', icon: 'person' },
  { id: 'corpo', name: 'Corpo', icon: 'body' },
  { id: 'rosto', name: 'Rosto', icon: 'face' },
  { id: 'cabelo', name: 'Cabelo', icon: 'hair' },
  { id: 'roupas', name: 'Roupas', icon: 'shirt' },
  { id: 'esculpir', name: 'Esculpir', icon: 'sculpt' },
  { id: 'animacao', name: 'Animação', icon: 'play' },
  { id: 'exportar', name: 'Exportar', icon: 'export' },
];
const hints = {
  default: 'Roda: zoom no cursor · botão direito: girar no ponto do cursor · botão do meio: mover',
  esculpir: 'Arraste sobre o corpo para esculpir · Ctrl inverte · botão direito: girar',
  brush: 'Pinte sobre o couro cabeludo: o traço cria mechas penteadas na direção do movimento',
  comb: 'Arraste sobre o cabelo: todas as mechas dentro do círculo seguem o movimento (G desliga a gravidade, F fixa a forma)',
  move: 'Arraste uma mecha para mudar o lugar dela no couro cabeludo; ela vai inteira, com a mesma forma',
  pull: 'Arraste do couro cabeludo para criar uma mecha · arraste um ponto da mecha para movê-la · segure F ao soltar para manter a forma, P para prender o ponto · G liga/desliga a gravidade',
  select: 'Clique para selecionar · Shift soma · Ctrl alterna',
  grow: 'Clique numa mecha e arraste no sentido da ponta',
  cut: 'Passe a tesoura sobre as mechas',
  pin: 'Clique num ponto da mecha para prender ou soltar',
};
// These only change playback or lights, so they never rebuild the mesh.
const presentationFields = new Set(['animation', 'animationSpeed', 'lighting', 'expression', 'expressionIntensity']);
const views = [['front', 'Frente'], ['side', 'Lado'], ['rear', 'Costas'], ['face', 'Rosto'], ['body', 'Corpo']];
const toolNames = { brush: 'Pincel', comb: 'Pentear', pull: 'Puxar', move: 'Mover', select: 'Selecionar', grow: 'Alongar', cut: 'Cortar', pin: 'Prender' };
// Made-to-measure clothes tools: [tool, name, icon].
const clothTools = [[null, 'Girar', 'resume'], ['edges', 'Bordas', 'grow'], ['clothAdd', 'Pintar', 'sculpt'], ['clothErase', 'Apagar', 'cut']];
const clothHints = {
  look: 'Roda: zoom no cursor · botão direito: girar · botão do meio: mover',
  edges: 'Arraste a barra, a manga, o decote, a cintura ou a perna da peça para cima ou para baixo · Ctrl+Z desfaz',
  clothAdd: 'Pinte no corpo onde a peça deve cobrir · Ctrl+Z desfaz',
  clothErase: 'Pinte no corpo onde a peça não deve cobrir · Ctrl+Z desfaz',
};
const toolIcons = { brush: 'sculpt', comb: 'hair', pull: 'pull', move: 'move', select: 'select', grow: 'grow', cut: 'cut', pin: 'pin' };
const patternNames = { solid: 'Liso', stripes: 'Listras', pinstripe: 'Risca de giz', checks: 'Xadrez', gradient: 'Degradê' };
const brushNames = { draw: 'Desenhar', inflate: 'Inflar', grab: 'Arrastar', smooth: 'Suavizar', flatten: 'Achatar', pinch: 'Pinçar' };
const PRESET_PREFIX = 'hgs.preset.';
const storage = {
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};
const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'personagem';

/** Small element builder: h('div', { class, onclick, ... }, ...children). */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

export class StudioUI {
  constructor() {
    this.person = normalizeCharacter(defaultCharacter);
    this.section = 'personagem';
    this.undo = []; this.redo = [];
    this.undressBody = true; this.renderer = null; this.crowdCount = 0; this.stats = null;
    this.openGroups = new Map(); this.uid = 0;
    this.body = document.getElementById('inspectorBody');
    this.nav = document.getElementById('sectionNav');
    this.buildNav(); this.bindChrome(); this.render();
  }
  attachRenderer(renderer) { this.renderer = renderer; this.queueCharacter(); }

  // ------------------------------------------------------------ status
  ready(message, error = false) {
    const indicator = document.querySelector('.status-dot');
    indicator.classList.toggle('ok', !error); indicator.classList.toggle('error', error);
    document.getElementById('readyLabel').textContent = message;
  }
  fail(message) { this.ready('Erro no 3D', true); document.getElementById('errorText').textContent = message; document.getElementById('errorPanel').hidden = false; }
  queueCharacter() {
    clearTimeout(this.rebuildTimer);
    this.ready('Gerando…');
    this.rebuildTimer = setTimeout(async () => {
      if (await this.renderer?.setCharacter(this.person)) {
        this.ready('Pronto'); this.updateMeta();
        if (this.section === 'cabelo' || this.section === 'exportar') this.render();
        // The edge lines follow the rebuilt garment.
        if (this.tailoring) this.renderer.clothEditor.show(this.person.garments[this.garmentIndex ?? 0] ?? null);
      }
    }, 80);
  }
  updateMeta() {
    const measured = this.renderer?.current?.metrics.height ?? this.person.heightMeters;
    document.getElementById('characterName').textContent = this.person.name;
    document.getElementById('characterMeta').textContent = `${measured.toFixed(2)} m${this.crowdCount ? ` · ${this.crowdCount + 1} pessoas` : ''}`;
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
      const button = h('button', { class: 'nav-item', type: 'button', 'data-section': section.id, title: section.name, onclick: () => this.setSection(section.id) },
        icon(section.icon, 22), h('span', { class: 'nav-label', text: section.name }));
      this.nav.append(button);
    }
  }
  bindChrome() {
    const $ = id => document.getElementById(id);
    $('randomButton').addEventListener('click', () => this.setPerson(randomCharacter()));
    $('exportButton').addEventListener('click', () => this.exportGLB());
    $('screenshotButton').addEventListener('click', () => this.screenshot());
    $('retryButton').addEventListener('click', () => location.reload());
    $('zoomIn').addEventListener('click', () => this.renderer?.camera.zoom(-180));
    $('zoomOut').addEventListener('click', () => this.renderer?.camera.zoom(180));
    $('fitButton').addEventListener('click', () => this.chooseView(this.crowdCount ? 'crowd' : 'body'));
    const viewRow = $('viewButtons');
    for (const [id, name] of views) viewRow.append(h('button', { type: 'button', 'data-view': id, onclick: () => this.chooseView(id), text: name }));
    this.popover($('charactersButton'), $('charactersMenu'), () => this.renderCharactersMenu());
    this.popover($('lightButton'), $('lightMenu'), () => this.renderLightMenu());
    this.popover($('crowdButton'), $('crowdMenu'), () => this.renderCrowdMenu());
    document.addEventListener('pointerdown', event => {
      for (const menu of document.querySelectorAll('.popover:not([hidden])')) {
        if (!menu.contains(event.target) && !menu.previousElementSibling?.contains(event.target)) menu.hidden = true;
      }
    });
  }
  popover(button, menu, render) {
    button.addEventListener('click', () => {
      const open = menu.hidden;
      for (const other of document.querySelectorAll('.popover')) other.hidden = true;
      if (open) { render(); menu.hidden = false; }
    });
  }
  chooseView(view) {
    this.renderer?.camera.view(view, this.renderer?.current?.metrics.height);
    for (const button of document.querySelectorAll('#viewButtons button')) button.classList.toggle('on', button.dataset.view === view);
  }
  setHint(text) { document.getElementById('viewportHint').textContent = text; }

  // ------------------------------------------------------------ menus
  renderCharactersMenu() {
    const menu = document.getElementById('charactersMenu');
    const names = storage.keys().filter(key => key.startsWith(PRESET_PREFIX)).map(key => key.slice(PRESET_PREFIX.length)).sort((a, b) => a.localeCompare(b));
    const list = h('div', { class: 'menu-list' }, names.length ? names.map(name => h('div', { class: 'menu-row' },
      h('button', { type: 'button', class: 'menu-item', onclick: () => { this.loadPreset(name); menu.hidden = true; }, text: name }),
      h('button', { type: 'button', class: 'icon-button ghost', title: `Excluir "${name}"`, 'aria-label': `Excluir ${name}`, onclick: () => { if (confirm(`Excluir o personagem "${name}"?`)) { storage.remove(PRESET_PREFIX + name); this.renderCharactersMenu(); } } }, icon('trash', 16)),
    )) : h('p', { class: 'menu-empty', text: 'Nenhum personagem salvo' }));
    menu.replaceChildren(
      h('div', { class: 'menu-title', text: 'Personagens salvos' }), list,
      h('div', { class: 'menu-actions' },
        h('button', { type: 'button', class: 'button primary', onclick: () => { this.savePreset(); this.renderCharactersMenu(); } }, icon('save', 16), `Salvar "${this.person.name}"`),
        h('button', { type: 'button', class: 'button', onclick: () => { this.setPerson(defaultCharacter); this.setCrowd(0); menu.hidden = true; } }, icon('reset', 16), 'Padrão')),
    );
  }
  renderLightMenu() {
    const menu = document.getElementById('lightMenu');
    menu.replaceChildren(h('div', { class: 'menu-title', text: 'Iluminação' }), ...lightingNames.map((name, i) => h('button', {
      type: 'button', class: `menu-item${this.person.lighting === i ? ' on' : ''}`, onclick: () => { this.update('lighting', i); this.renderLightMenu(); }, text: name,
    })));
  }
  renderCrowdMenu() {
    const menu = document.getElementById('crowdMenu');
    const counts = [1, 10, 50, 100, 250, 500, 1000];
    menu.replaceChildren(
      h('div', { class: 'menu-title', text: 'Teste de multidão' }),
      h('div', { class: 'chips' }, counts.map(count => h('button', { type: 'button', class: `chip${this.crowdCount === count - 1 ? ' on' : ''}`, onclick: () => { this.setCrowd(count - 1); this.renderCrowdMenu(); }, text: String(count) }))),
      h('div', { class: 'metric-list', id: 'crowdMetrics' }),
    );
    this.updateStats(this.stats);
  }
  setCrowd(count) {
    this.crowdCount = count;
    this.ready(count ? 'Montando multidão…' : 'Pronto');
    this.renderer?.setCrowdCount(count, message => this.ready(message ?? 'Pronto'));
    this.chooseView(count ? 'crowd' : 'body');
    this.updateMeta();
  }

  // ------------------------------------------------------------ sections
  setSection(name) {
    if ((this.clothBrush || this.clothTool) && name !== 'roupas') { this.setClothBrush(null); this.clothTool = null; this.renderer?.clothEditor.hide(); }
    if (this.section === 'cabelo' && name !== 'cabelo') this.finishLocks();
    const wasSculpting = this.section === 'esculpir';
    const previous = this.section;
    this.section = name;
    if (name === 'cabelo' && previous !== 'cabelo') this.startLocks();
    if (wasSculpting !== (name === 'esculpir') && this.renderer) {
      const undressed = this.renderer.undressed;
      this.renderer.setSculptMode(name === 'esculpir');
      if (name !== 'esculpir' && undressed) { this.renderer.undressed = false; this.queueCharacter(); }
      if (name === 'esculpir' && this.undressBody && this.renderer.sculpt.settings.target === 'body') { this.renderer.undressed = true; this.queueCharacter(); }
    }
    this.render(true);
  }
  render(fresh = false) {
    const scroll = fresh ? 0 : this.body.scrollTop;
    this.body.replaceChildren();
    const section = sections.find(s => s.id === this.section);
    document.getElementById('sectionTitle').textContent = section.name;
    const actions = document.getElementById('sectionActions'); actions.replaceChildren();
    this.nav.querySelectorAll('.nav-item').forEach(button => {
      const active = button.dataset.section === this.section;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    this.setHint(hints.default);
    this.updateMeta();
    ({
      personagem: () => this.renderCharacter(), corpo: () => this.renderBody(), rosto: () => this.renderFace(),
      cabelo: () => this.renderHair(actions), roupas: () => this.renderClothes(), esculpir: () => this.renderSculpt(actions),
      animacao: () => this.renderAnimation(), exportar: () => this.renderExport(),
    })[this.section]();
    this.body.scrollTop = scroll;
  }
  renderCharacter() {
    const id = this.group('Identidade');
    const name = h('input', { type: 'text', value: this.person.name, maxlength: 42, 'aria-label': 'Nome' });
    name.addEventListener('change', () => { this.update('name', name.value); name.value = this.person.name; });
    id.append(this.row('Nome', name));
    this.segmented(id, 'Corpo', ['Feminino', 'Masculino'], this.person.gender, v => this.update('gender', v));
    this.range(id, 'ageYears', 'Idade', 1, 90, 1, ' anos');
    const [min, max] = this.heightBounds();
    this.range(id, 'heightMeters', 'Altura', min, max, 0.01, ' m');
    this.swatches(id, 'skin', 'Pele', skinPalette, 'skin');
    const gen = this.group('Gerar');
    gen.append(h('div', { class: 'button-grid' },
      h('button', { type: 'button', class: 'button primary', onclick: () => this.setPerson(randomCharacter()) }, icon('dice', 16), 'Pessoa'),
      h('button', { type: 'button', class: 'button', onclick: () => this.randomFace() }, 'Rosto'),
      h('button', { type: 'button', class: 'button', onclick: () => this.randomBody() }, 'Corpo'),
      h('button', { type: 'button', class: 'button', onclick: () => { const r = randomCharacter(); this.setPerson({ ...this.person, outfit: r.outfit, topColor: r.topColor, bottomColor: r.bottomColor }); } }, 'Roupa')));
  }
  renderBody() {
    const shape = this.group('Proporções');
    for (const [key, label] of [['build', 'Peso'], ['muscle', 'Músculos'], ['shoulders', 'Ombros'], ['waist', 'Cintura'], ['hips', 'Quadril'], ['legLength', 'Pernas'], ['headSize', 'Cabeça']]) this.range(shape, key, label, key === 'muscle' ? 0 : -1, 1);
    const skin = this.group('Pele', { open: false });
    this.range(skin, 'skinRoughness', 'Brilho ↔ fosco', 0, 1);
  }
  renderFace() {
    const shape = this.group('Formato');
    for (const [key, label] of [['faceWidth', 'Largura'], ['jaw', 'Queixo'], ['cheek', 'Bochechas'], ['nose', 'Nariz']]) this.range(shape, key, label, -1, 1);
    shape.append(h('button', { type: 'button', class: 'button wide', onclick: () => this.randomFace() }, icon('dice', 16), 'Rosto aleatório'));
    const eyes = this.group('Olhos');
    this.range(eyes, 'eyeSize', 'Tamanho', -1, 1); this.range(eyes, 'eyeSpacing', 'Distância', -1, 1);
    this.swatches(eyes, 'eyeColor', 'Cor', eyePalette, 'eyes');
    const brows = this.group('Sobrancelhas', { open: false });
    this.segmented(brows, 'Formato', ['Natural', 'Reta', 'Arqueada', 'Angulosa'], this.person.browShape, v => this.update('browShape', v));
    this.range(brows, 'browAngle', 'Inclinação', -25, 25, 1, '°');
    this.range(brows, 'browArch', 'Arco', -1, 1); this.range(brows, 'browThickness', 'Espessura', 0.35, 2.1);
    this.range(brows, 'browWidth', 'Largura', 0.7, 1.4); this.range(brows, 'browHeight', 'Altura', -1, 1);
    this.range(brows, 'browDensity', 'Densidade', 0, 1);
    this.swatches(brows, null, 'Cor (padrão: a do cabelo)', hairPalette, 'brows');
    const lashes = this.group('Cílios', { open: false });
    this.range(lashes, 'lashLength', 'Comprimento', 0.4, 1.8); this.range(lashes, 'lashCurl', 'Curvatura', 0, 1);
    this.range(lashes, 'lashDensity', 'Densidade', 0, 1);
    this.swatches(lashes, null, 'Cor', ['#201915', '#3a2a22', '#5b4636', '#11131a'], 'lashes');
  }

  // ------------------------------------------------------------ hair
  get locking() { return Boolean(this.renderer) && this.section === 'cabelo' && this.renderer.lockEditor.active; }
  /** The hair section edits the character's locks live (animation frozen). */
  startLocks() {
    if (!this.renderer) return;
    this.renderer.lockEditor.onChange = () => this.locksChanged();
    this.renderer.setLocksMode(true);
  }
  /** Leaving: the locks are stored with the character and built as one game mesh. */
  finishLocks() {
    if (!this.renderer?.locksMode) return;
    const data = this.renderer.setLocksMode(false);
    if (data) this.person = normalizeCharacter({ ...this.person, locks: data });
    this.queueCharacter();
  }
  lockPanelState() {
    const editor = this.renderer.lockEditor;
    return `${[...editor.selected].sort((a, b) => a - b).join(',')}|${editor.locks.length}|${editor.settings.tool}|${editor.revision ?? 0}`;
  }
  locksChanged() {
    const editor = this.renderer?.lockEditor;
    if (!editor?.active || this.section !== 'cabelo') return;
    if (this.lockPanelState() !== this.lockPanelKey && !this.sliding) { this.render(); return; }
    this.updateLockStatus();
  }
  updateLockStatus() {
    const node = document.getElementById('lockStatus'), editor = this.renderer?.lockEditor;
    if (!node || !editor?.active) return;
    const s = editor.summary();
    node.textContent = `${s.count} mechas${s.selected ? ` · ${s.selected} selecionada${s.selected > 1 ? 's' : ''}` : ''}${s.styled ? ` · ${s.styled} com forma fixa` : ''}${s.gravityOn ? '' : ' · gravidade desligada'}`;
    const undo = document.getElementById('lockUndo'), redo = document.getElementById('lockRedo');
    if (undo) undo.disabled = !editor.undoStack.length;
    if (redo) redo.disabled = !editor.redoStack.length;
  }
  applyHairPreset(id) {
    const editor = this.renderer?.lockEditor, data = hairPresetData(id);
    this.person = normalizeCharacter({ ...this.person, hairPreset: id, locks: null });
    if (editor?.active) { if (data) editor.load(JSON.stringify(data)); else editor.clearAll(); }
    this.render();
  }
  setHairColor(index, custom) {
    const colors = { ...this.person.colors };
    if (custom) colors.hair = custom; else delete colors.hair;
    this.person = normalizeCharacter({ ...this.person, hairColor: index ?? this.person.hairColor, colors });
    const hex = parseInt((custom ?? hairPalette[this.person.hairColor]).slice(1), 16);
    this.renderer?.lockEditor.setColor(hex);
    if (this.renderer) this.renderer.hairColor = hex;
    this.render();
  }
  renderHair(actions) {
    const editor = this.renderer?.lockEditor;
    if (!editor?.active) { this.group('Cabelo').append(h('p', { class: 'muted', text: 'Preparando…' })); setTimeout(() => { if (this.section === 'cabelo') this.render(); }, 400); return; }
    const settings = editor.settings;
    this.lockPanelKey = this.lockPanelState();
    this.setHint(hints[settings.tool]);
    actions.append(
      this.iconButton('undo', 'Desfazer (Ctrl+Z)', () => editor.undo(), 'lockUndo'),
      this.iconButton('redo', 'Refazer (Ctrl+Y)', () => editor.redo(), 'lockRedo'));
    // Styles: a gallery, like a character creator's hair library.
    const styles = this.group('Estilo');
    const tint = this.person.colors.hair ?? hairPalette[this.person.hairColor];
    styles.append(h('div', { class: 'style-grid', style: `--hair-tint:${tint}` }, hairPresets.map(p => h('button', {
      type: 'button', class: `style-card${this.person.hairPreset === p.id ? ' on' : ''}`, title: p.name, onclick: () => this.applyHairPreset(p.id),
    }, hairPictogram(p.id), h('span', { text: p.name })))));
    // Colour.
    const color = this.group('Cor');
    const swatchRow = h('div', { class: 'swatches' }, hairPalette.map((hex, i) => h('button', {
      type: 'button', class: `swatch${!this.person.colors.hair && this.person.hairColor === i ? ' on' : ''}`, style: `--swatch:${hex}`, title: `Cor ${i + 1}`, 'aria-label': `Cor de cabelo ${i + 1}`,
      onclick: () => this.setHairColor(i, null),
    })));
    const picker = h('input', { type: 'color', class: `swatch-picker${this.person.colors.hair ? ' on' : ''}`, value: tint, title: 'Outra cor', 'aria-label': 'Outra cor de cabelo' });
    picker.addEventListener('change', () => this.setHairColor(null, picker.value));
    swatchRow.append(picker); color.append(swatchRow);
    // Tools: direct manipulation in the viewport.
    const tools = this.group('Ferramentas');
    tools.append(h('div', { class: 'tool-row', role: 'group', 'aria-label': 'Ferramenta de cabelo' }, lockTools.map(tool => h('button', {
      type: 'button', class: `tool${settings.tool === tool ? ' on' : ''}`, 'data-lock-tool': tool, title: `${toolNames[tool]} — ${hints[tool]}`, 'aria-pressed': String(settings.tool === tool),
      onclick: () => { editor.setTool(tool); this.render(); },
    }, icon(toolIcons[tool], 20), h('span', { text: toolNames[tool] })))));
    if (settings.tool === 'comb') {
      this.slide(tools, { label: 'Tamanho do pente', value: settings.combRadius, min: 0.03, max: 0.4, step: 0.005, onInput: v => { settings.combRadius = v; } });
      this.slide(tools, { label: 'Força do pente', value: settings.combStrength, min: 0.1, max: 1, step: 0.05, onInput: v => { settings.combStrength = v; } });
    }
    if (settings.tool === 'brush') {
      this.slide(tools, { label: 'Comprimento das mechas', value: settings.brushLength, min: 0.04, max: 0.8, step: 0.005, scale: 100, unit: 'cm', onInput: v => { settings.brushLength = v; } });
      this.slide(tools, { label: 'Distância entre mechas', value: settings.brushSpacing, min: 0.008, max: 0.06, step: 0.001, scale: 100, unit: 'cm', onInput: v => { settings.brushSpacing = v; } });
    }
    this.toggle(tools, 'Espelhar no outro lado', settings.mirror, on => { settings.mirror = on; }, 'Cada mecha nova nasce também do lado oposto');
    this.toggle(tools, 'Prender ao soltar', settings.pinOnRelease, on => { settings.pinOnRelease = on; }, 'O ponto puxado fica preso onde você soltar (ou segure P)');
    this.toggle(tools, 'Manter forma ao soltar', settings.fixOnRelease, on => { settings.fixOnRelease = on; }, 'A mecha puxada fica na forma em que você soltar, sem cair (ou segure F ao soltar)');
    this.toggle(tools, 'Mostrar linha central', settings.showMidline, on => { settings.showMidline = on; editor.updateHelpers(); }, 'A linha do meio da cabeça (as raízes perto dela encaixam no meio mesmo escondida)');
    this.toggle(tools, 'Mostrar couro cabeludo', settings.showScalp, on => { settings.showScalp = on; editor.updateHelpers(); });
    // The selected locks.
    const count = editor.selected.size, lock = editor.summary().first;
    const record = () => editor.checkpoint();
    if (count && lock) {
      const shape = this.group(count > 1 ? `${count} mechas selecionadas` : 'Mecha selecionada');
      this.slide(shape, { label: 'Comprimento', value: lockLength(lock), min: 0.015, max: 1.1, step: 0.005, scale: 100, unit: 'cm', onStart: record, onInput: v => editor.setLength(v) });
      this.slide(shape, { label: 'Largura', value: lock.width, min: 0.006, max: 0.09, step: 0.001, scale: 100, unit: 'cm', onStart: record, onInput: v => editor.setParam('width', v) });
      this.slide(shape, { label: 'Volume', value: lock.volume, min: 0.12, max: 1, onStart: record, onInput: v => editor.setParam('volume', v), title: 'Espessura em relação à largura' });
      this.slide(shape, { label: 'Afunilar', value: lock.taper, min: 0, max: 1, onStart: record, onInput: v => editor.setParam('taper', v), title: 'Quanto a mecha afina até a ponta' });
      this.slide(shape, { label: 'Curvar', value: lock.bend, min: -1, max: 1, onStart: record, onInput: v => editor.setParam('bend', v), title: 'Pontas para dentro (+) ou para fora (−)' });
      this.slide(shape, { label: 'Enrolar', value: lock.curl, min: 0, max: 1, onStart: record, onInput: v => editor.setParam('curl', v) });
      this.slide(shape, { label: 'Voltas', value: lock.turns, min: 0.5, max: 14, step: 0.1, onStart: record, onInput: v => editor.setParam('turns', v) });
      this.slide(shape, { label: 'Torcer', value: lock.twist * 180 / Math.PI, min: -540, max: 540, step: 1, unit: '°', onStart: record, onInput: v => editor.setParam('twist', v * Math.PI / 180) });
      this.slide(shape, { label: 'Firmeza', value: lock.stiffness, min: 0, max: 1, onStart: record, onInput: v => editor.setParam('stiffness', v), title: 'Quanto a mecha resiste à gravidade' });
      shape.append(h('div', { class: 'button-grid' },
        h('button', { type: 'button', class: 'button', onclick: () => editor.pinTip() }, icon('pin', 16), 'Prender ponta'),
        h('button', { type: 'button', class: 'button', onclick: () => editor.unpin() }, 'Soltar pinos'),
        h('button', { type: 'button', class: 'button danger', onclick: () => editor.deleteSelected(), title: 'Delete' }, icon('trash', 16), 'Apagar'),
        h('button', { type: 'button', class: 'button', onclick: () => editor.clearSelection() }, 'Limpar seleção')));
    } else {
      const fresh = this.group('Novas mechas', { open: false });
      this.slide(fresh, { label: 'Largura', value: settings.width, min: 0.006, max: 0.09, step: 0.001, scale: 100, unit: 'cm', onInput: v => { settings.width = v; } });
      this.slide(fresh, { label: 'Volume', value: settings.volume, min: 0.12, max: 1, onInput: v => { settings.volume = v; } });
      this.slide(fresh, { label: 'Afunilar', value: settings.taper, min: 0, max: 1, onInput: v => { settings.taper = v; } });
      fresh.append(h('button', { type: 'button', class: 'button wide', onclick: () => editor.selectAll() }, 'Selecionar todas as mechas'));
    }
    // Gravity: an operation applied after each edit; nothing runs by itself.
    const physics = this.group('Gravidade');
    physics.append(h('p', { class: 'status-line', id: 'lockStatus' }));
    this.toggle(physics, 'Gravidade ligada (G)', settings.gravityOn, on => { editor.setGravityOn(on); this.render(); }, 'Desligada, as mechas ficam na forma em que você as puxar');
    this.slide(physics, { label: 'Força da gravidade', value: settings.gravity, min: 0, max: 1, onStart: record, onInput: v => editor.setGravity(v), title: '0: as mechas mantêm o formato desenhado' });
    physics.append(h('div', { class: 'button-grid' },
      h('button', { type: 'button', class: 'button', id: 'lockGravity', onclick: () => editor.applyGravity(), title: 'Assenta as mechas soltas pela gravidade' }, icon('settle', 16), 'Aplicar gravidade'),
      h('button', { type: 'button', class: 'button primary', id: 'lockSetRest', onclick: () => editor.setRest(), title: 'O formato atual das mechas selecionadas (ou de todas) vira a forma do penteado e resiste à gravidade · tecla F' }, icon('lock', 16), 'Fixar forma (F)'),
      h('button', { type: 'button', class: 'button', onclick: () => editor.releaseRest(), title: 'As mechas voltam a cair com a gravidade' }, icon('unlock', 16), 'Soltar forma')));
    // Files.
    const files = this.group('Arquivo', { open: false });
    const nameInput = h('input', { type: 'text', id: 'lockSlotName', value: this.lockSlot ?? 'Meu penteado', maxlength: 40, 'aria-label': 'Nome do penteado' });
    const slots = LockEditor.slots();
    const slotSelect = h('select', { id: 'lockSlots', 'aria-label': 'Penteados salvos' }, slots.map(name => h('option', { value: name, text: name })));
    if (this.lockSlot && slots.includes(this.lockSlot)) slotSelect.value = this.lockSlot;
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0]; if (!file) return;
      this.ready(editor.load(await file.text()) ? `"${file.name}" carregado` : 'Arquivo não é um penteado', false); fileInput.value = '';
    });
    files.append(
      this.row('Nome', nameInput),
      h('div', { class: 'button-grid' },
        h('button', { type: 'button', class: 'button', id: 'lockSave', onclick: () => { const name = nameInput.value.trim() || 'Meu penteado'; this.lockSlot = name; this.ready(editor.saveSlot(name) ? `Penteado "${name}" salvo` : 'Armazenamento indisponível'); this.render(); } }, icon('save', 16), 'Salvar'),
        h('button', { type: 'button', class: 'button', onclick: () => this.downloadLocks(editor, nameInput.value) }, icon('file', 16), 'Exportar .json')),
      slots.length ? this.row('Salvos', slotSelect) : null,
      h('div', { class: 'button-grid' },
        h('button', { type: 'button', class: 'button', id: 'lockLoad', disabled: !slots.length, onclick: () => { const name = slotSelect.value; if (!name) return; this.lockSlot = name; this.ready(editor.loadSlot(name) ? `Penteado "${name}" carregado` : 'Penteado não encontrado'); } }, icon('folder', 16), 'Carregar'),
        h('button', { type: 'button', class: 'button', onclick: () => fileInput.click() }, 'Importar .json'),
        slots.length ? h('button', { type: 'button', class: 'button danger', onclick: () => { const name = slotSelect.value; if (name && confirm(`Excluir "${name}"?`)) { editor.deleteSlot(name); this.render(); } } }, icon('trash', 16), 'Excluir') : null),
      fileInput);
    this.updateLockStatus();
  }
  downloadLocks(editor, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(editor.serialize())], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `${slug(name || 'penteado')}.mechas.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // ------------------------------------------------------------ clothes
  get sculpting() { return Boolean(this.renderer) && (this.section === 'esculpir' || (this.section === 'roupas' && Boolean(this.clothBrush))); }
  /** Made-to-measure clothes are being edited (undo/redo applies to them). */
  get dressing() { return Boolean(this.renderer) && this.section === 'roupas' && this.person.outfit === 4; }
  /** The edge tool is on: the left button drags the garment's edges. */
  get tailoring() { return this.dressing && this.clothTool === 'edges'; }
  /** Clothes tools: null (look around), 'edges', 'clothAdd', 'clothErase'. */
  setClothTool(tool) {
    this.clothTool = tool;
    if (tool === 'clothAdd' || tool === 'clothErase') { this.setClothBrush(tool); this.renderer?.clothEditor.hide(); }
    else {
      this.setClothBrush(null);
      if (tool === 'edges') { this.renderer?.setSculptMode(true); this.renderer?.clothEditor.show(this.person.garments[this.garmentIndex ?? 0] ?? null); }
      else this.renderer?.clothEditor.hide();
    }
    this.setHint(clothHints[tool ?? 'look']);
  }
  // Undo/redo of the made-to-measure outfit (every change is a whole-outfit snapshot).
  garmentCheckpoint() {
    (this.garmentUndo ??= []).push(JSON.stringify(this.person.garments));
    if (this.garmentUndo.length > 60) this.garmentUndo.shift();
    this.garmentRedo = [];
  }
  restoreGarments(json) {
    this.person = normalizeCharacter({ ...this.person, garments: JSON.parse(json) });
    this.garmentIndex = Math.min(this.garmentIndex ?? 0, Math.max(0, this.person.garments.length - 1));
    this.queueCharacter(); this.render();
  }
  undoGarment() { if (!this.garmentUndo?.length) return; (this.garmentRedo ??= []).push(JSON.stringify(this.person.garments)); this.restoreGarments(this.garmentUndo.pop()); }
  redoGarment() { if (!this.garmentRedo?.length) return; (this.garmentUndo ??= []).push(JSON.stringify(this.person.garments)); this.restoreGarments(this.garmentRedo.pop()); }
  clothEdgeStart() { this.ready('Arraste para cima ou para baixo'); }
  clothEdgeMove(drag) { if (drag) this.ready(`${drag.label}: ${Math.round(drag.value * 100)}%`); }
  clothEdgeEnd(result) {
    if (!result) { this.ready('Pronto'); return; }
    this.garmentCheckpoint();
    this.updateGarment({ [result.key]: result.value }, 0);
    this.render();
  }
  setClothBrush(mode) {
    const settings = this.renderer?.sculpt.settings;
    if (!settings) return;
    if (mode && !this.clothBrush) this.savedBrush = { target: settings.target, brush: settings.brush, radius: settings.radius };
    this.clothBrush = mode;
    if (mode) { Object.assign(settings, { target: 'body', brush: mode, radius: Math.max(settings.radius, 0.04) }); this.renderer.setSculptMode(true); }
    else { if (this.savedBrush) Object.assign(settings, this.savedBrush); this.renderer.setSculptMode(this.section === 'esculpir'); }
  }
  commitClothPaint({ mode, weights }) {
    const garment = this.person.garments[this.garmentIndex ?? 0];
    if (!garment || !weights.size) return;
    this.garmentCheckpoint();
    const paint = { ...garment.paint };
    for (const [v, w] of weights) { const old = paint[v] ?? 0; paint[v] = mode === 'clothAdd' ? Math.max(old, w) : Math.min(old, -w); }
    this.updateGarment({ paint }, 0);
  }
  updateGarment(changes, delay = 120) {
    const garments = this.person.garments.map((g, i) => i === (this.garmentIndex ?? 0) ? { ...g, ...changes } : g);
    this.person = normalizeCharacter({ ...this.person, garments });
    clearTimeout(this.garmentTimer);
    this.garmentTimer = setTimeout(() => this.queueCharacter(), delay);
  }
  setGarments(garments, index) {
    this.garmentCheckpoint();
    this.person = normalizeCharacter({ ...this.person, garments });
    this.garmentIndex = Math.max(0, Math.min(this.person.garments.length - 1, index));
    this.queueCharacter(); this.render();
  }
  renderClothes() {
    const outfit = this.group('Roupa');
    outfit.append(h('div', { class: 'chips' }, outfitNames.map((name, i) => h('button', {
      type: 'button', class: `chip${this.person.outfit === i ? ' on' : ''}`, onclick: () => { if (this.clothBrush && i !== 4) this.setClothBrush(null); this.update('outfit', i); this.render(); }, text: name,
    }))));
    if (this.person.outfit !== 4) {
      const colors = this.group('Cores');
      this.swatches(colors, 'topColor', 'Parte de cima', topPalette, 'top');
      this.swatches(colors, 'bottomColor', 'Parte de baixo', bottomPalette, 'bottom');
      return;
    }
    const garments = this.person.garments;
    this.garmentIndex = Math.max(0, Math.min(garments.length - 1, this.garmentIndex ?? 0));
    // Tools in the viewport, as in the hair editor.
    const tools = this.group('Ferramentas');
    tools.append(h('div', { class: 'tool-row', role: 'group', 'aria-label': 'Ferramenta de roupa' }, clothTools.map(([tool, name, glyph]) => h('button', {
      type: 'button', class: `tool${(this.clothTool ?? null) === tool ? ' on' : ''}`, 'data-cloth-tool': tool ?? 'look', title: `${name} — ${clothHints[tool ?? 'look']}`, 'aria-pressed': String((this.clothTool ?? null) === tool),
      onclick: () => { this.setClothTool(tool); this.render(); },
    }, icon(glyph, 20), h('span', { text: name })))));
    if (this.clothBrush) {
      const settings = this.renderer.sculpt.settings;
      this.slide(tools, { label: 'Tamanho do pincel', value: settings.radius, min: 0.01, max: 0.15, step: 0.005, scale: 100, unit: 'cm', onInput: v => { settings.radius = v; } });
      this.toggle(tools, 'Espelhar no corpo', settings.symmetry, on => { settings.symmetry = on; });
    }
    this.setHint(clothHints[this.clothTool ?? 'look']);
    if (this.clothTool === 'edges') this.renderer?.clothEditor.show(garments[this.garmentIndex] ?? null);
    const pieces = this.group('Peças');
    pieces.append(h('div', { class: 'chips' }, garments.map((g, i) => h('button', { type: 'button', class: `chip${i === this.garmentIndex ? ' on' : ''}`, onclick: () => { this.garmentIndex = i; this.render(); }, text: `${i + 1}. ${garmentLabels[g.type]}` }))));
    pieces.append(h('div', { class: 'button-grid' },
      this.iconButton('undo', 'Desfazer (Ctrl+Z)', () => this.undoGarment()), this.iconButton('redo', 'Refazer (Ctrl+Y)', () => this.redoGarment())));
    const addSelect = h('select', { 'aria-label': 'Nova peça' }, garmentTypes.map(type => h('option', { value: type, text: garmentLabels[type] })));
    pieces.append(this.row('Nova peça', addSelect), h('div', { class: 'button-grid' },
      h('button', { type: 'button', class: 'button', disabled: garments.length >= 8, onclick: () => this.setGarments([...garments, newGarment(addSelect.value)], garments.length) }, icon('plus', 16), 'Adicionar'),
      h('button', { type: 'button', class: 'button danger', disabled: !garments.length, onclick: () => this.setGarments(garments.filter((_, i) => i !== this.garmentIndex), this.garmentIndex - 1) }, icon('trash', 16), 'Remover'),
      h('button', { type: 'button', class: 'button', disabled: this.garmentIndex < 1, title: 'Mais perto da pele', onclick: () => { const g = [...garments], i = this.garmentIndex; [g[i - 1], g[i]] = [g[i], g[i - 1]]; this.setGarments(g, i - 1); } }, 'Para dentro'),
      h('button', { type: 'button', class: 'button', disabled: this.garmentIndex >= garments.length - 1, title: 'Mais por fora', onclick: () => { const g = [...garments], i = this.garmentIndex; [g[i + 1], g[i]] = [g[i], g[i + 1]]; this.setGarments(g, i + 1); } }, 'Para fora')));
    const garment = garments[this.garmentIndex];
    if (!garment) return;
    const cut = this.group('Modelagem');
    const typeSelect = h('select', { 'aria-label': 'Tipo' }, garmentTypes.map(type => h('option', { value: type, text: garmentLabels[type] })));
    typeSelect.value = garment.type;
    typeSelect.addEventListener('change', () => { this.garmentCheckpoint(); this.updateGarment({ ...newGarment(typeSelect.value), paint: garment.paint, color: garment.color, color2: garment.color2, pattern: garment.pattern }); this.render(); });
    cut.append(this.row('Tipo', typeSelect));
    const field = (key, label) => this.slide(cut, { label, value: garment[key], min: 0, max: 1, onStart: () => this.garmentCheckpoint(), onInput: v => this.updateGarment({ [key]: v }, 250) });
    const t = garment.type;
    if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'dress'].includes(t)) { field('sleeve', 'Manga'); field('neckline', 'Decote'); }
    if (['tshirt', 'longsleeve', 'tank', 'hoodie', 'skirt', 'dress'].includes(t)) field('length', t === 'skirt' || t === 'dress' ? 'Barra' : 'Comprimento');
    if (['pants', 'shorts', 'socks'].includes(t)) field('leg', t === 'socks' ? 'Altura' : 'Perna');
    if (['pants', 'shorts', 'skirt'].includes(t)) field('rise', 'Cintura');
    if (['skirt', 'dress'].includes(t)) field('flare', 'Rodado');
    field('fit', 'Folga');
    const fabric = this.group('Tecido');
    const patternSelect = h('select', { 'aria-label': 'Padrão' }, garmentPatterns.map(name => h('option', { value: name, text: patternNames[name] ?? name })));
    patternSelect.value = garment.pattern;
    patternSelect.addEventListener('change', () => { this.garmentCheckpoint(); this.updateGarment({ pattern: patternSelect.value }); this.render(); });
    fabric.append(this.row('Padrão', patternSelect));
    const colorInput = key => { const input = h('input', { type: 'color', value: garment[key] }); input.addEventListener('click', () => this.garmentCheckpoint()); input.addEventListener('input', () => this.updateGarment({ [key]: input.value }, 200)); return input; };
    fabric.append(this.row('Cor', colorInput('color')));
    if (garment.pattern !== 'solid') {
      fabric.append(this.row('Segunda cor', colorInput('color2')));
      this.slide(fabric, { label: 'Escala', value: garment.scale, min: 0, max: 1, onInput: v => this.updateGarment({ scale: v }, 250) });
    }
    this.slide(fabric, { label: 'Aspereza', value: garment.roughness, min: 0, max: 1, onInput: v => this.updateGarment({ roughness: v }, 250) });
    const paint = this.group('Pintura', { open: false });
    paint.append(h('button', { type: 'button', class: 'button wide', disabled: !Object.keys(garment.paint).length, onclick: () => { this.updateGarment({ paint: {} }, 0); this.render(); } }, `Limpar pintura (${Object.keys(garment.paint).length})`));
  }

  // ------------------------------------------------------------ sculpt
  commitSculpt(target) {
    if (!target) return;
    if (target.paint) { this.commitClothPaint(target.paint); return; }
    const changes = target.changes();
    if (!changes.size) return;
    this.undo.push(JSON.stringify(this.person.sculpt)); this.redo = [];
    if (this.undo.length > 60) this.undo.shift();
    const sculpt = structuredClone(this.person.sculpt);
    const store = target.kind === 'body' ? sculpt.body : (sculpt[target.kind][target.style] ??= {});
    for (const [unit, delta] of changes) { const old = store[unit] ?? [0, 0, 0]; store[unit] = old.map((value, k) => value + delta[k]); }
    target.built.set(target.points);
    this.person = normalizeCharacter({ ...this.person, sculpt });
    this.updateSculptButtons();
    clearTimeout(this.sculptTimer);
    this.sculptTimer = setTimeout(() => this.queueCharacter(), target.kind === 'body' ? 350 : 900);
  }
  restoreSculpt(json) { this.person = normalizeCharacter({ ...this.person, sculpt: JSON.parse(json) }); this.updateSculptButtons(); this.queueCharacter(); }
  undoSculpt() { if (this.undo.length) { this.redo.push(JSON.stringify(this.person.sculpt)); this.restoreSculpt(this.undo.pop()); } }
  redoSculpt() { if (this.redo.length) { this.undo.push(JSON.stringify(this.person.sculpt)); this.restoreSculpt(this.redo.pop()); } }
  updateSculptButtons() {
    const undo = document.getElementById('sculptUndo'), redo = document.getElementById('sculptRedo');
    if (undo) undo.disabled = !this.undo.length;
    if (redo) redo.disabled = !this.redo.length;
  }
  renderSculpt(actions) {
    const settings = this.renderer?.sculpt.settings;
    if (!settings) { this.group('Esculpir').append(h('p', { class: 'muted', text: 'Iniciando o 3D…' })); return; }
    if (settings.target === 'hair') settings.target = 'body';
    if (!brushNames[settings.brush]) settings.brush = 'draw';
    this.setHint(hints.esculpir);
    actions.append(this.iconButton('undo', 'Desfazer (Ctrl+Z)', () => this.undoSculpt(), 'sculptUndo'), this.iconButton('redo', 'Refazer (Ctrl+Y)', () => this.redoSculpt(), 'sculptRedo'));
    const brush = this.group('Pincel');
    this.segmented(brush, 'Esculpir', ['Corpo e rosto', 'Roupas'], settings.target === 'outfit' ? 1 : 0, i => {
      settings.target = ['body', 'outfit'][i];
      const undress = settings.target === 'body' && Boolean(this.undressBody);
      if (this.renderer.undressed !== undress) { this.renderer.undressed = undress; this.queueCharacter(); } else this.renderer.freezeForSculpt();
    });
    brush.append(h('div', { class: 'chips' }, Object.entries(brushNames).map(([id, name]) => h('button', {
      type: 'button', class: `chip${settings.brush === id ? ' on' : ''}`, onclick: () => { settings.brush = id; this.render(); }, text: name,
    }))));
    this.slide(brush, { label: 'Raio', value: settings.radius, min: 0.005, max: 0.15, step: 0.001, scale: 100, unit: 'cm', onInput: v => { settings.radius = v; } });
    this.slide(brush, { label: 'Força', value: settings.strength, min: 0.05, max: 1, onInput: v => { settings.strength = v; } });
    this.toggle(brush, 'Simetria (espelhar em X)', settings.symmetry, on => { settings.symmetry = on; });
    this.toggle(brush, 'Inverter (afundar, desinflar)', settings.invert, on => { settings.invert = on; }, 'Também segurando Ctrl');
    this.toggle(brush, 'Esconder roupas ao esculpir o corpo', Boolean(this.undressBody), on => {
      this.undressBody = on;
      const undress = on && settings.target === 'body';
      if (this.renderer.undressed !== undress) { this.renderer.undressed = undress; this.queueCharacter(); }
    });
    const reset = this.group('Redefinir', { open: false });
    const { body, outfit } = this.person.sculpt;
    const count = Object.keys(body).length + Object.values(outfit).reduce((m, edits) => m + Object.keys(edits).length, 0);
    reset.append(h('p', { class: 'muted', text: `${count.toLocaleString('pt-BR')} vértices esculpidos` }), h('div', { class: 'button-grid' },
      h('button', { type: 'button', class: 'button', onclick: () => {
        const sculpt = structuredClone(this.person.sculpt);
        if (settings.target === 'body') sculpt.body = {}; else { const style = this.renderer.sculpt.target?.style; if (style) delete sculpt[settings.target][style]; }
        this.undo.push(JSON.stringify(this.person.sculpt)); this.redo = []; this.restoreSculpt(JSON.stringify(sculpt)); this.render();
      } }, 'Esta parte'),
      h('button', { type: 'button', class: 'button danger', onclick: () => { this.undo.push(JSON.stringify(this.person.sculpt)); this.redo = []; this.restoreSculpt('{}'); this.render(); } }, 'Tudo')));
    this.updateSculptButtons();
  }

  // ------------------------------------------------------------ animation
  renderAnimation() {
    const motion = this.group('Movimento');
    motion.append(h('div', { class: 'chips' }, animationNames.map((name, i) => h('button', {
      type: 'button', class: `chip${this.person.animation === i ? ' on' : ''}`, onclick: () => { this.update('animation', i); this.render(); }, text: name,
    }))));
    this.range(motion, 'animationSpeed', 'Velocidade', 0.4, 1.8, 0.01, '×');
    motion.append(h('button', { type: 'button', class: 'button wide', onclick: () => this.renderer?.replay() }, icon('reset', 16), 'Repetir do início'));
    const pose = this.group('Postura');
    this.segmented(pose, null, ['Natural', 'Relaxada', 'Confiante', 'Mãos na cintura'], this.person.pose, v => this.update('pose', v));
    const face = this.group('Expressão');
    face.append(h('div', { class: 'chips' }, expressionNames.map((name, i) => h('button', {
      type: 'button', class: `chip${this.person.expression === i ? ' on' : ''}`, onclick: () => { this.update('expression', i); this.render(); }, text: name,
    }))));
    this.range(face, 'expressionIntensity', 'Intensidade', 0, 1);
    const fine = this.group('Ajuste fino do rosto', { open: false });
    for (const name of blendshapeNames) {
      this.slide(fine, { label: name, value: this.person.faceShapes[name] ?? 0, min: -1, max: 1, onInput: v => {
        this.person = normalizeCharacter({ ...this.person, faceShapes: { ...this.person.faceShapes, [name]: v } });
        this.renderer?.setPresentation(this.person);
      } });
    }
    fine.append(h('button', { type: 'button', class: 'button wide', onclick: () => { this.person = normalizeCharacter({ ...this.person, faceShapes: {} }); this.renderer?.setPresentation(this.person); this.render(); } }, 'Zerar ajustes'));
  }

  // ------------------------------------------------------------ export
  get exportOptions() { return this.exportSettings ??= { skeleton: 'unreal', lod: 'high', groom: 'cards', animations: true, blendshapes: true, cosmetic: false, optimize: true }; }
  renderExport() {
    const options = this.exportOptions;
    const glb = this.group('GLB para jogos');
    const choose = (label, key, entries) => this.segmented(glb, label, entries.map(e => e[1]), entries.findIndex(e => e[0] === options[key]), i => { options[key] = entries[i][0]; });
    choose('Esqueleto', 'skeleton', [['unreal', 'Unreal'], ['mixamo', 'Mixamo / Unity']]);
    choose('Detalhe', 'lod', [['high', 'Alto'], ['medium', 'Médio'], ['low', 'Baixo']]);
    choose('Sobrancelhas e cílios', 'groom', [['cards', 'Cartões (leve)'], ['strands', 'Fios']]);
    this.toggle(glb, 'Animações (16 clipes)', options.animations, on => { options.animations = on; });
    this.toggle(glb, 'Blendshapes faciais (ARKit)', options.blendshapes, on => { options.blendshapes = on; });
    this.toggle(glb, 'Otimizar (soldar vértices, JPEG)', options.optimize, on => { options.optimize = on; });
    this.toggle(glb, 'Camadas de brilho dos olhos', options.cosmetic, on => { options.cosmetic = on; });
    glb.append(h('button', { type: 'button', class: 'button primary wide big', onclick: () => this.exportGLB() }, icon('export', 18), 'Exportar GLB'));
    const summary = this.group('Personagem atual', { open: false });
    const group = this.renderer?.current?.group;
    let triangles = 0, meshes = 0;
    group?.traverse(object => { if (object.isMesh && object.visible && object.geometry.index) { triangles += object.geometry.index.count / 3; meshes++; } });
    const face = this.renderer?.current?.faceMeshes?.[0];
    summary.append(h('div', { class: 'metric-list' }, [['Triângulos', triangles.toLocaleString('pt-BR')], ['Malhas', meshes], ['Ossos', this.renderer?.current?.body.skeleton.bones.length ?? '—'], ['Blendshapes', face ? Object.keys(face.morphTargetDictionary).length : 0]]
      .flatMap(([label, value]) => [h('span', { text: label }), h('b', { text: String(value) })])));
  }

  // ------------------------------------------------------------ actions
  setPerson(person, rebuild = true) {
    if (person.seed !== this.person.seed || person.name !== this.person.name) { this.undo = []; this.redo = []; this.garmentIndex = 0; }
    this.person = normalizeCharacter(person);
    // A new character brings its own hair: the hair editor reloads it after the rebuild.
    if (this.section === 'cabelo' && this.renderer?.locksMode) this.renderer.lockEditor.end();
    if (rebuild) this.queueCharacter();
    this.render();
  }
  update(key, value) {
    if (key === 'ageYears') { this.updateAge(value); return; }
    this.person = normalizeCharacter({ ...this.person, [key]: value });
    if (key === 'heightMeters') this.person.height = Math.max(1.48, Math.min(1.98, this.person.heightMeters));
    if (presentationFields.has(key)) this.renderer?.setPresentation(this.person);
    else if (key !== 'name') this.queueCharacter();
    this.updateMeta();
  }
  updateAge(ageYears) {
    this.person = normalizeCharacter({ ...this.person, ageYears, heightMeters: Number(ageHeightReference(ageYears, this.person.gender).toFixed(2)) });
    const input = document.querySelector('[data-key="heightMeters"]');
    if (input) {
      const [min, max] = this.heightBounds();
      input.min = min; input.max = max; input.value = this.person.heightMeters;
      input.closest('.field').querySelector('input[type=number]').value = this.person.heightMeters.toFixed(2);
    }
    this.queueCharacter(); this.updateMeta();
  }
  heightBounds(height = this.person.heightMeters) { return [Math.max(0.55, Number((height * 0.7).toFixed(2))), Math.min(2.2, Number((height * 1.3).toFixed(2)))]; }
  randomFace() { const r = randomCharacter(); this.setPerson({ ...this.person, faceWidth: r.faceWidth, jaw: r.jaw, cheek: r.cheek, nose: r.nose, eyeSize: r.eyeSize, eyeSpacing: r.eyeSpacing, eyeColor: r.eyeColor }); }
  randomBody() {
    const r = randomCharacter();
    const relative = r.heightMeters / ageHeightReference(r.ageYears, r.gender);
    const heightMeters = Number((ageHeightReference(this.person.ageYears, this.person.gender) * relative).toFixed(2));
    this.setPerson({ ...this.person, heightMeters, height: r.height, build: r.build, muscle: r.muscle, shoulders: r.shoulders, waist: r.waist, hips: r.hips, legLength: r.legLength });
  }
  loadPreset(name) {
    const json = storage.get(PRESET_PREFIX + name);
    if (!json) { this.ready('Personagem não encontrado', true); return; }
    try { this.setPerson(parsePreset(json)); this.undo = []; this.redo = []; this.ready(`"${name}" carregado`); }
    catch (error) { this.fail(`Não foi possível carregar: ${error.message}`); }
  }
  savePreset() {
    if (this.section === 'cabelo' && this.renderer?.lockEditor.active) this.person = normalizeCharacter({ ...this.person, locks: this.renderer.lockEditor.serialize() });
    const name = this.person.name.trim() || 'Personagem';
    this.ready(storage.set(PRESET_PREFIX + name, serializePreset(this.person)) ? `"${name}" salvo` : 'Armazenamento indisponível', false);
  }
  screenshot() {
    document.getElementById('stage').toBlob(blob => {
      if (!blob) { this.ready('Captura indisponível', true); return; }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `${slug(this.person.name)}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); this.ready('Captura salva');
    }, 'image/png');
  }
  async exportGLB() {
    try {
      this.ready('Exportando GLB…');
      if (this.section === 'cabelo' && this.renderer?.lockEditor.active) this.person = normalizeCharacter({ ...this.person, locks: this.renderer.lockEditor.serialize() });
      const bytes = await this.renderer.exportGLB(this.exportOptions);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })), a = document.createElement('a');
      a.href = url; a.download = `${slug(this.person.name)}-${this.person.seed}.glb`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.ready('GLB exportado');
    } catch (error) { this.fail(`Falha ao exportar: ${error.message}`); }
  }

  // ------------------------------------------------------------ controls
  /** A collapsible group; its open state is remembered per section and title. */
  group(title, { open = true } = {}) {
    const key = `${this.section}:${title}`;
    const details = h('details', { class: 'group' }, h('summary', {}, h('span', { text: title }), icon('chevron', 14)));
    details.open = this.openGroups.get(key) ?? open;
    details.addEventListener('toggle', () => this.openGroups.set(key, details.open));
    const body = h('div', { class: 'group-body' });
    details.append(body); this.body.append(details);
    return body;
  }
  row(label, control) { control.id ||= `c${++this.uid}`; return h('div', { class: 'row' }, h('label', { for: control.id, text: label }), control); }
  iconButton(name, title, onclick, id) { return h('button', { type: 'button', class: 'icon-button', id, title, 'aria-label': title, onclick }, icon(name, 18)); }
  /**
   * Slider with a typed value beside its label (precise entry, NN/g). `scale`
   * shows the value in other units (cm); onStart/onEnd bracket one drag.
   */
  slide(parent, { label, value, min, max, step = 0.01, scale = 1, unit = '', onInput, onStart, onEnd, key, title }) {
    const id = `s${++this.uid}`, digits = step * scale >= 1 ? 0 : step * scale >= 0.1 ? 1 : 2;
    const range = h('input', { type: 'range', id, min, max, step, value, 'data-key': key });
    const number = h('input', { type: 'number', class: 'value', min: +(min * scale).toFixed(digits), max: +(max * scale).toFixed(digits), step: +(step * scale).toFixed(4), value: (value * scale).toFixed(digits), 'aria-label': `${label} (valor)` });
    let first = true;
    const begin = () => { if (first) { this.sliding = true; onStart?.(); first = false; } };
    const end = () => { first = true; this.sliding = false; onEnd?.(range, number); this.updateLockStatus(); };
    range.addEventListener('input', () => { begin(); number.value = (Number(range.value) * scale).toFixed(digits); onInput(Number(range.value)); });
    range.addEventListener('change', end);
    number.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, Number(number.value) / scale));
      if (!Number.isFinite(v)) return;
      begin(); range.value = v; number.value = (v * scale).toFixed(digits); onInput(v); end();
    });
    const node = h('div', { class: 'field', title }, h('div', { class: 'field-head' }, h('label', { for: id, text: label }), h('span', { class: 'value-box' }, number, unit ? h('span', { class: 'unit', text: unit.trim() }) : null)), range);
    parent.append(node);
    return range;
  }
  /** Slider bound to a character field. */
  range(parent, key, label, min, max, step = 0.01, unit = '') {
    return this.slide(parent, { label, value: this.person[key], min, max, step, unit, key, onInput: v => this.update(key, v) });
  }
  segmented(parent, label, names, selected, onPick) {
    const row = h('div', { class: 'segmented', role: 'group', 'aria-label': label ?? undefined }, names.map((name, i) => h('button', {
      type: 'button', class: selected === i ? 'on' : '', 'aria-pressed': String(selected === i), onclick: () => { onPick(i); this.render(); }, text: name,
    })));
    parent.append(label ? h('div', { class: 'stack' }, h('div', { class: 'stack-label', text: label }), row) : row);
  }
  toggle(parent, label, checked, onChange, title) {
    const box = h('input', { type: 'checkbox', role: 'switch' }); box.checked = Boolean(checked);
    box.addEventListener('change', () => onChange(box.checked));
    parent.append(h('label', { class: 'switch', title }, box, h('span', { class: 'track' }), h('span', { text: label })));
  }
  /** Palette swatches for a character field, with a free colour picker for `colorKey`. */
  swatches(parent, key, label, palette, colorKey) {
    const custom = this.person.colors[colorKey];
    const row = h('div', { class: 'swatches', role: 'group', 'aria-label': label }, palette.map((hex, i) => h('button', {
      type: 'button', class: `swatch${!custom && key && this.person[key] === i ? ' on' : ''}`, style: `--swatch:${hex}`, title: `${label} ${i + 1}`, 'aria-label': `${label} ${i + 1}`,
      onclick: () => {
        const colors = { ...this.person.colors }; delete colors[colorKey];
        this.person = normalizeCharacter({ ...this.person, colors });
        if (key) this.update(key, i); else this.queueCharacter();
        this.render();
      },
    })));
    const picker = h('input', { type: 'color', class: `swatch-picker${custom ? ' on' : ''}`, value: custom ?? palette[this.person[key]] ?? palette[0], title: 'Outra cor', 'aria-label': `${label}: outra cor` });
    picker.addEventListener('change', () => { this.person = normalizeCharacter({ ...this.person, colors: { ...this.person.colors, [colorKey]: picker.value } }); this.queueCharacter(); this.render(); });
    row.append(picker);
    parent.append(h('div', { class: 'stack' }, h('div', { class: 'stack-label', text: label }), row));
  }
}
