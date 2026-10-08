import { prepareWorkerModule } from './generation.mjs';

function bodyPacket(context) {
  const copy = value => value ? new value.constructor(value) : value;
  const outfit = context.outfitSurface;
  return {
    positions: Float32Array.from(context.positions), unitScale: context.positions.unitScale,
    heads: context.skeleton.heads.map(point => point.toArray()), byName: [...context.skeleton.byName],
    outfitSurface: outfit ? { positions: copy(outfit.positions), normals: copy(outfit.normals), index: copy(outfit.index) } : null,
    height: context.height, lod: context.lod,
  };
}

/** One numeric request in flight. Definitions supersede poses immediately;
 * elapsed time is accumulated, not hidden or discarded by the bridge. */
export class HairPhysicsClient {
  constructor(context, { onResult = () => {}, onError = error => console.error(error) } = {}) {
    this.onResult = onResult; this.onError = onError;
    this.epoch = 0; this.definition = undefined;
    this._body = bodyPacket(context);
    this._stats = { steps: 0, maxStretch: 0, maxPenetration: 0, penetrating: 0, infeasibleContacts: 0, droppedTime: 0 };
    this._elapsed = 0; this._on = false; this._strength = 1;
    this._request = 0; this._activeEpoch = -1;
    this._controller = new AbortController();
    this._boot().catch(error => { if (!this._disposed) this._fail(error); });
  }
  get stats() {
    return { ...this._stats, queuedTime: this._elapsed, inFlightTime: this._busy?.type === 'advance' ? this._busy.dt : 0 };
  }
  async _boot() {
    if (typeof Worker === 'undefined') throw new Error('Continuous hair physics requires a browser Worker');
    const url = await prepareWorkerModule(new URL('./hair-physics-worker.mjs', import.meta.url), { signal: this._controller.signal });
    if (this._disposed) return;
    const worker = new Worker(url, { type: 'module', name: 'hair-physics' });
    this._worker = worker;
    worker.onerror = event => { event.preventDefault(); this._fail(new Error(event.message || 'Hair physics worker failed')); };
    worker.onmessageerror = () => this._fail(new Error('Could not receive the hair physics pose'));
    worker.onmessage = ({ data }) => { try { this._receive(data); } catch (error) { this._fail(error); } };
    this._flush();
  }
  _invalidate(locks, type, definition) {
    if (this._disposed) return false;
    if (this._error) throw this._error;
    this.epoch++; this.definition = definition;
    this._activeEpoch = -1; this._elapsed = 0;
    this._waiter?.resolve(false); this._waiter = null;
    this._locks = structuredClone(locks);
    if (!Array.isArray(this._locks?.locks)) throw new TypeError('Hair physics requires serialized locks');
    this._ids = this._locks.locks.map(lock => lock.id ?? null);
    this._pending = { type, locks: this._locks, epoch: this.epoch, definition };
    return true;
  }
  /** Explicit authored edit/rebuild; runtime p/sy are never compared as a hash. */
  replace(locks, definition = this.definition) {
    try {
      if (!this._invalidate(locks, 'replace', definition)) return Promise.resolve(false);
      const ready = new Promise((resolve, reject) => { this._waiter = { epoch: this.epoch, resolve, reject }; });
      this._flush();
      return ready;
    } catch (error) { return Promise.reject(error); }
  }
  /** Freeze the parent's currently DISPLAYED p, ignoring any older worker p. */
  pause(serializedPose = this._locks) {
    this._on = false;
    if (!serializedPose || this._disposed) return;
    this._invalidate(serializedPose, 'pause', this.definition);
    this._flush();
  }
  advance(dt, { on = true, strength = 1 } = {}) {
    if (this._disposed || this._error) return false;
    if (!on) { if (this._on) this.pause(); return false; }
    this._on = true;
    this._strength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 1;
    if (Number.isFinite(dt) && dt > 0) this._elapsed += dt;
    this._flush();
    return Boolean(this._busy);
  }
  _flush() {
    if (!this._worker || this._disposed || this._error || this._busy) return;
    let message;
    if (this._pending) {
      message = this._pending; this._pending = null;
      if (!this._contextSent) { message.context = this._body; this._contextSent = true; }
    } else if (this._on && this._activeEpoch === this.epoch && this._elapsed >= 1 / 120) {
      // Publish after one fixed tick, keeping accumulated wall time explicit.
      // A slow solve must not turn the next request into a many-second batch
      // or silently discard elapsed time at HairDynamics' admission limit.
      const dt = 1 / 120;
      this._elapsed -= dt;
      message = { type: 'advance', epoch: this.epoch, definition: this.definition, dt, options: { on: true, strength: this._strength } };
    } else return;
    message.request = ++this._request;
    this._busy = { request: message.request, type: message.type, epoch: message.epoch, dt: message.dt };
    try { this._worker.postMessage(message); } catch (error) { this._fail(error); }
  }
  _receive(message) {
    if (this._disposed || this._error) return;
    if (message.request !== this._busy?.request) throw new Error('Hair physics response does not match the requested step');
    this._busy = null;
    if (message.type === 'error') {
      const error = new Error(message.message); error.name = message.name || 'Error'; if (message.stack) error.stack = message.stack;
      this._fail(error); return;
    }
    // Old calculations still acknowledge their request, freeing the single
    // slot, but cannot overwrite a newer edit or the pose frozen by pause.
    if (message.epoch !== this.epoch) { this._flush(); return; }
    if (message.type !== 'ready' && message.type !== 'pose') throw new Error('Unknown hair physics response');
    if (!Array.isArray(message.poses) || message.poses.length !== this._ids.length) throw new Error('Hair physics pose has a different lock count');
    for (const [index, pose] of message.poses.entries()) {
      if (pose.index !== index || pose.id !== this._ids[index]) throw new Error('Hair physics pose has a different lock identity');
      if (!(pose.x instanceof Float32Array) || pose.x.length !== this._locks.locks[index].p.length || !pose.x.every(Number.isFinite)) throw new Error('Hair physics returned an invalid lock pose');
    }
    this._stats = message.stats;
    if (message.type === 'ready') {
      this._activeEpoch = this.epoch;
      if (this._waiter?.epoch === this.epoch) { this._waiter.resolve(true); this._waiter = null; }
    } else if (this._on) {
      for (const pose of message.poses) {
        const row = this._locks.locks[pose.index];
        row.p = Array.from(pose.x, (value, component) => value - pose.x[component % 3]);
        if (this._locks.v >= 2) row.rt = pose.rootTaper;
      }
      this.onResult({ ...message, stats: this.stats });
    }
    this._flush();
  }
  _fail(error) {
    if (this._disposed || this._error) return;
    this._error = error;
    this._waiter?.reject(error); this._waiter = null;
    this._stop();
    this.onError(error);
  }
  _stop() {
    if (this._worker) { this._worker.onmessage = this._worker.onerror = this._worker.onmessageerror = null; this._worker.terminate(); this._worker = null; }
    this._controller.abort();
    this._busy = null; this._pending = null; this._elapsed = 0;
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true; this.epoch++;
    this._waiter?.resolve(false); this._waiter = null;
    this._stop();
  }
}
