# CLAUDE.md — People

## REGRA INVIOLÁVEL: PESQUISA OBRIGATÓRIA NA INTERNET

Esta regra vale para TODO o projeto, incluindo o construtor de modelos humanos
3D, sem exceção por simplicidade, urgência ou conhecimento prévio.

1. **Antes de implementar qualquer coisa:** pesquise na internet sobre a tarefa
   e a abordagem pretendida ANTES de escrever ou alterar código. Isso inclui
   funcionalidades, correções, ajustes e refatorações. Memória, conhecimento
   prévio e arquivos locais não substituem a pesquisa na internet.
2. **Após duas tentativas sem sucesso no mesmo problema:** interrompa as
   alterações e faça uma NOVA pesquisa na internet ANTES de uma terceira
   tentativa, mesmo que já tenha pesquisado antes da implementação. Considere
   sem sucesso uma tentativa cuja verificação relevante falhou ou não confirmou
   a solução. Trocar comando, ferramenta ou abordagem não zera essa contagem.
3. **Pesquisa real e pertinente:** use a ferramenta de busca/navegação disponível,
   abra e leia as fontes relevantes; priorize documentação oficial, código-fonte
   oficial e issues dos mantenedores. Busque pelo erro exato, quando houver,
   e confira a compatibilidade com as versões usadas no projeto.
4. **Antes de alterar código:** informe o que encontrou, com links das fontes,
   e explique a abordagem escolhida. Após duas falhas, explique também o que a
   nova pesquisa revelou e qual hipótese será testada; não repita a mesma
   abordagem sem evidência nova.
5. **Sem acesso à internet ou sem evidência suficiente:** pare e reporte o
   impedimento. Não invente fontes, não afirme ter pesquisado sem fazê-lo e não
   prossiga com implementação baseada apenas em suposições.

Pesquisar não autoriza ampliar o escopo, contornar restrições nem substituir a
verificação local. NÃO HÁ NEGOCIAÇÃO PARA ESTA REGRA.

## REGRA INVIOLÁVEL: CONFERIR O RESULTADO VISUAL, NUNCA SUPOR

Sempre que criar ou alterar algo visual — interface, layout, estilos, imagens,
modelos 3D, materiais, iluminação, câmera, renderização ou animações — você DEVE
conferir o resultado real antes de considerar a tarefa concluída.

1. **Abra e observe o resultado:** execute a aplicação ou renderize o artefato
   no ambiente relevante e confira os estados afetados pela mudança. Capture
   imagens e ABRA essas imagens para examiná-las; apenas gerar uma captura
   não é conferir. Para movimento ou animação, observe a execução ao longo do
   tempo; uma imagem estática não comprova o comportamento.
2. **Compare com o pedido:** confira se o resultado visível atende aos requisitos,
   incluindo aparência, posicionamento, proporções e comportamento pertinentes.
   Não suponha que ficou correto com base no código, em logs, na ausência de
   erros ou em testes automatizados aprovados.
3. **Corrija e confira novamente:** se encontrar um defeito visual, corrija-o
   dentro do escopo e repita a inspeção do resultado atualizado. As regras de
   pesquisa obrigatória na internet continuam valendo.
4. **Reporte com evidência:** apresente as capturas ou a evidência visual
   examinada e diga o que conferiu. Se não conseguir abrir, renderizar ou
   inspecionar o resultado, declare **NÃO VERIFICADO**, explique o impedimento
   e não afirme que a parte visual está correta ou concluída.

NÃO HÁ NEGOCIAÇÃO: resultado visual deve ser observado, nunca presumido.
