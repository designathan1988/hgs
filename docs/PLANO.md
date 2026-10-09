# Plano de conclusão (2026-10-09)

Base: [AUDITORIA.md](AUDITORIA.md). Regra de entrega: uma etapa só conta como
feita depois de usada no app com o mouse, conferida em capturas de perto e de
vários ângulos, com os testes da área passando. Commit na `main` ao fim de cada
etapa. O que já funciona não é substituído; o que quebra é corrigido no lugar.

| Etapa | O quê | Itens da auditoria |
|---|---|---|
| 0 | Assumir as alterações sem dono (cache, servidor, folga, autocolisão), corrigir os 4 testes, `STATUS.md` verdadeiro | D1–D5 |
| 1 | Posar: arrastar a esfera move mão e pé direto (IK), girar osso direto pelo anel; boneco sem quebrar | A1 |
| 2 | Boca: dentes e língua dentro da boca fechada, em qualquer corpo e no modo ao vivo | B2 |
| 3 | Esculpir: o que se vê no traço é o que fica salvo; sombreamento liso durante o traço; pincel com queda suave | B3 |
| 4 | Moldar: pegar a parte certa (nariz puxa nariz) | B1 |
| 5 | Cabelo, ferramentas: tesoura corta tudo que o traço cruza; ferramentas começam fora do cabelo; pente; gravidade de um passo (já existe em `locks.mjs`) com Aplicar/Fixar; curvar, enrolar, torcer; prender | H2–H4, H9–H11 |
| 6 | Cabelo, visual: risca sem vão; cobertura cheia nos estilos; cabelos de malha CC0 como estilos prontos | H7, H10, H13 |
| 7 | Roupas: costura e ombro sem rasgar com folga e com moldes; camada sobre camada; tecidos; painel simples com o avançado recolhido | C1–C3 |
| 8 | Itens novos: barba, maquiagem, tatuagem, acessórios (óculos, brincos, chapéus) | P7 |
| 9 | Animação: trilha com chaves visíveis, chaves faciais | A2–A3 |
| 10 | Interface: nomes nas ferramentas, dicas corretas, avançado recolhido, barra sem números de depuração | G6, P1 |
| 11 | Exportação: soldar vértices do corpo; conferir LOD visualmente | G3 |

Cada etapa começa pela leitura da fonte técnica e do código envolvido, e
termina com o registro em `STATUS.md` do que está ativo no app.
