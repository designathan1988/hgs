# Evolução do Human Studio — registro de implementação

Plano aprovado em 7 de outubro de 2026. Alvo: personagens para jogos; criação guiada local, cabelo por mechas e superfície fundida, roupas por moldes SVG e ajuste 3D. Three.js instalado e manifestado: 0.186.0. Nenhuma dependência adicional.

## Entregas e contratos

1. Criação guiada: cinco etapas, variações com preservação de corpo/rosto/cabelo/roupa, progresso, cancelamento e publicação apenas da reconstrução mais recente.
2. Cabelo: fontes editáveis, grupos, união volumétrica, pincéis e operações espaciais relativas à cabeça, salvamento compatível, colisão e rig.
3. Roupa: painéis SVG, moldes e componentes, costuras e pences, caimento XPBD, autocolisão, materiais por painel, edição e salvamento compatível.
4. Integração: presets, GLB, níveis de detalhe e documentação; testes dos fluxos e verificação no navegador.

## Evidência e adaptações

### Estado e criação
Atual: `randomCharacter()` substitui a pessoa; `normalizeCharacter()` normaliza campos e as formas autorais. Não há roteiro ou preservação seletiva de características. Adaptação: geração determinística existente com cópia explícita dos grupos preservados, incluindo escultura e cores. O algoritmo é uma decisão do projeto baseada no contrato existente, não uma API de geração fornecida pelo Three.js.

### Reconstrução e cancelamento
Atual: `Renderer.setCharacter()` possui um token para descartar resultados antigos, mas geração numérica síncrona pode bloquear eventos e não oferece cancelamento visível. APIs de controle devem preservar o personagem anterior até a conclusão da próxima geração.
Fontes consultadas: [AbortSignal.throwIfAborted](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted), [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame). A política de checkpoints e publicação é uma adaptação do projeto.

### Geometria e exportação
Conferidos: `node_modules/three/package.json` (0.186.0), `src/extras/ShapeUtils.js`, `examples/jsm/utils/BufferGeometryUtils.js` e `examples/jsm/modifiers/SimplifyModifier.js` da dependência instalada.
Fontes: [ShapeUtils](https://threejs.org/docs/pages/ShapeUtils.html), [BufferGeometryUtils](https://threejs.org/docs/pages/module-BufferGeometryUtils.html), [GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html).
Triangular moldes com furos e exportar GLB são capacidades documentadas. União volumétrica, moldes paramétricos e edição autoral são funcionalidades próprias; concatenar buffers ou soldar vértices coincidentes não constrói essa união.

## Progresso

- Regras permanentes registradas; branch de trabalho `codex/character-authoring`, no checkout existente para manter o aplicativo local acessível.
- Auditoria de todos os módulos e implementação das três entregas em andamento.
- Novos testes serão executados primeiro para demonstrar ausência do comportamento e depois para verificar sua implementação; testes antigos não serão alterados.
- Navegador: inicialmente foi usado Playwright do runtime porque Browser estava indisponível. Após o usuário fornecer o plugin, a verificação passou ao Browser conectado à aplicação local. A aba original foi preservada, o personagem foi salvo e uma segunda aba recebeu a versão atual.

## Fontes e decisões das ferramentas autorais

### Cabelo

Antes: concatenação de tubos por mecha, largura acessível apenas no contexto da seleção, pincel limitado a distribuir raízes no couro cabeludo e gravidade estática idempotente. A nova superfície aplica união dos grupos selecionados, preservando fontes e operações espaciais relativas à cabeça. O traço livre, pente local sob o cursor e modos fios/mechas/volume reutilizam as curvas; são adaptações do projeto.

Conferidos no Three.js 0.186.0: quatro índices/pesos por vértice em `SkinnedMesh.js`, geometria e atributos em `BufferGeometry.js`. Referências oficiais: [SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html), [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html), [falloff de pincéis](https://docs.blender.org/manual/en/4.0/sculpt_paint/brush/falloff.html), [agrupamento de curvas](https://docs.blender.org/manual/en/5.1/modeling/geometry_nodes/hair/guides/clump_hair_curves.html). Extração: [Paul Bourke, Polygonising a scalar field](https://paulbourke.net/geometry/polygonise/), com a subdivisão em seis tetraedros já existente no projeto.

Gravidade: o ajuste anterior era estático. A primeira alteração oferecia assentamento por botão; o usuário esclareceu que precisa de queda contínua enquanto ligada e congelamento ao desligar. A interface foi corrigida e a simulação transferida a Worker, com passo fixo, velocidades e descarte de resultados antigos. Referências primárias: [Müller, Chentanez e Kim, Fast Simulation of Inextensible Hair and Fur, §§3.2–3.3](https://matthias-research.github.io/pages/publications/FTLHairFur.pdf), [XPBD](https://mmacklin.com/xpbd.pdf) e [GJK original](https://graphics.stanford.edu/courses/cs164-09-spring/Handouts/paper_GJKoriginal.pdf). As restrições e os contatos das seções elípticas são adaptações do projeto. **A convergência no penteado completo continua pendente:** a auditoria de triângulos encontrou cruzamentos e o Browser mostrou instabilidade no cabelo cacheado. A proteção subsequente foi verificada no Browser: rejeita poses não separadas, conserva a geometria anterior, desliga a gravidade e informa o erro. O editor passa a iniciar desligado.

Bloqueio de física: projeções cartesianas reduziram os cruzamentos do Chanel, mas não os eliminaram; rotações em cadeia pioraram o resultado; inicialização ordenada limitada também falhou e regrediu o teste de duas mechas (27 contatos, profundidade máxima 7,964 mm). A estratégia regressiva foi retirada e o kernel cartesiano foi restaurado; não se alterou o teste nem sua tolerância. Hipótese técnica: as projeções locais não convergem simultaneamente para os contatos das seções renderizadas, as âncoras e os comprimentos nessa configuração sobreposta. Para concluir falta um solver que resolva esse conjunto de restrições no penteado completo, sem estreitar ou esconder mechas, mover raízes ou eliminar fixações. As tentativas foram interrompidas conforme `AGENTS.md`.

Limites declarados: campo elíptico aproximado, grade de até 300 mil células com resolução efetiva visível, detalhes abaixo da resolução podem desaparecer e prévia aproximada antes do resultado do Worker. Densidade zero preserva a fonte para permitir desfazer.

Largura no traço livre: a orientação antiga das seções podia mostrar a mecha de perfil, fazendo a largura parecer ineficaz. Novos traços guardam a normal de referência da câmera (`rn` opcional no formato v2), transportada pelos frames ao longo da curva; os presets sem esse campo mantêm sua orientação antiga. A geometria continua sendo um tubo elíptico sólido e fechado. Referências conferidas: [Camera.getWorldDirection](https://threejs.org/docs/pages/Camera.html#getWorldDirection) e [Wang et al., Computation of Rotation Minimizing Frames](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/Computation-of-rotation-minimizing-frames.pdf). Os pontos de controle aparecem apenas nas ferramentas de edição de pontos, para não encobrir a largura durante o desenho.

Verificação anterior no Edge: gesto com mouse gerou uma curva de 31,654 cm e largura 18 mm; assentamento estático moveu a ponta 31,965 cm, mantendo o desenho fonte e erro máximo relativo de comprimento de segmento 0,00000342. Conversão para Volume manteve a curva e gerou superfície em Worker, sem erros de página/console. Esse resultado de uma mecha **não valida** a nova gravidade contínua ou a ausência de interpenetrações no penteado completo. As capturas são reais; as verificações antigas de pente global foram substituídas pela exigência de pente local do usuário.

Curvar: poses preservadas não passavam pelo operador antigo de caimento, portanto alterar `bend` não modificava seu desenho. Agora usa o `bendLock` já existente sobre uma base do gesto, com projeção de comprimento/raízes/pinos/máscaras. O campo v2 opcional `bi` registra a curvatura incorporada em `p/q` para impedir aplicação duplicada ao assentar; arquivos antigos continuam usando o operador anterior. O ciclo 0 → 0,5 → 0 restaura a base do mesmo gesto, e mudanças de comprimento ou novos puxões invalidam essa base.

Cancelamento: assentamento guarda pose e histórico antes de começar e restaura ambos quando cancelado sem uma edição posterior. Sair da seção cancela a pose intermediária antes de serializar. A fusão cancela somente o cálculo derivado: parâmetros e traços autorais já concluídos são preservados e a prévia anterior permanece. Nome e apresentação feitos durante uma reconstrução também são preservados ao cancelar. Erros têm ação para manter o personagem anterior.

### Moldes e tecido

Antes: cobertura contínua derivada do corpo e uma malha compartilhada; sem construção de painéis independentes. Agora: contornos SVG em metros, amostragem Bézier, triangulação com furos, refinamento compartilhado, colocação anatômica e costuras XPBD. Materiais e fixações são guardados por painel; a escultura usa coordenadas do painel para não depender do índice de vértice ou ordem da peça.

Referências primárias: [ShapeUtils](https://threejs.org/docs/pages/ShapeUtils.html), [XPBD, Macklin/Müller/Chentanez 2016](https://mmacklin.com/xpbd.pdf), [GarmentCode, autores/ETH](https://igl.ethz.ch/projects/garmentcode/) e [Bridson/Fedkiw/Anderson, Robust Treatment of Collisions, Contact and Friction for Cloth Animation](https://graphics.stanford.edu/papers/cloth-sig02/cloth.pdf). A organização painel/borda/costura e o simulador são implementações próprias, sem incorporar dependências dessas ferramentas.

Os contatos partícula/triângulo são discretos; CCD e contato exato entre todas as arestas não foram implementados. O corte no corpo mantém os controles originais; moldes usam contornos e escultura/fixação próprios. `authoringMode` só é serializado quando necessário ou escolhido explicitamente, evitando impedir a atribuição de um molde a uma peça recém-criada.

### Workers, publicação e revisão

As import maps da janela não se aplicam a Workers. O resolvedor transforma somente imports locais estáticos e mantém o URL original dos módulos para carregar assets; Three.js continua vindo da versão local. O pacote numérico transporta buffers tipados, rig, morphs e animações; texturas são restauradas na página. [Import maps](https://html.spec.whatwg.org/multipage/webappapis.html#import-map-processing-model), [Worker.terminate](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate), [ObjectLoader](https://threejs.org/docs/pages/ObjectLoader.html) e [descarte de recursos Three.js](https://threejs.org/manual/pages/cleanup.html).

Falhas reproduzidas e corrigidas: a expansão de centenas de milhares de índices como argumentos estourava a pilha do Worker; o envio de arrays foi substituído por iteração. Atualizações de nome/apresentação feitas durante a geração eram sobrescritas pelo snapshot inicial; agora a publicação consulta o estado atual. Fixação da roupa perdia a peça selecionada ao esconder o contorno; seleção e ferramenta são mantidas. Reset de escultura não incluía amostras dos moldes; agora os dados e o histórico incluem as peças. Elementos decorativos interceptavam o clique dos switches; a área de interação do input agora coincide com o indicador, conforme [pointer-events](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/pointer-events).

## Verificação

Criação guiada, preservação de características, cancelamento, salvamento, moldes e exportação/reabertura GLB foram exercitados no Edge nesta sessão; o GLB reaberto tinha cabelo, roupa, materiais, rig e 16 animações. Essas verificações precedem a última alteração de física. `npm test` final em 8 de outubro, após retirada da estratégia regressiva: **106 testes passaram, zero falhas, zero ignorados**, duração 74,613 s. Testes existentes e package/lock não foram alterados. Os testes novos da dinâmica passaram nos cenários sintéticos, mas a auditoria independente do Chanel completo e a captura no Browser do cacheado encontraram falhas. A integração inteira permanece **incompleta** enquanto essas falhas de física persistirem. Browser confirmou reabertura do personagem salvo, controle de congelamento, rejeição de candidato inválido, pausa automática com mensagem visível e ausência de erros de console; o backend conectado não expôs `cua.drag`, portanto um novo gesto de pente não pôde ser exercitado nesse backend.

Após essa suíte, foi acrescentada uma verificação da proteção do editor sem Worker: duas malhas fixadas incompatíveis não alteram pose, desenho, afunilamento ou estado autoral; a gravidade pausa com erro explícito. `node --test tests/hair-dynamics.test.mjs tests/hair-interaction.test.mjs`: **22 testes passaram, zero falhas**, duração 7,963 s. Esse teste adicional foi verificado pelo comando direcionado, não incluído na execução anterior de 106 testes.
