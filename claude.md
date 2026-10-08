# CLAUDE.md — Criador de personagens 3D

@docs/PROJETO.md

## REGRAS DE TRABALHO

Regras de processo ficam só neste arquivo. A descrição técnica do projeto
(stack, versões, mapa de arquivos, fluxo de criação de um personagem) fica em
`docs/PROJETO.md`, importado acima; mantenha-o atualizado quando a estrutura
mudar.

### 1. Pesquisa na internet antes de cada arquivo editado

- Antes de editar um arquivo do projeto, leia com WebFetch a documentação ou
  especificação das técnicas usadas NAQUELE arquivo, para as versões
  instaladas. Pesquisa feita para outro arquivo não vale.
- O hook `.claude/hooks/research-gate.mjs` aplica esta regra: bloqueia a
  primeira edição de cada arquivo enquanto nenhuma página tiver sido lida com
  WebFetch desde o último arquivo liberado, e bloqueia escrita de arquivos pelo
  terminal. Quando ele bloquear, faça a leitura pertinente; não tente contornar.
- Imediatamente antes de editar, poste este bloco:

```
[EVIDÊNCIA]
Arquivo: caminho:linhas
Código atual: (o que o código faz hoje)
Fonte lida nesta etapa: URL
O que a fonte diz: (resumo em suas palavras)
Divergência: (por que o código atual está errado à luz da fonte)
Correção que vou aplicar: ...
```

- Memória e conhecimento prévio não são fonte. Se divergirem da documentação,
  vale a documentação. Em dúvida sobre uma biblioteca, leia o código-fonte dela
  em `node_modules`.
- Após duas tentativas sem sucesso no mesmo problema, faça uma nova pesquisa
  (pelo erro exato, quando houver) antes da terceira.
- Sem acesso à internet: pare e diga. Nunca invente URL nem afirme ter
  pesquisado sem ter feito.
- Fontes preferidas: especificação glTF 2.0 e glTF Validator (Khronos);
  documentação e código-fonte do three.js (SkinnedMesh, Skeleton, Bone, morph
  targets, GLTFLoader, GLTFExporter, SkeletonUtils); especificação VRM;
  documentação de rig humanoide e importação de personagens do Unity, Unreal e
  Godot; manual do Blender (pesos, transferência de dados, Surface Deform);
  MakeHuman e MPFB (proxies de roupa e cabelo); GDC e post-mortems sobre
  personagens, roupas e cabelo em jogos.

### 2. Seguir o fluxo pelo código

Diagnóstico e verificação se fazem lendo o código, não rodando o app.

- Parta do ponto de entrada e siga o caminho de criação de um personagem:
  parâmetro alterado na interface → malha base → morphs → esqueleto → pesos →
  roupas → cabelo → materiais → desenho → exportação. Abra a definição de cada
  função chamada; não presuma o que ela faz pelo nome.
- Busca por palavra-chave serve para localizar, nunca para concluir. Não
  conclua nada sobre uma função cuja definição você não abriu.
- Antes de corrigir, poste o mapa do fluxo analisado, uma linha por etapa:
  `etapa → arquivo:linha → o que executa → dados que entram e saem → custo`.
- Depois de corrigir, refaça o trecho do mapa afetado mostrando como ficou.

### 3. O entregável é código alterado e técnica correta

- Aplique as correções. Não entregue lista de sugestões e não pergunte se deve
  aplicar. Pergunte apenas se a mudança alterar como o app funciona para o
  usuário ou remover um recurso.
- Corrigir é aplicar a técnica fundamentada na fonte, não esconder o defeito.
  Proibido: inflar a roupa com escala ou deslocamento para disfarçar
  atravessamento, prender peças em ossos com cópia de posição a cada frame em
  vez de skinning, duplicar esqueletos, ajustar números até "parecer certo".
- Um sistema substituído só conta quando o novo está funcionando no app.
  Preparação (documentos, refatorações, pontos de encaixe) não é entrega.

### 4. Sem ciclos de teste e sem navegador

- Não rode o app, testes, benchmarks ou scripts de sondagem, e não abra
  navegador, a menos que o usuário peça.
- Ao terminar: typecheck e build do projeto (scripts em `package.json`), uma
  vez. Se falhar, corrija e rode de novo só o que falhou.
- Se existir um caminho de exportação por linha de comando, exporte um
  personagem com roupa e cabelo e passe o arquivo pelo glTF Validator, uma vez,
  no final. Se não existir, diga ao usuário como exportar e validar.
- Para o que só se confere vendo, entregue ao usuário a lista exata de poses e
  situações a olhar; ele confere.
- Nada de subagentes, a menos que o usuário peça.

### 5. O relato do usuário é o dado

- Defeito relatado pelo usuário é fato. Não conteste com medições feitas aqui.
- Nunca responda "não identifiquei o problema". Responda com o que encontrou no
  código e o que corrigiu.

### 6. Relatório final

Sempre que arquivos forem alterados, a resposta termina com a tabela
`Problema | Arquivo:linha | Correção | URL da fonte`, uma linha por arquivo, e
diz o que está ATIVO no app e o que não está. Um hook de parada cobra a tabela
se ela faltar.

### 7. Git e estado

- Faça commit após cada etapa concluída, adicionando caminhos explícitos ao
  stage, nunca alterações de outra pessoa. Sem worktrees. Nunca use
  force-push.
- Estado do trabalho (o que está ativo e o que falta) fica em `docs/STATUS.md`.

## O QUE PRECISA ESTAR CERTO NUM PERSONAGEM

Cada item abaixo é uma exigência a confirmar na especificação ou documentação
antes de implementar; os detalhes (limites, convenções) vêm da fonte, não da
memória.

### Esqueleto e pesos
- Um único esqueleto por personagem. Corpo, roupas e cabelo são deformados por
  ele: mesmos ossos, mesma pose de ligação.
- Hierarquia, nomes de ossos, pose de ligação (T ou A) e orientação dos eixos
  compatíveis com os motores e formatos de destino declarados em
  `docs/PROJETO.md`.
- Cada vértice tem no máximo o número de influências que o formato e o
  renderizador suportam, com pesos que somam 1; nenhum vértice fica sem peso.
- Quando a forma do corpo muda (altura, peso, proporções), as articulações
  acompanham e a pose de ligação e as matrizes inversas são recalculadas.
  Esqueleto fixo sobre corpo alterado é defeito.

### Corpo e morphs
- Morphs aplicados à mesma topologia, com contagem de vértices consistente
  entre malha, morphs, pesos e roupas que dependem dela.
- Normais atualizadas quando a forma muda.

### Roupas
- A roupa se ajusta ao corpo atual e acompanha qualquer mudança de forma.
- Pesos da roupa vêm do corpo, pela técnica escolhida e fundamentada.
- Partes do corpo cobertas não atravessam a roupa, pela técnica escolhida e
  fundamentada (por exemplo, ocultar a região coberta).
- Camadas sobrepostas (camisa sob casaco) em ordem, sem atravessar umas às
  outras.

### Cabelo
- Técnica adequada a jogos em tempo real, escolhida com base em fonte.
- Deformado pelo esqueleto da cabeça, acompanhando a forma da cabeça.
- Transparência sem erros de ordenação nem bordas serrilhadas, pela técnica
  documentada para o renderizador usado.

### Exportação
- Arquivo válido segundo a especificação e o validador oficial.
- Escala, eixos, nomes de ossos e materiais compatíveis com os destinos.
- Orçamento de triângulos, ossos, materiais e texturas adequado a jogos,
  declarado em `docs/PROJETO.md`.
