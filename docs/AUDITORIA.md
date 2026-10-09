# Auditoria: pedidos do usuário × app real (2026-10-09)

Fontes dos pedidos: conversas de 06–07/10 e 08–09/10 (transcrições), planos
`precious-cosmos`, `lovely-pixel`, `vast-hartmanis`, exigências do `CLAUDE.md`,
e a lista que o usuário pontuou em 09/10.
Cada item foi conferido usando o app no navegador, com o mouse, e examinando
capturas de perto. Suíte: 83 testes, 79 passam, 4 falham.

Legenda: OK · PARCIAL · FALHA · AUSENTE

## Pontuado pelo usuário em 09/10 (a lista não se restringe a isto)

| # | Pedido | Usuário | Conferido no app |
|---|---|---|---|
| P1 | Interface redesenhada com foco em usabilidade e design | NÃO CUMPRIDO | FALHA: ver G6 |
| P2 | Cabelo totalmente funcional, bom visual, ferramentas para qualquer penteado, física | NÃO CUMPRIDO | FALHA: ver H1–H12 |
| P3 | Roupas personalizadas | NÃO CUMPRIDO | FALHA: ver C1–C3 |
| P4 | Rig para mexer livremente sem quebrar; animação de corpo e facial | NÃO CUMPRIDO | FALHA: ver A1–A3 |
| P5 | Otimização para jogos, LOD | NÃO CUMPRIDO | PARCIAL: ver G3–G4 |
| P6 | Corpo e rosto para criar qualquer pessoa | NÃO CUMPRIDO | PARCIAL: ver B1–B2 |
| P7 | Sobrancelhas, cílios, barba, tatuagem, maquiagem, acessórios | NÃO CUMPRIDO | PARCIAL: sobrancelhas e cílios existem; barba, tatuagem, maquiagem e acessórios (óculos, brincos, chapéus) não existem no código |

## Cabelo

| # | Pedido | Estado | Evidência |
|---|---|---|---|
| H1 | Puxar uma mecha do couro cabeludo, raiz presa | PARCIAL | Pincel cria 5 mechas por traço (3 + espelho); não há "puxar" uma mecha existente |
| H2 | Alongar, encurtar, engrossar, afinar, curvar, enrolar, torcer, cortar, prender/soltar | FALHA | Curvar, torcer, prender/soltar e mover raiz foram removidos em `188601c`. Tesoura: um traço sobre o Longo cortou 2 de 63 mechas (média 30,5 → 30,1 cm), só a mecha da frente sob o cursor; começando fora do cabelo, não corta nada (`hair-editor.mjs:527`) |
| H3 | Gravidade que assenta, colide, não estica, não oscila | AUSENTE | O editor não tem gravidade desde `188601c` ("sem física ao vivo") |
| H4 | Pausar, ajustar, fixar a forma | AUSENTE | Sem "Fixar forma" no painel |
| H5 | Largura, volume, afunilar | OK | Controles em Ajustar mechas |
| H6 | Desfazer/refazer, apagar, salvar/carregar | PARCIAL | Existem; não reconferidos em todos os caminhos |
| H7 | Bonito de vários ângulos | FALHA | Longo no editor: ralo, couro aparecendo; Chanel: risca aberta em zigue-zague com pele na frente (frente e ¾) |
| H8 | Sem Groom; estilos prontos | OK | 7 estilos e 9 peças |
| H9 | Alongar separado; pente; seleção fácil; prender no ar | FALHA | Pente e prender removidos; alongar só via Retocar |
| H10 | Sem vão no topo; linha central com espelho; mover mecha; fixar para cima; gravidade liga/desliga | FALHA | Vão voltou no Chanel; linha central, mover, fixar e gravidade removidos |
| H11 | Fácil, preciso, rápido; mechas não se atravessam | FALHA | Ferramentas exigem começar em cima da mecha; o traço do pincel pendeu sobre o olho |
| H12 | Acompanha cabeça e esqueleto; balanço | OK | Personagem andando: cabelo segue a cabeça; 6 cadeias de mola |
| H13 | Cabelos de malha feitos por artista (13 CC0 no projeto) | NÃO USADOS | `long01` montado pela API ficou com cobertura cheia e natural; a interface não oferece |

## Navegação

| # | Pedido | Estado | Evidência |
|---|---|---|---|
| N1 | Roda: zoom no cursor; meio: mover; direito: girar no ponto | OK | Dica na tela e código (`main.mjs:20-97`) |

## Roupas

| # | Pedido | Estado | Evidência |
|---|---|---|---|
| C1 | Criar roupas: tipos, bordas, pintar, desfazer, salvar | PARCIAL | Existe; o painel Moldes 2D expõe dezenas de controles técnicos (Bézier, pences, rotação X/Y/Z, elasticidade…) |
| C2 | Caimento solto, sem rasgar, galeria, tecidos | FALHA | Corte no corpo com Folga 0,30: colada como pintura (marca os seios). Folga 1,00: ombro rasgado em pontas e afundamento sob o busto. Moldes 2D: costura do ombro e da manga aberta mesmo com uma camiseta só; camiseta sobre camiseta rasga em tiras. Sem galeria visual nem tecidos (algodão, jeans…) |
| C3 | Acompanha corpo e animação | PARCIAL | Roupas prontas animam bem; teste `clothing` falha: "tshirt: 2 pontos dentro da pele" |

## Corpo, rosto, esculpir

| # | Pedido | Estado | Evidência |
|---|---|---|---|
| B1 | Corpo: proporções, ajustes, Moldar | PARCIAL | Sliders ao vivo funcionam; Moldar no rosto puxando o nariz escolheu "Olhos · epicanto" e o nariz não mudou |
| B2 | Rosto e boca sem defeitos | FALHA | Com a boca fechada, os dentes (faixa branca) e a gengiva/língua (vermelho) aparecem entre os lábios nos cantos, em qualquer corpo e sem expressão; a malha dos dentes é recuada por números fixos (`face-mesh.mjs:22`) e o modo ao vivo sobrescreve com a posição crua |
| B3 | Esculpir | FALHA | Durante o traço o corpo inteiro fica facetado (normais não refeitas); o traço vira degrau duro; depois da reconstrução a escultura quase some (38 vértices, ≤ 5 mm) — o que se vê ao esculpir não é o que fica salvo |

## Rig, animação, expressões

| # | Pedido | Estado | Evidência |
|---|---|---|---|
| A1 | Pegar o boneco e posar livremente | FALHA | Arrastar a esfera laranja (a dica manda) gira a câmera; a esfera só é pega com um clique parado e depois arrastando a seta do gizmo (`main.mjs:102`, `pose.mjs:151`). Pose T funciona |
| A2 | Animar: linha do tempo | PARCIAL | Duas chaves (T → Acenando) tocam interpoladas; não há trilha com as chaves visíveis nem edição de curva |
| A3 | Expressões / animação facial | PARCIAL | 12 humores e ajuste fino por grupo; a chave grava a expressão atual; sem trilha facial própria |

## Jogo: desempenho, LOD, exportação, estado

| # | Pedido | Estado | Evidência |
|---|---|---|---|
| G1 | Abre rápido mostrando o boneco | OK com cache | 1,8 s com cache; pessoa nova 4,4 s (roupa pronta) |
| G2 | Rápido; edição ao vivo | PARCIAL | Desenho 0,22 ms por quadro; slider de corpo ao vivo; roupa sob medida 1,5–7 s por ajuste |
| G3 | LOD com qualidade; orçamento | PARCIAL | LOD0 40.039 / LOD1 23.321 / LOD2 6.239 triângulos; corpo exportado com 53.512 vértices para 15.692 triângulos (cantos não soldados) |
| G4 | GLB válido | OK | glTF Validator: 0 erros, 0 avisos nos três níveis |
| G5 | Estado global, desfazer único | PARCIAL | Store existe; desfazer funcionou em Corpo e Esculpir |
| G6 | Interface fácil, intuitiva, leve | FALHA | Ferramentas só com ícones; dicas que não batem com o comportamento (Posar); Moldes 2D com dezenas de controles técnicos; FPS e triângulos na barra |

## Defeitos encontrados fora da lista

| # | Defeito | Onde | Evidência |
|---|---|---|---|
| D1 | Teste de íris desatualizado (olho agora usa textura) | `tests/appearance.test.mjs:16` | falha |
| D2 | Normalização arredonda ancestralidade para 0,333 e o teste espera 1/3 | `tests/state.test.mjs:24` | falha |
| D3 | Cílios: 65% dos folículos na borda (teste pede > 90%) | `tests/groom-placement.test.mjs:25` | falha |
| D4 | Alterações sem dono em 9 arquivos (cache IndexedDB, folga, autocolisão, servidor) | working tree | `git status` |
| D5 | `STATUS.md` descreve o editor de mechas removido | `docs/STATUS.md` | comparação com o código |
| D6 | Nome não muda ao gerar outra pessoa | Personagem | "Maya Chen" com outro corpo, idade e pele |
