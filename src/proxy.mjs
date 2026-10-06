const source = name => new URL(`../assets/proxies/${name}`, import.meta.url);

async function read(name, binary = false) {
  const url = source(name);
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(url);
    return binary
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : JSON.parse(bytes.toString('utf8'));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing wearable ${name}: HTTP ${response.status}`);
  return binary ? response.arrayBuffer() : response.json();
}

const cache = new Map();
export function loadProxy(name) {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Invalid wearable name: ${name}`);
  if (!cache.has(name)) {
    cache.set(name, Promise.all([read(`${name}.json`), read(`${name}.bin`, true)]).then(([meta, bin]) => {
      if (meta.license !== 'CC0-1.0') throw new Error(`Wearable ${name} is not CC0`);
      const section = (id, Type) => {
        const entry = meta.layout[id];
        return entry ? new Type(bin, entry.byteOffset, entry.count) : new Type(0);
      };
      return {
        meta,
        refs: section('refs', Uint32Array),
        weights: section('weights', Float32Array),
        offsets: section('offsets', Float32Array),
        uvs: section('uvs', Float32Array),
        index: section('index', Uint32Array),
        deleteVerts: section('deleteVerts', Uint32Array),
      };
    }).catch(error => { cache.delete(name); throw error; }));
  }
  return cache.get(name);
}

export function fitProxy(proxy, body) {
  const { meta, refs, weights, offsets } = proxy;
  const axis = k => {
    const a = meta.scaleRefs[k * 2], b = meta.scaleRefs[k * 2 + 1];
    return Math.abs(body[a * 3 + k] - body[b * 3 + k]) / Math.max(1e-6, meta.scaleBase[k]);
  };
  const scale = [axis(0), axis(1), axis(2)];
  const result = new Float32Array(refs.length);
  for (let v = 0; v < refs.length / 3; v++) {
    for (let dim = 0; dim < 3; dim++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += body[refs[v * 3 + k] * 3 + dim] * weights[v * 3 + k];
      result[v * 3 + dim] = sum + offsets[v * 3 + dim] * scale[dim];
    }
  }
  return result;
}

export function proxySkin(proxy, bodyJoints, bodyWeights) {
  const n = proxy.refs.length / 3;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  const blended = new Map();
  for (let v = 0; v < n; v++) {
    blended.clear();
    for (let k = 0; k < 3; k++) {
      const base = proxy.refs[v * 3 + k];
      const share = Math.max(0, proxy.weights[v * 3 + k]);
      for (let j = 0; j < 4; j++) {
        const bone = bodyJoints[base * 4 + j];
        const w = bodyWeights[base * 4 + j] / 65535 * share;
        if (w > 0) blended.set(bone, (blended.get(bone) ?? 0) + w);
      }
    }
    const top = [...blended].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((sum, [, value]) => sum + value, 0) || 1;
    for (let j = 0; j < 4; j++) {
      joints[v * 4 + j] = top[j]?.[0] ?? 0;
      weights[v * 4 + j] = (top[j]?.[1] ?? (j === 0 ? total : 0)) / total;
    }
  }
  return { joints, weights };
}

export function proxyTextureURL(proxy) {
  return proxy.meta.texture ? source(proxy.meta.texture).href : null;
}
