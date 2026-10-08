# Estado do trabalho

Plano executado: correção de rig, roupas, cabelo, materiais e exportação (aprovado e concluído em 2026-10-08).

| Passo | Conteúdo | Estado |
| --- | --- | --- |
| 0 | Commit-base do trabalho anterior na `main` | feito (`8bafd25`) |
| 1 | `docs/PROJETO.md` e este arquivo | feito |
| 2 | Gravidade do editor com campo de densidade | feito |
| 3 | Esqueleto orientado, pesos saneados, exportação na pose de ligação | feito |
| 4 | Juntas seguem a escultura; blendshapes com normais | feito |
| 5 | Roupas com pesos da pele de origem/região; pele coberta escondida | feito |
| 6 | Cabelo com cadeias de juntas e mola | feito |
| 7 | Materiais dentro da faixa do glTF | feito |
| 8 | Exportação válida e validação Khronos | feito |

Plano executado: redesenho da interface e controlador global de estado e eventos (2026-10-08, commits `4faca55`, `5e5be43`, `6b6bc7b`).

| Passo | Conteúdo | Estado |
| --- | --- | --- |
| 1 | `store.mjs` (estado, eventos, operações, histórico) e `ui-kit.mjs` | feito |
| 2 | UI sobre o store; rail de ferramentas, cartão de opções, popover Exportar, paleta nova | feito |
| 3 | Fundo neutro do 3D | feito |
| 4 | Editor de moldes nas classes do app | feito |
| 5 | Documentação | feito |

## Ativo no app

- Estado global: `store.mjs` é a fonte única (personagem + interface); a UI reage ao evento `change`. Desfazer/refazer único no topo e em Ctrl+Z/Y para Personagem, Corpo, Rosto, Roupas, Esculpir e Animação (expressões); no Cabelo vai para o histórico do editor de mechas e a visita inteira vira um passo. Status e Cancelar vêm das operações registradas (geração, exportação, cabelo, multidão). Personagem autosalvo (`hgs.autosave`) e restaurado ao abrir; grupos abertos, opções de exportação e cartão recolhido lembrados (`hgs.ui`).
- Layout: rail de seções (7: Personagem, Corpo, Rosto, Cabelo, Roupas, Esculpir, Animação) → rail de ferramentas da seção (Cabelo; pincéis de Esculpir; Roupas sob medida), duas colunas, `role=toolbar` com setas/Home/End → 3D com o cartão de opções da ferramenta ativa (canto superior esquerdo, recolhível), vistas/luz/captura/desempenho (superior direito), zoom (inferior direito), dica e avisos (embaixo) → inspetor com o conteúdo da seção. Exportar é um popover do topo com opções e resumo; "Criar pessoa" e "Criação guiada" saíram (o rail já é a sequência).
- Cores: grafite neutro, acento único `#f27a2e` (o da seleção no 3D); trilhos e chaves ≥ 3:1, texto ≥ 4,5:1. Fundo do 3D em degradê cinza neutro, igual em todas as iluminações, piso e grade que somem na névoa.
- Editor de mechas, inspetor: Penteado (estilos + cor), Prendedores (sempre que houver), Ajustar mechas, Gravidade, Representação, Exibição, Arquivo. Cartão da ferramenta: Espelhar e Círculo (comuns) e as opções próprias da ferramenta.
- Pentear: como um pente real — agarra cada mecha tocada (raiz, meio ou ponta) num dente que acompanha o cursor e puxa a mecha inteira; se ela não alcança, o pente desliza para a ponta e a solta lá; nunca estica (FABRIK até o dente, FTL depois). Alcance Pincel, Selecionadas ou Todo o cabelo.
- Prender: Elástico (junta a seleção ou o círculo num feixe de raio ½·√Σespessura²), Grampo (prende rente à cabeça as mechas sob o clique), Fivela (junta encostado na cabeça), Arco/Tiara (de orelha a orelha, prende quem passa por baixo), Gel (fixa a forma; aspecto molhado no editor), Pino. Cada prendedor segura um ponto por mecha (pino com `holder`), é salvo com o penteado (`accessories`), aparece no personagem final e no GLB (malha `HairAccessories`, osso `head`) e tem "×" na lista.
- Preencher: raízes numa rede de Fibonacci da cabeça (espaçamento = Distância entre mechas), plantadas onde o círculo passa; forma pela direção e comprimento médios das vizinhas que já existiam (Add do Blender), senão penteada para o lado e para trás. Adensar respeita a "Distância entre mechas" (Distance Min do Blender).
- Preencher aceita passar de novo na mesma área: cada traço gira a rede de Fibonacci ao acaso, e só uma raiz em cima de outra é recusada (as do próprio traço mantêm a distância).
- Couro cabeludo (`scalp.mjs`): linha do cabelo por marcos anatômicos em 32 pontos — testa 0,42 rad, ponto temporal, costeleta descendo na frente da orelha até −0,30, atrás da orelha −0,55 → −0,85 (abaixo do lóbulo), pezinho na nuca −1,05 (≈10 cm abaixo do centro da cabeça; antes −0,62). Vale pele com peso de cabeça + pescoço ≥ 0,3 a até 1,6 R; a orelha (vértices que o alvo MakeHuman `ears/*-ear-trans-up` move inteiros) nunca recebe raiz.
- Desenhar: traço estabilizado (8 px, Stabilize Stroke do Blender); colado no couro cabeludo enquanto o cursor está sobre ele; ao sair, segue no plano de vista pelo ponto onde a mecha deixou a cabeça (Only First do Blender) e, onde a pele ou a roupa ficam na frente desse plano, sobre elas. Sem degrau de profundidade na saída do couro cabeludo (era a “sanfona”).
- Penteado Curto cobre o pezinho e as costeletas (anéis −0,62 e −0,88); penteados gerados de novo.
- Seleção por pintura (Shift soma, Ctrl tira).
- Interface (todas as guias): sliders numa linha (legenda | barra preenchida | valor); escolhas na linha do rótulo, em ícones onde a opção é visual; ferramentas só com ícones no rail e o nome da ativa no cartão; ações em linhas de ícones com nome no tooltip; foco do teclado preservado quando o painel se refaz.
- constrainLockPose não estica nunca: ponto preso parado mantém a pose anterior do trecho; ponto em movimento fica o mais perto possível.
- Gravidade (editor): contato com pele/roupa por partícula com a mesma folga do penteado estático (PBD), folículo fixo e restrição de forma local do TressFX liberada pela rampa da Firmeza (`gravityWeight`, a mesma do penteado estático); mecha‑mecha por campo de densidade (Müller et al. 2012 §3.5). Só desliga sozinha por estiramento ou ponto preso dentro do corpo. O worker recebe no máximo um quadro (1/60 s) por pedido; `fx` (fixa) é gravado também no formato v1.
- Esqueleto: ossos orientados pela cabeça→cauda + roll do rig MPFB (+Y ao longo do osso); clipes convertidos para esse repouso; pesos de todas as malhas saneados (4 influências, soma 1, índice 0 onde peso 0); `auditCharacter` disponível.
- Corpo: juntas acompanham a escultura do corpo (anel de pele em volta de cada junta); os 32 blendshapes levam também deslocamento de normal.
- Roupas: peças cortadas do corpo mantêm os pesos da pele de origem; moldes 2D pegam pesos só da pele da própria região (saias: pelve/coxas); roupa pronta sem escala extra; roupa infantil esconde a pele coberta.
- Cabelo: trecho apoiado na cabeça com os pesos da pele de cabeça/pescoço; trecho livre de mechas longas em até 12 cadeias de juntas `hair_NN_J` filhas de `head` no mesmo esqueleto; mola VRMC_springBone na prévia (colisores cabeça, pescoço, peito, clavículas, braços); vértices limitados pelo orçamento do nível (30k/15k/3k); cabelo em casca (API) sem transparência ordenada.
- Materiais: tinta da pele e cor das roupas prontas assadas na textura em espaço linear (fatores e cores de vértice ≤ 1); rugosidade de cada peça sob medida no seu próprio material.
- Exportação: ossos na pose de ligação; sem `userData` no arquivo; malhas com skin na raiz da cena; com "otimizar", duas malhas (`Body`, `Head` com 32 alvos de posição e normal); extensão `VRMC_springBone`; texturas até 2048 px.
- Validação: `npm run export:glb` — última execução: glTF Validator 0 erros, 0 avisos (informações: extensão VRMC desconhecida pelo validador; UVs sem textura no Node); auditoria sem problemas; 83 ossos (30 de cabelo); cabelo 29.547 vértices; 10 chamadas de desenho.

## Não ativo / pendente

- Mecha atravessando mecha: não resolvido. Foi tentada uma separação por caixas orientadas (SAT) depois da deposição, com projeção em planos de contato (PBD); medida nos 6 penteados prontos, ela girava as mechas (pontas deslocadas 5–53 cm) sem zerar os contatos (as fitas de 5,5 cm se sobrepõem como telhas: ~890 contatos em ~1.100 pontos), então foi retirada. Continua a camada fina de `turnOffLocks` na deposição e o campo de densidade na gravidade ao vivo.
- Testes automáticos (2026-10-08): `npm test` 108 de 109; falha `tests/face-rig.test.mjs` "expressions…GLB", que procura `morphTargetDictionary` no nó `Head`, mas o GLTFLoader carrega uma malha de várias primitivas como `Group` (os 32 alvos estão nos filhos) — teste desatualizado em relação à exportação em duas malhas, sem relação com o cabelo.
- Gravidade do editor: o worker leva ~10–12 ms por subpasso com 63 mechas; acima disso a simulação fica mais lenta que o tempo real (sem acumular atraso).
- A conferência visual (lista no fim do relatório da sessão) é do usuário. O redesenho da interface foi verificado só por leitura do código e `node --check` (sem navegador, pela regra do projeto).
- Ferramentas ainda sem atalho de teclado próprio (só F, G, P, Delete, +/−, Ctrl+Z/Y).
- Olhos com 32.640 triângulos (subdivisão dupla do globo para a íris por cor de vértice): fora do escopo deste plano; candidato a revisão de orçamento.
- O validador não verifica as imagens (o GLB do Node não tem texturas); cores e texturas são conferidas no navegador.
