# Original eyebrow and eyelash textures

These CC0 textures were extracted without image edits from the official
[MakeHuman system assets pack](https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip)
using HTTP byte ranges. The local source paths in that archive are:

- `eyebrows/eyebrow004/eyebrow004.png` → `eyebrow004-original.png`  
  SHA-256: `899B2AE3D6D46BEF093B8DA0FA2E2C21F07F7565B5E13C57139D1288A3A8E27E`
- `eyebrows/eyebrow002/eyebrow002.png` → `eyebrow002-original.png`  
  SHA-256: `1DE4E4CB69B3F4324390219FFBEB17A0B2555104D3211D1AC667655B69B64038`
- `eyelashes/eyelashes01/eyelashes01.png` → `eyelashes01-original.png`  
  SHA-256: `4B69C0FFF2648874460E9CAF80C31413C444218A5C50AFEBC425AEAA65484A35`

The bundled copies in Roadcraft had been resized to 256 pixels. These originals
preserve their 512-pixel alpha detail. The system asset pack is CC0; the
project also keeps its license record in `assets/LICENSES.json`.

`eyebrow-follicles.json` contains 600 barycentric follicle samples derived
from the alpha of `eyebrow002-original.png` on the CC0 `eyebrow002` mesh.
The browser fits these through the same proxy references as the source mesh.
