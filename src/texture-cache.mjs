import { SRGBColorSpace, TextureLoader } from 'three';

// Textures are decoded once per page and shared by every character built
// from them (rebuilding a character on each edit no longer reloads them).
// Shared textures are marked so a character's dispose() leaves them alone.
const cache = new Map();

export function sharedTexture(key, make) {
  if (!cache.has(key)) {
    cache.set(key, Promise.resolve().then(make).then(texture => {
      texture.userData.shared = true;
      return texture;
    }).catch(error => { cache.delete(key); throw error; }));
  }
  return cache.get(key);
}

/** An sRGB colour texture from a URL, unflipped (glTF/MakeHuman UV convention unless `flipY`). */
export function imageTexture(url, { flipY = false } = {}) {
  return sharedTexture(`image:${flipY}:${url}`, async () => {
    const texture = await new TextureLoader().loadAsync(url);
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = flipY;
    texture.needsUpdate = true;
    return texture;
  });
}
