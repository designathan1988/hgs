# CLAUDE.md — Criador de personagens 3D

@docs/PROJETO.md

## ORDENS PRINCIPAIS (valem acima de qualquer outra regra)

1. **Pesquise na internet antes de implementar qualquer funcionalidade ou
   fazer qualquer mudança.** Sem exceção.
2. **Tentativa e erro é proibido.** Não chute código, números ou parâmetros
   para "ver se funciona". Toda mudança nasce de uma fonte lida.
3. **Abra a aplicação, tire foto de cada etapa, analise cada foto e
   verifique.**
4. **Nunca diga que algo está concluído, pronto, corrigido ou funcionando antes
   de entrar na aplicação, tirar as fotos, testar de verdade e ver os
   resultados.**

## REGRAS DE TRABALHO

Regras de processo ficam só neste arquivo. A descrição técnica do projeto
(stack, versões, mapa de arquivos, fluxo de criação de um personagem) fica em
`docs/PROJETO.md`, importado acima; mantenha-o atualizado quando a estrutura
mudar.

### 1. Pesquisa na internet antes de tudo

- Antes de implementar uma funcionalidade ou alterar qualquer arquivo, pesquise
  na internet (WebSearch) e **abra e leia** (WebFetch) a documentação oficial,
  a especificação ou o código-fonte das técnicas envolvidas, nas versões
  instaladas. Trecho de resultado de busca não conta como leitura.
- Quando houver, leia também como projetos maduros resolvem o mesmo problema.
- A pesquisa vale para o arquivo e o problema em questão. Pesquisa feita para
  outro arquivo ou outro problema não vale.
- Memória e conhecimento prévio não são fonte. Se divergirem da documentação,
  vale a documentação. Em dúvida sobre uma biblioteca, leia também o
  código-fonte dela em `node_modules`.
- **Tentativa e erro está proibido.** Se uma mudança não deu certo, não tente
  outra variação às cegas: pare, pesquise de novo (pelo erro exato, quando
  houver) e só então mude o código com base no que leu.
- Sem acesso à internet: pare e diga. Nunca invente URL nem afirme ter
  pesquisado sem ter feito.
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

- Fontes preferidas: especificação glTF 2.0 e glTF Validator (Khronos);
  documentação e código-fonte do three.js (SkinnedMesh, Skeleton, Bone, morph
  targets, GLTFLoader, GLTFExporter, SkeletonUtils); especificação VRM;
  documentação de rig humanoide e importação de personagens do Unity, Unreal e
  Godot; manual do Blender (pesos, transferência de dados, Surface Deform);
  MakeHuman e MPFB (proxies de roupa e cabelo); GDC e post-mortems sobre
  personagens, roupas e cabelo em jogos.

### 2. Seguir o fluxo pelo código

- Parta do ponto de entrada e siga o caminho de criação de um personagem:
  parâmetro alterado na interface → malha base → morphs → esqueleto → pesos →
  roupas → cabelo → materiais → desenho → exportação. Abra a definição de cada
  função chamada; não presuma o que ela faz pelo nome.
- Busca por palavra-chave serve para localizar, nunca para concluir. Não
  conclua nada sobre uma função cuja definição você não abriu.
- Antes de corrigir, poste o mapa do fluxo analisado, uma linha por etapa:
  `etapa → arquivo:linha → o que executa → dados que entram e saem → custo`.
- Depois de corrigir, refaça o trecho do mapa afetado mostrando como ficou.
- Ler o código não substitui abrir o app (seção 4).

### 3. O entregável é código alterado e técnica correta

- Aplique as correções. Não entregue lista de sugestões e não pergunte se deve
  aplicar. Pergunte apenas se a mudança alterar como o app funciona para o
  usuário ou remover um recurso.
- Corrigir é aplicar a técnica fundamentada na fonte, não esconder o defeito.
  Proibido: inflar a roupa com escala ou deslocamento para disfarçar
  atravessamento, prender peças em ossos com cópia de posição a cada frame em
  vez de skinning, duplicar esqueletos, ajustar números até "parecer certo".
- Um sistema substituído só conta quando o novo está funcionando no app,
  visto em foto. Preparação (documentos, refatorações, pontos de encaixe) não é
  entrega.

### 4. Abrir o app, fotografar e verificar — sempre

Nada está concluído sem esta seção cumprida.

- Abra a aplicação no navegador embutido: `preview_start` com o nome `people`
  (`.claude/launch.json`, `server.py` na porta 8765). Recarregue a página
  depois de cada mudança.
- Use o app como o usuário usaria: clique nos controles, mude parâmetros,
  troque roupas e cabelos, pose, anime, exporte. Teste várias entradas
  diferentes em sequência, não uma só.
- **Tire foto (screenshot) de todos os processos**: estado inicial, cada passo
  da interação e o resultado final de cada funcionalidade tocada.
- **Analise cada foto antes da próxima ação.** Procure o que o usuário veria de
  errado: malha atravessando, roupa ou cabelo fora do lugar, deformação
  estranha, texto cortado ou coberto, controle sumido, sobreposição,
  desalinhamento, idioma trocado. Cada defeito visto é corrigido (com nova
  pesquisa, seção 1) e fotografado de novo.
- Leia também o console (`read_console_messages`) e os logs do servidor; erro no
  console é defeito.
- Rode os testes automáticos (`npm test`) e `node --check` nos arquivos
  alterados. Testes verdes **não** substituem as fotos.
- Exporte um personagem com roupa e cabelo (`npm run export:glb`) e passe o
  arquivo pelo glTF Validator quando a mudança tocar o personagem ou a
  exportação.
- **Nunca diga "concluído", "pronto", "corrigido" ou "funciona"** sem ter
  entrado no app, tirado as fotos, testado de verdade e visto os resultados.
  No relatório, diga foto por foto o que foi conferido. Se for impossível
  olhar, diga isso com todas as letras e não declare a tarefa concluída.
- Nada de subagentes, a menos que o usuário peça.

### 5. O relato do usuário é o dado

- Defeito relatado pelo usuário é fato. Não conteste com medições feitas aqui.
- Nunca responda "não identifiquei o problema". Responda com o que encontrou no
  código e no app e o que corrigiu.

### 6. Relatório final

Sempre que arquivos forem alterados, a resposta termina com a tabela
`Problema | Arquivo:linha | Correção | URL da fonte`, uma linha por arquivo,
seguida do que foi visto nas fotos do app, e diz o que está ATIVO no app e o
que não está.

### 7. Git e estado

- Faça commit após cada etapa concluída (e verificada no app), adicionando
  caminhos explícitos ao stage, nunca alterações de outra pessoa. Sem
  worktrees. Nunca use force-push.
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
