// Animação panel: the clip library, posing and the user's own timeline (body and face tracks).
// Rendered by StudioUI.renderAnimation (ui.mjs) with the UI's own helpers, in its compact style:
// one line per control, icons with the explanation in the tooltip, destructive actions at the right.
import { h, iconButton, chips, iconChoices, segmented, toggleChips } from './ui-kit.mjs';
import { icon } from './icons.mjs';
import { clipGroups, clipNames, clipLabels, libraryKeys, libraryPose, libraryVariant, poseLibrary } from './motion.mjs';
import { clearKey, importAnimation, insertMotion, interpolations, moveKey, poseAt, sameTime, setKey } from './timeline.mjs';
import { jointLimits } from './pose.mjs';
import { faceWeights, mixamoName } from './human-three.mjs';
import { animationNames, expressionNames } from './state.mjs';

const CUSTOM = () => animationNames.length - 1;
const expressionGlyphs = ['exNeutral', 'exRelaxed', 'exHappy', 'exSmile', 'exLaugh', 'exSad', 'exAngry', 'exAnnoyed', 'exSurprised', 'exWorried', 'exTired', 'exTalking'];
const poseNames = { A: 'Repouso (A)', T: 'T', natural: 'Em pé', hips: 'Mãos na cintura', sit: 'Sentado', wave: 'Acenando', run: 'Correndo' };

// Bones the user can pick, in Portuguese, by region.
const part = { pelvis: 'Quadril', spine_01: 'Lombar', spine_02: 'Tronco', spine_03: 'Peito', neck_01: 'Pescoço', head: 'Cabeça',
  clavicle: 'Ombro', upperarm: 'Braço', lowerarm: 'Antebraço', hand: 'Mão', thigh: 'Coxa', calf: 'Perna', foot: 'Pé', ball: 'Dedos do pé',
  thumb: 'Polegar', index: 'Indicador', middle: 'Médio', ring: 'Anelar', pinky: 'Mínimo' };
export function boneLabel(name) {
  if (part[name]) return part[name];
  const m = /^(\w+?)_(?:(\d+)_)?([lr])$/.exec(name);
  if (!m || !part[m[1]]) return name;
  return `${part[m[1]]}${m[2] ? ` ${Number(m[2])}` : ''} ${m[3] === 'l' ? 'E' : 'D'}`;
}
const boneRegions = [
  ['Tronco e cabeça', ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head']],
  ['Braços', ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']],
  ['Pernas', ['thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']],
  ['Mão esquerda', ['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap(f => [1, 2, 3].map(n => `${f}_0${n}_l`))],
  ['Mão direita', ['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap(f => [1, 2, 3].map(n => `${f}_0${n}_r`))],
];

export function renderAnimationPanel(ui) {
  renderMotion(ui);
  const stance = ui.group('Postura', { open: false });
  stance.append(chips({ label: 'Postura parada', items: ['Natural', 'Relaxada', 'Confiante', 'Mãos na cintura'], selected: ui.person.pose, onPick: v => ui.update('pose', v) }));
  renderPosing(ui);
  renderTimeline(ui);
}

/** Movimento: play/pause, the library by group, speed, and copying the movement into the user's clip. */
function renderMotion(ui) {
  const r = ui.renderer, group = ui.group('Movimento');
  const action = () => r?.action, playing = action() ? !action().paused : true;
  const posing = Boolean(ui.state.ui.posing), current = posing ? -1 : ui.person.animation;
  const id = clipNames[ui.person.animation];
  const captured = id && r?.motion ? libraryVariant(r.motion, id, ui.person.gender) : null;
  group.append(h('div', { class: 'icon-bar' },
    iconButton(playing ? 'pause' : 'resume', playing ? 'Pausar' : 'Tocar', event => {
      const a = action(); if (!a) return;
      a.paused = !a.paused;
      const button = event.currentTarget;
      button.replaceChildren(icon(a.paused ? 'resume' : 'pause', 18)); button.title = a.paused ? 'Tocar' : 'Pausar'; button.setAttribute('aria-label', button.title);
    }),
    iconButton('reset', 'Repetir do início', () => r?.replay()),
    h('span', { class: 'spacer' }),
    iconButton('plus', captured ? `Copiar "${clipLabels[ui.person.animation]}" para a sua animação, a partir do tempo ${(ui.timeAt ?? 0).toFixed(1).replace('.', ',')} s` : 'Escolha um movimento capturado para copiar', () => copyToTimeline(ui, captured), { disabled: !captured })));
  // One movement plays; while posing none is lit (picking one leaves Posar).
  const pick = i => { if (posing) ui.store.dispatch({ type: 'ui/set', changes: { posing: false } }); ui.update('animation', i); };
  for (const [title, ids] of clipGroups) {
    const indices = ids.map(name => clipNames.indexOf(name)).filter(i => i >= 0);
    const list = h('div', { class: 'anim-group', title: 'Capturas: Microsoft Rocketbox (MIT) · Parado e Sambar: procedurais' },
      h('span', { class: 'anim-group-label', text: title }),
      chips({ label: title, items: indices.map(i => clipLabels[i]), selected: indices.indexOf(current), onPick: k => pick(indices[k]) }));
    group.append(list);
  }
  ui.range(group, 'animationSpeed', 'Velocidade', 0.4, 1.8, 0.01, '×');
}

/** Captured motion → body keys of the user's clip from the timeline's time (10 per second, at most 20 s). */
function copyToTimeline(ui, variant) {
  const r = ui.renderer;
  if (!variant || !r?.current) return;
  const start = Math.round((ui.timeAt ?? 0) * 100) / 100, room = Math.min(20, 60 - start, variant.duration);
  if (room <= 0.1) { ui.toast('Sem espaço: a animação vai até 60 s', 'error'); return; }
  const keys = libraryKeys(r.current.context.skeleton, variant, { fps: 10, start, to: room, limit: 201 });
  const clip = insertMotion(ui.person.clip, keys);
  if (clip.keys.length > 600) { ui.toast('Chaves demais (até 600): apague parte da animação antes', 'error'); return; }
  ui.patch({ clip }, { history: true });
  ui.toast(`${clipLabels[ui.person.animation]}: ${keys.length} chaves de ${start.toFixed(1).replace('.', ',')} a ${keys.at(-1).t.toFixed(1).replace('.', ',')} s`, 'info', ui.undoAction());
}

/** Pose: posing on/off, symmetry and limits, ready poses, the chosen bone in degrees, pins, mirror. */
function renderPosing(ui) {
  const r = ui.renderer, editor = r?.poseEditor, on = Boolean(ui.state.ui.posing);
  const group = ui.group('Pose');
  const flag = (glyph, title, get, set) => h('button', { type: 'button', class: `icon-button${get() ? ' on' : ''}`, 'aria-pressed': String(get()), title, 'aria-label': title,
    onclick: event => { set(!get()); event.currentTarget.classList.toggle('on', get()); event.currentTarget.setAttribute('aria-pressed', String(get())); ui.scheduleRender(); } }, icon(glyph, 18));
  group.append(h('div', { class: 'mode-row' },
    h('button', { type: 'button', class: `mode-card${on ? ' on' : ''}`, 'aria-pressed': String(on), title: 'Posar: clique numa parte do corpo e gire pelo anel; arraste as esferas: laranja leva mãos e pés, azul leva o quadril',
      onclick: () => ui.store.dispatch({ type: 'ui/set', changes: { posing: !on } }) }, icon('figure', 18), h('span', { text: on ? 'Posando no 3D' : 'Posar no 3D' })),
    on && editor ? flag('mirror', 'Simetria: espelha no outro lado o que você gira ou puxa', () => editor.symmetry, v => { editor.symmetry = v; }) : null,
    on && editor ? flag('lock', 'Limites das juntas: joelho, cotovelo e dedos só dobram para o lado certo', () => editor.limits, v => { editor.limits = v; }) : null));
  group.append(chips({ label: 'Poses prontas', items: poseLibrary.map(id => poseNames[id]), selected: -1, onPick: i => {
    if (!r?.current) return;
    if (!on) ui.store.dispatch({ type: 'ui/set', changes: { posing: true } });
    const posing = libraryPose(r.current.context.skeleton, poseLibrary[i]);
    r.poseEditor.apply(posing); ui.patch({ posing }, { history: true });
  } }));
  if (!on || !editor?.active) return;
  editor.onCommit = posing => ui.patch({ posing }, { history: 'posing' });
  editor.onSelect = () => ui.scheduleRender();
  ui.setHint('Clique numa parte e gire pelo anel · esferas: laranja mãos e pés, azul quadril · botão direito: girar');

  // The chosen bone: a list for precision (fingers are small to click) and its angles in degrees.
  const chosen = editor.selected?.isBone ? editor.selected.name : null;
  const select = h('select', { 'aria-label': 'Parte escolhida', title: 'Parte escolhida (ou clique no corpo)' },
    h('option', { value: '', text: chosen || editor.selected ? (editor.selected?.name === 'ik_pelvis' ? 'Quadril (mover)' : '—') : 'Escolha uma parte…' }),
    boneRegions.map(([label, names]) => h('optgroup', { label }, names.filter(name => editor.bone(name)).map(name => {
      const option = h('option', { value: name, text: boneLabel(name) }); option.selected = name === chosen; return option;
    }))));
  select.addEventListener('change', () => { if (select.value) editor.selectName(select.value); });
  group.append(h('div', { class: 'field' }, h('label', { text: 'Parte' }), select));
  if (chosen) {
    const limits = editor.limits ? jointLimits(chosen) : null, angles = editor.angles(chosen);
    ['Dobrar', 'Torcer', 'Inclinar'].forEach((label, k) => {
      const [min, max] = limits?.[k] ?? [-180, 180];
      ui.slide(group, { label, value: Math.max(min, Math.min(max, angles[k])), min, max, step: 0.5, unit: '°', center: true,
        title: `${label} ${boneLabel(chosen)} (${['eixo X do osso', 'ao longo do osso', 'eixo Z do osso'][k]})`,
        onInput: v => { const next = editor.angles(chosen); next[k] = v; editor.setAngles(chosen, next); },
        onEnd: () => { editor.commit(); } });
    });
  }
  group.append(toggleChips({ label: 'Pinos: ficam no lugar enquanto o resto se move', items: [['Mão E', 'hand_l'], ['Mão D', 'hand_r'], ['Pé E', 'foot_l'], ['Pé D', 'foot_r']].map(([name, bone]) => [`Prender ${name}`, editor.pins.has(bone)]),
    onToggle: (i) => { editor.togglePin(['hand_l', 'hand_r', 'foot_l', 'foot_r'][i]); } }));
  group.append(h('div', { class: 'icon-bar' },
    iconButton('reset', 'Zerar a parte escolhida', () => editor.reset(false), { disabled: !editor.selected }),
    iconButton('mirrorToRight', 'Copiar o lado esquerdo para o direito', () => editor.mirrorSide('l')),
    iconButton('mirrorToLeft', 'Copiar o lado direito para o esquerdo', () => editor.mirrorSide('r')),
    iconButton('mirror', 'Espelhar a pose inteira', () => editor.flip()),
    h('span', { class: 'spacer' }),
    iconButton('figure', 'Voltar à pose de repouso (A)', () => { editor.reset(true); ui.toast('Pose de repouso', 'info', ui.undoAction()); }, { danger: true })));
}

/**
 * Linha do tempo of the user's clip ("Personalizada"): a body track (poses from Posar or copied
 * movement) and a face track (expressions), keys shown as diamonds that drag to another time.
 */
function renderTimeline(ui) {
  const clip = ui.person.clip, r = ui.renderer, editor = r?.poseEditor;
  // Docked under the groups, not one of them: the accordion opens one group at a time, and posing
  // (Pose) and keying (here) go together.
  const group = h('section', { class: 'anim-dock', 'aria-label': 'Linha do tempo' },
    h('div', { class: 'anim-dock-title' }, h('span', { text: 'Linha do tempo' }), clip.keys.length ? h('span', { class: 'badge', text: String(clip.keys.length) }) : null));
  ui.body.append(group);
  ui.timeAt = Math.max(0, Math.min(ui.timeAt ?? 0, clip.duration));
  const setClip = (next, history = true) => ui.patch({ clip: next }, { history });
  // Show the clip at the timeline's time: in the pose editor while posing (so it can be adjusted and keyed), else paused on screen.
  const show = t => {
    ui.timeAt = t;
    if (editor?.active) { if (clip.keys.some(key => key.pose)) { editor.apply(poseAt(ui.person.clip, t)); editor.commit(); } }
    else r?.scrubUserClip(t);
  };
  const time = ui.slide(group, { label: 'Tempo', value: ui.timeAt, min: 0, max: clip.duration, step: 0.05, unit: 's', onInput: v => { show(v); placeCursor(v); } });
  ui.slide(group, { label: 'Duração', value: clip.duration, min: 0.5, max: 60, step: 0.1, unit: 's', onInput: v => setClip({ ...ui.person.clip, duration: Math.max(v, ui.person.clip.keys.at(-1)?.t ?? 0) }, 'clip:duration'), onEnd: () => ui.scheduleRender() });

  // Tracks: body and face rows with draggable keys, a time ruler, the cursor across both.
  const tracks = h('div', { class: 'anim-tracks', role: 'group', 'aria-label': `Chaves: ${clip.keys.length}` });
  const percent = t => `${(t / clip.duration) * 100}%`;
  const cursors = [];
  const placeCursor = t => { for (const cursor of cursors) cursor.style.left = percent(t); };
  const timeFromX = (lane, x) => { const box = lane.getBoundingClientRect(); return Math.max(0, Math.min(clip.duration, (x - box.left) / Math.max(1, box.width) * clip.duration)); };
  const lane = (label, glyph, kind) => {
    const row = h('div', { class: 'anim-lane' });
    const keys = clip.keys.filter(key => key[kind]);
    for (const key of keys) {
      const diamond = h('button', { type: 'button', class: `anim-key ${kind}${sameTime(key.t, ui.timeAt) ? ' on' : ''}`, style: `left:${percent(key.t)}`,
        title: `${label}: chave em ${key.t.toFixed(2).replace('.', ',')} s · arraste para mudar o tempo`, 'aria-label': `${label}, chave em ${key.t.toFixed(2)} segundos` });
      // Drag (setPointerCapture) moves the key; a click goes to it.
      diamond.addEventListener('pointerdown', event => {
        event.preventDefault(); event.stopPropagation();
        diamond.setPointerCapture(event.pointerId);
        const startX = event.clientX; let moved = false, to = key.t;
        diamond.onpointermove = move => {
          if (Math.abs(move.clientX - startX) > 3) moved = true;
          if (!moved) return;
          to = Math.round(timeFromX(row, move.clientX) * 20) / 20;
          diamond.style.left = percent(to);
        };
        diamond.onpointerup = () => {
          diamond.onpointermove = diamond.onpointerup = null;
          if (moved && !sameTime(to, key.t)) { ui.timeAt = to; setClip(moveKey(ui.person.clip, key.t, to)); return; }
          show(key.t); ui.scheduleRender();
        };
      });
      row.append(diamond);
    }
    // A press on the empty lane moves the time there.
    row.addEventListener('pointerdown', event => { if (event.target !== row) return; const t = Math.round(timeFromX(row, event.clientX) * 20) / 20; show(t); placeCursor(t); time.setValue(t); });
    const cursor = h('span', { class: 'anim-cursor', 'aria-hidden': 'true', style: `left:${percent(ui.timeAt)}` });
    cursors.push(cursor); row.append(cursor);
    return h('div', { class: 'anim-row' }, h('span', { class: 'anim-row-label', title: label }, icon(glyph, 16)), row);
  };
  tracks.append(lane('Corpo', 'figure', 'pose'), lane('Rosto', 'face', 'face'));
  tracks.append(h('div', { class: 'anim-ruler', 'aria-hidden': 'true' }, h('span', { text: '0' }), h('span', { text: `${clip.duration.toFixed(1).replace('.', ',')} s` })));
  group.append(tracks);

  // Keys at the current time: body (the pose from Posar), face (the expression), or both.
  const atTime = clip.keys.find(key => sameTime(key.t, ui.timeAt));
  const pose = () => editor?.active ? editor.read() : ui.person.posing;
  const face = () => faceWeights(ui.person.expression, ui.person.expressionIntensity ?? 0.5, ui.person.faceShapes);
  group.append(h('div', { class: 'icon-bar' },
    iconButton('key', 'Gravar chave: pose e expressão atuais neste tempo', () => setClip(setKey(ui.person.clip, ui.timeAt, { pose: pose(), face: face() }))),
    iconButton('figure', 'Gravar só a pose (trilha Corpo)', () => setClip(setKey(ui.person.clip, ui.timeAt, { pose: pose() }))),
    iconButton('face', 'Gravar só a expressão (trilha Rosto)', () => setClip(setKey(ui.person.clip, ui.timeAt, { face: face() }))),
    iconButton('close', 'Apagar a chave deste tempo', () => setClip(clearKey(ui.person.clip, ui.timeAt)), { disabled: !atTime }),
    h('span', { class: 'spacer' }),
    iconButton('play', 'Tocar a sua animação', () => { ui.store.dispatch({ type: 'ui/set', changes: { posing: false } }); ui.update('animation', CUSTOM()); r?.replay(); }, { disabled: !clip.keys.length }),
    h('button', { type: 'button', class: `icon-button${clip.loop !== false ? ' on' : ''}`, 'aria-pressed': String(clip.loop !== false), title: 'Repetir sem parar (desligado: toca uma vez e para no fim)', 'aria-label': 'Repetir',
      onclick: () => setClip({ ...ui.person.clip, loop: ui.person.clip.loop === false }) }, icon('reset', 18)),
    iconButton('file', 'Importar animação (.glb do Mixamo ou deste app)', () => file.click()),
    iconButton('trash', 'Apagar todas as chaves', () => { if (confirm(`Apagar as ${clip.keys.length} chaves da sua animação?`)) setClip({ ...ui.person.clip, keys: [] }); }, { danger: true, disabled: !clip.keys.length })));
  group.append(segmented({ label: 'Curva', items: ['Suave', 'Linear', 'Degrau'], selected: interpolations.indexOf(clip.interpolation ?? 'linear'),
    onPick: i => setClip({ ...ui.person.clip, interpolation: interpolations[i] }) }));
  // Expressions to key on the face track (the same faces as Rosto › Expressão).
  group.append(iconChoices({ label: 'Expressão para a chave', items: expressionNames.map((name, i) => [name, expressionGlyphs[i] ?? 'face']), selected: ui.person.expression,
    onPick: i => ui.update('expression', i) }));
  // An animation from a file (Mixamo or this app's rig) becomes editable keys.
  const file = h('input', { type: 'file', accept: '.glb,.gltf', hidden: true });
  file.addEventListener('change', async () => {
    const chosenFile = file.files[0];
    file.value = '';
    if (!chosenFile || !/\.(glb|gltf)$/i.test(chosenFile.name) || !r?.current) { if (chosenFile) ui.toast('Escolha um arquivo .glb ou .gltf', 'error'); return; }
    try {
      ui.store.begin('import', { label: 'Importando animação…', cancellable: false });
      const imported = await importAnimation(await chosenFile.arrayBuffer(), r.current, { alias: mixamoName });
      ui.patch({ clip: { ...ui.person.clip, ...imported } }, { history: true });
      ui.update('animation', CUSTOM());
      ui.toast(`Animação "${imported.name}" importada · ${imported.keys.length} chaves`);
    } catch (error) { ui.toast(`Não foi possível importar: ${error.message}`, 'error'); }
    finally { ui.store.end('import'); r.setPresentation(ui.person); }
  });
  group.append(file);
}
