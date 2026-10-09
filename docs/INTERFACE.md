# Interface: diagnóstico e plano (2026-10-09)

Pedido do usuário: interface focada em usabilidade e design, intuitiva em
todos os módulos — não troca de cores. Este documento registra o que foi
encontrado usando o app (1280×800 e 1024×700, mouse e teclado), as fontes, a
nova arquitetura e as etapas.

## 1. Diagnóstico por módulo (visto no app)

### Geral
| # | Problema | Evidência |
|---|---|---|
| G1 | A câmera não acompanha a seção: em **Rosto** o rosto ocupa ~40 px de altura; ao sair de **Cabelo** a câmera fica no rosto e **Roupas** mostra só a cabeça | captura Rosto e Roupas após Cabelo |
| G2 | O botão de vista **"Corpo"** continua aceso quando a câmera está no rosto (estado falso) | Cabelo, Roupas |
| G3 | Nomes repetidos com sentidos diferentes: seções "Corpo"/"Rosto" e vistas "Corpo"/"Rosto"; "Corpo: Feminino/Masculino" em Personagem; "Postura", "Pose", "Poses prontas" em Animação | Personagem, Animação |
| G4 | FPS e "73 mil triângulos" fixos na barra de status (número de depuração) | todas |
| G5 | O que está carregando aparece só no rodapé ("Gerando · etapa"), longe do 3D | troca de roupa leva 3–9 s sem nada no 3D |
| G6 | Ferramentas só com ícones (Cabelo 7, Esculpir 6, Roupas 7); nomes e atalhos só no tooltip; ferramentas desabilitadas a 30% sem dizer por quê | trilho de ferramentas |
| G7 | O cartão da ferramenta cobre a barra de vistas (Frente/Lado somem) em Roupas sob medida e em 1024 px | captura Roupas, 1024 |
| G8 | Atalhos invisíveis (B, F, R, C, E, V, S, [ ], Ctrl+Z); nenhum atalho de seção; nenhuma lista de atalhos | — |
| G9 | Ações destrutivas sem confirmação nem como voltar à vista: "Padrão" troca o personagem; Esculpir › "Tudo" apaga a escultura; ícone de lixeira para "voltar à pose A" | menus |
| G10 | Em 1024 px a barra do topo perde os rótulos (Aleatório, Personagens, Exportar viram ícones) | 1024 |
| G11 | Bordas de campos e segmentos com 1,2–1,5:1 contra o painel (WCAG 1.4.11 pede 3:1 para identificar o controle); botão pequeno de 22 px (WCAG 2.5.8: 24 px) | styles.css |

### Personagem
- "Aleatório" no topo e "Gerar variação" no painel fazem a mesma coisa; os 4 interruptores "Manter…" ficam antes da ação e não se lê o que farão.
- Pele: 8 bolinhas sem nome; acabamento da pele (brilho) está escondido em Corpo › Pele; ancestralidade em Corpo.

### Corpo e Rosto
- Sliders mostram números crus (−0,15; 0,64) sem dizer o que é cada ponta (magro/pesado).
- "Proporção (comum ↔ ideal)" cortado.
- "Moldar" é um botão no meio da lista; o título "Moldar no corpo" aparece também em Rosto.
- "Todos os ajustes": 802 sliders atrás de chips de região, sem busca e sem ver o que já foi alterado.

### Cabelo
- Dois sistemas de penteado lado a lado sem hierarquia: 14 chips "Base pronta" (texto) e a galeria de 7 desenhos "Mechas"; dava para ver "Chanel virado com franja" e "Careca" acesos ao mesmo tempo.
- Texto técnico ("Base pronta: cabelo inteiro feito por artista. Mechas: …").
- "Ajustar mechas" com 10 sliders seguidos; painel de 1.993 px.
- Ferramenta Apagar com ícone de lixeira (parece "excluir tudo").

### Roupas
- Prontas: chips de texto. Sob medida: painel alarga para 500 px e o 3D encolhe; primeira escolha é "Corte no corpo / Moldes 2D" (termo de modelagem).
- Peças: chips "1. Camiseta", um select "Nova peça" e 4 ícones sem nome (+, lixeira, setas).
- Ferramenta "Girar a câmera" é uma ferramenta; "Fixar/Soltar" aparecem apagadas sem explicação.

### Esculpir
- Opções do pincel no cartão flutuante; alvo e redefinir no painel: duas regiões para uma tarefa.
- "Corpo e ros…" cortado; "Tudo" apaga sem confirmar.

### Animação
- Sem pausar/tocar; só "Repetir do início".
- 16 movimentos em chips; "Andar" aceso enquanto o Posar parou a animação.
- Expressão (rosto) misturada com animação; 52 nomes ARKit em inglês ("mouthSmileLeft") como rótulos.
- Linha do tempo como dois sliders e chips de tempo.

### Exportar e Personagens
- "Detalhe: Alto · M… · Ba… · Pa…" cortados; "Pelos do rosto: Cartões/Fios" sem explicação; "13 malhas" na prévia enquanto o GLB otimizado sai com 2.
- Personagens: "Padrão" troca o personagem sem aviso; lista vazia sem explicar o que salvar faz.

## 2. Princípios e fontes

| Princípio | Fonte | Como se aplica |
|---|---|---|
| Status visível perto da ação | NN/g, heurística 1 — https://www.nngroup.com/articles/ten-usability-heuristics/ | Indicador "Gerando…" sobre o 3D; vista ativa verdadeira |
| Palavras do usuário | NN/g, heurística 2 | Nomes ARKit traduzidos; "Moldes 2D" vira "Desenhar moldes"; pontas dos sliders com palavras |
| Controle e liberdade | NN/g, heurística 3 | Avisos com "Desfazer"; pausar/tocar |
| Prevenção de erro | NN/g, heurística 5 | Confirmação em apagar tudo |
| Reconhecer em vez de lembrar | NN/g, heurística 6 | Ferramentas com nome e tecla visíveis; galerias |
| Atalhos para quem já sabe | NN/g, heurística 7 | 1–7 para seções; "?" abre a lista; teclas no trilho |
| Divulgação progressiva (2 níveis, rótulo que antecipa o conteúdo) | NN/g — https://www.nngroup.com/articles/progressive-disclosure/ | Grupos "Mais ajustes de …" recolhidos; nada com 3 níveis |
| Manipulação direta | GDC 2015, Sims 4 — https://www.gdcvault.com/play/1022085/Innovations-in-The-Sims-4 | "Moldar" e "Posar" no topo de suas seções, com instrução clara |
| Categorias à esquerda, ferramentas com propriedades; enquadramentos Rosto/Corpo; atalhos da ferramenta ativa; esconder cabelo e roupa | MetaHuman Creator — https://dev.epicgames.com/documentation/metahuman/navigating-metahuman-creator-in-unreal-engine | Câmera por seção; vistas Rosto/Corpo inteiro; lista de atalhos por ferramenta |
| Busca por nome e "só o que foi alterado" em listas grandes de morphs | Character Creator 4 — https://manual.reallusion.com/Character-Creator-4/Content/ENU/4.0/04_Introducing_the_User_Interface/Modify_Morphs_Tab.htm | Ajustes detalhados com busca e filtro "Alterados" |
| Toolbar à esquerda, Tool Settings da ferramenta, Sidebar; dicas de teclado na barra de status | Blender — https://docs.blender.org/manual/en/latest/interface/window_system/regions.html | Trilho com nomes; dica de mouse no rodapé; cartão só da ferramenta |
| Alvo ≥ 24 px; 3:1 em componentes e estados | WCAG 2.2 — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html, https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html | Bordas de campos e segmentos visíveis; botões pequenos ≥ 24 px |
| Pincel que desenha a mecha; sliders de espessura e curvatura | VRoid Studio (anúncio beta, pixivision — o manual em vroid.pixiv.help respondeu 403) | Ferramenta Pincel em destaque no Cabelo |

## 3. Nova arquitetura

### Navegação (trilho à esquerda, ordem do fluxo de criação)
1 Pessoa · 2 Corpo · 3 Rosto · 4 Cabelo · 5 Roupas · 6 Pose e animação · 7 Esculpir (separado por uma linha: ferramenta livre).
Teclas 1–7 trocam a seção (aparecem no tooltip e na lista "?").

### Câmera por seção (enquadramento automático, como o MetaHuman)
Pessoa, Corpo, Roupas, Animação, Esculpir → Corpo inteiro; Rosto → Rosto;
Cabelo → cabeça em ¾ (já feito pelo editor). O usuário pode girar à vontade;
voltar à seção reenquadra. Vistas renomeadas: **Rosto · Corpo inteiro · Frente · Lado · Costas**,
na base do 3D, centralizadas; luz, captura e desempenho no canto superior direito.

### Topo
Marca · nome do personagem editável no próprio topo · desfazer/refazer ·
"Sortear" (abre opções do que manter) · Personagens · Exportar.

### Rodapé
Status e a dica do mouse/teclado da ferramenta ativa (Blender) · botão "Atalhos (?)".
FPS e triângulos saem do rodapé e ficam no painel Desempenho.

### Sobre o 3D
- Cartão da ferramenta (canto superior esquerdo): nome, tecla e só as opções dela.
- Indicador de trabalho ("Gerando · etapa…") no topo central do 3D enquanto houver operação.

### Trilho de ferramentas
Só ícones (pedido do usuário: "ícones, não texto"); nome e tecla no tooltip e no
cabeçalho do cartão da ferramenta; grupos separados por uma linha fina, sem títulos.
Ferramentas que não valem para a peça atual somem (o motivo fica no tooltip do trilho).

### Painéis
- **Pessoa**: Sexo, Idade, Altura, Pele (cor com nome + acabamento), Ancestralidade. Sortear com "Manter" em chips marcáveis.
- **Corpo**: Moldar (botão grande no topo, com instrução); Proporções com pontas nomeadas e valor em %; Busto; "Ajustes detalhados" com busca e "Só alterados".
- **Rosto**: Moldar; Formato; Olhos; Expressão (prévia, vinda de Animação); Sobrancelhas; Cílios; Ajustes detalhados com busca; "Expressão: ajuste fino" com nomes em português.
- **Cabelo**: 1 Cabelo pronto (base) · 2 Mechas (galeria) · Cor · Montar com peças · Ajustar mechas (principais) + "Mais ajustes das mechas" · Guia · Movimento · Arquivo.
- **Roupas**: galeria de conjuntos com ícone; Sob medida: lista de peças com nome e botões com texto; "Como a peça é feita" (corte no corpo / moldes) como opção avançada; Tecido; Moldes 2D recolhido.
- **Pose e animação**: Reproduzir (tocar/pausar, movimento, velocidade) · Posar · Jeito de ficar em pé · Linha do tempo.
- **Esculpir**: alvo em linguagem clara; "Apagar toda a escultura" com confirmação.

### Estados
- Vazio: penteado sem mechas, nenhuma peça, nenhum personagem salvo — frase que diz o próximo passo.
- Carregando: indicador sobre o 3D + rodapé; painel de cabelo "Preparando…".
- Erro: painel de erro existente, com ações; avisos em vermelho.
- Desfazer: avisos de ações grandes (sortear, novo personagem, apagar) trazem botão "Desfazer".

## 4. Etapas

| Etapa | Conteúdo | Arquivos |
|---|---|---|
| 1 | Estrutura: trilho numerado, câmera por seção, vistas renomeadas, rodapé sem FPS, dica no rodapé, indicador de trabalho no 3D, atalhos 1–7 e "?" | index.html, styles.css, ui.mjs, ui-kit.mjs |
| 2 | Trilho de ferramentas com nomes e teclas; cartão sem cobrir as vistas; contraste e alvos | ui-kit.mjs, styles.css |
| 3 | Pessoa/Corpo/Rosto: sliders com pontas nomeadas, Moldar no topo, ajustes com busca, expressão no Rosto | ui.mjs, ui-kit.mjs |
| 4 | Cabelo: hierarquia base → mechas → ajustes, mais ajustes recolhidos | ui.mjs |
| 5 | Roupas: galeria, peças com rótulo, avançado recolhido | ui.mjs |
| 6 | Pose e animação: tocar/pausar, nomes claros, ARKit em português; Esculpir | ui.mjs |
| 7 | Exportar e Personagens: opções sem corte, explicações, avisos com Desfazer | ui.mjs, styles.css |

Cada etapa é usada no navegador antes do commit.

## 5. Revisão depois do retorno do usuário (mesmo dia)

O usuário viu a primeira versão e pediu: menos texto, menos espaço, ícones onde a
escolha é visual, rótulo ao lado do controle, nada cortado, mudança visível de
identidade e de cena. Regras adotadas em todos os módulos:

| Regra | Como ficou |
|---|---|
| Uma linha por controle | Slider = rótulo curto, trilha, valor discreto (caixa só ao passar o mouse); pontas dos sliders no tooltip e no `aria-valuetext`; pares esquerda/direita numa linha (E, D) |
| Sem texto explicativo | Nenhum parágrafo nos painéis; explicação no tooltip; só estados vazios de uma linha |
| Ícones onde a escolha é visual | Expressões (12 rostos), sobrancelhas, tipos de corpo, fases da vida, ferramentas, ações (barra de ícones com tooltip) |
| Um nível aberto por vez | Grupos em acordeão; o técnico de cada módulo num único "Avançado" no fim |
| Identidade nova | Palco de estúdio com degradê radial e disco no chão (sem grade); painéis como cartões de vidro sobre a cena; acento violeta; o centro da câmera no meio da área livre (`setViewOffset`) |

Fontes desta revisão: Material Components, tema escuro (superfícies cinza-escuro,
elevação mais clara); three.js `Fog` e `PerspectiveCamera.setViewOffset` (código em
`node_modules/three`); WAI-ARIA APG Slider (`aria-valuetext`); NN/g, divulgação
progressiva.
