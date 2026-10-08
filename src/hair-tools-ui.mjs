/** Small additive panel; all edits use LockEditor history and serialization. */
export function renderHairTools(container, editor, { onChange = () => {} } = {}) {
  container.replaceChildren();
  if (!editor.active) return;
  const make = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const changed = fn => { fn(); onChange(); };
  const check = (label, value, fn) => {
    const row = make('label', null, 'hair-fusion-check'), input = make('input'); input.type = 'checkbox'; input.checked = value;
    input.addEventListener('change', () => changed(() => fn(input.checked)));
    row.append(input, make('span', label)); container.append(row);
  };
  const fusion = editor.summary().fusion;
  if (editor.summary().fusionBusy) container.append(make('p', 'Calculando união dos volumes…'));
  if (editor.summary().fusionError) container.append(make('p', `Falha na fusão: ${editor.summary().fusionError}`));
  // Fusion itself is switched by the Representation control (Volume); this panel only tunes it.
  const groups = fusion?.groups ?? [{ id: 'main', name: 'Principal', fuse: true }];
  const groupLabel = make('label', 'Grupo ativo'), select = make('select'); select.setAttribute('aria-label', 'Grupo ativo do cabelo');
  for (const group of groups) { const option = make('option', group.name); option.value = group.id; option.selected = group.id === editor.settings.activeGroup; select.append(option); }
  select.addEventListener('change', () => changed(() => { editor.settings.activeGroup = select.value; }));
  groupLabel.append(select); container.append(groupLabel);
  const newRow = make('div', null, 'hair-group-actions'), name = make('input'), create = make('button', 'Criar grupo');
  name.type = 'text'; name.placeholder = 'Nome do grupo'; name.maxLength = 64; name.setAttribute('aria-label', 'Nome do novo grupo'); create.type = 'button';
  create.addEventListener('click', () => changed(() => editor.createGroup(name.value)));
  newRow.append(name, create); container.append(newRow);
  const assign = make('button', 'Mover seleção para o grupo'); assign.type = 'button'; assign.disabled = !editor.selected.size || !fusion;
  assign.addEventListener('click', () => changed(() => editor.assignGroup(editor.settings.activeGroup))); container.append(assign);
  if (fusion) {
    for (const group of groups) check(`Fundir ${group.name}`, group.fuse, value => editor.setGroupFusion(group.id, value));
    const slider = (label, key, min, max, step) => {
      const row = make('label', label), input = make('input'), output = make('output', `${(fusion[key] * 1000).toFixed(1)} mm`);
      input.type = 'range'; Object.assign(input, { min, max, step, value: fusion[key] }); input.setAttribute('aria-label', label);
      input.addEventListener('pointerdown', () => editor.checkpoint());
      input.addEventListener('keydown', event => { if (!event.repeat && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) editor.checkpoint(); });
      input.addEventListener('input', () => { output.textContent = `${(Number(input.value) * 1000).toFixed(1)} mm`; editor.setFusionSettings({ [key]: Number(input.value) }, false); });
      input.addEventListener('change', onChange); row.append(input, output); container.append(row);
    };
    slider('Suavidade da união', 'smoothness', 0, .04, .001);
    slider('Tamanho do voxel', 'resolution', .001, .03, .001);
    const reset = make('button', 'Liberar máscara'); reset.type = 'button'; reset.addEventListener('click', () => changed(() => editor.clearMask())); container.append(reset);
    const stats = editor.summary().fusionStats;
    const adapted = stats.filter(s => s && s.resolution > s.requestedResolution * 1.001);
    if (adapted.length) container.append(make('p', `Resolução adaptada para ${Math.max(...adapted.map(s => s.resolution * 1000)).toFixed(1)} mm pelo limite de amostragem.`));
  }
}
