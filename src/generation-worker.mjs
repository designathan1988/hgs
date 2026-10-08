import { createHuman } from './human-three.mjs';
import { packHuman } from './generation.mjs';

function transfers(value, buffers = new Set()) {
  if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
  else if (value instanceof ArrayBuffer) buffers.add(value);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) transfers(child, buffers);
  return buffers;
}

self.onmessage = async ({ data: { spec } }) => {
  let human;
  try {
    human = await createHuman(spec, { onProgress: stage => self.postMessage({ type: 'progress', stage }) });
    const packet = packHuman(human);
    self.postMessage({ type: 'result', packet }, [...transfers(packet)]);
  } catch (error) { self.postMessage({ type: 'error', name: error.name, message: error.message, stack: error.stack }); }
  finally { human?.dispose(); }
};
