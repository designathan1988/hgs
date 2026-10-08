# Arquitetura e auditoria do Human Studio

Leitura integral dos 40 arquivos originais de `src/` em 7–8 de outubro de 2026, incluindo o pipeline antigo. `hair-presets.mjs` foi inspecionado por estrutura e por importação para conferir seu esquema; o conteúdo numérico gerado não foi despejado. Este registro descreve a base auditada e o transporte de geração acrescentado nesta implementação. As extensões de cabelo e roupa têm seus próprios módulos e testes.

## Fluxo ativo

`index.html` importa `src/main.mjs` e fornece um import map para a versão local de Three.js (0.186.0, conferida em `node_modules/three/package.json`). O aplicativo ativo usa `WebGLRenderer` de Three.js. Os módulos de WebGPU permanecem no repositório, mas não são importados pelo ponto de entrada.

```text
DOM / ponteiro / teclado
  → main.mjs → StudioUI (ui.mjs)
  → normalizeCharacter (state.mjs)
  → studioSpec (renderer-three.mjs)
  → geração em Worker → createHuman (human-three.mjs)
    → assets → Morpher/PCA/macro/regional → posições em metros
    → escultura do corpo → esqueleto → malha com UV e skinning
    → olhos / sobrancelhas / cílios
    → sapatos → roupas de dentro para fora → cabelo
    → blendshapes faciais → LOD → clipes
  → pacote numérico → ObjectLoader → texturas no DOM
  → publicação do personagem → AnimationMixer → WebGLRenderer
```

No Node, a geração continua chamando `createHuman` diretamente. Os testes não precisam de navegador ou DOM para construir geometria. No navegador, o Worker executa os cálculos que podem bloquear eventos, inclusive XPBD e construção de superfícies; a textura e o canvas ficam na página.

O estado editável é separado do objeto renderizado. `StudioUI.person` guarda a especificação normalizada; a malha representa a última reconstrução publicada. Apresentação (luz, expressão, animação e velocidade) pode mudar sem reconstrução. Proporções, idade, altura, roupas e escultura exigem reconstrução. Os controles possuem debounce; a geração anterior deve permanecer visível até a nova ser concluída e aceita.

## Responsabilidade de todos os arquivos originais

| Arquivo | Responsabilidade e condição |
| --- | --- |
| `main.mjs` | Entrada ativa; cria renderer e UI, roteia ponteiro/teclas entre câmera, cabelo, roupa e escultura e mantém o loop de quadros. |
| `ui.mjs` | Oito seções, controles, histórico de escultura/roupa, arquivos JSON, localStorage, criação/reconstrução, exportação e feedback. |
| `state.mjs` | Defaults, normalização, compatibilidade de presets, paletas, referência de altura por idade, geração aleatória determinística e JSON de personagem. |
| `icons.mjs` | SVG de interface e pictogramas de cabelo; depende de `document`. |
| `renderer-three.mjs` | Pipeline ativo: especificação do estúdio, câmera, publicação, modos de edição, luz, animação, multidão, picking e exportação por LOD. |
| `human-three.mjs` | Montagem ativa: morfologia, esqueleto a partir de landmarks, corpo, pele, aparência, face, LOD, clipes, ciclo de recursos e GLB. |
| `parametric.mjs` | Carrega assets JSON/binários uma vez; chama Morpher e ajusta escala/altura em metros. |
| `parametric-core.mjs` | Morpher: base, coeficientes PCA, resíduos macro, deltas regionais e mapeamento dos sliders. |
| `macro.mjs` | Interpola estados macro, combina fatores e ancestralidade e converte idade/anos. |
| `appearance.mjs` | Ordem de vestir; fitting de proxies, olhos/córneas, grooms, recoloração, shells, cabelo por mechas e superfícies para colisão. |
| `proxy.mjs` | Assets CC0 de acessórios; referências baricêntricas, escala, fitting, pesos de skinning e URL de textura. |
| `texture-cache.mjs` | Promessas de texturas compartilhadas; remove falhas do cache; protege texturas contra descarte de um personagem. |
| `hair-surface.mjs` | Subdivisão de cabelos sólidos com preservação de UV/skinning e normal map derivado de imagem; mapa exige canvas. |
| `scalp.mjs` | Frame da cabeça, hairline, campo de cobertura, normais, colisor de cabeça/corpo/roupa e pesos do cabelo. |
| `locks.mjs` | Esquema das mechas, raízes, serialização, edição de comprimento, gravidade determinística, varredura de tubos e underlay. |
| `lock-editor.mjs` | Edição de mechas separadas no viewport; ferramentas, picking, histórico, gravidade, pinos, salvar/carregar e helpers. |
| `hair-presets.mjs` | Asset gerado por `tools/author-hair-presets.mjs`: seis penteados por mechas e careca; não é implementação manual. |
| `tailor.mjs` | Roupa sob medida; cobertura contínua, corte, saia/vestido, drape, camadas, barras, pesos e malha final. |
| `cloth.mjs` | XPBD de tecido: stretch/bending, gravidade, compliance, atrito, pontos presos e bandas elásticas. |
| `cloth-editor.mjs` | Picking de peça e arraste de manga/barra/decote/cintura; prévia da curva de corte e reconstrução ao soltar. |
| `collision.mjs` | Superfícies por camadas, busca espacial de triângulos próximos, distância assinada, correção e ocultação de cobertura. |
| `sculpt.mjs` | Brushes no repouso, simetria, offsets esparsos por altura, seleção de alvo e pintura de cobertura da roupa. |
| `face-rig.mjs` | 32 blendshapes nomeados, landmarks faciais, formas regionais, mandíbula, pálpebras e presets de expressão. |
| `face-mesh.mjs` | Boca/dentes/língua, aplicação dos morphs ao corpo/grooms e composição de pesos de expressão. |
| `face-groom.mjs` | Folículos autorais de sobrancelha e cílios ajustados à pele/olhos; fios geométricos com skinning. |
| `brow-shape.mjs` | Normaliza parâmetros e deforma sobrancelhas em torno de sua linha autoral. |
| `motion.mjs` | 16 clipes procedurais, posturas, marcha, gestos, piscadas, fala e keyframes compatíveis com exportação. |
| `lod.mjs` | Solda e reduz a geometria com `SimplifyModifier`; geometria real menor nos níveis médio/baixo. |
| `renderer.mjs` | Renderer WebGPU antigo, shaders, buffers e câmera; inativo no aplicativo. |
| `shaders.wgsl` | Shader do renderer WebGPU antigo; skinning, iluminação, ruído e chão. |
| `human.mjs` | Pessoa antiga por primitivas e roupa implícita; usada apenas pelo renderer/multidão antigos. |
| `geometry.mjs` | MeshBuilder antigo: triângulos com 14 floats, lathes, ellipsoids, ribbons e tubes. Também pode servir aos cálculos implícitos. |
| `math.mjs` | Vetores/matrizes em arrays, cores e helpers do pipeline antigo e de geometria implícita. |
| `face.mjs` | Rosto procedural antigo por superfícies e primitivas; inativo no pipeline Three. |
| `hair.mjs` | Cabelo antigo por ribbons com índices de estilo; inativo no pipeline Three. |
| `garments.mjs` | Roupa antiga por SDF/isosurface, detalhes e skinning; chamada por `human.mjs`. |
| `clothing.mjs` | Implementação anterior de roupas por lathe/tube; nem o `human.mjs` atual a importa. |
| `animation.mjs` | Matrizes para 20 bones do renderer WebGPU antigo. |
| `crowd.mjs` | Multidão antiga instanciada com cinco LODs; a multidão ativa está em `renderer-three.mjs`. |
| `implicit.mjs` | SDF, smooth union e marching tetrahedra; usado pela roupa antiga e reutilizável para união volumétrica. |

Os binários de `assets/` são dados: malha base com grupos/helpers, packs macro/PCA e regionais, definição de modificadores, rig/pesos, proxies e texturas. Não são código de MakeHuman em tempo de execução. `server.py` serve arquivos locais com tipos MIME e `Cache-Control: no-cache`; `server.cmd` é o launcher Windows. Nenhuma dependência foi acrescentada pelo transporte de geração.

## Cabelo: fonte autoral, malha e adaptação

Na base auditada, o esquema de penteado é `hgs-locks`, versão 1, com `R`, `scalp` e `locks`. Cada mecha contém raiz `r` (três IDs de vértice e pesos), pose `p`, design `q`, comprimento de segmento `sg`, forma fixa `sy`, pinos e parâmetros abreviados. `p` e `q` têm 60 números (20 pontos × 3). Os presets possuem 63 mechas em longo/chanel/ondulado/cacheado, 73 em franja e 75 em curto; careca usa `null`.

As raízes são baricêntricas na malha base, portanto acompanham a morfologia. Pontos e largura são relativos à raiz e escalados por `frame.R / saved.R`, mantendo tamanho relativo à cabeça. Na base auditada, os vetores salvos são deslocamentos no frame global, sem rotação de um frame tangente autoral. Esculturas grandes ou assimétricas podem exigir readaptação de orientação além de translação/escala.

`LockShaper` calcula gravidade a partir do design, respeita pinos e forma fixa e apoia cada mecha nas superfícies e nas mechas já colocadas. Não há simulação contínua ociosa. A edição usa uma malha por mecha para picking; a construção de jogo reúne as superfícies e liga o cabelo ao rig. O underlay apenas colore as lacunas junto às raízes.

Concatenar tubos ou soldar vértices não resolve união volumétrica. A extensão de união precisa guardar suas fontes editáveis separadamente da superfície final, para que uma edição/regeneração não destrua a autoria.

## Roupa: fonte autoral, caimento e chaves

Na base auditada, cada peça normalizada guarda tipo, parâmetros de corte/folga, aparência e pintura por ID de vértice da malha base. O corte interpola a curva zero da cobertura; depois suaviza o molde, aplica XPBD, corrige penetração, transfere pesos e adiciona barras. Roupas são construídas de dentro para fora e adicionadas ao colisor antes da próxima camada e do cabelo. A roupa final carrega `garmentOf` para seleção e `sculptKeys` para escultura.

As chaves originais de escultura usam índice da camada (`layer * 100000 + baseVertex`, ou uma faixa separada para a saia). Reordenar ou remover peças muda o significado dessas chaves: autoria estável requer identidade da peça e offsets guardados nela, não somente posição no array. Os vértices de interseção e barras originais recebem chave −1 e não preservam escultura individual ao reconstruir.

O arquivo original `.roupa.json` guarda apenas `garments`. Ele preserva parâmetros/pintura, mas não `sculpt.outfit.tailor`. O preset do personagem guarda também a escultura. Moldes/painéis SVG, costuras e pences precisam viajar na fonte autoral normalizada de cada peça para sobreviver a salvar/carregar/exportar e às alterações do corpo.

## Falhas de integração identificadas na base

- `normalizeCharacter` convertia uma lista autoral vazia de mechas em `null` para um preset não careca. Apagar todas as mechas fazia o penteado padrão retornar. Vazio autoral e ausência de autoria têm significados diferentes.
- O editor de cabelo trabalha com seu próprio estado até concluir/salvar. A UI normaliza uma nova `person`; o renderer pode ainda referenciar a anterior. Exportar pelo renderer sem sincronizar esse snapshot pode reconstruir o cabelo antigo.
- Exportar logo após alterar roupa/cor/corpo durante o debounce pode usar uma malha antiga, ou uma especificação antiga. A exportação precisa capturar e construir a especificação autoral atual.
- Durante reconstrução, `beginLocks` guarda o estado do editor anterior. Publicar uma pessoa inteiramente nova exige distinguir esse caso de refitting da mesma autoria, para evitar reaplicar cabelo do personagem anterior.
- O token original descartava apenas o resultado de `createHuman`; não interrompia os cálculos. Um erro de uma reconstrução antiga também precisava ser distinguido do erro da atual.
- O descarte original cobria geometria/material, mas não arrays de materiais ou a textura de bones do Skeleton. Helpers do editor têm seus próprios recursos, que também precisam de ciclo de vida explícito.
- O asset loader original de corpo cacheia sua promessa. Uma falha fica cacheada; repetir geração não transforma essa falha em sucesso. O cache de proxy/textura, em contraste, remove a promessa rejeitada.
- A documentação anterior descrevia estilos de cabelo/controles/física que não correspondem mais à UI de mechas. Código e comportamento executado têm prioridade como evidência.

Esses itens são achados da base, não uma afirmação de que todos permanecem após as mudanças paralelas. A validação da integração deve exercer apagar cabelo, mudar corpo, reordenar peças, salvar/carregar, exportar durante edição e cancelar uma construção longa.

## Transporte e cancelamento implementados

`generation.mjs` fornece `packHuman`, `unpackHuman` e `buildHumanInWorker`; `generation-worker.mjs` é a entrada de cálculo. O Worker recebe apenas a especificação serializável. `createHuman` executa sem `document`, sem WebGL e sem texturas DOM. O pacote usa `group.toJSON()` de Three, preserva buffers tipados de atributos/morphs e transporta somente contexto numérico (posições, escala, heads, IDs de bones/roots, superfície da roupa e métricas). Não transporta `dispose`, Morpher, Collider ou callbacks. Os buffers são transferidos uma vez por identidade.

Na página, `ObjectLoader` recria meshes, esqueleto, bind matrices, animações, nomes/influências dos morphs e materiais. `loadHumanData` fornece o Morpher local; o wrapper recompõe `Vector3`, Maps e referências reais dos bones. `baseIds`, `sculptKeys` e `garmentOf` permanecem tipados. `unitScale` é guardado explicitamente porque propriedades adicionais de typed arrays não têm o mesmo contrato de transporte dos seus elementos. As bounding boxes são recalculadas.

Mapas de pele, detalhe das roupas, alpha cards, normal maps e grooves de mechas são hidratados na página pelo pipeline de aparência. A ausência de texturas no Worker não deve alterar a cor final; em particular a recoloração original de roupa usa um fator de brilho diferente quando o detalhe texturizado está presente.

Import maps não se aplicam a Workers. O resolvedor local lê o grafo ES, troca imports de `three`, addons e módulos relativos por URLs resolvidas e substitui `import.meta.url` pela URL original, preservando o endereço dos assets. Os módulos locais/addons viram Blob URLs; o build de Three é usado por sua URL original. O grafo é cacheado; ciclos/imports desconhecidos e falhas HTTP são erros explícitos. As URLs ficam válidas durante o uso e são revogadas ao sair definitivamente da página. Nenhuma falha de Worker aciona uma geração síncrona silenciosa.

Cada construção possui Worker próprio. `AbortSignal` rejeita a solicitação e chama `terminate()`; assim o botão de cancelar pode interromper inclusive loops síncronos longos sem depender de um checkpoint dentro deles. O cache de preparação pode continuar sendo preenchido após cancelar um consumidor, mas nenhum Worker começa para a solicitação cancelada. O renderer ainda deve conferir o token antes de publicar e descartar uma conclusão atrasada. Callbacks de progresso e eventos do Worker são removidos no término; uma conclusão que chega após cancelamento também é descartada.

O cache de textura compartilhada pertence à página. O wrapper descarta uma vez cada geometria, material, textura não compartilhada e skeleton. Cancelar o Worker não necessita descartar GPU nele, porque o Worker nunca cria o renderer.

## Evidência observada e fontes

- `node --test tests/generation.test.mjs`: inicialmente 2 falhas por ausência do módulo; depois 2 testes passaram. O roundtrip usa `createHuman` real, compara corpo/skinning/morphs, verifica labels, escala/contexto e reproduz uma animação no esqueleto recebido. O segundo teste rejeita uma solicitação pré-cancelada.
- Sonda numérica sem DOM: `loadHumanData` + `shapeHuman` produziram 57.474 coordenadas finitas; o roundtrip independente de `ObjectLoader` preservou SkinnedMesh, skeleton e userData tipado.
- Primeira execução real no Edge/Playwright carregou o grafo do Worker e revelou `RangeError: Maximum call stack size exceeded` em `appearance.addSurfaceEyes`: expansão de `...next` na segunda subdivisão excedia a pilha do Worker. O achado foi encaminhado ao responsável por aparência. Buffers grandes devem ser copiados por `.set`/loops, evitando expansão como argumentos.
- Após a correção da expansão dos índices dos olhos, execução real Edge/Playwright: personagem completo com cabelo curto, roupa pronta, texturas e rig construído e hidratado em 1.176 ms; 12 meshes, 4 image maps, 53 bones, 32 blendshapes e 32.809 vértices no cabelo. Progresso observado: Preparando → Assets → Corpo → Aparência → Rig → Pronto. Nenhum `pageerror`.
- Na mesma execução, uma geração de roupa sob medida foi cancelada 20 ms após o estágio Aparência. Recebeu `AbortError` em menos de 1 ms após o `abort`; um intervalo de 5 ms na página executou 34 vezes durante a solicitação. Uma construção posterior em novo Worker terminou com 53.512 vértices de corpo, verificando cancelamento real e reutilização do grafo.
- Esses resultados exercitam geração/transporte/hidratação/cancelamento. O roteiro guiado inteiro, download GLB, reconstrução no meio de edição e capturas visuais são verificações de integração do responsável pela UI.

Fontes primárias/documentação consultadas:

- [MDN: import maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap): import maps de documento não resolvem módulos carregados em Workers/worklets.
- [MDN: Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers): contexto separado, mensagens, fetch e indisponibilidade de DOM.
- [MDN: Worker.terminate](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate): interrupção imediata, sem esperar a operação terminar.
- [MDN: AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal): estado de cancelamento, motivo, listeners e API assíncrona rejeitando operações canceladas.
- [MDN: objetos transferíveis](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects): typed arrays são serializáveis; seu ArrayBuffer é transferível e fica separado da origem.
- [Three: Skeleton](https://threejs.org/docs/pages/Skeleton.html): serialização de skeleton e descarte de recursos GPU.
- [Three: AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html): parar ações e remover recursos de uma raiz com `uncacheRoot`.
- Código instalado conferido: `src/loaders/ObjectLoader.js`, `src/loaders/BufferGeometryLoader.js`, `src/core/BufferGeometry.js`, `src/objects/SkinnedMesh.js` e `src/objects/Skeleton.js` em Three 0.186.0. O suporte ao pacote (skinning, morphs, labels, userData, bind matrices) foi conferido no código desta versão e por execução, não presumido a partir de uma versão diferente.
