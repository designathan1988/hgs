# Estado do trabalho

Atualizado em 2026-10-09, depois de usar o app no navegador item por item.
Detalhe de cada pedido e da evidência: [AUDITORIA.md](AUDITORIA.md).
Etapas em andamento: [PLANO.md](PLANO.md).

## Ativo no app e conferido em uso

- Abertura: 1,8 s com cache de construção (IndexedDB); pessoa nova com roupa pronta em ~4,4 s.
- Corpo: sliders ao vivo (forma, esqueleto e roupas acompanham durante o arrasto), refino ao soltar.
- Roupas prontas (Casual, Esporte fino, Social, Trabalho) e sapatos: vestem e animam sem defeito visível.
- Animação: 16 clipes; pose T, poses prontas; linha do tempo com chaves que tocam interpoladas.
- Cabelo no personagem final: segue a cabeça e balança por cadeias de mola (VRMC_springBone).
- Exportação: GLB e Pacote LOD; glTF Validator 0 erros e 0 avisos (LOD0 40.039, LOD1 23.321, LOD2 6.239 triângulos).
- Navegação: roda faz zoom no cursor, botão do meio move, botão direito gira no ponto sob o cursor.
- Editor de cabelo atual (`hair-editor.mjs`, desde `188601c`): Pincel, Preencher, Retocar, Volume, Cortar, Apagar, Selecionar; peças prontas; cartões com textura de fios.

## Com defeito (a corrigir, ver PLANO.md)

- Posar: arrastar a esfera de IK gira a câmera.
- Boca: dentes e gengiva aparecem entre os lábios fechados.
- Esculpir: corpo facetado durante o traço; a escultura salva é bem menor que a vista.
- Moldar: puxar o nariz pega "olhos".
- Cabelo: tesoura corta só a mecha da frente sob o cursor; ferramentas não começam fora do cabelo; risca aberta no Chanel; sem gravidade, fixar, prender, curvar, torcer, pente e linha central (removidos em `188601c`).
- Roupa sob medida: colada sem folga; com folga ou por moldes, ombro e manga rasgam; camiseta sobre camiseta rasga.
- Cílios: 35% dos folículos fora da borda da pálpebra (teste).
- Corpo exportado sem soldar vértices (53.512 vértices para 15.692 triângulos).

## Não existe

- Barba, maquiagem, tatuagem, acessórios (óculos, brincos, chapéus).
- Trilha de animação com chaves visíveis; trilha facial própria.
