import { icon } from './icons.mjs';

/**
 * The interface's building blocks. Controls update their own look when used
 * (the pressed segment, the chip, the slider's filled track), so a click never
 * needs the whole panel rebuilt; when a panel is rebuilt, `captureFocus` /
 * `restoreFocus` put the keyboard focus back on the same control (WAI-ARIA APG:
 * focus must never fall to the body).
 */

/** Small element builder: h('div', { class, onclick, ... }, ...children). */
export function h(tag, attrs = {}, ...children) {
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

let uid = 0;
export const nextId = prefix => `${prefix}${++uid}`;

// ------------------------------------------------------------------ focus
const FOCUSABLE = 'button, input, select, textarea, [tabindex]';
const focusKey = node => `${node.tagName}|${node.getAttribute('aria-label') ?? node.labels?.[0]?.textContent ?? node.getAttribute('title') ?? node.textContent.trim()}`;
/** Where the focus is inside `root`, as a key that survives rebuilding it. */
export function captureFocus(root) {
  const active = document.activeElement;
  if (!active || active === document.body || !root.contains(active)) return null;
  const key = focusKey(active), same = [...root.querySelectorAll(FOCUSABLE)].filter(node => focusKey(node) === key);
  return { key, index: same.indexOf(active) };
}
export function restoreFocus(root, saved) {
  if (!saved) return;
  const same = [...root.querySelectorAll(FOCUSABLE)].filter(node => focusKey(node) === saved.key);
  same[Math.max(0, saved.index)]?.focus({ preventScroll: true });
}

// --------------------------------------------------------------- controls
/** A collapsible group; `onToggle(open)` remembers its state. */
export function group(container, { title, open = true, onToggle }) {
  const details = h('details', { class: 'group' }, h('summary', {}, icon('chevron', 14), h('span', { text: title })));
  details.open = open;
  details.addEventListener('toggle', () => onToggle?.(details.open));
  const body = h('div', { class: 'group-body' });
  details.append(body); container.append(details);
  return body;
}
export function row(label, control) {
  control.id ||= nextId('c');
  return h('div', { class: 'row' }, h('label', { for: control.id, text: label }), control);
}
export function iconButton(name, title, onclick, { id, danger = false, disabled = false, size = 18 } = {}) {
  return h('button', { type: 'button', class: `icon-button${danger ? ' danger' : ''}`, id, title, 'aria-label': title, disabled, onclick }, icon(name, size));
}
/**
 * Slider with a typed value on the same line (label | track | value). The
 * track fills up to the thumb. `scale` shows the value in other units (cm);
 * onStart/onEnd bracket one drag or one typed entry.
 */
export function slider({ label, value, min, max, step = 0.01, scale = 1, unit = '', title, onInput, onStart, onEnd, key }) {
  const id = nextId('s'), digits = step * scale >= 1 ? 0 : step * scale >= 0.1 ? 1 : 2;
  const range = h('input', { type: 'range', id, min, max, step, value, 'data-key': key });
  const number = h('input', { type: 'number', class: 'value', min: +(min * scale).toFixed(digits), max: +(max * scale).toFixed(digits), step: +(step * scale).toFixed(4), value: (value * scale).toFixed(digits), 'aria-label': `${label} (valor)` });
  const fill = v => range.style.setProperty('--fill', `${((v - min) / (max - min || 1)) * 100}%`);
  fill(value);
  let first = true;
  const begin = () => { if (first) { onStart?.(); first = false; } };
  const end = () => { if (first) return; first = true; onEnd?.(); };
  range.addEventListener('input', () => { begin(); const v = Number(range.value); number.value = (v * scale).toFixed(digits); fill(v); onInput(v); });
  range.addEventListener('change', end);
  number.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, Number(number.value) / scale));
    if (!Number.isFinite(v)) return;
    begin(); range.value = v; number.value = (v * scale).toFixed(digits); fill(v); onInput(v); end();
  });
  const node = h('div', { class: 'field', title: title ?? label }, h('label', { for: id, text: label }), range, h('span', { class: 'value-box' }, number, unit ? h('span', { class: 'unit', text: unit.trim() }) : null));
  /** Show a value set elsewhere (the age moves the height). */
  node.setValue = (v, bounds) => {
    if (bounds) { range.min = bounds[0]; range.max = bounds[1]; min = bounds[0]; max = bounds[1]; }
    range.value = v; number.value = (v * scale).toFixed(digits); fill(v);
  };
  return node;
}
/** One choice among a few, on its label's line. An item [name, icon] shows the icon only, the name in the tooltip. */
export function segmented({ label, items, selected, onPick }) {
  const icons = items.some(Array.isArray);
  const buttons = items.map((item, i) => {
    const [name, glyph] = Array.isArray(item) ? item : [item, null];
    return h('button', {
      type: 'button', class: selected === i ? 'on' : '', 'aria-pressed': String(selected === i), title: name, 'aria-label': glyph ? name : undefined,
      onclick: () => { buttons.forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-pressed', String(k === i)); }); onPick(i); }, text: glyph ? undefined : name,
    }, glyph ? icon(glyph, 18) : null);
  });
  const control = h('div', { class: `segmented${icons ? ' icons' : ''}`, role: 'group', 'aria-label': label ?? undefined }, buttons);
  return label ? h('div', { class: 'stack inline', title: label }, h('div', { class: 'stack-label', text: label }), control) : control;
}
export function chips({ label, items, selected, onPick }) {
  const buttons = items.map((name, i) => h('button', {
    type: 'button', class: `chip${selected === i ? ' on' : ''}`, 'aria-pressed': String(selected === i), text: name,
    onclick: () => { buttons.forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-pressed', String(k === i)); }); onPick(i); },
  }));
  return h('div', { class: 'chips', role: 'group', 'aria-label': label }, buttons);
}
export function toggle({ label, checked, onChange, title, id }) {
  const box = h('input', { type: 'checkbox', role: 'switch', id }); box.checked = Boolean(checked);
  box.addEventListener('change', () => onChange(box.checked));
  return h('label', { class: 'switch', title }, box, h('span', { class: 'track' }), h('span', { text: label }));
}
/** Palette swatches with a free colour picker; `selected` is the palette index or null when `custom` is set. */
export function swatches({ label, palette, selected, custom, onPick, onCustom, extra = [] }) {
  const buttons = palette.map((hex, i) => h('button', {
    type: 'button', class: `swatch${!custom && selected === i ? ' on' : ''}`, style: `--swatch:${hex}`, title: `${label} ${i + 1}`, 'aria-label': `${label} ${i + 1}`,
    'aria-pressed': String(!custom && selected === i),
    onclick: () => { for (const b of [...buttons, picker]) b.classList.toggle('on', b === buttons[i]); onPick(i); },
  }));
  const picker = h('input', { type: 'color', class: `swatch-picker${custom ? ' on' : ''}`, value: custom ?? palette[selected] ?? palette[0], title: 'Outra cor', 'aria-label': `${label}: outra cor` });
  // `input` while the picker is open previews the colour; `change` (picker closed) commits it.
  const pick = live => { for (const b of buttons) b.classList.remove('on'); picker.classList.add('on'); onCustom(picker.value, { live }); };
  picker.addEventListener('input', () => pick(true));
  picker.addEventListener('change', () => pick(false));
  return h('div', { class: 'stack' }, h('div', { class: 'stack-label', text: label }), h('div', { class: 'swatches', role: 'group', 'aria-label': label }, ...extra, buttons, picker));
}

// ---------------------------------------------------------------- toolbar
/**
 * A toolbar of tool groups (WAI-ARIA APG Toolbar): one Tab stop, arrows move
 * between tools (roving tabindex), Home/End go to the ends. `groups` is
 * [[label, [[id, name, glyph, { disabled, shortcut }]]]].
 */
export function toolbar(container, { groups, active, onPick, label }) {
  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-orientation', 'vertical');
  container.setAttribute('aria-label', label);
  container.replaceChildren(...groups.map(([name, tools]) => h('div', { class: 'tool-group', role: 'group', 'aria-label': name },
    h('div', { class: 'tool-group-label', 'aria-hidden': 'true', text: name }),
    h('div', { class: 'tool-grid' }, tools.map(([id, title, glyph, { disabled = false, shortcut } = {}]) => h('button', {
      type: 'button', class: `tool${active === id ? ' on' : ''}`, 'data-tool': id, disabled, tabindex: '-1',
      title: shortcut ? `${title} (${shortcut})` : title, 'aria-label': title, 'aria-pressed': String(active === id),
      onclick: event => { setRoving(container, event.currentTarget); onPick(id); },
    }, icon(glyph, 20)))))));
  const buttons = [...container.querySelectorAll('.tool:not(:disabled)')];
  setRoving(container, buttons.find(b => b.classList.contains('on')) ?? buttons[0]);
  if (!container.dataset.roving) {
    container.dataset.roving = '1';
    container.addEventListener('keydown', event => {
      const list = [...container.querySelectorAll('.tool:not(:disabled)')], at = list.indexOf(document.activeElement);
      if (at < 0) return;
      const target = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: list.length - 1 }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      const next = list[(target + list.length) % list.length];
      setRoving(container, next); next.focus();
    });
  }
}
function setRoving(container, button) {
  for (const b of container.querySelectorAll('.tool')) b.tabIndex = b === button ? 0 : -1;
}

// --------------------------------------------------------------- popovers
const popovers = [];
/** A button that opens a panel: aria-expanded, Esc or a click outside closes it, focus returns to the button. */
export function popover(button, panel, render) {
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', panel.id);
  const entry = {
    button, panel,
    open() { closePopovers(); render(); panel.hidden = false; button.setAttribute('aria-expanded', 'true'); },
    close(focus = false) { if (panel.hidden) return; panel.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); },
    refresh() { if (!panel.hidden) render(); },
  };
  button.addEventListener('click', () => (panel.hidden ? entry.open() : entry.close()));
  popovers.push(entry);
  return entry;
}
export function closePopovers(focus = false) { for (const entry of popovers) entry.close(focus); }
document.addEventListener('pointerdown', event => {
  for (const entry of popovers) if (!entry.panel.contains(event.target) && !entry.button.contains(event.target)) entry.close();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const open = popovers.find(entry => !entry.panel.hidden);
  if (open) { event.preventDefault(); open.close(true); }
});
