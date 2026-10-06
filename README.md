# Human Generator Studio

Gerador de personagens humanos para jogos, no navegador. Aplica morphs de corpo e rosto numa malha humana contínua, veste roupas e cabelo com colisão em camadas, cria rig de corpo e rig facial, e exporta GLB animado pronto para engine. Em tempo de execução usa apenas o pacote local `three`; não depende de Blender nem do programa MakeHuman.

## Como rodar no Windows

Rode `npm install` uma vez e depois dê dois cliques em `server.cmd`. Ele serve o projeto na porta 8765 com `server.py` (Python 3) e abre `http://127.0.0.1:8765/`. Esse servidor manda `Cache-Control: no-cache`, então depois de atualizar o projeto basta recarregar a página. O `http.server` puro do Python deixava o navegador usar módulos antigos.

Use Edge ou Chrome recentes, com WebGL 2 e aceleração gráfica. Para parar o servidor, use Ctrl+C no terminal.

## O que dá para editar

- **Character / Body / Face / Eyes / Skin**: identidade, idade, altura, proporções, rosto, olhos e pele. Pele, íris, cabelo, roupas, sobrancelhas e cílios aceitam qualquer cor pelo seletor ao lado da paleta. Os tons de pele escolhem a textura mais próxima e corrigem a cor em espaço linear, para bater com a amostra.
- **Eyes**: sobrancelhas (formato, inclinação, arco, espessura, largura, altura, densidade, cor) e cílios (comprimento, curvatura, densidade, cor).
- **Hair**: 13 estilos em malha, leves para jogo: curto, de lado, longo, chanéis, trança, Afro, raspado e careca. Tipos liso, ondulado, cacheado e crespo deformam a própria malha, sem acrescentar triângulos. Há também comprimento, volume e cor.
- **Clothing**: quatro guarda-roupas prontos (CC0) com cores de cima e de baixo, ou **Custom (tailor)**, um alfaiate de roupas sob medida.
  - Moldes: camiseta, manga longa, regata, moletom, calça, bermuda, saia, vestido, meias, luvas e peça em branco. Cada um tem manga, comprimento, decote, cintura, rodado, folga, rugosidade, cor, segunda cor e padrão (listras, risca de giz, xadrez, degradê).
  - Pincel de tecido: pinta ou apaga a roupa em qualquer parte do corpo.
  - Camadas (de dentro para fora) com "Move inward/outward".
  - Como funciona: o molde é um campo contínuo sobre o corpo, recortado exatamente na curva de nível, então as bordas são lisas e têm barra com espessura. O caimento é simulado com XPBD (gravidade, tensão ou folga, rigidez de dobra e atrito). O tecido colide com a pele e com as camadas de baixo, com espessura, como num simulador de roupas. Partes de camadas internas cobertas pela externa e a pele coberta são removidas. Os pesos de skinning vêm da pele sob cada ponto.
- **Sculpt**: pincéis Draw, Inflate, Grab, Smooth, Flatten e Pinch, com simetria em X, raio, força e inversão (Ctrl). Valem para corpo e rosto, cabelo e roupas. No cabelo há ainda Pin/Unpin (prende regiões) e Cut (corta como tesoura). Desfazer e refazer com Ctrl+Z / Ctrl+Y. As edições ficam salvas no preset e no GLB, e roupa e cabelo continuam fora da pele depois de esculpir.
- **Expression**: 12 humores e 32 blendshapes com nomes ARKit (`eyeBlinkLeft`, `jawOpen`, `mouthSmileLeft`…), ajustáveis um a um, com boca, dentes e língua.
- **Pose / Animation**: 4 posturas e 16 clipes (idle, andar, andar rápido, correr leve, correr, parar, virar, sentar, levantar, olhar em volta, falar, gesticular, acenar, usar celular, carregar, interagir), com piscadas e fala no rosto.
- **Export**: GLB para jogo, com ossos no padrão Unreal Mannequin ou Mixamo (Unity Humanoid e Godot). Opções: nível de detalhe alto, médio ou baixo; sobrancelhas e cílios em cartões ou fios; com ou sem animações e blendshapes. A versão otimizada solda os vértices, separa a cabeça como malha própria com os blendshapes e grava texturas opacas em JPEG.
- **Performance**: teste de multidão com 1 a 1000 pessoas e LOD.

Preset salva tudo (inclusive escultura, roupas sob medida e cores) no armazenamento local do navegador. O botão de lixeira apaga o preset selecionado.

## API em código

Importe `createHuman`, `exportHumanGLB`, `registerHairStyle` e `registerClothingStyle` de `src/human-three.mjs`. `createHuman({ seed, ageYears, gender, muscle, weight, heightMeters, features, hair, clothing, shoes, faceWeights, sculpt, groom, lod })` devolve o grupo Three.js, o corpo com rig, as animações (`clipNames` em `src/motion.mjs`), as malhas com rig facial (`faceMeshes`), as medidas e `dispose()`.

- `hair`: `{ style, length, volume, texture: 'straight'|'wavy'|'curly'|'coily', curl }`; estilos procedurais `afro` e `buzz`.
- `clothing`: estilo CC0 com `color`/`bottomColor`, `{ style: 'tailor', garments: [...] }` (veja `newGarment` em `src/tailor.mjs`) ou `{ style: 'none' }`.
- `faceWeights`: pesos de blendshape (veja `faceWeights(expression, intensity, custom)`).
- `exportHumanGLB(human, { skeleton: 'unreal'|'mixamo', animations, blendshapes, cosmetic, optimize })`.

## Organização do código

- `src/parametric.mjs`: assets e forma do corpo.
- `src/human-three.mjs`: rig, pele, montagem e exportação.
- `src/appearance.mjs`: olhos, cabelo, roupas prontas, sapatos e ordem das camadas.
- `src/tailor.mjs`: roupas sob medida.
- `src/cloth.mjs`: simulação XPBD.
- `src/collision.mjs`: colisor de superfícies em camadas, resolução de penetração e remoção do que fica coberto.
- `src/face-rig.mjs` e `src/face-mesh.mjs`: blendshapes.
- `src/motion.mjs`: animações.
- `src/sculpt.mjs`: pincéis.
- `src/renderer-three.mjs`: visualização e multidão.
- `src/ui.mjs`: editor.
- `src/state.mjs`: presets.

Os módulos antigos de primitivas/WebGPU continuam sem uso no app.

A pasta `assets/` tem malha, morphs, texturas, rig e roupas CC0 do pacote de assets do MakeHuman. `assets/LICENSES.json` guarda origem e licença.

## Verificação

`npm test` cobre geometria, aparência, colisão (nada dentro da pele), qualidade das bordas das roupas, simulação, rig facial, exportação Unreal/Mixamo, LOD e presets. No navegador, confira as vistas frente, lado, costas, rosto e multidão, e exporte um GLB.
