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

## Ativo no app

- Editor de mechas, painel: grupos Penteado, Ferramentas (Criar · Dar forma · Selecionar e mover; Volume só na representação Volume) com as opções só da ferramenta ativa, Ajustar mechas, Gravidade, Representação, Exibição, Arquivo.
- Pentear: como um pente real — agarra cada mecha tocada (raiz, meio ou ponta) num dente que acompanha o cursor e puxa a mecha inteira; se ela não alcança, o pente desliza para a ponta e a solta lá; nunca estica (FABRIK até o dente, FTL depois). Alcance Pincel, Selecionadas ou Todo o cabelo.
- Prender: Elástico (junta a seleção ou o círculo num feixe de raio ½·√Σespessura²), Grampo (prende rente à cabeça as mechas sob o clique), Fivela (junta encostado na cabeça), Arco/Tiara (de orelha a orelha, prende quem passa por baixo), Gel (fixa a forma; aspecto molhado no editor), Pino. Cada prendedor segura um ponto por mecha (pino com `holder`), é salvo com o penteado (`accessories`), aparece no personagem final e no GLB (malha `HairAccessories`, osso `head`) e tem "×" na lista.
- Preencher: raízes numa rede de Fibonacci da cabeça (espaçamento = Distância entre mechas), plantadas onde o círculo passa; forma pela direção e comprimento médios das vizinhas que já existiam (Add do Blender), senão penteada para o lado e para trás. Adensar respeita a "Distância entre mechas" (Distance Min do Blender).
- Seleção por pintura (Shift soma, Ctrl tira). "Criação guiada" só na guia inicial.
- Interface (todas as guias): sliders numa linha (legenda | barra | valor); escolhas na linha do rótulo, em ícones onde a opção é visual (pontas, forma, alcance, representação); paletas de ferramentas só com ícones e o nome da ferramenta ativa como título; ações em linhas de ícones com nome no tooltip; chaves com legendas curtas.
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

- Testes automáticos: na revisão do modo cabelo (pedido do usuário) rodaram `tests/hair-dynamics.test.mjs`, `tests/hair-interaction.test.mjs` e `tests/locks.test.mjs`: 30 de 30 passam. Os demais não foram executados.
- Gravidade do editor: o worker leva ~10–12 ms por subpasso com 63 mechas; acima disso a simulação fica mais lenta que o tempo real (sem acumular atraso).
- A conferência visual (lista no fim do relatório da sessão) é do usuário.
- Olhos com 32.640 triângulos (subdivisão dupla do globo para a íris por cor de vértice): fora do escopo deste plano; candidato a revisão de orçamento.
- O validador não verifica as imagens (o GLB do Node não tem texturas); cores e texturas são conferidas no navegador.
