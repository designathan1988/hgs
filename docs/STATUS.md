# Estado do trabalho

Plano em execução: correção de rig, roupas, cabelo, materiais e exportação (aprovado em 2026-10-08).

| Passo | Conteúdo | Estado |
| --- | --- | --- |
| 0 | Commit-base do trabalho anterior na `main` | feito (`8bafd25`) |
| 1 | `docs/PROJETO.md` e este arquivo | feito |
| 2 | Gravidade do editor com campo de densidade | feito |
| 3 | Esqueleto orientado, pesos saneados, exportação na pose de ligação | pendente |
| 4 | Juntas seguem a escultura; blendshapes com normais | pendente |
| 5 | Roupas com pesos da pele de origem/região; pele coberta escondida | pendente |
| 6 | Cabelo com cadeias de juntas e mola | pendente |
| 7 | Materiais dentro da faixa do glTF | pendente |
| 8 | Exportação válida e validação Khronos | pendente |

## Ativo no app

- Editor de mechas: a gravidade contínua trata mecha‑mecha por campo de densidade (atrito e repulsão, Müller et al. 2012 §3.5); só pausa por violação de corpo/roupa (> 1 mm), estiramento (> 1 %) ou contato inviável com o corpo.
