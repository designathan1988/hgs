# Estado do trabalho

Atualizado em 2026-10-09, depois de usar o app no navegador item por item.
Detalhe de cada pedido e da evidência: [AUDITORIA.md](AUDITORIA.md).
Etapas em andamento: [PLANO.md](PLANO.md).

## Varredura geral de funcionamento (09/10, no app)

- Cabelo: os 7 penteados carregam (~1 s cada); rabo de cavalo, coque, fivela e arco prendem as mechas; o grampo prende as mechas escolhidas (sem seleção, o ponto padrão no lado da cabeça não pega mecha do Longo: aparece o aviso). Nuca do Curto sem placa preta (0bff940), conferida em mulher 1,72 m e 2,00 m e homem 1,55 m com cabelo preto, no editor e no personagem final.
- Roupa: 4 conjuntos prontos e as 23 peças sob medida vestem sem erro no console (1–4 s por peça). Moletom por moldes sobre camiseta não deixa a camiseta atravessar correndo (c530192). Roupa por moldes não espeta durante o arrasto de Peso de −100 % a 100 % (deddb3e).
- Rosto: 6 expressões aplicam. Posar: 7 poses prontas. Linha do tempo: 2 chaves gravadas e tocadas. Exportação pela interface: GLB (30 MB, 34 clipes, 113 juntas) e Pacote LOD (44.045 / 26.061 / 6.425 triângulos). `npm run export:glb`: validador 0 erros, 0 avisos.
- Rodada com 3 personagens sorteados (Aisha Okafor: homem magro 1,78 m, terno, andando; Leo Silva: mulher 46 anos 1,71 m, casual, sambando; Ari Chen: homem 1,73 m, Cacheado, sob medida, acenando): sem erros no console.
- Pendente desta varredura: capuz do moletom por moldes fica levantado e o cabelo longo passa por fora dele; nome sorteado não segue o sexo (Aisha em corpo masculino, Leo em corpo feminino); personagem de teste com 13 chamadas de desenho (orçamento 10).

## Ativo no app e conferido em uso

- Abertura: 1,8 s com cache de construção (IndexedDB); pessoa nova com roupa pronta em ~4,4 s.
- Corpo: sliders ao vivo (forma, esqueleto e roupas acompanham durante o arrasto), refino ao soltar.
- Roupas prontas (Casual, Esporte fino, Social, Trabalho) e sapatos: vestem e animam sem defeito visível.
- Roupa sob medida, "corte no corpo" (conferido em 09/10): casca lisa, sem rasgos com folga 0,3 e 1,0, sem vinco sob o busto. Moletom sobre camiseta sem atravessar, e anima andando. Construção de 0,3 a 0,5 s por peça.
- Moldes 2D (conferido): costuras soldadas e fechadas, mangas afuniladas, camiseta sobre camiseta sem rasgar (2–4 pontos de borda, contra 43 antes). Camiseta em molde em ~1,6 s.
- Galeria de peças com ícones (Dia a dia, Calçados, Carnaval), fantasias prontas Passista e Destaque, 10 tecidos PBR (algodão, jeans, malha, seda, cetim, couro, paetê, pedraria, lamê, tule), ajuste no 3D com Bordas e Cobrir/Descobrir, até 12 peças.
- Carnaval: biquíni, calcinha/tanga, maiô, braçadeiras, tornozeleiras, saia de franjas, costeiro e cabeça de plumas, coroa. Franjas e plumas balançam em molas (VRMC_springBone, mesmo esqueleto). GLB da Passista e da Destaque: 0 erros no glTF Validator.
- Calçados sob medida: tênis, botas e sandálias de tiras, com sola plana.
- Animação (conferido no app em 09/10): 33 clipes, 30 capturados do Microsoft Rocketbox (MIT, `assets/animations/`, atribuição em `LICENSE-Rocketbox.md`), variante masculina/feminina pelo sexo; Parado, Sambar e Desfilar procedurais. Pés a ±2 cm do chão (aterramento por quadro). Troca de clipe com transição de 0,3 s. Exportados no GLB (2,6 MiB de animação; validador 0 erros/0 avisos, também com nomes Mixamo).
- Posar: limites de junta, ângulos em graus por parte, esfera azul move o quadril, pinos de mãos e pés (agachar com pés presos), simetria, espelhar.
- Linha do tempo: trilhas Corpo e Rosto, chaves arrastáveis, curva suave/linear/degrau, repetir, copiar movimento capturado para a sua animação, chaves de expressão; exporta no GLB.
- Cabelo no personagem final: segue a cabeça e balança por cadeias de mola (VRMC_springBone).
- Exportação: GLB e Pacote LOD; glTF Validator 0 erros e 0 avisos (LOD0 40.039, LOD1 23.321, LOD2 6.239 triângulos).
- Navegação: roda faz zoom no cursor, botão do meio move, botão direito gira no ponto sob o cursor.
- Editor de cabelo atual (`hair-editor.mjs`, desde `188601c`): Pincel, Preencher, Retocar, Volume, Cortar, Apagar, Selecionar; peças prontas; cartões com textura de fios. Efeito de cor (ombré, luzes, raiz, pontas) e tipo de fio (1–4C), gel, frisado e tipo de mecha aparecem na hora no editor (conferido: ombré e 3B).
- Roupa sob medida com silhueta própria (conferido em 09/10, homem, mulher, corpo pesado, andando): calça de perna reta (retas coxa→joelho→barra, Müller & Sohn) e lisa na virilha; manga em tubo bíceps→punho; blusa que cai do busto (por dentro da calça, reta do busto ao cós); saia evasê com godês; tênis e botas com forma de sapato (sem dedos). Testes de roupa e moldes 26/26.
- Carnaval (conferido): alças frente-única que contornam a nuca; paetê costurado chato; cabeça de plumas em leque (auréola) com cartões cruzados; faixa rente à testa; saia de franjas em duas carreiras.
- Luz de ambiente (RoomEnvironment pela PMREM): metais, paetê, lamê, sandálias e joias refletem.
- Física de cabelo e fantasia com `center` = pelve (VRMC_springBone): correr não joga o cabelo na horizontal; gravado no GLB.
- Touca do cabelo em mechas cobre o couro (sem falhas de pele por dentro) e esmaece fio a fio na linha do cabelo.
- Rosto: barba (estilos), maquiagem, tatuagens e acessórios (óculos com haste atrás da orelha, aviador em gota, brincos, chapéus, colar sobre a gola) — conferidos e no GLB.
- Moldar: a parte sob o cursor acende antes de puxar; o puxão pega a região certa (queixo para baixo = altura do queixo).
- LOD1/LOD2: pele e camadas cobertas removidas antes de simplificar (sem pele atravessando a roupa). Corpo exportado soldado (17.533 vértices).
- Boca: jawOpen abre por inteiro (o fechamento dos lábios em repouso sai com a abertura).

## Interface (conferido no app em 09/10, 1280×800 e 1920×1080)

- Grade de 8 px (4/8/16/24), alvos de 32 px; todo controle numa linha: rótulo de 96 px, controle, valor de 48 px (medido em todas as abas: nenhum rótulo fora de 96 px nem cortado; a lista de ajustes detalhados e a expressão fina usam 136 px com quebra de linha).
- Paleta única: 8 colunas fixas de amostras de 20 px, seletor livre na 8ª célula da última linha.
- Abas: Corpo (Forma | Detalhes | Tatuagens), Rosto (Forma | Olhos | Visual | Expressão), Cabelo (Estilo | Cor | Mechas | Avançado), Roupas (Vestir | Peça | Tecido), Esculpir (Corpo e rosto | Roupa), Animação (Movimento | Pose | Linha do tempo). As opções da ferramenta ficam no topo da aba onde ela trabalha; escolher a ferramenta abre essa aba.
- Cabelo: um penteado por vez (escolher mechas tira o cabelo pronto, escolher cabelo pronto apaga as mechas); "Careca" só acende sem cabelo pronto; grade-guia do Pincel desligada ao entrar (Avançado › Grade-guia).
- Animação: categorias com ícone (Parado, Andar e correr, Festa, Gestos, Sentar) e cartões de ícone, um grupo por vez.
- Rodapé: etapas em português ("Formando o corpo…", "Esqueleto e rosto…", "Montando a cena…"), dicas curtas.
- Tipo de corpo: nenhum aceso quando o corpo não é um dos tipos.
- Posar: arrastar a esfera azul por cima dos anéis move só o quadril ($pelvis), não gira o osso escolhido. Linha do tempo: arrastar a chave de 1,0 s para 1,5 s funciona, e clicar na chave leva o tempo até ela. A animação própria salva está sem chaves.

## Com defeito (a corrigir, ver PLANO.md)

- Animação: Rocketbox não tem pulo nem samba (o Sambar é procedural); sentar fica sem cadeira; clipes capturados não acompanham o rosto além de piscar e sorrir.
- Interface: Rosto mantém "Ajustes por região" como grupo recolhível na aba Forma (o Corpo tem a aba Detalhes); os ícones de movimento repetem a mesma figura em variações do mesmo clipe (Andar, Passear, Andar confiante; as cinco danças).
- Boca: com a boca aberta os dentes de cima não aparecem (a malha existe, atrás do lábio).
- Cabelo em mechas: na têmpora e na linha do cabelo a pele aparece em listras entre os cartões que passam sobre a pele fora da touca; penteados prontos de mechas ("Longo", "Cacheado") com cara de fitas/fios finos; "Franja" sem franja; mechas atravessam ombros em parte dos quadros (a colisão é só na ponta de cada osso); faltam pentear, agrupar e alisar no editor.
- Roupa sob medida: blusa feminina ainda marca o bico do seio; tênis com bico e solado pouco definidos; sem dobras simuladas no corte no corpo; sem salto; cor de plumas e franjas só muda após reconstruir.
- LOD2 do conjunto pronto "Esporte fino": um triângulo da calça aparece sobre a camiseta (sobreposição numa costura de UV).
- Orçamento: Passista com cabelo longo tem 130 ossos e 14 chamadas de desenho (orçamento 113 e 10).

## Não existe

- Curvas editáveis por chave (tangentes), camadas aditivas de animação, pulo.
