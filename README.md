# Human Generator Studio

Gerador de personagens humanos para jogos, no navegador. Aplica morphs de corpo e rosto numa malha humana contínua, veste roupas e cabelo com colisão em camadas, cria rig de corpo e rig facial, e exporta GLB animado pronto para engine. Em tempo de execução usa apenas o pacote local `three`; não depende de Blender nem do programa MakeHuman.

## Como rodar no Windows

Rode `npm install` uma vez e depois dê dois cliques em `server.cmd`. Ele serve o projeto na porta 8765 com `server.py` (Python 3) e abre `http://127.0.0.1:8765/`. Esse servidor manda `Cache-Control: no-cache`, então depois de atualizar o projeto basta recarregar a página. O `http.server` puro do Python deixava o navegador usar módulos antigos.

Use Edge ou Chrome recentes, com WebGL 2 e aceleração gráfica. Para parar o servidor, use Ctrl+C no terminal.

## O que dá para editar

- **Character / Body / Face / Eyes / Skin**: identidade, idade, altura, proporções, rosto, olhos e pele. Pele, íris, cabelo, roupas, sobrancelhas e cílios aceitam qualquer cor pelo seletor ao lado da paleta. Os tons de pele escolhem a textura mais próxima e corrigem a cor em espaço linear, para bater com a amostra.
- **Eyes**: sobrancelhas (formato, inclinação, arco, espessura, largura, altura, densidade, cor) e cílios (comprimento, curvatura, densidade, cor).
- **Cabelo**: penteados prontos em mechas (longo, chanel, franja, curto, ondulado, cacheado, careca), editáveis no editor de mechas. No personagem, o trecho apoiado na cabeça segue a pele de cabeça/pescoço; o trecho livre de mechas longas vai para cadeias de ossos `hair_NN_J` (filhos de `head`, no mesmo esqueleto) com mola no estilo VRMC_springBone, que balança e colide com cabeça, pescoço, peito, clavículas e braços.
- **Clothing**: quatro guarda-roupas prontos (CC0) com cores de cima e de baixo, ou **Custom (tailor)**, um alfaiate de roupas sob medida.
  - Moldes: camiseta, manga longa, regata, moletom, calça, bermuda, saia, vestido, meias, luvas e peça em branco. Cada um tem manga, comprimento, decote, cintura, rodado, folga, rugosidade, cor, segunda cor e padrão (listras, risca de giz, xadrez, degradê).
  - Pincel de tecido: pinta ou apaga a roupa em qualquer parte do corpo.
  - Camadas (de dentro para fora) com "Move inward/outward".
  - Como funciona: o molde é um campo contínuo sobre o corpo, recortado exatamente na curva de nível, então as bordas são lisas e têm barra com espessura. O caimento é simulado com XPBD (gravidade, tensão ou folga, rigidez de dobra e atrito). O tecido colide com a pele e com as camadas de baixo, com espessura, como num simulador de roupas. Partes de camadas internas cobertas pela externa e a pele coberta são removidas. Cada ponto cortado do corpo mantém os pesos de skinning da pele de onde saiu, então roupa e pele deformam juntas e as camadas mantêm a ordem; peças de moldes 2D pegam os pesos da pele da própria região (braço, perna, tronco, cabeça).
- **Mechas**: modelagem de cabelo em malha, no estilo The Sims. Cada mecha é um tubo liso e fechado (sem transparência), preso por uma raiz ao couro cabeludo.
  - Ferramentas: **Puxar** (clique no couro cabeludo e arraste para criar uma mecha; arraste uma mecha existente para movê-la), **Selecionar** (Shift soma, Ctrl alterna), **Alongar** (clique numa mecha e arraste no sentido da ponta), **Cortar** (passe a tesoura sobre as mechas) e **Prender / soltar** (fixa um ponto onde ele está). "Espelhar" cria a mecha simétrica do outro lado; "Prender o ponto puxado ao soltar" (ou segurar P) deixa a mecha presa no ar.
  - Controles da seleção: comprimento, largura, volume (espessura), afunilamento, curvar, enrolar, voltas, torcer e firmeza. Teclas + e − alongam ou encurtam; Delete apaga; Ctrl+Z / Ctrl+Y desfazem e refazem; Espaço pausa.
  - Caimento: **Gravidade (G)** controla a simulação contínua no editor; desligar congela a pose exibida. **Fixar forma (F)** protege a forma; **Soltar forma** libera. O solver preserva o desenho fonte; corpo e roupa são contatos rígidos e mecha encontra mecha por campo de densidade (atrito e repulsão, Müller et al. 2012 §3.5), então mechas podem se encostar de leve. A gravidade só pausa se uma mecha entrar no corpo/roupa, esticar ou ficar presa contra o corpo por uma fixação.
  - Salvar e carregar no navegador ou em arquivo `.mechas.json` (geometria, raízes e configurações). **Concluir** monta uma única malha de jogo presa ao rig da cabeça, guardada com o personagem e no preset.
- **Sculpt**: pincéis Draw, Inflate, Grab, Smooth, Flatten e Pinch, com simetria em X, raio, força e inversão (Ctrl). Valem para corpo e rosto, cabelo e roupas. No cabelo há ainda Pin/Unpin (prende regiões) e Cut (corta como tesoura). Desfazer e refazer com Ctrl+Z / Ctrl+Y. As edições ficam salvas no preset e no GLB, e roupa e cabelo continuam fora da pele depois de esculpir.
- **Expression**: 12 humores e 32 blendshapes com nomes ARKit (`eyeBlinkLeft`, `jawOpen`, `mouthSmileLeft`…), ajustáveis um a um, com boca, dentes e língua.
- **Pose / Animation**: 4 posturas e 16 clipes (idle, andar, andar rápido, correr leve, correr, parar, virar, sentar, levantar, olhar em volta, falar, gesticular, acenar, usar celular, carregar, interagir), com piscadas e fala no rosto.
- **Export**: GLB para jogo, com ossos no padrão Unreal Mannequin (UE4) ou Mixamo (Unity Humanoid e Godot), orientados como no rig MPFB (+Y ao longo do osso) e gravados na pose de ligação A. Opções: nível de detalhe alto, médio ou baixo; sobrancelhas e cílios em cartões ou fios; com ou sem animações e blendshapes. A versão otimizada solda os vértices e junta o personagem em duas malhas com skin: `Body` (vários materiais) e `Head` (rosto, boca, cílios e sobrancelhas com os 32 blendshapes, posição e normal); texturas opacas em JPEG, até 2048 px. As cadeias de cabelo vão como ossos e como extensão `VRMC_springBone` (motores com suporte a VRM simulam a mola; nos outros o cabelo segue a cabeça). Na Unity use "Enforce T-Pose" no Avatar; no Unreal, a pose de retarget do IK Retargeter; no Godot, BoneMap humanoide com "Fix Silhouette".
- **Performance**: teste de multidão com 1 a 1000 pessoas e LOD.

Preset salva tudo (inclusive escultura, roupas sob medida e cores) no armazenamento local do navegador. O botão de lixeira apaga o preset selecionado.

## Criação guiada e edição autoral

**Criar pessoa** abre cinco etapas: pessoa inicial, corpo e rosto, cabelo, roupas e revisão/exportação. Em **Preservar nas variações**, marque corpo, rosto, cabelo ou roupa antes de gerar uma variação. Os grupos preservados incluem suas cores e edições autorais. Você pode alternar as etapas ou usar edição livre.

A geração numérica e a fusão de cabelo rodam em Workers locais, mantendo o personagem anterior visível. O rodapé mostra a etapa e permite **Cancelar operação**. Nome, iluminação e expressão alterados durante uma geração são preservados. Nenhum serviço de IA ou dependência adicional é usado.

### Desenhar cabelo

- Em **Desenhar e dar forma**, alterne **Fios**, **Mechas** e **Volume** usando as mesmas curvas editáveis. Largura e espessura ficam acessíveis no início do painel. Sem seleção, ajustam todo o penteado; com seleção, só a parte selecionada. Fios de jogo começam em 1 mm de largura, não representam cada fibra microscópica do cabelo real.
- **Desenhar traço** começa no couro cabeludo e acompanha o cursor para fora da cabeça; **Preencher raízes** distribui mechas sobre a superfície. **Puxar** continua disponível para criar e remodelar curvas existentes.
- **Pentear** atua onde o cursor toca o cabelo, nas mechas dentro do raio do pincel. **Seleção sob o pincel** limita o gesto às mechas selecionadas que também estão nessa região. Raízes, pinos e máscaras protegem as regiões ancoradas. Pontas arredondadas, afinadas ou retas e formas lisa, ondulada ou cacheada permanecem editáveis.
- Os pincéis de suavidade, volume, densidade, agrupamento e máscara têm raio, força, suavidade e simetria. Grupos marcados para fusão participam de uma única superfície volumétrica; os demais mantêm mechas separadas. A escultura fica em coordenadas relativas à cabeça e pode ser reaplicada quando a malha muda.
- **Gravidade (G)** liga ou desliga a simulação; não há botão para reaplicar a queda. O processamento usa passos fixos e descarta respostas antigas após edição ou pausa. O editor inicia com gravidade desligada; se a separação não convergir, rejeita a pose calculada, preserva a edição anterior, pausa e informa a falha. A convergência dos contatos entre todas as mechas continua pendente.

A fusão usa um campo de distância aproximado e uma grade limitada a 300 mil células. A interface informa quando a resolução solicitada foi adaptada. Detalhes menores que a resolução efetiva podem desaparecer; a prévia interativa aproxima o resultado até o Worker concluir. O arquivo `.mechas.json` mantém curvas, grupos, máscaras e parâmetros de construção.

### Roupas por moldes

Em **Sob medida → Construção**, escolha **Corte no corpo** ou **Moldes 2D**. Alternar mantém o molde salvo. Pintura de cobertura, arraste de bordas e sliders de manga/decote/comprimento pertencem ao corte no corpo; no modo de moldes, edite os contornos SVG e use escultura/fixação 3D.

O editor SVG permite desenhar painéis e furos, recortar, arrastar pontos/alças Bézier, duplicar, espelhar, medir, posicionar componentes e associar bordas externas ou de furos para costuras, pences e aberturas. Há moldes para as categorias de roupa existentes e componentes de manga, gola, capuz, bolso e punho. Cada painel tem posição, material, espessura, rigidez, elasticidade, cores e estampa.

**Esculpir**, **Fixar** e **Soltar** atuam no personagem 3D. Escultura e fixação usam coordenadas do painel, mantendo as edições ao regenerar a malha ou reordenar peças. Os arquivos de roupa incluem o molde, as costuras e as edições. O caimento usa XPBD e contato discreto entre partículas/triângulos; não inclui detecção contínua de colisão nem contato exato entre todas as arestas. Moldes são destinados a personagens de jogos, sem certificação para fabricação.

Presets e arquivos antigos continuam carregando, sem regravação automática. As novas extensões usam formatos versionados. O GLB contém o resultado de cabelo e roupa com rig, materiais e animações; JSON guarda a construção editável.

Pesquisa, adaptações e verificação: [registro de implementação](docs/IMPLEMENTATION.md) e [auditoria de arquitetura](docs/ARCHITECTURE.md). `AGENTS.md` exige fontes oficiais e análise do fluxo completo antes de novas alterações.

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

`npm test` cobre geometria, aparência, colisão (nada dentro da pele), qualidade das bordas das roupas, simulação, rig facial, exportação Unreal/Mixamo, LOD e presets. `npm run export:glb` exporta um personagem vestido (camiseta, moletom, calça) com cabelo longo, confere pesos, esqueleto único, contagens e orçamento, e passa o arquivo pelo glTF Validator da Khronos (`exports/personagem.glb` e `.report.json`). No navegador, confira as vistas frente, lado, costas, rosto e multidão, e exporte um GLB.
