import { normalizeCharacter, defaultCharacter } from './state.mjs';

/**
 * The studio's single source of truth (Redux data flow,
 * https://redux.js.org/tutorials/fundamentals/part-2-concepts-data-flow):
 * the state changes only by dispatching an action, a pure reducer computes
 * the next state without mutating the previous one (unchanged parts keep their
 * references), and listeners are told through DOM events on an EventTarget
 * (https://developer.mozilla.org/en-US/docs/Web/API/EventTarget).
 *
 * Besides the state the store keeps three global services:
 * - an event bus (`emit`/`on`, CustomEvent `detail`) for status, toasts and errors;
 * - the running operations (build, export, hair, crowd), so "busy" and
 *   "Cancel" come from one place;
 * - the character's undo history, grouped like ProseMirror's (changes of the same
 *   group within 500 ms are one step, 100 steps kept), with a routable target so
 *   the hair editor answers Ctrl+Z with its own history while it is open.
 *
 * Tool parameters (brush radius, comb strength…) stay in their engines
 * (LockEditor.settings, SculptSession.settings); the store holds which tool is active.
 */
const HISTORY_DEPTH = 100;
const GROUP_DELAY = 500;

export const defaultExport = Object.freeze({ skeleton: 'unreal', lod: 'high', groom: 'cards', animations: true, blendshapes: true, cosmetic: false, optimize: true });

export function createState({ person = defaultCharacter, ui = {} } = {}) {
  return {
    person: normalizeCharacter(person),
    ui: {
      section: 'personagem',
      // The active tool of each section with tools; null in Roupas is "look around".
      tools: { cabelo: 'brush', esculpir: 'draw', roupas: null },
      garment: 0, view: 'body', crowd: 0,
      undress: true, sculptTarget: 'body',
      export: { ...defaultExport }, groups: {}, toolPanel: true,
      ...ui,
    },
  };
}

/** The next character after `changes`; keys that did not change keep their references. */
function patchPerson(person, changes) {
  const next = normalizeCharacter({ ...person, ...changes });
  for (const key of Object.keys(next)) {
    if (!(key in changes) && typeof person[key] === 'object' && person[key] !== null) next[key] = person[key];
  }
  return next;
}

export function reducer(state, action) {
  switch (action.type) {
    // A character from the history is a former state: kept as it was, so only what differs reads as changed.
    case 'person/set': return { ...state, person: action.origin === 'history' ? action.person : normalizeCharacter(action.person) };
    case 'person/patch': return { ...state, person: patchPerson(state.person, action.changes) };
    case 'ui/set': return { ...state, ui: { ...state.ui, ...action.changes } };
    case 'ui/tool': return { ...state, ui: { ...state.ui, tools: { ...state.ui.tools, [action.section]: action.tool } } };
    case 'ui/export': return { ...state, ui: { ...state.ui, export: { ...state.ui.export, ...action.changes } } };
    case 'ui/group': return { ...state, ui: { ...state.ui, groups: { ...state.ui.groups, [action.key]: action.open } } };
    default: return state;
  }
}

export class Store extends EventTarget {
  constructor(state = createState()) {
    super();
    this.state = state;
    this.past = []; this.future = []; this.lastGroup = null;
    this.operations = new Map();
    this.historyTarget = null;
  }

  /**
   * Apply an action. Optional fields read by the store:
   * `history` — a group key (true = always a new step, false/absent = not undoable);
   * `historyBase` — the character to restore on undo instead of the previous one.
   * Other fields (`live`, `rebuild`…) travel to the listeners untouched.
   */
  dispatch(action) {
    const prev = this.state, next = reducer(prev, action);
    if (next === prev) return prev;
    if (action.history && next.person !== prev.person) this.record(action.historyBase ?? prev.person, action.history);
    this.state = next;
    this.dispatchEvent(new CustomEvent('change', { detail: { action, prev, next } }));
    return next;
  }
  /** Call `listener(value, previous, action)` whenever `selector(state)` changes; returns the current value. */
  select(selector, listener, options) {
    let current = selector(this.state);
    this.addEventListener('change', event => {
      const value = selector(event.detail.next);
      if (Object.is(value, current)) return;
      const previous = current; current = value;
      listener(value, previous, event.detail.action);
    }, options);
    return current;
  }

  // ---------------------------------------------------------------- events
  emit(type, detail = null) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  /** Listen to a bus event; pass `{ signal }` to remove the listener with an AbortController. */
  on(type, listener, options) { this.addEventListener(type, event => listener(event.detail, event), options); }

  // ------------------------------------------------------------ operations
  begin(id, { label = '', cancellable = true } = {}) { this.operations.set(id, { label, cancellable }); this.emit('operations'); }
  progress(id, label) { const op = this.operations.get(id); if (!op) return false; op.label = label; this.emit('operations'); return true; }
  end(id) { if (this.operations.delete(id)) this.emit('operations'); }
  get busy() { return this.operations.size > 0; }
  /** The most recent operation, which the status line shows. */
  get currentOperation() { return [...this.operations.values()].at(-1) ?? null; }

  // --------------------------------------------------------------- history
  record(person, group) {
    const now = performance.now(), last = this.lastGroup;
    const joined = group !== true && last && last.key === group && now - last.time < GROUP_DELAY;
    if (!joined) { this.past.push(person); if (this.past.length > HISTORY_DEPTH) this.past.shift(); }
    this.lastGroup = { key: group, time: now };
    this.future = [];
    this.emit('history');
  }
  /** Route undo/redo elsewhere (an object with undo, redo, canUndo, canRedo), or back to the character with null. */
  setHistoryTarget(target) { this.historyTarget = target; this.lastGroup = null; this.emit('history'); }
  get canUndo() { return this.historyTarget ? this.historyTarget.canUndo() : this.past.length > 0; }
  get canRedo() { return this.historyTarget ? this.historyTarget.canRedo() : this.future.length > 0; }
  undo() { this.step(this.past, this.future, 'undo'); }
  redo() { this.step(this.future, this.past, 'redo'); }
  step(from, to, direction) {
    if (this.historyTarget) { this.historyTarget[direction](); this.emit('history'); return; }
    if (!from.length) return;
    to.push(this.state.person);
    this.lastGroup = null;
    this.dispatch({ type: 'person/set', person: from.pop(), origin: 'history' });
    this.emit('history');
  }
}

/** localStorage that never throws (private windows, blocked storage). */
export const storage = {
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};
