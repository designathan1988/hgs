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

- Editor de mechas: a gravidade contínua trata mecha‑mecha por campo de densidade (atrito e repulsão, Müller et al. 2012 §3.5); só pausa por violação de corpo/roupa (> 1 mm), estiramento (> 1 %) ou contato inviável com o corpo.
- Esqueleto: ossos orientados pela cabeça→cauda + roll do rig MPFB (+Y ao longo do osso); clipes convertidos para esse repouso; pesos de todas as malhas saneados (4 influências, soma 1, índice 0 onde peso 0); `auditCharacter` disponível.
- Corpo: juntas acompanham a escultura do corpo (anel de pele em volta de cada junta); os 32 blendshapes levam também deslocamento de normal.
- Roupas: peças cortadas do corpo mantêm os pesos da pele de origem; moldes 2D pegam pesos só da pele da própria região (saias: pelve/coxas); roupa pronta sem escala extra; roupa infantil esconde a pele coberta.
- Cabelo: trecho apoiado na cabeça com os pesos da pele de cabeça/pescoço; trecho livre de mechas longas em até 12 cadeias de juntas `hair_NN_J` filhas de `head` no mesmo esqueleto; mola VRMC_springBone na prévia (colisores cabeça, pescoço, peito, clavículas, braços); vértices limitados pelo orçamento do nível (30k/15k/3k); cabelo em casca (API) sem transparência ordenada.
- Materiais: tinta da pele e cor das roupas prontas assadas na textura em espaço linear (fatores e cores de vértice ≤ 1); rugosidade de cada peça sob medida no seu próprio material.
- Exportação: ossos na pose de ligação; sem `userData` no arquivo; malhas com skin na raiz da cena; com "otimizar", duas malhas (`Body`, `Head` com 32 alvos de posição e normal); extensão `VRMC_springBone`; texturas até 2048 px.
- Validação: `npm run export:glb` — última execução: glTF Validator 0 erros, 0 avisos (informações: extensão VRMC desconhecida pelo validador; UVs sem textura no Node); auditoria sem problemas; 83 ossos (30 de cabelo); cabelo 29.547 vértices; 10 chamadas de desenho.

## Não ativo / pendente

- Testes automáticos não foram executados (regra do projeto). Foram ajustados ao novo contrato: `tests/hair-dynamics.test.mjs`, `tests/hair-interaction.test.mjs`, `tests/human-three.test.mjs`.
- A conferência visual (lista no fim do relatório da sessão) é do usuário.
- Olhos com 32.640 triângulos (subdivisão dupla do globo para a íris por cor de vértice): fora do escopo deste plano; candidato a revisão de orçamento.
- O validador não verifica as imagens (o GLB do Node não tem texturas); cores e texturas são conferidas no navegador.
