# Estado do trabalho

Plano em execução: correção de rig, roupas, cabelo, materiais e exportação (aprovado em 2026-10-08).

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
| 8 | Exportação válida e validação Khronos | pendente |

## Ativo no app

- Editor de mechas: a gravidade contínua trata mecha‑mecha por campo de densidade (atrito e repulsão, Müller et al. 2012 §3.5); só pausa por violação de corpo/roupa (> 1 mm), estiramento (> 1 %) ou contato inviável com o corpo.
- Esqueleto: ossos orientados pela cabeça→cauda + roll do rig MPFB (+Y ao longo do osso); clipes convertidos para esse repouso; pesos de todas as malhas saneados (4 influências, soma 1, índice 0 onde peso 0); GLB exportado sempre na pose de ligação; `auditCharacter` disponível.
- Corpo: juntas acompanham a escultura do corpo (anel de pele em volta de cada junta); os 32 blendshapes levam também deslocamento de normal.
- Roupas: peças cortadas do corpo mantêm os pesos da pele de origem; moldes 2D pegam pesos só da pele da própria região (saias: pelve/coxas); roupa pronta sem escala extra; roupa infantil esconde a pele coberta.
- Cabelo: trecho apoiado na cabeça com os pesos da pele de cabeça/pescoço; trecho livre de mechas longas em até 12 cadeias de juntas `hair_NN_J` filhas de `head` no mesmo esqueleto; mola VRMC_springBone na prévia (colisores cabeça, pescoço, peito, clavículas, braços); cabelo em casca (API) sem transparência ordenada.
- Materiais: tinta da pele e cor das roupas prontas assadas na textura em espaço linear (fatores e cores de vértice ≤ 1); rugosidade de cada peça sob medida no seu próprio material.
