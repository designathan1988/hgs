import { ObjectLoader, Quaternion, Vector3 } from 'three';
import { createHuman } from './human-three.mjs';
import { loadHumanData } from './parametric.mjs';

/** A texture-free character packet. Buffers remain typed and transferable. */
export function packHuman(human) {
  const scene = human.group.toJSON();
  const geometries = new Map();
  human.group.traverse(object => { if (object.geometry) geometries.set(object.geometry.uuid, object.geometry); });
  for (const entry of scene.geometries ?? []) {
    const geometry = geometries.get(entry.uuid);
    for (const [name, attribute] of Object.entries(geometry.attributes)) entry.data.attributes[name].array = attribute.array;
    for (const [name, attributes] of Object.entries(geometry.morphAttributes)) {
      attributes.forEach((attribute, index) => { entry.data.morphAttributes[name][index].array = attribute.array; });
    }
  }
  const { positions, skeleton, outfitSurface, height, lod } = human.context;
  return {
    scene, body: human.body.uuid, faceMeshes: human.faceMeshes.map(mesh => mesh.uuid), metrics: human.metrics,
    context: {
      positions, unitScale: positions.unitScale, outfitSurface, height, lod,
      heads: skeleton.heads.map(point => point.toArray()), byName: [...skeleton.byName],
      // Rest rotations and tails: clips rebuilt on the page (live reshaping) need them.
      rest: skeleton.rest.map(q => q.toArray()), tails: skeleton.tails.map(point => point.toArray()),
      bones: skeleton.bones.map(bone => bone.uuid), roots: skeleton.roots.map(bone => bone.uuid),
    },
  };
}

function disposeGroup(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material);
      for (const texture of Object.values(material)) if (texture?.isTexture && !texture.userData.shared) textures.add(texture);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}

/** Hydrate Three geometry/rig on the main thread; DOM textures are attached separately. */
export async function unpackHuman(packet) {
  const data = await loadHumanData();
  const group = new ObjectLoader().parse(packet.scene);
  try {
    const objects = new Map();
    group.traverse(object => {
      objects.set(object.uuid, object);
      if (!object.geometry) return;
      const geometry = object.geometry;
      for (const [key, Type] of [['baseIds', Uint16Array], ['sculptKeys', Int32Array], ['garmentOf', Int8Array]]) {
        const value = geometry.userData[key];
        if (value && !ArrayBuffer.isView(value)) geometry.userData[key] = Type.from(Array.isArray(value) ? value : Object.values(value));
      }
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    });
    const body = objects.get(packet.body);
    if (!body?.isSkinnedMesh) throw new Error('Generated character has no skinned body');
    const saved = packet.context;
    const positions = saved.positions instanceof Float32Array ? saved.positions : Float32Array.from(saved.positions);
    positions.unitScale = saved.unitScale;
    const skeleton = {
      heads: saved.heads.map(point => new Vector3(...point)), byName: new Map(saved.byName),
      rest: saved.rest.map(q => new Quaternion().fromArray(q)), tails: saved.tails.map(point => new Vector3(...point)),
      bones: saved.bones.map(uuid => objects.get(uuid)), roots: saved.roots.map(uuid => objects.get(uuid)),
    };
    if (skeleton.bones.some(bone => !bone?.isBone)) throw new Error('Generated character has an incomplete skeleton');
    const faceMeshes = packet.faceMeshes.map(uuid => objects.get(uuid));
    if (faceMeshes.some(mesh => !mesh?.isMesh)) throw new Error('Generated character has an incomplete face rig');
    return {
      group, body, animations: group.animations, faceMeshes, metrics: packet.metrics,
      context: { data, positions, skeleton, outfitSurface: saved.outfitSurface, height: saved.height, lod: saved.lod },
      dispose() { disposeGroup(group); },
    };
  } catch (error) { disposeGroup(group); throw error; }
}

const sourceModules = new Map(), moduleURLs = new Set(), sourceHashes = new Map();
// FNV-1a over the module texts: the build cache is keyed by the code that produced it.
function fnv1a(text, hash = 0x811c9dc5) {
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
}
const coreURL = new URL('../node_modules/three/build/three.module.js', import.meta.url).href;
const addonsURL = new URL('../node_modules/three/examples/jsm/', import.meta.url).href;
// Static declarations in this application's ES modules; node: dynamic imports
// remain in guarded file-URL branches and are never executed in a browser.
const declaration = /^([ \t]*(?:import|export)\s+(?:(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s+from\s+)?)(['"])([^'"\r\n]+)\2/gm;

async function workerModule(url, ancestors = []) {
  if (url === coreURL || url.startsWith(new URL('./three.core.js', coreURL).href)) return url;
  if (ancestors.includes(url)) throw new Error(`Worker module cycle: ${[...ancestors, url].join(' → ')}`);
  if (sourceModules.has(url)) return sourceModules.get(url);
  const loading = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not prepare generation worker: ${url}: HTTP ${response.status}`);
    let source = await response.text();
    sourceHashes.set(url, fnv1a(source));
    const matches = [...source.matchAll(declaration)];
    // Dependencies are fetched in parallel; awaiting each one in turn serialised the whole graph.
    const replacements = await Promise.all(matches.map(async match => {
      const specifier = match[3];
      let resolved;
      if (specifier === 'three') resolved = coreURL;
      else if (specifier.startsWith('three/addons/')) resolved = addonsURL + specifier.slice('three/addons/'.length);
      else if (specifier.startsWith('.') || specifier.startsWith('/') || /^https?:/.test(specifier)) resolved = new URL(specifier, url).href;
      else throw new Error(`Unsupported generation worker import: ${specifier} in ${url}`);
      return { start: match.index, end: match.index + match[0].length, text: match[1] + JSON.stringify(await workerModule(resolved, [...ancestors, url])) };
    }));
    for (const replacement of replacements.reverse()) source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
    source = source.replace(/\bimport\.meta\.url\b/g, JSON.stringify(url));
    const blobURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    moduleURLs.add(blobURL);
    return blobURL;
  })();
  sourceModules.set(url, loading);
  try { return await loading; } catch (error) { sourceModules.delete(url); throw error; }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  for (const url of moduleURLs) URL.revokeObjectURL(url);
  moduleURLs.clear(); sourceModules.clear();
});

function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** Share the module graph resolver with numeric editor workers. */
export function prepareWorkerModule(url, { signal } = {}) {
  return abortable(workerModule(String(url)), signal);
}

/* Build cache. A packet is deterministic for (module sources, spec), so the last
 * characters are kept in IndexedDB and a reload shows them without rebuilding.
 * put() clones the value synchronously (IndexedDB 3.0, "add or put" step 10);
 * packets hold only structured-cloneable data (they already cross postMessage).
 * Bump cacheVersion when assets/ change: only module sources are fingerprinted. */
const cacheVersion = 1, cacheEntries = 4;
let cacheDB, cacheHandle = null;
function openCache() {
  cacheDB ??= new Promise(resolve => {
    try {
      const request = indexedDB.open('human-studio-builds', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('packets', { keyPath: 'key' }).createIndex('time', 'time');
      request.onsuccess = () => { cacheHandle = request.result; resolve(cacheHandle); };
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return cacheDB;
}
function cacheKey(spec) {
  const sources = [...sourceHashes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([url, hash]) => `${url.split('/').pop()}:${hash}`).join();
  return `${cacheVersion}|${fnv1a(sources)}|${JSON.stringify(spec)}`;
}
async function cachedPacket(key) {
  const db = await openCache();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction('packets').objectStore('packets').get(key);
      request.onsuccess = () => resolve(request.result?.packet ?? null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
function storePacket(key, packet) {
  // Synchronous when the database is open (the lookup opened it), so the clone is taken before unpacking.
  const db = cacheHandle;
  if (!db) { openCache().then(handle => handle && storePacket(key, packet)); return; }
  try {
    const transaction = db.transaction('packets', 'readwrite'), store = transaction.objectStore('packets');
    store.put({ key, time: Date.now(), packet });
    // Oldest entries beyond the limit leave (index on write time).
    const count = store.count();
    count.onsuccess = () => {
      let extra = count.result - cacheEntries;
      if (extra <= 0) return;
      store.index('time').openCursor().onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor || extra-- <= 0) return;
        cursor.delete(); cursor.continue();
      };
    };
  } catch (error) { console.warn('Build cache unavailable', error); }
}

const workerEntry = () => workerModule(new URL('./generation-worker.mjs', import.meta.url).href);
let spareWorker = null;
/** A worker spawned ahead of time imports the modules and the human data while the user edits. */
function takeWorker(entry) {
  const worker = spareWorker ?? new Worker(entry, { type: 'module', name: 'human-generation' });
  spareWorker = null;
  return worker;
}
function prepareSpare(entry) {
  if (spareWorker || typeof Worker === 'undefined') return;
  try { spareWorker = new Worker(entry, { type: 'module', name: 'human-generation' }); } catch { spareWorker = null; }
}

/** A dedicated worker per build makes synchronous cloth/mesh work cancellable. */
export async function buildHumanInWorker(spec, { signal, onProgress } = {}) {
  signal?.throwIfAborted();
  if (typeof Worker === 'undefined') return createHuman(spec, { signal, onProgress });
  onProgress?.('Preparando');
  const entry = await abortable(workerEntry(), signal);
  signal?.throwIfAborted();
  const key = cacheKey(spec);
  const cached = await abortable(cachedPacket(key), signal);
  if (cached) {
    try { const human = await unpackHuman(cached); if (signal?.aborted) { human.dispose(); signal.throwIfAborted(); } prepareSpare(entry); return human; }
    catch (error) { if (error.name === 'AbortError') throw error; console.warn('Cached build discarded', error); }
  }
  return new Promise((resolve, reject) => {
    const worker = takeWorker(entry);
    // The next build starts from a warm worker; spawned after this one ends so it does not compete for the CPU.
    const done = () => prepareSpare(entry);
    let settled = false;
    const cleanup = () => { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); signal?.removeEventListener('abort', abort); done(); };
    const fail = error => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'Generation worker failed')); };
    worker.onmessageerror = () => fail(new Error('Could not receive the generated character'));
    worker.onmessage = async ({ data: message }) => {
      if (settled) return;
      try {
        if (message.type === 'progress') { onProgress?.(message.stage); return; }
        if (message.type === 'error') { const error = new Error(message.message); error.name = message.name || 'Error'; if (message.stack) error.stack = message.stack; fail(error); return; }
        if (message.type !== 'result') throw new Error('Unexpected generation worker response');
        worker.onmessage = null;
        storePacket(key, message.packet);
        const human = await unpackHuman(message.packet);
        if (settled || signal?.aborted) { human.dispose(); if (!settled) abort(); return; }
        settled = true; cleanup(); resolve(human);
      } catch (error) { fail(error); }
    };
    try { worker.postMessage({ spec }); } catch (error) { fail(error); }
  });
}
