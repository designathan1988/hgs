# Human Studio — descrição técnica

Criador de pessoas 3D para jogos, no navegador. Gera corpo, rosto, roupas e cabelo sobre a malha humana do MakeHuman, prende tudo a um único esqueleto e exporta GLB.

## Destinos

- Formato: GLB / glTF 2.0 (metros, +Y para cima, frente para +Z).
- Esqueleto: nomes do UE4 Mannequin (`unreal`, padrão) ou renomeados para Mixamo (`mixamo`: Unity Humanoid, Godot, bibliotecas de animação).
- Pose de ligação: **A** (a da malha base: braço ~48° abaixo da horizontal). Unity: "Enforce T-Pose" na configuração do Avatar; Unreal: pose de retarget do IK Retargeter; Godot: BoneMap humanoide + "Fix Silhouette".
- Conteúdo: 16 clipes + o clipe próprio ("Personalizada", da linha do tempo), 52 blendshapes ARKit (inclui olhar e língua), LOD alto/médio/baixo.
- LOD: um GLB por nível no "Pacote LOD" (.zip), mesmo esqueleto, malhas `Body_LODn`/`Head_LODn` (convenção `_LODX` do Unity). glTFast não lê MSFT_lod; Unreal recebe cada arquivo num slot de LOD; Godot gera LOD sozinho (pode ser desligado na importação; a doc avisa de problemas em malhas com skin).

## Stack

- three.js **0.186.0** (`node_modules/three`), ES modules sem bundler, import map em `index.html`.
- Servidor local `server.py` (porta 8765, sem cache) aberto por `server.cmd`.
- Geração do personagem num Worker por construção (`src/generation.mjs`, resolvedor de módulos por Blob URL; import maps não valem em Workers).
- Testes: `node --test tests/*.test.mjs` (`npm test`). Não há TypeScript, typecheck nem build; a checagem de compilação é `node --check`.
- Exportação e validação por linha de comando: `npm run export:glb` (`tools/export-glb.mjs`, usa o pacote `gltf-validator` da Khronos).
- Addons de three.js usados: GLTFExporter, GLTFLoader (testes e importação de animação), BufferGeometryUtils, MeshoptSimplifier (`libs/meshopt_simplifier.module.js`, meshoptimizer 1.1), SkeletonUtils (clone, retarget), TransformControls (Posar), fflate (`zipSync`, pacote LOD).

## Mapa de arquivos por sistema

| Sistema | Arquivos |
| --- | --- |
| Entrada e interface | `index.html`, `styles.css`, `src/main.mjs`, `src/store.mjs` (estado e eventos globais), `src/ui.mjs`, `src/ui-kit.mjs` (controles, barra de ferramentas, popovers), `src/state.mjs`, `src/icons.mjs` |
| Renderer, publicação, transporte | `src/renderer-three.mjs`, `src/generation.mjs`, `src/generation-worker.mjs`, `src/texture-cache.mjs` |
| Edição ao vivo | `src/live.mjs` (forma: corpo, esqueleto e tudo que veste), `src/look.mjs` (cores e materiais), `src/shape-handles.mjs` (Moldar) |
| Corpo e morphs | `src/parametric.mjs`, `src/parametric-core.mjs`, `src/macro.mjs`, `src/sculpt.mjs` |
| Esqueleto, pele, montagem, GLB | `src/human-three.mjs`, `src/skin.mjs`, `src/motion.mjs`, `src/lod.mjs` (meshoptimizer) |
| Pose e animação | `src/pose.mjs` (gizmo, IK de duas juntas), `src/timeline.mjs` (clipe próprio, importação com retarget), `src/motion.mjs` (clipes, convenção D, biblioteca de poses) |
| Rosto | `src/face-rig.mjs`, `src/face-mesh.mjs`, `src/face-groom.mjs`, `src/brow-shape.mjs` |
| Roupas | `src/appearance.mjs`, `src/proxy.mjs`, `src/tailor.mjs`, `src/fabrics.mjs` (tecidos PBR), `src/costume.mjs` (plumas, franjas, coroa, molas), `src/garment-icons.mjs`, `src/pattern-cloth.mjs`, `src/patterns.mjs`, `src/pattern-editor.mjs`, `src/cloth.mjs`, `src/cloth-contact.mjs`, `src/cloth-editor.mjs`, `src/collision.mjs` |
| Cabelo | `src/locks.mjs`, `src/scalp.mjs`, `src/hair-accessories.mjs` (elástico, grampo, fivela, arco/tiara), `src/hair-rig.mjs`, `src/spring-bones.mjs`, `src/hair-fusion.mjs`, `src/hair-fusion-worker.mjs`, `src/hair-dynamics.mjs`, `src/hair-physics-client.mjs`, `src/hair-physics-worker.mjs`, `src/lock-editor.mjs`, `src/hair-tools-ui.mjs`, `src/hair-presets.mjs` (gerado por `tools/author-hair-presets.mjs`), `src/hair-surface.mjs` (cabelos em malha da API) |
| Ferramentas | `tools/author-hair-presets.mjs`, `tools/export-glb.mjs` |
| Inativos (pipeline WebGPU antigo) | `src/renderer.mjs`, `src/shaders.wgsl`, `src/human.mjs`, `src/geometry.mjs`, `src/math.mjs`, `src/face.mjs`, `src/hair.mjs`, `src/garments.mjs`, `src/clothing.mjs`, `src/animation.mjs`, `src/crowd.mjs`, `src/implicit.mjs` |

## Assets de base

- **Malha** `assets/base.{json,bin}`: MakeHuman hm08 (MPFB2 `afb9f53`), 19.158 vértices, 21.334 UVs, 18.304 quads. Grupo `body` = 13.378 quads (53.512 vértices por canto, 26.756 triângulos). Helpers (tights, dentes, língua) e cubos de junta `joint-*`. 182 faces `helper-genital` removidas. Unidade decímetro, +Y para cima, +Z para frente; convertida para metros com os pés em y = 0 (`parametric.mjs`).
- **Morphs**: `targets-macro-pca` (64 componentes PCA para 348 alvos macro), `targets-local` (802 alvos regionais), `modifiers.json` (macro.json do MPFB2). Valem para os 19.158 vértices, cubos de junta inclusive.
- **Esqueleto** `skeleton-game-engine.json` (MPFB `rig.game_engine.json`): 53 ossos com nomes do UE4 Mannequin; cabeça e cauda por estratégia (CUBE = média de um grupo `joint-*`, MEAN = média de vértices) e `roll` por osso, no referencial do Blender (+Z para cima, −Y para frente).
- **Pesos** `weights-game-engine.bin`: 4 influências por vértice (juntas uint8, pesos uint16 que somam 65535). Os 200 vértices sem peso não pertencem a nenhuma face.
- **Proxies CC0** (`assets/proxies`): 8 roupas prontas, 2 sapatos, olhos, sobrancelhas, cílios, cabelos em malha (só API). Cada proxy guarda 3 vértices de referência, pesos baricêntricos, offsets e vértices do corpo que esconde (`deleteVerts`).
- **Peles**: 20 texturas (idade × ancestralidade × sexo).
- **Penteados prontos** (`hair-presets.mjs`): longo, chanel, franja, curto, ondulado, cacheado, careca; 63–75 mechas de 20 pontos.

## Fluxo de criação de um personagem

0. Duas velocidades. **Ao vivo**: campos de forma (`liveShapeFields` em `ui.mjs`: corpo, rosto, macros, `morphs`) → `Renderer.liveShape` → no próximo quadro `LiveShape.update` (`live.mjs`): morphs, novo repouso do esqueleto e `calculateInverses`, malhas presas ao corpo (base, proxy MakeHuman, triângulo da pele, afim da cabeça), clipes refeitos; cores (`liveLookFields`) → `look.mjs` (material/textura, sem rebuild). **Refino** ao soltar (`commitLive`) → build completo abaixo.
1. Interface → ação no store (`store.dispatch`, `person/patch`) → evento `change` → `StudioUI.onChange`: campos de apresentação (inclui `posing` e `clip`) → `setPresentation`; demais → `queueCharacter` (debounce) → `Renderer.setCharacter` → `studioSpec`. Seção e ferramenta ativa → `applyMode` (editor de mechas, escultura, ferramentas de roupa, Posar, Moldar).
2. Worker → `createHuman` (`human-three.mjs`).
3. Morphs (`shapeHuman`/`Morpher.shape`) → escultura do corpo (`applyOffsets`).
4. Esqueleto (`makeSkeleton`): cabeça e cauda de cada osso pelas estratégias do rig sobre a malha atual (cubos morfados + deslocamento da escultura), orientação pelo eixo e roll do rig MPFB; bind calcula as matrizes inversas.
5. Malha do corpo com UV, normais e pesos dos dados.
6. Olhos (proxy `eyes` com UV e textura de íris MakeHuman recolorida, ~1.000 triângulos; a casca de córnea do proxy fica fora do índice), sobrancelhas, cílios (presos a `head`).
7. Colisor do corpo → sapatos (proxy `shoes01`, omitido quando há calçado sob medida) → roupas. Prontas: ajuste MakeHuman. Sob medida (`tailor.mjs`): corte no corpo pelo campo de cobertura de cada tipo (inclui biquíni, maiô, braçadeiras, tornozeleiras, faixa das franjas e calçados, estes cortados da "forma" lisa do pé), casca ajustada `fitShell` (laplaciano só na normal + Shrinkwrap "Outside" sobre a pele sem mamilos/costelas, folga pela normal suavizada, Taubin) sem caimento; ou moldes 2D (`pattern-cloth.mjs`: malha em grade + Delaunay, contagens iguais por costura, caimento XPBD, costuras soldadas). Camadas: pele erguida pelas peças de baixo (densa) + `keepOutside` contra cada peça já vestida. Pesos: da pele de origem (corte) ou da região (moldes). Um material `MeshPhysicalMaterial` por tecido (`fabrics.mjs`), texturas desenhadas na página. → pele coberta escondida (exceto sob tule).
7b. Fantasia (`costume.mjs`, depois do cabelo e antes dos acessórios): franjas, costeiro e cabeça de plumas (cartões recortados por alfa), coroa e faixa; cadeias de 3 juntas com mola VRMC_springBone no mesmo esqueleto, somadas às do cabelo em `group.userData.hairSprings`; malha `Costume`.
8. Cabelo em mechas: raízes baricêntricas, gravidade de penteado no corpo e roupa atuais, malha opaca; prendedores (pinos marcados pelo acessório, malha `HairAccessories` inteira no osso `head`); cadeias de juntas de cabelo filhas de `head` a partir do último ponto preso (mola VRMC_springBone na prévia e no GLB).
9. Rig facial (52 blendshapes ARKit com posição e normal; `eyeLook*` giram o globo) em LOD0 e LOD1 → LOD (meshoptimizer `simplifyWithAttributes`, só índices) → clipes (+ clipe próprio) → saneamento dos pesos.
10. Pacote numérico → página → texturas → cena → `AnimationMixer` → mola do cabelo → desenho.
11. Exportação: pose de ligação, malhas `Body` e `Head`, sem `userData`, validação Khronos.

## Orçamento para jogos

Fontes: tabela de LOD do MetaHuman (Epic) e "Modeling characters for optimal performance" (Unity).

| Item | Alto | Médio | Baixo |
| --- | --- | --- | --- |
| Malhas com skin no GLB | 2 (`Body`, `Head`) | 1–2 | 1 |
| Influências por vértice | 4 | 4 | 4 |
| Ossos | ≤ 113 (53 do corpo + cabelo) | idem | idem |
| Vértices de cabelo | ≤ 30.000 | ≤ 15.000 | ≤ 3.000 |
| Primitivas/materiais | ≤ 10 | ≤ 10 | ≤ 6 |
| Lado da textura | ≤ 2048 | ≤ 2048 | sem textura |

O script `tools/export-glb.mjs` informa quando um personagem passa do orçamento.
