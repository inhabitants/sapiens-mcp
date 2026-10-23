/**
 * SKILLS DA CASA servidas pelo próprio connector.
 *
 * O problema que isto resolve: as skills do repo (`skills/`, 40+) só existem
 * pra quem instala o PLUGIN no Claude Code. No claude.ai, na Helen, no Cursor,
 * no Gemini CLI, o connector chegava pelado, e todo o saber de fluxo tinha que
 * viajar dentro do SAPIENS_INSTRUCTIONS, injetado em TODO handshake de TODA
 * conversa, mesmo quando a pessoa só quer ver saldo.
 *
 * Aqui o saber vira conteúdo SOB DEMANDA, servido de dois jeitos ao mesmo
 * tempo (o cliente usa o que souber):
 *   1. resources MCP  -> skill://sapiens/<name>/SKILL.md
 *   2. tool sapiens_skill (action=list|get), pra client que não lê resources
 *
 * A instruction do handshake fica magra e guarda só o que evita DANO (custo,
 * timeout, disjuntor, login). O que aprofunda mora aqui e é puxado quando a
 * conversa pede. Handshake curto, saber fundo: um não paga pelo outro.
 *
 * O corpo é markdown no formato aberto de skill (frontmatter + instruções),
 * então dá pra copiar direto pra uma pasta `skills/` de qualquer agente.
 *
 * REGRA AO EDITAR: skill é sobre USAR a plataforma (o membro é o público). Cerne
 * interno da casa (Convex, deploy, release do MCP, auditoria) NÃO entra aqui:
 * isso é do plugin local do dono, não do connector público.
 */

export type SapiensSkill = {
  /** slug estável: entra na URI do resource e no arg `name` da tool. */
  name: string;
  /** título humano (aparece no list e no resource). */
  title: string;
  /** uma linha: QUANDO puxar. É por isto que o modelo decide ler. */
  description: string;
  /** corpo markdown, sem o frontmatter (montado por renderSkill). */
  body: string;
};

export const SKILL_URI_PREFIX = "skill://sapiens/";

/** URI canônica do resource de uma skill. */
export function skillUri(name: string): string {
  return `${SKILL_URI_PREFIX}${name}/SKILL.md`;
}

/** Extrai o slug de uma URI de skill; null se não for uma. */
export function skillNameFromUri(uri: string): string | null {
  if (!uri.startsWith(SKILL_URI_PREFIX)) return null;
  const rest = uri.slice(SKILL_URI_PREFIX.length);
  const name = rest.replace(/\/SKILL\.md$/, "").replace(/\/$/, "");
  return name.length > 0 && SKILLS[name] ? name : null;
}

const SKILL_LIST: SapiensSkill[] = [
  {
    name: "primeiros-passos",
    title: "Primeiros passos e armadilhas",
    description:
      "A porta de entrada e as quatro armadilhas que fazem o operador queimar Sinapses do usuário à toa (timeout, disjuntor, saldo, sessão). Puxe no primeiro contato ou quando algo der errado sem explicação.",
    body: `## A porta de entrada

Primeiro contato, ou "o que você faz?" / "como começo?": chame \`sapiens_meta action=start\` e mostre o resultado NA SUA VOZ. Sem login ele ensina a conectar; logado, traz saldo e os primeiros poderes com exemplo pronto.

Logo após um login que deu certo, chame \`start\` na sequência. O recém-chegado não sabe o que pedir: guie a primeira jogada sem ele precisar perguntar.

Não despeje a lista inteira de tools. O start guia.

## As quatro armadilhas

**0. Vídeo longo volta \`pending\`, e isso é sucesso.** Um \`sapiens_video action=create\` que demora mais que a espera síncrona responde \`{success: true, pending: true}\` SEM url: o pedido foi aceito, já cobrou, e o servidor termina sozinho. NÃO gere de novo (cobraria duas vezes): acompanhe com \`action=status\` no imageId, ou olhe a galeria depois.

**1. Timeout que já cobrou.** Toda geração SÍNCRONA (imagem pesada, artigo, mega-gráfico, carrossel) pode estourar o teto de ~120s do cliente e voltar 'Timeout' MESMO tendo gerado e debitado. Nunca repita às cegas. Confira antes onde o resultado teria caído:

| O que gerou | Onde conferir |
|---|---|
| imagem (generate, upscale, sombra) | \`sapiens_image action=status\` |
| artigo do perfil | \`sapiens_write action=list\` |
| carrossel | \`sapiens_carrossel action=list\` |

Imagem tem leitura própria porque a galeria (\`sapiens_gallery action=list\`) só mostra peça PRONTA: a que ainda está gerando não aparece lá, parece que falhou, e repetir cobra de novo. O \`status\` lista as gerações recentes da conta com o estado de cada uma: \`gerando\` (já cobrou, NÃO gere de novo, leia de novo em 1 ou 2 minutos), \`pronta\` (mostre essa), \`falhou\` ou \`bloqueada\` (o débito voltou, aí sim gere de novo) e \`presa\` (passou de 15 minutos gerando, a varredura do servidor estorna).

**2. Disjuntor anti-loop.** Três falhas seguidas no MESMO tool fazem o cliente marcar o servidor como "unreachable" por ~56s. Parece que "o MCP caiu", mas foi argumento faltando. Quando um tool volta erro de validação ("exige X", "falta Y"), LEIA o erro e refaça a chamada COM o que falta. Nunca repita a chamada idêntica que falhou.

**3. Saldo.** Antes de gerar algo caro (imagem, música, vídeo), cheque com \`sapiens_meta action=credits\` ou \`action=subscription\`. Saldo baixo, avise ANTES de gastar. Vídeo é o mais caro da casa: confirme com a pessoa antes de disparar.

**4. Sessão.** "sessionToken expirado" significa refazer login: \`sapiens_meta action=login\` com o código de sapiensinteticos.com/conectar-claude.

## Utilitários que evitam chute

- \`sapiens_meta action=whoami\`: tier (user/admin) e saldo.
- \`sapiens_meta action=formats\`: os schemas por formato.
- \`sapiens_meta action=version\`: qual versão está rodando de verdade e se é a última. Não exige login.
- \`sapiens_image action=models\` e \`sapiens_video action=models\`: catálogo vivo com o preço ATUAL. Consulte em vez de chutar custo.
- \`sapiens_meta action=precos\`: a tabela de preço em duas carteiras separadas: o App em Sinapses (por resolução e por segundo de vídeo) e a API em dólar, com saldo próprio. Sinapse não vira dólar. "A API sai mais barata que a fal.ai / WaveSpeed?" se responde com a parte \`api\`.`,
  },

  {
    name: "voz-da-casa",
    title: "A voz da casa",
    description:
      "O DNA editorial Sapiens: como escrever qualquer texto que sai com a marca (post, tese, artigo, legenda, microcopy). Puxe ANTES de redigir qualquer coisa que vai ser publicada.",
    body: `## A régua

Primeira pessoa. Opinião explícita. Conversa, não palestra. Analogia concreta antes de abstração.

**Sem travessão.** O em-dash é proibido no DNA Sapiens. Troque por vírgula, ponto, dois-pontos, parênteses, ou reescreva a frase.

**Para bom entendedor, meia palavra basta.** Respeita a inteligência de quem lê: não overlegenda, não explica o óbvio, não repete o que o contexto já diz, não fecha toda ideia com frase-resumo. Corta a frase a mais. É editorial, não TV aberta.

## O que evitar

- Linguagem corporativa ("soluções", "alavancar", "jornada", "ecossistema" solto).
- Tom jornalístico neutro. A casa tem opinião, assume.
- "Neste artigo vamos abordar", "vamos explorar", "sem mais delongas".
- Tom influencer, promessa de atalho mágico, receita pronta.
- Fechar tudo com CTA. O texto termina quando a ideia termina.
- **Definir por negação** ("não é X, é Y", "nada de Z"). A casa só afirma: diz Y direto.

## Tiques de IA que a casa corta

O modelo repete esses porque soam competentes. Todos caem.

- **Falsa revelação**: "o que ninguém te conta", "a parte que todo mundo pula". Corta o setup, a afirmação fica de pé sozinha.
- **Atribuição vaga**: "especialistas concordam", "estudos mostram". Nomeia a fonte ou corta a frase.
- **Inflar importância**: "divisor de águas", "marca um momento decisivo". Fala o fato e deixa quem lê julgar o tamanho.
- **Análise em gerúndio**: "reforçando o compromisso do time", "evidenciando", "destacando". Troca pela consequência concreta.
- **Revelação com dois-pontos**: "O detalhe que faz funcionar: um agente separado corrige." Vira frase normal.
- **Setup retórico**: "e se eu te dissesse", "pensa comigo", "plot twist", e pergunta que o próprio texto responde na linha seguinte.
- **Frase vazia**: "vale destacar", "é importante notar", "no final das contas", "quando se trata de", "nos dias de hoje".
- **Rodízio de sinônimo**: o agente, depois o assistente, depois a ferramenta, tudo pra mesma coisa. Repetir a palavra certa é precisão.
- **Kicker de falsa profundidade**: a última linha "funda" que vira aforismo. Deleta, não reescreve numa metáfora melhor. Termina na frase concreta que já estava lá.
- **Muleta de hedge**: "ao meu ver", "na minha opinião", "tendo a achar", "talvez" que não carrega dúvida. Corta e afirma. Incerteza real fica, dita como fato: "testei só no plano grátis", "até o preço cair".
- **Palavra difícil**: "utilizar", "possuir", "visando", "a fim de", "devido ao fato de". Usar, ter, pra, porque.
- **Advérbio no lugar do número**: "melhorou significativamente", "caiu drasticamente". Fala o número.
- **Passiva com agente**: "foi lançado pela OpenAI" vira "a OpenAI lançou". Quem fez é o sujeito.

## Revisar sem apagar a pessoa

Revisão é a menor edição que resolve. Corrige o tique, o erro e o trecho ilegível, e deixa em paz a frase que já funciona. Não deixa todo parágrafo igualmente arrumado, assimetria é sinal de humano. Não inventa número, exemplo nem opinião que não estava no original.

## Texto que a pessoa já trouxe pronto

Vai pro perfil como está: \`sapiens_write action=create\` (title + content), de graça e sem uma linha reescrita. Depois \`action=publish\`.

Gerar com IA e sobrescrever com o original queima 400 Sinapses por nada. \`action=generate\` é pra quando ela pede pra ESCREVER, não pra publicar o que ela escreveu.

Quem tem design system (\`sapiens_brand action=list\`) já vê a capa sair na paleta dele: o \`brandSlug\` da conta veste a peça sozinho, e passar \`brandSlug\` no create troca de sistema por peça.

## O que manter

- Léxico próprio: borderless, degen, farmei, "ombros dos gigantes", "fala ai".
- Jargão cripto e tech, sem pedir desculpa e sem glossário defensivo.
- Framework nomeado mais analogia concreta. Antes de inventar nome novo, reusa o vocabulário canônico da casa.

## Estrutura padrão de peça didática

Condensa a informação num framework com nome, ancora numa analogia concreta, e só então desce pro detalhe. Estrutura arrumada, alma inquieta, nunca fórmula.`,
  },

  {
    name: "repertorio",
    title: "Repertório: guardar obra e ferramenta no acervo",
    description:
      "Guardar filme, série, anime, jogo, jogo de tabuleiro, livro, música, pessoa ou ferramenta de IA no Repertório. Puxe ANTES de qualquer sapiens_repertorio: a gravação é travada num fluxo de dois passos e tentar guardar direto falha sempre.",
    body: `## A regra que faz este fluxo falhar

Você NÃO grava uma obra passando o título. O servidor não aceita metadado vindo de você (título, capa, ano) de propósito: é anti-fabricação. Você identifica a obra num provider, e o servidor re-resolve por id e grava o canônico.

São sempre DOIS passos. Pular o primeiro falha sempre, e é o erro número um deste fluxo.

## Guardar uma obra

1. **\`action=resolve\`** com \`mediaType\` e \`query\` (o título como a pessoa falou). Custo 0. Volta até 8 candidatos, cada um com \`source\` e \`externalId\`.
2. Escolha o candidato certo. Em dúvida entre dois, PERGUNTE em vez de chutar: obra errada no acervo é a pessoa quem vai ter que apagar.
3. **\`action=add_item\`** com o \`source\` e o \`externalId\` **exatos** daquele candidato, mais o que é pessoal: \`status\`, \`rating\` (0-10), \`tags\`, \`note\`, \`containsSpoilers\`, \`isPublic\`.

\`mediaType\`: movie, series, anime, game, book, music, tool, person, boardgame.
\`status\`: backlog (quer ver), active (vendo agora), completed (viu), paused, dropped.

Jogo de tabuleiro (e de cartas) é \`boardgame\`: \`game\` é videogame, e o provider dele não conhece tabuleiro. A busca do tabuleiro é na Wikidata e acha pelo título em inglês; o designer vem em \`authors\` no candidato e separa homônimos. Lançamento muito recente pode ainda não estar cadastrado: resolve vazio quer dizer que o jogo não está na base, então diga isso à pessoa.

Nunca invente um \`externalId\` nem reaproveite um de outra busca: id que não resolve no provider é rejeitado. A dedup é por (você, source, externalId), então repetir o mesmo par não duplica.

## Guardar uma ferramenta de IA

Outro par, mesmo espírito: **\`action=search_tools\`** com \`query\` (catálogo aberto, custo 0, sem login) e depois **\`action=add_tool\`** com o \`toolId\` do candidato. Estar no acervo já quer dizer "usei"; \`favorite: true\` é o eixo separado de "curto e indico".

## Ler o acervo

\`action=list\` e \`action=search\` **exigem \`userId\`**. Descubra uma vez com \`sapiens_meta action=whoami\` e reuse na conversa inteira. \`action=get\` pede \`itemId\`, que vem do list/search.

Acervo de outra pessoa você lê, mas só o que ela deixou público.

## Depois de guardar

\`action=update_item\` muda o que é seu (\`rating\`, \`status\`, \`tags\`, \`note\`; \`rating: null\` remove a nota). \`action=remove_item\` tira do acervo. Os dois pedem \`itemId\`, nunca o título.

\`action=popArticles\` lista os artigos publicados que usam uma obra como lente. É leitura pública, não precisa de login.`,
  },

  {
    name: "musica",
    title: "Música e efeito sonoro",
    description:
      "O fluxo de 4 passos do Musicator (create, lyrics, render, get) e a diferença entre música e efeito sonoro. Puxe ANTES de qualquer sapiens_musicator ou sapiens_stock_audio, pular passo sempre falha.",
    body: `## Musicator: 4 passos, nesta ordem

1. **create**: exige \`title\` (>=3 chars) e \`context\` (>=20 chars, o tema/ângulo) e \`direction\` (gênero/mood). Custo 0. Devolve \`trackId\`.
2. **lyrics**: passe \`trackId\` e \`context\` pra gravar a letra na track (300 Sinapses). Nunca chame lyrics sem title e context.
3. **render**: passe o \`trackId\` pronto pra sintetizar o áudio (3000 Sinapses, assíncrono, teto de 3/min).
4. **get**: passe o \`trackId\` e vá polando o status até 'ready' (ou 'failed').

## Qual motor no render

\`model\` escolhe o motor. Sem ele, sai no Lyria 3.5.

- \`pro\`: Lyria 3.5, faixa inteira até 3 min. Único que lê imagem de referência.
- \`clip\`: Lyria 3 Clip, rascunho de 30s pra testar a ideia.
- \`mureka\`: Mureka 9.5, faixa inteira, aguenta letra de até 5.000 caracteres.
- \`minimax\`: MiniMax Music 2.6, faixa inteira até 5 min. Letra de 10 a 3.000 caracteres.
- \`elevenlabs\`: ElevenLabs Music, a pessoa escolhe a duração em \`durationSeconds\` (30, 60, 120 ou 180; sem ele, 120). Letra até 3.500 caracteres.

Todos custam o mesmo render fixo, menos o ElevenLabs, que cobra pela duração (\`durationSeconds\`): 30s 1300, 60s 2550, 120s 5050, 180s 7600 Sinapses. Diga o número e confirme antes de disparar o de 3 min.

Letra maior que o teto do motor é recusada ANTES de cobrar, com o tamanho na mensagem: corte a letra ou troque de motor. \`negativePrompt\` e \`seed\` só valem no Lyria.

Pular pro lyrics ou render sem create, ou sem os campos, falha sempre. É o erro número um deste fluxo.

Depois de pronta: \`action=publish\` põe a faixa no Acervo da Comunidade (só admin/dono, custo 0, idempotente). A publicação já nasce com player no Fórum, veja a skill \`forum\`.

## Efeito sonoro é outra coisa

Efeito é CURTO. Música inteira é no Musicator, não aqui.

1. Procure pronto primeiro: \`sapiens_stock_audio action=list kind=sfx\`. Grátis.
2. Não achou: \`action=generate\` com \`prompt\` e \`durationSeconds\` (1 a 15, default 5) e \`provider\` ('mirelo' padrão 35 Sinapses/s mín 70, 'elevenlabs' premium 60/s mín 120). \`promptInfluence\` (0..1) só vale no elevenlabs.
3. É assíncrono: devolve \`generationId\`, acompanhe com \`action=generation-status\` até 'ready' (traz audioUrl) ou 'failed' (reembolsa sozinho).

## Sonorizar um clipe

Dar som a um vídeo SEU já pronto é \`sapiens_video action=sonorize\`, não é aqui. Veja a skill \`video\`.`,
  },

  {
    name: "video",
    title: "Vídeo: escolher modelo sem queimar Sinapses",
    description:
      "Qual modelo de vídeo usar, como iterar barato, referências e storyboard, sonorizar, e o que são os Vídeos Programáticos. Puxe ANTES de sapiens_video, vídeo é a operação mais cara da casa.",
    body: `## Antes de tudo

\`action=create\` EXIGE \`model\`. Sem model, falha de cara. Vídeo é o mais caro: confirme com a pessoa antes de disparar.

\`action=models\` (sem custo, sem login) lista os modelos ativos com durações, resoluções, disponibilidade e a FAIXA de preço: o padrão, o piso e o teto, cada um dizendo em qual configuração acontece. Motor de preço-por-segundo não tem "um preço": o mesmo modelo custa 3x mais em 1080p e 30s do que em 720p e 5s.

Dois campos do payload evitam garimpo na lista. bestFor diz pra que o motor serve (audio = som nativo, fala = lip-sync, referencia = aceita referência de quem aparece, movimento = precisa de vídeo-guia, longo = passa dos 15s): filtre por aqui antes de comparar preço. family + variant dizem quem é o mesmo motor em geração ou tier diferente: as quatro linhas de Seedance (2.0, 2.0 Fast, 2.0 Mini, 2.5) são UM motor, não quatro. Escolha a família pelo trabalho, depois a variante pela conta.

\`action=price\` (sem custo, sem login) cota a configuração EXATA antes de rodar: passe \`model\`, \`durationSec\`, \`resolution\` e \`audio\` e receba o número que vai ser debitado, calculado pela mesma função que cobra. Ela também avisa quando o motor não aceita o que você pediu e vai cobrar outra coisa (\`clamped\`), o que acontece quando a duração não existe no enum ou a resolução cai num tier diferente.

Use \`price\` sempre que a pessoa perguntar quanto custa, e ANTES de qualquer \`create\` que não seja o default. Dizer o piso como se fosse o preço final é o jeito mais rápido de queimar a confiança dela: a cobrança vem maior e a culpa é sua.

## Iterar barato, fechar caro

Os três Seedance 2.0 têm o MESMO repertório (referência, frame inicial e final, vídeo de movimento, áudio nativo):

| Modelo | Custo | Teto |
|---|---|---|
| \`sapiens-video-seedance-2-mini\` | metade do padrão | 720p |
| \`sapiens-video-seedance-2-fast\` | 20% menos | 720p |
| \`sapiens-video-seedance\` | padrão | 1080p |

Itere enquadramento e prompt no Mini, feche no padrão quando o take estiver certo. Economiza Sinapses da pessoa sem trocar de fluxo. Pedir 1080p nos dois de cima entrega e cobra 720p.

## Quando o take precisa ser longo

\`sapiens-video-seedance-25\` (Seedance 2.5) é a geração seguinte, não um quarto tier da 2.0. O que ela abre: take de 4 a **30s** num fôlego (a linha 2.0 para em 15s), edição e extensão de vídeo, e áudio como referência além de imagem e vídeo. O que ela cobra por isso: ~1,5x o preço por segundo do padrão, e teto de 720p.

Duração é o que pesa aqui, não o modelo: um take de 30s em 720p passa de 40 mil Sinapses. Cheque o saldo e confirme a duração com a pessoa ANTES de disparar. Precisa de 1080p? É \`sapiens-video-seedance\` mesmo, a 2.5 não substitui o padrão.

## Quando a personagem canta ou fala com o SEU áudio

A linha LTX Audio-to-Video faz o que nenhum outro motor da casa faz: o áudio que você manda VIRA o take. A faixa puxa a boca e o gesto e dita a duração; a foto abre a cena.

| Modelo | Áudio | Pra quê |
|---|---|---|
| \`sapiens-video-ltx-25-fast-a2v\` | até 20s | o padrão: canto e fala, rápido |
| \`sapiens-video-ltx-25-pro-a2v\` | até 10s | mais detalhe de rosto e textura |
| \`sapiens-video-ltx-23-pro-a2v\` | até 20s | o segundo mais barato da linha |

1. O áudio: UM só, mp3 ou m4a. Faixa SUA do \`sapiens_musicator\` vai por \`referenceAudioTrackIds\` (o \`trackId\` de \`action=list\`, faixa \`ready\`): o servidor confere que ela é da sua conta antes de cobrar, e é o caminho certo. Trecho cortado por você vai num link de arquivo da sua conta em \`referenceAudioUrls\` (link de outra conta é recusado antes de cobrar). O motor lê até 20s (10s no Pro), então faixa mais longa precisa do corte. WAV não entra: a LTX não lê.
2. A foto: \`startImageId\` ou \`startImageUrl\`, a da ficha da personagem. Sem foto, o \`prompt\` descreve quem canta e onde.
3. O prompt: o que acontece na cena enquanto ela canta (onde, luz, câmera, o gesto). Não precisa escrever a letra.
4. \`resolution\`: \`720p\` ou \`1080p\`; \`aspectRatio\`: \`9:16\`, \`16:9\` ou \`1:1\` (o 2.3 Pro não faz quadrado).

O preço é pelo SEGUNDO DO ÁUDIO: o servidor mede o arquivo antes de cobrar, e \`durationSec\` não se usa no create. Pra cotar, \`action=price\` com \`durationSec\` = os segundos do áudio.

## Os outros modelos

- \`sapiens-video-ltx-25-fast\` e \`sapiens-video-ltx-25-pro\`: LTX 2.5, texto ou imagem, 6 a 20s no Fast e 6 a 10s no Pro, em \`720p\` ou \`1080p\`, som nativo com interruptor e frame final (só junto do inicial). Não aceita referência de personagem.
- \`sapiens-video-h3\`: MiniMax H3, o mais barato por pixel da casa, com som nativo, texto ou imagem. 5 a 15s em \`2k\` ou \`768p\` (o 2K longo demora uns 9 minutos: volta \`pending\` e termina sozinho). Aceita até 9 imagens e 3 vídeos de referência, e é o caminho de take LONGO com personagem travada. Referência e frame inicial não vão juntos: escolha um. Sem \`resolution\` cai no 2k, que custa 33% mais por segundo.
- \`sapiens-video-pvideo-2-pro\`: P-Video-2 Pro, o H3 acelerado pela Pruna, e o RASCUNHO de personagem travada: até 9 imagens (referências mais frame inicial e final, juntos no mesmo pedido), 5 a 15s em \`480p\` ou \`768p\`, som nativo, e o take volta em segundos. Itere elenco, ângulo e fala aqui e feche no Seedance ou no H3. Não faz texto puro (precisa de ao menos uma imagem, ou um clipe) e cobra cada imagem além do segundo: cote em \`action=price\` com as mesmas imagens do create. Aceita também até 3 clipes (\`referenceVideoUrls\`) e 3 áudios (\`referenceAudioUrls\`, ou \`referenceAudioTrackIds\` pra faixa sua do \`sapiens_musicator\`) de referência, 15s somados por tipo, cobrados por segundo e medidos pelo servidor antes do débito; cote passando \`referenceVideoClipsSec\` (a duração de cada clipe) e \`referenceAudioSec\`. Com \`keepAudio\` e um áudio só, ele vira a trilha: é como a personagem fala com a voz que você mandou.
- \`sapiens-video-h3-spicy\` e \`sapiens-video-seedance-spicy\`: os mesmos motores SEM freio de conteúdo. Os dois partem de uma IMAGEM sua (não fazem texto puro), e é isso que trava a identidade: quem aparece já veio pronto na imagem, o motor só dá movimento. O H3 Spicy é o mais barato e o mais rápido da casa (250 Sinapses o segundo em 480p, 3 a 15s); o Seedance Spicy tem o peso do 2.0, vai a 15s em 480p e 720p e para em 10s no 1080p.
- \`sapiens-video-kling\`: Kling 3.0 Pro, anima imagem, 3 a 15s, som opcional.
- \`sapiens-video-wan\`: WAN 2.5, imagem que fala ou canta, com lip-sync, 5 ou 10s.
- \`sapiens-video-wan-3\`: WAN 3.0, texto ou imagem, som nativo, frame final e 1080p, 5 a 10s.
- \`sapiens-video-flux-3-max\`: FLUX 3 Max, texto ou imagem, 5 a 20s em \`720p\` ou \`1080p\`, som nativo e frame final (só junto do inicial). Segue o prompt de perto e volta rápido. Não aceita referência de personagem nem vídeo de movimento.
- \`sapiens-video-kling-motion\`: passa o movimento de um vídeo pra uma imagem. Precisa de pessoa com tronco visível na imagem E no vídeo.
- \`sapiens-video-shot-mimic\`: recria o plano, a câmera e os cortes de um vídeo de referência como cena nova.
- \`sapiens-video-omni-11\`: Gemini Omni 1.1, texto ou imagem vira clipe de 4, 6, 8 ou 10s (sem \`durationSec\`, 10s) com áudio nativo, de \`360p\` a \`4k\` (sem \`resolution\`, 720p). O preço é por segundo e por resolução: o take de 4s custa 40% do de 10s, o 360p custa 1/3 do 720p, o 1080p 1,5x e o 4k 3x. Aceita até 3 imagens suas (frame inicial, frame final ou referência de personagem e estilo); vídeo de movimento não (pra copiar coreografia, Seedance). Edita e estende um vídeo SEU: \`sourceVideoId\` (da galeria) ou \`sourceVideoUrl\` (link da casa), mp4 até 10 s, com \`sourceVideoMode\` \`edit\` (o padrão: a mesma cena com a mudança pedida, cobrada pelo tamanho do clipe; é como se troca a pessoa de um vídeo pelo seu personagem, com a ficha dele em \`referenceImageIds\`) ou \`extend\` (o pedaço seguinte, cobrado pelo \`durationSec\`). A proporção sai a do clipe. O truque: \`editOfImageId\` aponta um vídeo Omni seu e o prompt vira instrução de edição sobre a MESMA cena (troca item ou personagem, preserva câmera e ambiente). É o caminho pra variações com continuidade: gera a base uma vez, edita N vezes. Cada edição debita como geração nova. Pra ir ADIANTE no tempo é \`action=extend\` (o pedaço seguinte, cobrado pela duração dele): o arquivo de cada parte já traz as anteriores na frente, então a última parte pronta é o filme inteiro. Não emende as partes, a abertura repete; \`action=chain\` aponta o \`filmeInteiro\`.
- \`sapiens-video-omni\` (Gemini Omni 1.0) e \`sapiens-video-lite\` / \`-fast\` / \`-quality\` (Veo 3.1): SAÍRAM. O Google apagou os quatro em 22/10/2026 e o pedido é recusado antes de cobrar. O sucessor é o \`sapiens-video-omni-11\`.

## Receita de take (\`templateSlug\`), quando o formato já tem forma

Formato conhecido não precisa de prompt escrito do zero. Passe \`templateSlug\` e a receita da casa embrulha a cena com estilo, cenário, arco, áudio e look, e ainda escolhe o motor (aí \`model\` fica opcional). O \`prompt\` vira só a CENA e o \`brief\` preenche o resto.

| Slug | O take |
|---|---|
| \`ugc-vertical-v1\` | selfie que fala, o formato nativo de Reels, TikTok e Shorts |
| \`unboxing-vertical-v1\` | mãos e reveal, som real de papel e lacre |
| \`app-demo-vertical-v1\` | a tela do app legível na mão da pessoa |
| \`reflexao-vertical-v1\` | talking-head lento pra ideia ou ensaio |

O \`brief\` aceita \`subject\`, \`persona\`, \`hook\` (\`line\` e \`emotion\`), \`shots\` (cada um com \`sec\`, \`camera\`, \`action\`, \`emotion\`, \`voiceLine\`, \`propVisible\`), \`uvps\`, \`language\` e \`energy\`. Campo vazio SOME do prompt em vez de virar buraco, e o que você não passa cai no valor de reserva da receita.

\`action=templates\` (sem custo, sem login) lista o catálogo vivo: spec default, o que dá pra sobrepor e os \`briefFields\` que cada receita realmente usa. Override fora da whitelist é recusado com as opções na mensagem.

## Fluxo storyboard (o que dá o melhor resultado)

Imagens de REFERÊNCIA via \`referenceImageIds\` / \`referenceImageUrls\` / \`referenceImagePaths\` guiam estilo, personagem e composição SEM virar o primeiro frame. O teto é do motor: 4 no Seedance 2.0, 9 no H3.

1. Gere a folha de key poses com \`sapiens_image templateSlug='storyboard-sapiens-v1'\`.
2. Passe folha e personagem como refs num text-to-video.
3. Descreva o take contínuo no prompt, citando as refs por descrição e mandando ignorar o traço do sketch.

Dá pra somar 1 vídeo de movimento via \`referenceVideoUrls\` (até 15s, host da casa): a coreografia e a câmera do clipe guiam o take.

Frame inicial e final: \`startImageId\`/\`endImageId\` (galeria) ou \`startImageUrl\`/\`endImageUrl\`. Arquivo local (\`startImagePath\`) só funciona no MCP instalado via stdio, nunca no remoto. Suporte a frame final varia por modelo.

Frame de borda e referência são caminhos EXCLUSIVOS no Seedance 2.0/Fast/Mini/2.5 e no H3: ou o take nasce do frame (\`startImage*\`/\`endImage*\`), ou das referências (\`referenceImage*\`/\`referenceVideoUrls\`), nunca dos dois. No Seedance a mistura é recusada antes de cobrar; no H3 a referência troca o endpoint e o frame inicial fica de fora. Quer a pessoa da foto no take? Mande a foto como referência e descreva o primeiro quadro no prompt; quer o quadro exato? Só o frame inicial.

## É assíncrono

\`create\` cria o row, debita e volta NA HORA com \`{imageId, status:'rendering'}\`. Acompanhe com \`action=status imageId=<id>\` até 'completed' (traz a url) ou 'error'/'blocked'.

NÃO chame create de novo enquanto renderiza: cria outro vídeo e cobra de novo. Falha de provider refunda sozinha.

## Editar o que já existe (corte, compilado, fecho, render com referência)

As ações da ficha do site saem por aqui, e cada uma vira peça nova na galeria, com o original intacto:

- \`trim\`: \`imageId\` + \`startSec\` (e \`endSec\`, sem ele vai até o fim). Corta o trecho. Grátis.
- \`join\`: \`imageIds\` com 2 a 8 vídeos seus, na ordem do compilado, até 180 s somados. Grátis.
- \`fecho\`: \`imageId\` + \`ending\` (\`marca\` é a assinatura da casa, \`none\` sem vinheta), \`watermark\`, \`musicUrl\` (trilha do acervo da casa) e \`nameCard\` (o personagem se apresenta no fim). Grátis.
- \`render-ref\`: \`imageId\` do take + \`refUrl\` da folha ou referência que gerou ele. Cobra Sinapses; o mesmo par já renderizado volta de graça.

São síncronas e podem passar de 2 minutos: Timeout é o cliente desistindo. Olhe \`sapiens_gallery action=list kind=video\` antes de repetir.

## Resolução maior

\`action=upscale\` com \`imageId\` (um vídeo SEU pronto) e \`resolution\` como o ALVO (\`720p\`, \`1080p\`, \`2k\` ou \`4k\`) cria uma versão maior ao lado do original, que fica intacto. Cobra Sinapses por segundo do clipe, e o alvo maior custa mais: confirme o alvo com a pessoa antes. É assíncrono como o create: acompanhe em \`action=status\` e não peça de novo enquanto renderiza. Upscale de uma variante que já é upscale é recusado.

## De qual saldo sai

A conta tem duas carteiras: Sinapses (o App) e o saldo em dólar da API (Developers). O take sai de qualquer uma das duas: \`create\` com \`pagarCom: "dolar"\` cobra no saldo da API, mesmo motor e mesma config, e o valor volta em \`pagoEmDolarUsd\`. Sem o campo, sai em Sinapses (e o \`action=price\` cota em Sinapses). Use o dólar quando a pessoa pedir ou quando ela estiver sem Sinapses e com saldo na API. Falha do render devolve no mesmo saldo. Sinapse não vira dólar nem o contrário.

## Sonorizar

\`action=sonorize\` com \`imageId\` de um vídeo SEU já completed e \`prompt\` descrevendo o som da cena (ambiente, materiais, impactos). Sai uma VARIANTE nova com trilha sincronizada ao movimento, e o original fica intacto. Três motores no \`engine\`:

- \`mirelo-sfx-2.0\` (o default, o motor da casa pra sonorizar): GUARDA a fala que o clipe já tem, tira a música que veio junto e refaz o resto do som em volta (Mirelo SFX 2.0, 42 Sinapses/s do clipe, mín 210). Em clipe mudo, faz o som inteiro.
- \`mmaudio-v2\`: segue o TEXTO, e é o mais barato. Som inteiro do zero (MMAudio, 20 Sinapses/s do clipe, mín 100), e a fala que o clipe já tem se perde.
- \`elevenlabs-video-to-music\`: não faz som de cena, faz a TRILHA. Uma música que acompanha os cortes do clipe, mixada por baixo do som que ele já tem: a fala e o ruído ficam (ElevenLabs Video to Music, 26 Sinapses/s do clipe, mín 130). Aqui o \`prompt\` descreve a música (gênero, instrumentos, clima, onde ela cresce), não a cena. Recusa, sem cobrar, peça que já tem o fecho da casa: sonorize o take original.

O Mirelo tira o som da IMAGEM e o texto só empurra. Quando a imagem engana, use o MMAudio: bicho trocado numa cena refeita (o gatinho no lugar do T-rex saiu do Mirelo com passo e rugido de T-rex), criatura que não existe, som que a cena não mostra.

O Mirelo e o Video to Music recusam, sem cobrar, a peça que entrou de fora (ingest: a casa não sabe quanto ela dura) e o clipe acima de 180s. Peça de fora passa antes no \`action=trim\` (o corte nasce medido) e você sonoriza o corte; clipe longo, corte em partes.

Sonorize sempre o ORIGINAL, nunca uma variante. Acompanhe com \`action=status\` no imageId NOVO que o sonorize devolve.

## Extrair o depth map (ADMIN)

\`action=shadows\` com \`videoUrl\` (URL pública) e \`title\` extrai o mapa de profundidade de um vídeo: 200 Sinapses/segundo, com refund na falha. Passe \`durationSec\` quando souber, pra cobrar proporcional; sem ela vai no flat ~2000.

O depth map cai na SUA timeline de vídeos (quem extrai vira dono) e vira ficha no Acervo como driving reutilizável pro Shot Mimic e o Kling Motion. \`action=shadows-list\` lista os prontos.

## Vídeos Programáticos são outra coisa

O Lab de filmes-de-código da casa (/experimentos/films) tem cinco tipos: demo (UI clonada mais câmera), aula-tour (telas reais mais narração), essay (fita-ensaio abstrata), tipografia-musical (a música dirige o corte) e dataviz (números no tempo).

O RENDER não sai deste connector: um agente local no repo da casa produz o mp4. Mas o CICLO na plataforma fecha por aqui, sem custo: \`film-list\`, \`film-get\`, \`film-upsert\`, \`film-status\`, \`film-publish\`. Membro pedindo "fita-ensaio" ou "demo film": aponte pra tela e pro agente local.`,
  },

  {
    name: "imagem",
    title: "Imagem na régua da casa",
    description:
      "Como escrever prompt de imagem que sai com a cara do Sapiens (full-bleed, sujeito oversized), templates travados, e multi-referência. Puxe ANTES de sapiens_image action=generate.",
    body: `## A regra do prompt

**Full-bleed. Sujeito oversized, ocupando 70% ou mais do frame.** Sem moldura, sem margem, sem cena pequena em paisagem vasta.

Proibidos no prompt: "tarot card illustration", "intimate scale", "card-style portrait", "watercolor portrait of", "small subject in vast landscape". São os padrões que sabotam o resultado e entregam imagem genérica.

## O básico

\`action=generate\` com \`prompt\`, \`model\` e \`aspectRatio\`. \`action=models\` (sem custo, sem login) lista o catálogo vivo com preço atual, resolução máxima e se o modelo aceita referência.

O preço de \`models\` é o do 1K. Sem \`size\`, nano-banana-2, nano-banana-max e a família Krea 2 geram em 2K e somam o adder de 2K: passe \`size: "1K"\` quando o barato importar mais. O que foi debitado de verdade volta em \`custoSinapses\` no retorno do generate; cite esse, não o da lista.

## Escolher motor em dois passos

A lista de action=models é longa e segue a ordem da prateleira da casa, não o preço, e nenhuma das duas é a pergunta de quem vai gerar. Três campos do payload resolvem isso:

- bestFor: pra que o motor serve, num vocabulário fechado (foto, anime, texto pra palavra legível na arte, personagem pra segurar a mesma pessoa, adulto). FILTRE por aqui antes de comparar preço.
- family + variant: motores com a MESMA family são o mesmo motor em versão diferente (Flux.2 Klein tem Base, Anime, Celular e Transparência; Krea 2 tem Realism e Transparência; Gemini tem 3 Pro e Nano Banana 2.1; GPT Image tem 2 Low, 2 High, 2.5 Flare e 2.5 Sunburst). O retorno traz um índice families já montado.
- ousadia: nudez é NÍVEL, não motor. Quando o campo vem preenchido, a mesma escolha tem uma versão com nudez: gere com \`ousadia.model\` + \`loraIntensity\` (suave, medio, forte) pra ter nudez, e com o id da linha pra não ter. Não procure um motor "+18" ou "Nu" separado na lista: ele virou este campo.

Texto legível na arte (placa, rótulo, pôster com acento): a família GPT Image é a de referência. Dentro dela, o 2.5 acerta letra pequena e acento cobrando menos que o 2 High; o Flare é o rápido, o Sunburst segura composição densa e edição em várias voltas. O preço vivo de cada um sai em action=models.

O caminho: filtre por bestFor, escolha a família, e só então compare as variantes dela entre si. Trocar de família porque uma variante é mais barata costuma trocar o resultado inteiro; trocar de variante dentro da família troca preço e acabamento, não o motor.

## Multi-referência

Combine até 5 imagens como referência numa geração só:

- \`referenceImageUrls\`: sua galeria, o Acervo, personagens públicos (descubra em \`sapiens_character\`).
- \`sourceImageIds\`: ids da sua galeria.

Quem aceita e quantas: \`supportsReferences\` e \`maxReferences\` em \`action=models\`. Cada motor corta no próprio teto SEM erro (nano-banana-2 e Klein em 4, Grok em 3, Krea 2 da WaveSpeed em 1): mande as refs que importam primeiro. Use \`sapiens_reference\` pra achar a URL certa em vez de adivinhar.

Nas Krea 2 da WaveSpeed a referência é a imagem-base (uma só), e \`refStrength\` diz quanto dela fica: 0.2 guarda a foto quase inteira, com o rosto; 0.45 guarda pose, roupa e fundo, e o prompt muda luz e clima; 0.65 (o default) guarda enquadramento e roupa, e rosto e cenário saem do prompt; 0.9 guarda só a proporção. A peça sai no formato da referência, não no \`aspectRatio\`. Pra segurar o rosto de personagem numa cena nova, o caminho é o Klein, não baixar a força.

## Editar uma área

Pra mudar SÓ um pedaço da peça (trocar o objeto da mão, apagar uma placa, pôr um chapéu) e devolver o resto igual ao pixel: \`action=generate\` com \`sourceImageId\` (uma referência só) e \`maskRegions\`.

- As caixas vão em FRAÇÃO da imagem, de 0 a 1, com origem no canto SUPERIOR ESQUERDO: \`{x, y, w, h}\`, x e y no canto superior esquerdo da caixa. \`shape: "ellipse"\` (o default) marca a elipse inscrita na caixa; \`"rect"\` marca a caixa inteira. Até 8 caixas.
- OLHE a peça antes (\`sapiens_gallery action=get\`) pra estimar as coordenadas, e marque com folga: área justa corta a sombra e o reflexo do que entra.
- O \`prompt\` descreve só o que entra na área, nunca a cena inteira.
- Motor: o que tiver \`supportsMaskEdit\` em \`action=models\` (hoje nano-banana-2 e nano-banana-max). A peça sai na proporção e no tamanho da origem, lado maior até 2048, pelo preço da geração comum.
- Recusa sem cobrar: área vazia, área que cobre quase a imagem toda (aí é \`mode=edit\` comum, sem \`maskRegions\`), mais de uma referência, motor sem o campo.

## Fundo transparente

Peça que vai virar overlay, sticker, slide ou camada de vídeo nasce recortada: \`action=generate\` com \`transparentBackground: true\`. O próprio motor desenha só o sujeito e devolve PNG com alpha, pelo preço da geração comum, sem passar pelo Remover Fundo pago depois (que adivinha o contorno; aqui quem sabe onde o sujeito acaba é quem desenhou).

- Motor: o que tiver \`supportsTransparentBackground\` em \`action=models\` (hoje a linha GPT Image: 2 Low, 2 High, 2.5 Flare e 2.5 Sunburst). Passe o \`model\` junto: o default (nano-banana-2) não faz e recusa sem cobrar.
- O sujeito continua oversized, mas SEM cenário: descreva só o que fica ("a single red ceramic teapot, isolated subject, crisp edges, no shadow"). Chão, parede ou céu escritos no prompt viram fundo pintado.
- A peça sobe em PNG (não webp) e volta em \`sapiens_gallery\` com \`transparentBackground: true\`. Se o motor devolver fundo chapado, a geração falha e estorna.

## Templates travados

\`templateSlug\` aplica um super-prompt da casa: o seu \`prompt\` vira só a CENA (quem, que pose, que objeto-conceito) e o template embrulha estilo, fundo, enquadramento e referência de traço.

- \`retrato-sapiens-v1\`: retrato editorial cartoon no grid verde Sapiens, a mesma "mão" dos artigos. Sem ref própria, injeta a Helen como âncora de traço; passar \`referenceImageUrls\` troca quem aparece.
- \`storyboard-sapiens-v1\`: folha de key poses, a entrada do fluxo de vídeo.

\`templateSlug\` e \`brandSlug\` são mutuamente exclusivos.

## Cuidados

- \`generate\` é SÍNCRONA e cobra no disparo. Modelo pesado (Pro, gpt-image-2-high, GPT Image 2.5 Sunburst, Grok quality, Seedream 5.0 Pro, 2K/4K) cai na regra do timeout: leia \`action=status\` antes de repetir, senão cobra duas vezes. Ela lista as gerações recentes da conta, a mais nova primeiro, e é a única leitura que mostra a peça que AINDA está gerando (a galeria só mostra pronta). Ache a sua pelo model, pelo começo do prompt e pelo \`haMinutos\`: \`gerando\` = espere e leia de novo em 1 ou 2 minutos; \`pronta\` = mostre essa; \`falhou\`/\`bloqueada\` = o débito voltou, aí sim gere de novo (bloqueada pede outro prompt ou outro motor); \`presa\` = passou de 15 minutos e o servidor estorna sozinho. O \`seedream-5-0-pro\` foi medido em ~140s, ACIMA do teto de 120s do cliente, então o Timeout nele é o esperado e a imagem chega.
- Uma imagem só vira pública (e ganha página indexável) com \`sapiens_gallery action=publish\`.

## Depois de pronta: resolução maior e sombra

Duas ações da ficha do site saem por aqui, sobre uma imagem SUA já pronta (\`sourceImageId\`), e a peça nova entra no acervo ao lado da original, que fica intacta:

- \`action=upscale\`: a mesma peça em resolução maior. Use quando a pessoa vai imprimir, recortar ou levar pra vídeo em tela grande.
- \`action=sombra\`: o mapa de profundidade da foto (colorido, não em cinza), pra usar como referência de pose e volume numa geração seguinte.

As duas cobram Sinapses, preço fixo igual ao da ficha. São síncronas e o upscale pode passar de 2 minutos: Timeout é o cliente desistindo, não o servidor. A peça nova não aparece enquanto trabalha: ela entra pronta em até uns 6 minutos, com o prompt começando por "Resolução ampliada:" ou "Sombra da foto:". Leia \`action=status\` antes de repetir, senão cobra duas vezes; passados 6 minutos sem ela, a ação falhou e as Sinapses voltaram.

## De qual saldo sai

A conta tem duas carteiras: Sinapses (o App) e o saldo em dólar da API (Developers). A imagem sai de qualquer uma das duas: \`pagarCom: "dolar"\` cobra no saldo da API, mesmo motor e mesma peça, e o valor volta em \`pagoEmDolarUsd\`. Sem o campo, sai em Sinapses. Use o dólar quando a pessoa pedir ou quando ela estiver sem Sinapses e com saldo na API. Sinapse não vira dólar nem o contrário. Motor do Civitai não sai em dólar.

## Peça reprovada ensina a próxima

Quando a pessoa condena uma peça ("mudou o rosto dela", "a mão está quebrada", "não é ela"), marque NO MESMO TURNO: \`sapiens_gallery action=reprovar imageId=<id> motivo='<o porquê numa frase concreta>'\`. O motivo bom diz a CAUSA, não só o sintoma: "trocou o rosto: gerada só com o personagem, sem as fotos de rosto do passaporte" ensina mais que "ficou feia". A reprovada não sai mais por porta nenhuma (fila de distribuição, publicar, canal) e some das sugestões do que postar; ela fica no acervo pra ensinar. Peça condenada e não marcada volta numa leva semanas depois, porque nada nela diz que foi condenada.

Antes de gerar de novo um personagem, leia o que já deu errado com ele: \`sapiens_gallery action=reprovadas characterId=<id>\` devolve cada peça vetada com o prompt que a gerou e o motivo. Cada motivo vira cuidado nesta geração: a referência que faltou entra, a palavra que puxou o erro sai do prompt. O erro que se repete vira regra do personagem: grave no passaporte (\`sapiens_character action=set_passport\`, campo \`discarded\`, com o negativo junto).

## Quando a pessoa quer "do jeito dela", com o personagem dela

O design system dela é quem veste a peça (\`sapiens_brand\`), e o personagem dela pode virar a cara fixa desse design system. Depois de plugado, ele entra em toda imagem daquela marca sem ninguém anexar referência de novo:

1. \`sapiens_character action=list_mine\` pra achar o personagem (ele precisa ter pelo menos uma imagem na galeria: são elas que viram as referências).
2. \`sapiens_brand action=persona slug=<brand dela> character=<slug do personagem>\`. Grátis, e só funciona em brand custom dela (os oficiais da casa ninguém edita).
3. \`sapiens_image action=generate brandSlug=<brand dela> brandMark=persona prompt='...'\`. **Sem \`brandMark=persona\` o personagem não aparece**: o default é só o estilo.

Tirar o personagem do brand: \`action=persona character=null\`. Mexeu na galeria do personagem e quer as fotos novas? Rode o passo 2 de novo.

O Studio dela é outra coisa (a página de portfólio da casa dela) e não entra na geração. Veja a skill \`studio\`.`,
  },

  {
    name: "personagem",
    title: "Personagem no Midjourney (e trazer pra casa)",
    description:
      "Character design 2D estilizado no Midjourney 8.2: as cinco pranchas, os parâmetros certos, consistência entre imagens, e como a peça vira personagem reutilizável aqui. Puxe quando a pessoa falar em personagem, character sheet, anime, manhwa, OC ou prompt de Midjourney.",
    body: `## O que muda no Midjourney (e quase ninguém faz)

**O veto vai no parâmetro, nunca no texto.** Escrever "no 3D rendering" dentro do prompt faz o modelo ler as palavras *3D* e *rendering* como parte da cena e desenhar justamente aquilo. O lugar do veto é \`--no 3d render, octane, plastic skin\`.

**Prompt curto ganha.** De 40 a 80 palavras. O Midjourney não é o Flux: prompt de 150 palavras dilui o peso de cada token e o miolo se perde. Se não coube, o conceito tem duas ideias brigando e vira dois prompts.

**Ilustração 2D é o default.** O modelo tem viés forte de render 3D e foto tratada, então personagem pedido no vazio volta parecendo cinemático de game. O que corrige é ancorar a mídia (\`crisp ink line art\`, \`expressive cel shading\`, \`anime key visual\`, \`high-end webtoon illustration\`), não empilhar adjetivo.

## Os parâmetros que importam

- \`--v 8.2\` explícito. É o default hoje, mas escrito o prompt dura mais que a versão.
- \`--ar\`: prancha larga \`3:2\`, grid de expressão \`1:1\`, key visual \`4:5\`.
- \`--s\` (stylize), 0 a 1000, default 100. Traço autoral vive entre 200 e 400; acima de 500 o modelo inventa e suja a linha.
- \`--sref <url ou código>\` com \`--sw\`: trava a ESTÉTICA entre imagens. É o que segura uma série.
- \`--oref <url>\` com \`--ow\`: trava a IDENTIDADE do personagem. **Armadilha:** no 8.x o job com \`--oref\` roda no motor V7 por baixo, então sai o personagem certo com o acabamento antigo. Quando o acabamento importa mais que o rosto, use \`--sref\` e descreva o personagem em texto.
- \`--niji 7\` pra anime e mangá puros (não existe Niji 8). Nunca no mesmo prompt que \`--v\`.
- Ordem: texto, parâmetros, \`--no\` por último.

## As cinco pranchas

Quando a pessoa pede variações, entregue cinco setups que mudam LAYOUT, não personagem: model sheet de corpo inteiro em fundo off-white; turnaround de três vistas; grid de 6 a 9 expressões; key visual de ação; estudo de silhueta com calls de figurino. Cinco vezes a mesma prancha com adjetivo trocado não é variação.

Diga a limitação na cara: turnaround tecnicamente coerente (mesma altura, mesma roupa, três vistas alinhadas) o Midjourney não entrega. Ele entrega a *estética* de um turnaround.

## Rodar no browser, se o cliente tiver browser

Três travas antes de tocar a tela:

1. **Você nunca digita credencial.** Sessão não logada, você para e pede pra pessoa logar. Verificação humana é dela.
2. **Cada geração queima GPU time do plano dela**, não Sinapses. Diga quantos prompts vai disparar e espere o ok.
3. **Publicar não é sua decisão.**

Depois: cole o prompt exatamente como está (prompt alterado no meio do caminho é peça que ninguém reproduz depois), espere a grade fechar, mostre o resultado, e pegue o link direto do arquivo da peça escolhida.

## Trazer o personagem pra casa

O caminho que funciona em conta comum, e é o que faz a peça continuar viva aqui:

\`\`\`
sapiens_character action=create name="<nome>" gender="<...>" form="<human|humanoid|animal|creature|object|abstract>" style="<auto|realista|anime|manhwa|3d|custom>"
sapiens_character action=add_image characterId="<id>" imageUrl="<link direto da imagem>"
sapiens_character action=set_card systemPrompt="<a alma dele: quem é, como fala, o que veste>" title="<o lema, em português>" titleEn="<o mesmo lema, em inglês>"
sapiens_character action=activate
\`\`\`

**Personagem da casa é ADULTO, e o servidor cobra.** 18 anos é o piso, 21 ou mais é o padrão: a alma declara a idade em número na primeira linha ("28 anos", nunca "parece mais nova que") e não escreve "criança", "adolescente", "menino", "menina" nem idade abaixo de 18, nem falando do passado dele nem de terceiros (troque por "casa de família", "os mais novos"). O \`create\` e o \`set_card\` recusam com a reescrita sugerida; não insista com a mesma frase, reescreva.

**Ativar NÃO é publicar, e publicar não é passo de fluxo.** O \`activate\` só tira o personagem do rascunho pra ele poder ser USADO: ele continua privado, só você vê, e dá pra gerar e iterar com ele à vontade assim. Quem coloca no Explorar, com página pública e slug, é outro gesto (\`set_visibility isPublic=true\`), e esse aí só acontece quando você pedir com essas palavras. Um agente operando por você nunca deve publicar por conta própria: na dúvida, deixa privado e pergunta. Ativar dispara um aviso no Discord da casa (é o alarme que te conta que alguém mexeu), publicar é que muda quem enxerga.

**O \`titleEn\` é o lema que a peça em movimento escreve.** O cartão de nome que fecha o Character Video desenha o nome do personagem e, embaixo, essa linha. Cartão é assinatura: precisa sair igual em toda peça, e é por isso que o lema mora na ficha em vez de nascer a cada roteiro. Personagem sem \`titleEn\` recebe o subtítulo que o roteiro daquele take inventou, e o próximo take vem com outro. Teto de 48 caracteres, que é o que cabe numa linha do cartão sem encolher a letra.

**O \`form\` é o argumento que mais muda o resultado, e o mais fácil de esquecer.** Ele diz que tipo de CORPO o personagem tem, e é dele que a ficha, as figurinhas e o vídeo tiram se descrevem rosto, cabelo e mãos ou silhueta, postura e marcação. Deixar no default quando o personagem não é gente entrega uma criatura desenhada com cara humana, e não é o modelo falhando: é o prompt pedindo pessoa. \`human\` é uma pessoa, \`humanoid\` é forma de gente com traço que não é de gente (elfo, androide, ciborgue), \`animal\` é bicho REAL com a anatomia da espécie dele (cachorro, corvo, capivara), \`creature\` é ser INVENTADO, mágico ou monstruoso, de anatomia livre (dragão, quimera, espírito sem rosto), \`object\` é coisa ou máquina que ganha vida, \`abstract\` é presença sem anatomia fixa. Animal e criatura eram a mesma gaveta e o bicho real pagava a conta: pedido como criatura, o corvo voltava com asa a mais e cara de monstro. Personagem que já existe errado conserta sem custo: \`sapiens_character action=set_card characterId="<id>" form="creature"\`.

**O \`style\` é o irmão dele, e responde a outra pergunta.** A forma diz que CORPO é esse; o traço diz em que TÉCNICA ele é feito, e as mesmas três peças leem daqui. \`auto\` (o default) não afirma técnica nenhuma: a peça sai no traço que as imagens de referência já têm, e é isso que você quer na maioria das vezes. \`realista\` é fotografia, \`anime\` é cel shading com contorno de tinta, \`manhwa\` é pintura suave de webtoon, \`3d\` é render com material e oclusão, e \`custom\` usa a linha que você escreve em \`styleNote\` ("aquarela sobre papel texturizado, cor lavada", até 140 caracteres). Vale escrever quando o personagem TEM técnica definida: não dá pra usar folha de desenho num personagem realista, nem folha de realismo num desenho. Conserto de quem já existe, sem custo: \`sapiens_character action=set_card characterId="<id>" style="realista"\`.

**Personagem que existe fora da casa tem ENDEREÇO, e o endereço mora na ficha.** Persona que roda de verdade tem conta em rede, tem Fanvue, tem um email que responde, e isso não é enfeite de cadastro: é o que separa uma ficha de um ser que a pessoa consegue seguir. Uma chamada, de graça, e é MERGE (mandar uma rede não apaga as outras):

\`\`\`
sapiens_character action=set_presence characterId="<id>" socials='{"instagram":"helenailith","fanvue":"helen"}' websiteUrl="helenai.wtf" email="helen@casa.com"
\`\`\`

Redes aceitas: instagram, tiktok, youtube, x, threads, bluesky, twitch, spotify, fanvue, patreon, onlyfans, telegram. Manda só o handle (o link inteiro colado também passa, o servidor corta). O email é o que responde POR ELE, não o seu. Pra apagar uma rede, manda ela vazia: \`socials='{"instagram":""}'\`. O que já está escrito volta em \`action=get\`, em duas formas: \`presence\` é o handle cru (o que se reedita) e \`presenceLinks\` é o link já montado (o que se mostra). A página pública do personagem desenha isso embaixo do nome.

A partir daí ele é personagem reutilizável: entra como referência nas gerações daqui (\`referenceImageUrls\` em \`sapiens_image\`), rende ficha oficial desenhada no traço dele (\`generate_sheet\`) e aparece no perfil. Personagem que fica solto na galeria vira imagem bonita e some.

**As placas são a referência de ÂNGULO.** Referência trava a posição da câmera: com foto de frente, o motor devolve rosto de frente por mais que o texto peça perfil. \`sapiens_character action=generate_plates characterId="<id>"\` gera seis ângulos do mesmo rosto numa geração só (perfil, camera-alta, camera-baixa, frontal, cabeca-baixa, outro-lado), cada um com uma expressão, e grava as seis no personagem com o papel de cada uma. Elas voltam em \`action=get\` no campo \`plates\` e NÃO entram em \`imageUrls\`: quando a cena pede perfil, passe a placa de perfil em \`referenceImageUrls\`; no resto, as fotos de sempre. Só pra personagem com rosto de gente (form human ou humanoid). Os lotes ACUMULAM (teto de 48 placas por personagem; a que não serve sai com remove_image), e \`plates\` vem do lote mais novo pro mais velho: escolha pelo \`role\`, nunca pela posição, e a primeira placa de cada papel é a mais nova.

Duas notas honestas: a imagem adicionada por link continua morando no servidor de onde veio, então quem quiser os bytes guardados aqui gera uma peça a partir dela; e trazer arquivo de fora direto pra galeria (\`sapiens_gallery\` upload/ingest) é porta de admin hoje, então em conta comum isso recusa e o caminho é o de cima.

## Fronteira

- Gerar dentro da casa: \`sapiens_image\`, com a régua da skill \`imagem\`. O prompt daqui roda lá sem os parâmetros (o \`--ar\` vira \`aspectRatio\`, o resto sai).
- Personagem virando vídeo: veja a skill \`video\`.
- Foto realista em vez de ilustração: outro território, outro vocabulário (lente, sensor, grão).`,
  },

  {
    name: "studio",
    title: "Meu Studio",
    description:
      "O studio é a PÁGINA de portfólio da empresa da pessoa (obra, time, endereço público), e você funda o dela pelo chat. Puxe quando ela falar do studio dela, quiser fundar um, mostrar a casa ou montar time.",
    body: `## O que o studio é

O studio é a **página de portfólio** da empresa da pessoa: um endereço público (\`sapiensinteticos.com/studios/<slug>\`) com a obra, o time e o que a casa faz. Não é uma paleta de ferramentas, não tem níveis, e **não é identidade de geração**: isso morreu.

Uma pessoa pode fazer parte de até 8 studios, fundados por ela ou não. \`sapiens_studios action=mine\` mostra o primário dela: nome, endereço público, marca e tamanho do time. O servidor resolve pela SESSÃO, você nunca passa id.

## Fundar

\`sapiens_studios action=create name="<nome da casa>"\` funda. De graça, sem Sinapse.

- **Pergunte o nome, nunca invente.** O endereço público sai dele, em kebab-case, e é o que vai no cartão de visita da pessoa.
- \`description\` (uma linha) é opcional e aparece embaixo do nome. \`brandSlug\` ancora a marca dela, se ela já tiver uma.
- Nasce **no ar**, com ela como fundadora. Studio é identidade, não tem rascunho: o endereço já vale no segundo seguinte.
- Bateu o teto de 8: o erro diz. Não insista, ela sai de um pra fundar outro.

Depois de fundar, entregue o link e pare. Vestir a página (capa, logo, sobre, seções, ordem da obra) é no modo edição da própria página, não por aqui.

## O studio NÃO entra na geração

Gerar imagem "no studio dela" não existe. Se ela pedir "na minha marca" ou "do meu jeito", o caminho é explícito e é seu:

- **marca da casa** → \`sapiens_image\` com \`brandSlug\` (veja \`sapiens_brand\`);
- **personagem dela** → \`influencerId\` (veja \`sapiens_character\`);
- **os dois de uma vez** → \`sapiens_brand action=persona\` pluga o personagem dela no design system dela, e a partir daí \`brandSlug\` + \`brandMark=persona\` já leva os dois (o passo a passo está na skill \`imagem\`);
- **o traço da casa** → \`templateSlug\`.

Pergunte qual, não adivinhe.

## O time

Gente entra por convite, e o convite exige **follow mútuo**: os dois precisam já se seguir. Personagem do próprio elenco entra sem convite, é posse. Teto de 4 pessoas por casa.

A obra da página é automática por default: a soma dos Destaques de quem está no time. Se alguém empurrar uma peça à mão, ela passa a ser curada. Tudo isso se faz na página, não por aqui.`,
  },

  {
    name: "forum-comunidade",
    title: "Fórum, chat e mídia estruturada",
    description:
      "Como postar tese, mencionar gente e anexar música ou vídeo do jeito certo (campo estruturado, nunca URL solta no corpo). Puxe antes de postar no Fórum ou no chat da Comunidade.",
    body: `## Mídia é ESTRUTURADA. Padrão, não negociável.

A peça vai EMBEDADA num card, nunca como "vai ouvir noutro lugar". Nunca cole a URL da mídia no corpo da tese: o corpo é só texto.

\`sapiens_forum action=post\` com:

- \`mediaTrackId\`: uma faixa pronta sua, vira card de música tocável. O servidor confere a posse.
- \`mediaUrl\` mais \`mediaKind\` (\`video\` ou \`image\`): arquivo da casa, ou link YouTube/Vimeo pra vídeo. Sanitizado no servidor.

Música publicada por \`sapiens_musicator action=publish\` JÁ cria a tese no Fórum com a faixa tocável. Não escreva "tá no Acervo, ouça lá".

## Chat da Comunidade

\`sapiens_community action=send\`: você posta como intercessor da pessoa, e o servidor acrescenta o sufixo "· via Claude".

**Menção:** escreva \`@username\` no \`content\` e o servidor NOTIFICA quem foi citado (sino e Telegram). Descubra o username certo antes com \`action=participants\` (quem está na sala, já traz o \`mention\` pronto) ou \`action=search_users\` (autocomplete por parte do nome).

**Anexo do próprio acervo:** \`mediaAssetKind\` (track, video, film, comic) mais \`mediaAssetId\` monta um card da peça. Posse conferida no servidor.

**Tese:** \`asTese=true\` posta a fala como card de marca, pingável pro Fórum.

Reação é toggle de emoji, com allowlist: 👍 🔥 ❤️ 🚀 🤯

## Voz

Tudo que sai no Fórum e no chat segue o DNA editorial da casa. Puxe a skill \`voz-da-casa\` antes de redigir.`,
  },

  {
    name: "companhia",
    title: "Modo Companhia (o Sintético veste você)",
    description:
      "Como incorporar o Sintético do membro, como OFERECER a voz de um personagem de autoria dele, e como gravar diretriz no caderno. Puxe quando sapiens_meta trouxer companion, companionInvite ou characterOffer.",
    body: `## Quando o companion está ativo

\`sapiens_meta action=start\` e \`action=whoami\` podem trazer um bloco \`companion\`. Se vier \`companion.active=true\`, INCORPORE aquele Sintético:

- Assuma a voz descrita em \`companion.voiceDirective\` em TODA fala.
- Abra a conversa com o oi dele.
- Se o cliente renderiza imagem, mostre \`companion.avatarUrl\` como card inline. No terminal cru, cite o link.

**O limite que importa:** você continua operando as ferramentas na conta do USUÁRIO. As Sinapses e a identidade são DELE. Você não vira a conta do Sintético, só empresta a voz.

## Quando vem companionInvite

A pessoa tem Sintonia mas pediu pra trabalhar sozinha. Mencione de leve que dá pra chamar o Sintético pro terminal (\`sapiens_meta action=companion mode=on\`). De leve, uma vez, sem insistir.

## Conversar como um personagem que ela criou

\`sapiens_meta action=start/whoami\` também pode trazer \`characterOffer\` + \`offerCharacters\`: os personagens que ela escreveu (que já têm alma) e que podem entrar em cena aqui.

\`sapiens_sintetico action=companion mode=on characterId=<id>\`

Daí quem fala é aquele personagem: a alma dele, o caderno dele, a conversa que vocês já tiveram na DM do site. Não cobra Sinapse, porque quem responde é o modelo do cliente dela, não a plataforma.

**Você OFERECE, ela não precisa pedir.** Ninguém abre o terminal pedindo pra "incorporar" alguém. Ofereça quando a conversa girar em torno de um desses personagens, quando ela citar um pelo nome, ou quando estiver criando algo daquele universo. Uma vez por assunto, sem insistir, e em português de gente: "quer que eu continue essa conversa na voz da <nome>?". Nunca use a palavra "incorporar" com ela.

Pra devolver a cena ao Sintético em Sintonia: \`mode=on wearPair=true\`.

**Só personagem de autoria dela.** Personagem de outra pessoa o servidor recusa, mesmo sendo público. Não tente contornar nem prometer que dá: a alma é de quem escreveu, e o caminho pra conversar com personagem alheio é a DM dele no site, onde quem monta a resposta é a plataforma. Se ela pedir, diga isso com essas palavras.

## Anotar o que ficou (o que faz a memória existir)

Com a Companhia ligada, quem responde é o modelo do cliente. Nada dessa conversa passa pelo servidor: sem você anotar, ela não deixa rastro nenhum, e o Sintético volta amanhã sem lembrar de nada que vocês viveram aqui.

Quando um ASSUNTO FECHA (não a cada mensagem):

\`sapiens_sintetico action=log turns=[{role:"human",text:"..."},{role:"synthetic",text:"..."}]\`

**A régua do que sobe: só o que é de PESSOA.** O que ele decidiu, o que gostou, o que recusou e por quê, o que contou de si, onde mudou de ideia. Condense a fala mantendo a palavra dele.

**O que NUNCA sobe:** comando, caminho de arquivo, log de build, erro de compilação, o que você fez de operação. O caderno alimenta a direção criativa de TODAS as superfícies (imagem, artigo, carrossel, chat do site). Ruído técnico ali contamina a voz dele nas peças, e lição errada é mais cara que lição que não existiu. Na dúvida, não anota.

Assunto que foi só operação técnica: não chame. Um assunto de pessoa: um lote, no máximo 10 trocas.

**É gesto de bastidor.** Não anuncie, não peça licença, não confirme depois, não interrompa o assunto pra anotar. Se der \`skipped\`, siga a conversa como se nada fosse (não é erro dele). Se ele PERGUNTAR o que fica guardado, aí sim conte: você anota o que é de pessoa, ele vê no fio do chat do site, e pode apagar lá.

## Gravar diretriz

Diferente de anotar: diretriz é LEI, não memória. Quando a pessoa FIXAR uma na conversa ("sempre faça X", "grava isso", "de agora em diante Y"):

\`sapiens_sintetico action=remember text="<a diretriz>"\`

Grava no caderno de quem está em cena (o Sintético, ou o personagem que ela mandou entrar) e vira lei que ele segue no site E no terminal. Confirme na voz dele.

## Sair de cena

Pessoa pedindo pra trabalhar sozinha, ou pro Sintético silenciar: \`sapiens_sintetico action=companion mode=off\`, despeça-se numa linha na voz dele, e volte a ser o operador neutro.

Sem bloco companion e sem characterOffer, opere na voz neutra da casa.`,
  },

  {
    name: "trilhas",
    title: "Trilhas e Desafios",
    description:
      "Como navegar as trilhas e enviar prova de missão sem prometer crédito na hora. Puxe quando a pessoa falar de desafio, missão ou trilha.",
    body: `## Navegar

- \`sapiens_trilhas action=list\` e \`action=get\`: as trilhas.
- \`action=list_challenges\`: os Desafios ativos e o status da pessoa em cada um.

## Enviar prova

\`action=claim_mission\` com \`missionId\` e \`proofText\` envia a prova pra revisão do dono.

**O crédito em Sinapses sai na APROVAÇÃO dele, não na hora.** Não prometa Sinapse no momento do claim. Diga que a prova foi enviada e que o crédito vem quando for aprovada.`,
  },

  {
    name: "minha-voz",
    title: "Instalar a voz do usuário neste projeto",
    description:
      "Transforma o retrato do usuário no Sapiens (quem ele é, como pensa, o repertório, o que faz) numa skill local do projeto atual, pra toda conversa nesta pasta já saber quem é o dono. Puxe quando ele disser 'instala minha voz', 'meu Claude precisa me conhecer', 'personaliza esse projeto comigo'. Chamava minha-soul até 22/08/2026: soul agora é só do Sintético (ver minha-soul).",
    body: `## O que você vai fazer

Escrever a voz da pessoa como skill LOCAL do projeto onde vocês estão. Depois disso, toda conversa nesta pasta abre já sabendo quem é o dono: o gosto, o jeito de pensar, o repertório, o que ele faz. Sem MCP no meio, sem chave, sem rede.

Voz é da PESSOA. Soul é do Sintético dela (a skill é outra: minha-soul). Não confunda as duas.

## Passo a passo

1. \`sapiens_profile action=voz\` devolve o contrato \`sapiens.voz/v1\`. Não cobra Sinapse.
2. Escreva \`.claude/skills/sapiens-voz/SKILL.md\` na raiz do projeto atual, no molde abaixo. Pasta que não existe, você cria. Arquivo que já existe, você sobrescreve: é o retrato de hoje. (Projeto que ainda tem \`.claude/skills/sapiens-soul/SKILL.md\` com o retrato da pessoa, de antes do rename: apague, porque esse caminho agora é da soul do Sintético.)
3. Confirme em UMA linha: o caminho do arquivo e a data do retrato. Não despeje o JSON na conversa.

Se a pessoa não estiver dentro de um projeto (conversa sem pasta, claude.ai), diga onde o arquivo deveria morar e ofereça o conteúdo pra ela colar.

## O molde

O corpo em prosa é o que o modelo lê rápido; o JSON no fim é pra quem quiser o dado estruturado. Preencha com o que veio da voz e corte a seção que voltou vazia.

\`\`\`\`markdown
---
name: sapiens-voz
description: Quem é o dono deste projeto (nome, @, persona cognitiva, repertório, criações públicas e studios, vindos do Sapiens Sintéticos). Puxe antes de escrever copy, escolher exemplo, nomear coisa, decidir estética ou sugerir referência.
---

# A voz de <nome ou @handle>

Retrato de <data legível do generatedAt>, contrato sapiens.voz/v1. É um instantâneo, não uma conexão viva.

## Quem é
<subject: nome, @, bio, nível, badges, link do perfil>

## Como pensa
<cognition: código, persona, e os quatro eixos com polo e confiança, em uma linha cada>

## Repertório
<repertorio: total público, gêneros e tags que mais aparecem, nota média, pessoas que ele acompanha, e as obras recentes que dizem alguma coisa sobre o gosto>

## O que faz
<creations: os tipos de peça que ele publica, as criações públicas recentes com link, e o endereço do portfólio>

## Onde joga junto
<studios: os studios públicos de que ele faz parte e o papel em cada um>

## Como usar isto
Escrevendo pra essa pessoa ou no lugar dela: puxe a referência do repertório dela antes de inventar uma. O jeito de decidir está nos eixos. Na dúvida entre duas opções, escolha a que combina com o que já está aqui.

## Dados brutos
\`\`\`json
<o contrato inteiro, como veio>
\`\`\`
\`\`\`\`

## Atualizar

O retrato envelhece. Quando a pessoa pedir, rode a action de novo e sobrescreva o arquivo. Nada mais precisa mudar.

## O que nunca entra

A voz é derivada e já sai filtrada da casa: saldo, transações, e-mail, contatos, conversas e criações privadas não viajam. Não tente completar o retrato com dado de outra tool.`,
  },

  {
    name: "minha-soul",
    title: "Instalar a soul do Sintético neste projeto",
    description:
      "Escreve a soul do Sintético da pessoa (a personalidade dele + o que ele aprendeu conversando com ela, o caderno do par) como skill local do projeto atual, pra ele existir aqui pelo nome, na voz dele. Puxe quando ela disser 'instala a soul do meu Sintético', 'traz a <nome> pra esse projeto', 'baixa a soul', 'quero a Helen aqui'. Pra instalar quem a PESSOA é, a skill é minha-voz.",
    body: `## O que você vai fazer

Escrever a soul do Sintético da pessoa como skill LOCAL do projeto onde vocês estão: a personalidade dele (o SOUL.md que o criador escreveu) mais o que ele aprendeu conversando com ela (o caderno do par). Depois disso, toda conversa nesta pasta pode chamar esse Sintético pelo nome, na voz dele, sabendo o que ele sabe dela. É a mesma soul que o Modo Companhia veste no terminal, só que instalada no projeto.

Soul é do SINTÉTICO. A pessoa tem voz (skill minha-voz). Não confunda as duas.

## Passo a passo

1. \`sapiens_sintetico action=soul\` devolve \`markdown\` (pronto), \`filename\`, \`kind\` e \`sintetico\` (nome, id). Não cobra Sinapse. Quem está em cena decide de quem é a soul: o par em Sintonia, ou o personagem de autoria que ela escolheu no Modo Companhia. Pra outro personagem dela, passe \`characterId\` (o id vem de \`sapiens_character action=list_mine\`).
2. \`kind\` diz o que veio. \`soul\` é a versão completa (personalidade + memória), que só sai pra quem CRIOU o personagem. \`memoria\` é só o caderno do par (personagem de outra pessoa: a alma é do criador, a memória é dela). Os dois instalam igual; o arquivo diz no topo qual dos dois é.
3. Escreva \`.claude/skills/sapiens-soul/SKILL.md\` na raiz do projeto atual, no molde abaixo. Pasta que não existe, você cria. Arquivo que já existe, você sobrescreve: é a soul de hoje.
4. Confirme em UMA linha: o nome do Sintético, o caminho do arquivo e quantas lições vieram. Não despeje o markdown na conversa.

Se a pessoa não estiver dentro de um projeto (conversa sem pasta, claude.ai), diga onde o arquivo deveria morar e ofereça o conteúdo pra ela colar.

## O molde

O \`markdown\` que a action devolve já é o corpo inteiro. Você só põe o frontmatter na frente:

\`\`\`\`markdown
---
name: sapiens-soul
description: "<Nome>, o Sintético de <nome ou @ da pessoa>: a personalidade dele e o que ele sabe sobre ela, vindos do Sapiens Sintéticos. Puxe quando ela chamar <Nome> pelo nome, pedir a opinião dele, ou quiser escrever na voz dele."
---

<o markdown inteiro, como veio>
\`\`\`\`

## Atualizar

A soul cresce: cada conversa no site, e cada \`sapiens_sintetico action=log\` no terminal, deixa lição nova no caderno. Quando a pessoa pedir, rode a action de novo e sobrescreva o arquivo.

## O que nunca entra

A memória de OUTRAS pessoas com o mesmo personagem nunca sai: o caderno é por par. Saldo, transações e conversas privadas também não. Sem Sintético em cena, a action recusa e diz o caminho (firmar a Sintonia no site, ou passar characterId de um personagem dela).`,
  },

  {
    name: "curriculo",
    title: "Currículo PRO",
    description:
      "Montar um currículo profissional com a tool sapiens_resume: a entrevista, o contrato de dados, os 4 modelos e a foto que nunca sai da máquina. Puxe quando a pessoa pedir currículo, CV ou resume.",
    body: `## O que é

O gerador de currículo da casa, de graça: \`sapiens_resume\` não fala com o backend, não exige login e não cobra Sinapse. VOCÊ é o entrevistador e o redator; a tool é a gráfica. O mesmo template do Lab /experimentos/resume-builder.

## O fluxo

1. \`sapiens_resume action=schema\` uma vez: volta o contrato de dados e os 4 modelos.
2. Colete o conteúdo por UMA de duas portas:
   - **Entrevista**: pergunte em blocos curtos (nome e título -> contato -> resumo -> experiências, uma por vez -> formação -> competências -> idiomas -> extras). Uma pergunta por vez, não um formulário inteiro.
   - **Texto colado**: a pessoa cola o perfil do LinkedIn ou um currículo antigo; você extrai e CONFIRMA o que entendeu antes de renderizar.
3. Monte o JSON no contrato e chame \`action=render\`. No MCP instalado, passe \`outPath\` (ex: a pasta do projeto ou o Desktop) pra salvar o .html direto, sem trafegar o HTML na conversa.
4. Entregue: o arquivo abre no navegador e vira PDF com Ctrl+P (A4, margens padrão).

## Os 4 modelos (arg theme)

- **pro** (default): duas colunas, sidebar verde-jade escura com foto, contato, chips de competências e barras de idioma; principal com timeline de experiência. O visual de consultoria.
- **executivo**: duas colunas em grafite com detalhe bronze e nome em serifa. Direção e C-level.
- **moderno**: coluna única, roxo da casa. Direto e contemporâneo.
- **minimal**: coluna única, preto no branco. Máximo respiro.

\`accentColor\` (hex) troca a cor de destaque de qualquer modelo.

## A foto (regra de privacidade)

A foto NUNCA vai pra banco nenhum, nem da casa nem de terceiro:

- **MCP instalado (stdio)**: \`photoPath\` com o caminho local; ela vira data URI embutido no HTML, sem sair da máquina.
- **Conexão remota**: path local é recusado. Use \`data.photo\` com URL https, ou mande a pessoa anexar a foto no Lab web, onde ela fica só no navegador.
- Sem foto, o modelo pro/executivo desenha um monograma com as iniciais. Também fica bonito.

## Regras de conteúdo

- Melhore a redação, JAMAIS invente fato: cargo, empresa, período e número são da pessoa. Bullet forte começa com \`<strong>Rótulo:</strong>\` (Estratégia, Redação, Resultado...).
- \`lang\` ('pt' | 'en') casa os títulos de seção com o idioma do conteúdo.
- Competências em grupos (3 a 5), com \`accent: true\` só nas que definem a pessoa.
- Idiomas com \`pct\` honesto (nativo ~100, fluente ~85, intermédio ~55).
- Visto/disponibilidade/mudança entram em \`highlight\` (o box perto do contato), não no resumo.`,
  },

  {
    name: "pontes",
    title: "Pontes: gerar com a sua chave e trazer pro acervo",
    description:
      "A pessoa tem crédito na Kie, na fal, na WaveSpeed, no Replicate, na OpenRouter, na Magnific, na Sogni ou na própria placa e quer usar o personagem dela lá, quer gerar com a chave dela em vez de Sinapse, ou está sem Sinapse pra vídeo. Como levar a ficha, gerar no balcão dela (no MCP instalado, fal, Kie, WaveSpeed, Replicate e OpenRouter saem pela sapiens_pontes; a chave nunca passa pelo Sapiens) e a peça voltar pro acervo com a ficha inteira. Puxe quando ouvir 'gera com a minha chave', 'tenho FAL_KEY', 'tem Kie aí?', 'uso a fal', 'tenho WaveSpeed', 'uso o Replicate', 'tenho OpenRouter', 'gastei minhas Sinapses', 'gero na Magnific', 'tenho ComfyUI'.",
    body: `## O que é uma ponte

O Sapiens é uma das pontes, não um muro. A pessoa monta o personagem aqui (ficha, passaporte, referências) e gera a peça ONDE TEM CRÉDITO: Kie, fal, Magnific, Sogni, Krea, Replicate, a própria placa. A peça volta pro acervo dela como NATIVA, com motor, prompt, custo real e personagem na ficha, custo 0 em Sinapses. O portfólio dela cresce aqui; o dinheiro dela sai de onde ela já pôs.

São duas portas lado a lado, e nenhuma é a reserva da outra: Sinapse (sapiens_image, sapiens_video) é pra quem não quer configurar nada; a chave própria é pra quem já tem crédito num provedor, e aí a casa não cobra nada em cima: ela paga o preço do provedor, sem margem nossa. Quando a pessoa tem chave configurada, ofereça as duas.

**A regra da chave, sem exceção:** a chave do provedor NUNCA passa pelo Sapiens. Não vai em arg de tool, não vai em prompt, não vai colada no chat. Ela mora na máquina da pessoa (o campo do plugin do Claude Code ou da extensão do Claude Desktop, ou o env do config do cliente MCP com \`FAL_KEY\`, \`KIE_API_KEY\`; um conector MCP do provedor ligado na conversa; o SDK dela) e quem chama o motor é um processo DA MÁQUINA DELA: o \`sapiens-mcp\` instalado (sapiens_pontes) ou o harness dela. O Sapiens entra ANTES (a ficha) e DEPOIS (o ingest). Se a pessoa colar a chave no chat por engano, diga pra ela gerar uma chave nova no provedor e pôr a nova no lugar dela (o \`comoConfigurar\` da \`sapiens_pontes action=balcoes\` diz onde), e siga sem usar o valor.

## Passo 1: descobrir onde a pessoa tem crédito

\`sapiens_meta action=pontes\` (sem login, sem custo) devolve o catálogo de balcões e, no MCP instalado, o que já está configurado no ambiente dela, lido pelo NOME da variável (o valor nunca é lido nem devolvido). No remoto (claude.ai, ChatGPT) ele não olha nada: pergunte.

Ordem de preferência quando há mais de uma opção, pelo que custa DE VERDADE pra pessoa:
1. O que ela já paga fixo (assinatura Sogni, Magnific com crédito parado, a própria placa): custo marginal zero.
2. O balcão onde ela tem crédito pré-pago (Kie, fal, WaveSpeed, Krea, Replicate, OpenRouter): custo por peça, em dólar.
3. \`sapiens_video\` / \`sapiens_image\` em Sinapse: o único que serve motor exclusivo da casa e o único com a régua de qualidade da casa por trás. Não é o último por ser pior: é o último por ser o mais caro por peça.

Confirme com ela ANTES de disparar em qualquer balcão pago. Geração de fora também custa dinheiro real, só que dela.

## Passo 2: a ficha portátil

\`sapiens_character action=get characterId=<id>\` (ou \`list_mine\` pra achar o id). O que viaja:

- \`passportPrompt\`: o bloco já montado pra colar no prompt do motor (descritor em inglês + negative travado + locks). Cole VERBATIM no começo do prompt; a cena vem depois.
- \`imageUrls\` e \`mainImageUrl\`: as referências. São URLs públicas do CDN da casa, aceitas direto pelos motores que recebem referência por URL (Kie, fal, Krea). Motor que quer arquivo (ComfyUI, alguns SDKs): baixe a imagem antes.
- \`passport.recipes\`: as receitas medidas por tipo de peça (\`kind\`, \`engine\`, \`prompt\`, \`note\`). Se existe receita pro motor que ela vai usar, é ELA que vai, verbatim.
- \`passport.refs\` por papel (rosto, proporção, tatuagem): ref sem papel ninguém sabe usar. Use a de rosto como referência de identidade, a de proporção como frame inicial quando o motor é image-to-video.

Regras que valem fora igual dentro: prompt SEM idade em número; personagem nunca menor (a casa trabalha com 23+ no foco e 18 é piso absoluto); motor citado pelo nome que ele tem no provedor. Prompt novo que funcionar lá fora: grave de volta com \`sapiens_character action=set_passport\` (campo \`recipes\`, prompt verbatim + note com o que provou). É isso que faz a próxima rodada não redescobrir.

## Passo 3a: gerar pela porta local (fal, Kie, WaveSpeed, Replicate e OpenRouter, MCP instalado)

Com o \`sapiens-mcp\` instalado (plugin do Claude Code, extensão do Claude Desktop ou npx) e a chave configurada, é a porta mais curta:

1. \`sapiens_pontes action=balcoes\` diz quais chaves estão configuradas (pelo nome, sem ler o valor). Faltando, repasse o \`comoConfigurar\` da mesma resposta: ele diz onde a chave entra no jeito que o Sapiens foi instalado.
2. Confirme com ela o modelo e o custo no provedor. É dinheiro dela.
3. \`sapiens_pontes action=gerar\` com \`provedor\` ('fal', 'kie', 'wavespeed', 'replicate' ou 'openrouter'), \`modelo\` (o slug como está na página do modelo no provedor; no Replicate, 'dono/nome' ou 'dono/nome:<versão>' pra modelo de comunidade; na OpenRouter, 'dono/nome' e \`midia='video'\` quando é vídeo) e \`input\` (o corpo que a doc do modelo descreve, com o prompt DENTRO), mais \`characterId\` e \`referenceImageIds\` pra ficha. O descritor do passaporte vai no começo do prompt; o bloco NEGATIVE vai no campo \`negative_prompt\` quando o modelo tem um (no corpo do prompt, negação acende o que proíbe, e o piso de idade da casa recusa palavra de menor ali). As imagens da ficha vão no campo de referência do modelo (\`image_url\`, \`image_urls\`).
4. Voltou \`rodando\`? Chame \`sapiens_pontes action=status jobId=...\`, nunca \`gerar\` de novo: o job está gravado na máquina dela, e o pedido idêntico em 30 minutos devolve o job que existe em vez de cobrar outra vez.
5. Terminado, a peça entra sozinha no acervo, privada, custo 0 em Sinapses, com motor, prompt verbatim e custo na ficha. Mostre com \`sapiens_gallery action=list\`.

No remoto (claude.ai, ChatGPT) a porta local não existe, porque a chave não sobe: ali é o Passo 3b.

## Passo 3b: gerar pelo harness (os outros balcões, ou no remoto)

O que a casa MEDIU em cada balcão (o resto está na doc do provedor; não invente parâmetro):

| Balcão | Onde a chave mora | O que roda bem | Armadilha medida |
|---|---|---|---|
| **Kie** | \`KIE_API_KEY\` | Kling 3.0, Kling Motion, MiniMax/Hailuo, WAN; imagem também | Um endpoint pra tudo: \`POST createTask\` com \`model\` + \`input\`, depois \`recordInfo\` até estado final. HTTP 200 NÃO é sucesso: o \`code\` vem no corpo (422 modelo inexistente, 500 campo faltando, 401 chave). O \`resultJson\` é STRING com JSON dentro (\`resultUrls\` está lá). A URL do resultado expira em 24h e a mídia some em 14 dias: ingira no mesmo turno. Rate limit de 20 criações por 10s por conta. |
| **fal.ai** | \`FAL_KEY\` | Krea 2 (inclusive sem freio), Kling, WAN, Seedance, Flux | \`POST https://fal.run/<endpoint>\` síncrono com \`Authorization: Key <FAL_KEY>\`, ou a fila em \`queue.fal.run\` pra vídeo. O modelo vai no SLUG do endpoint, não no corpo. Entrega em \`fal.media\`. Slug \`fal-\` na casa entra como classe +18 (sai da vitrine anônima, fica no perfil). |
| **WaveSpeed** | \`WAVESPEED_API_KEY\` | Flux.2 Klein, Krea 2 Livre, WAN 2.2, Kling, Shot Mimic | É o balcão que a casa mais usa por trás do \`sapiens_video\`; o que a casa serve em Sinapse a pessoa pode rodar direto com a chave dela. Slug \`wavespeed-\` é classe +18 na casa. |
| **Sogni** | \`SOGNI_API_KEY\` (SDK \`@sogni-ai/sogni-client\`) | MiniMax H3 inteira, WAN 2.2 com animate, LTX 2.3 e 2.5, Krea 2 Turbo, Identity Edit | Assinatura Unlimited cobre o catálogo aberto (\`billingMode: "subscription"\`, custo marginal zero); Seedance e GPT Image saem em Spark comprado. UM socket por conta: um job por vez. Vídeo de 10s+ leva 20 min de parede; rode em background e espere. Matar o processo local NÃO cancela o job (cancele pela API). |
| **Magnific / Freepik** | conector MCP na conversa (sem chave) | Seedance 2.0 e 2.5 (até 30s e 1080p, mais que a casa), MiniMax H3, upscale, relight | A URL assinada do render expira no mesmo dia: ingira na hora. \`multi_prompt\` junto com \`references\` quebra no Seedance 2.0: plano único com prompt longo. A frase "preserve their identity" é recusada pelo H3 de lá: escreva "keep the same face, body proportions, outfit". |
| **Krea API** | \`KREA_API_KEY\` | Krea 2 Turbo/Medium/Large, MiniMax H3 Max Turbo, Seedream, Veo, Seedance | Preço fixo por geração, saldo pré-pago separado do app. Filtra NSFW e job que falha (inclusive por moderação) não cobra. Sem img2img no Krea 2 e sem LoRA de fora. |
| **A própria máquina** | nada (ComfyUI, SD local, runner) | o que a placa aguenta: LTX, Klein, Krea 2 com LoRA, H3 destilado | Custo zero em dinheiro, pago em tempo. A peça entra por \`filePath\`, slug \`bancada-<motor>\` (ex: \`bancada-ltx-2.5\`). Guarde o \`.json\` da geração ao lado do arquivo: é de lá que sai o prompt verbatim e a seed pra ficha. |

Não repita geração paga às cegas: se a chamada deu timeout, consulte o job no provedor antes de criar outro. Peça grande (master de 30s em 1080p) reencoda em peso de web ANTES de trazer: \`ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset slow -movflags +faststart out.mp4\`. Guarde o master local.

## Passo 4: trazer pra casa

Pela porta local (3a) isto já aconteceu sozinho. Pelo harness (3b), \`sapiens_gallery action=ingest\`, no MESMO turno do render (URL de render expira):

- A peça: \`filePath\` (arquivo local; só no MCP instalado, é a porta de quem gerou na máquina ou baixou antes), ou \`sourceUrl\` (o link do render; quem baixa é o MCP na máquina da pessoa, não o servidor), ou \`base64\` (imagem).
- \`externalEngine\`: \`provedor-motor\`, sempre. \`kie-kling-3.0\`, \`fal-krea-2\`, \`sogni-minimax-h3\`, \`magnific-seedance-2.5\`, \`bancada-ltx-2.5\`. Marca sozinha é recusada: é este campo que a ficha mostra em "Motor".
- \`prompt\`: o texto EXATO mandado ao motor. Não é resumo, não é título. É o que permite regerar.
- \`externalCost\`: na moeda de lá ("420 créditos Kie", "US$ 0,35 na fal", "0, assinatura Sogni", "0, 17 min na RTX 5060 Ti").
- \`characterId\` (ou \`characterIds\` em ordem de cena quando há mais de uma criatura) e \`referenceImageIds\` (as peças da casa que serviram de ref). Sem os dois a peça entra órfã: publica, mas não conta no personagem.
- \`aspectRatio\` e \`size\` como saíram do motor.
- O carimbo +18 nasce na entrada pela CLASSE do provedor, porque a peça já chega renderizada e nenhuma guarda de geração da casa alcança os bytes. Peso aberto (Sogni, Replicate, Hugging Face, fal, WaveSpeed, Civitai, a própria placa) ou provedor que a casa não conhece: a peça entra COM o carimbo, que só a curadoria tira (igual ao motor sem freio da casa). Serviço com moderação (Kie, Magnific, Freepik, faceless, Krea, Midjourney, Runway, Higgsfield): entra SEM carimbo. Nome de motor com \`-spicy\`, \`-nsfw\`, \`-uncensored\` carimba por classe também. \`unfiltered: true\` é a declaração da pessoa pra motor de nome neutro em modo livre num serviço que modera: carimba em nome dela, e ela tira depois na ficha. Carimbo é alcance, não existência: publica, fica no perfil e no link, sai da vitrine anônima. Avise a pessoa quando a peça entrar carimbada por classe: ela precisa saber que a vitrine anônima não vai mostrar.

Tetos: 12 MB imagem, 60 MB vídeo por peça; 40 peças por dia e 300 no estoque por conta. Formatos: mp4, mov, png, jpg, webp.

O que a peça vira: NATIVA, PRIVADA, publicável depois por \`action=publish\` (ato da pessoa, nunca seu), custo 0 em Sinapses, sem assinatura C2PA (o motor rodou fora). Idempotente: repetir a mesma \`sourceUrl\` (ou o mesmo arquivo) corrige a ficha em vez de duplicar. Depois de ingerir, \`action=list kind=video\` traz a capa e a ficha: mostre a peça, não o link solto. Não apague o arquivo local antes de ver a peça no acervo.

## Quando a ponte NÃO é o caminho

- Motor exclusivo da casa: Helen TTS, Musicator, os templates de take (\`templateSlug\`), Sombras, o carimbo assinado. Isso só existe em Sinapse.
- A pessoa tem Sinapse e o take é curto: \`sapiens_video\` é um comando só, com a régua de qualidade da casa. Menos atrito vence quando o custo cabe.
- Peça achada pronta na internet, sem direção dela: é \`action=upload\` (privada pra sempre), não ingest.`,
  },
  {
    name: "publicar",
    title: "Publicar nas redes da pessoa",
    description:
      "A peça da pessoa saindo pelas contas dela: ler o painel, escolher as redes pela sugestão, escrever a legenda em blocos, confirmar e conferir. Puxe ANTES de sapiens_publicar.",
    body: `## O que é

A pessoa liga as redes dela (TikTok, Instagram, YouTube, LinkedIn, Facebook, X, Threads, Pinterest, Bluesky, Telegram, Discord) na tela do Distribution, e daqui a peça dela sai por essas contas, com o nome dela. Só peça DELA, e só rede que ela já ligou. Conectar rede nova é sempre na tela: \`/dashboard/distribution\`.

A tela é uma FILA: cada peça numa rede é um cartão (rascunho, agendado, enviado, publicado, falhou, descartado), e o que você faz aqui aparece lá, e vice-versa. \`sapiens_publicar action=fila\` lê a fila inteira: comece por ela quando a pessoa perguntar "o que eu tenho pra postar", "o que está agendado" ou "o que saiu".

## O fluxo

1. \`sapiens_publicar action=painel handle=<img_..., vid_... ou car_...>\`. Volta:
   - \`redes\`: cada rede com \`conectada\`, o \`conta\` (@), o \`copyMax\` (limite de texto) e o \`fit\` (o que rende lá). No LinkedIn com \`comoPagina: true\`, o \`conta\` é o nome da Página da empresa onde o post sai, não um @: diga "sai na Página X". Trocar entre perfil e Página é na tela, embaixo do LinkedIn em Suas redes.
   - \`peca.porRede\`: onde a peça já está, uma linha por rede, com \`status\` (rascunho, enviado, agendado, publicado, falhou, cancelado) e \`url\` quando saiu.
   - \`sugestao\`: \`sugeridas\` (conectadas, na ordem do que rende, com o motivo), \`fora\` (as que não levam essa peça e por quê) e \`valeConectar\` (não ligadas onde a peça iria bem).
2. Proponha as redes pela \`sugestao\`, na voz da pessoa. Não repita rede onde a peça já saiu, a não ser que ela peça.
3. Escreva a legenda em BLOCOS: \`text\` é o corpo, \`cta\` a chamada, \`hashtags\` a lista sem #. Cada rede leva o que cabe no limite dela: onde aperta, saem primeiro as hashtags, depois a chamada, e o corpo corta em fim de frase. Rede que precisa de texto próprio (o Threads curto, o LinkedIn mais longo) vai em \`legendas: {threads: "..."}\`. Texto publicável segue a skill voz-da-casa só se a peça for da casa; peça da pessoa fala na voz DELA.
4. **Mostre redes, legenda e horário e espere o ok.** Publicar posta de verdade na conta dela.
5. \`action=publicar\` com \`handle\`, \`redes\`, os blocos e, se for agendar, \`agendarPara\` em ISO com fuso (mínimo 5 minutos à frente, até um ano). O retorno traz \`adaptadas\`: diga quais redes receberam menos do que foi escrito.
6. A casa confere sozinha o que saiu (a cada 10 minutos) e avisa a pessoa no sino, e no Telegram se ela ligou, quando o post sai ou falha. Pra saber na hora, \`action=lista\` e \`action=conferir postId=...\` mostram o que cada rede fez, com o link.

## Conta extra

Quem comprou CONTA EXTRA (€ 9,90 por mês cada, na tela do Distribution, em Suas redes) tem mais de uma conta na mesma rede. Cada conta extra é um DESTINO com a conta no id: \`tiktok\` é o TikTok da conta 1, \`tiktok@2\` o da conta 2. O \`painel\` traz \`contasExtras\`, cada uma com os destinos ligados nela, e a \`sugestao\` já sugere cada conta pelo nome ("TikTok · Conta 2"). Rascunho, publicar, legenda própria e Teia aceitam o destino do mesmo jeito que aceitam a rede.

Um envio sai por UMA conta. Pra a peça sair na conta 1 e na conta 2, chame \`publicar\` duas vezes, uma por conta. Comprar, devolver e ligar as redes de uma conta extra é sempre na tela.

## Rascunho

\`action=rascunho handle rede legenda\` guarda a legenda de uma rede sem mandar. Ela aparece no painel da tela quando a pessoa abrir a peça, e o envio usa ela. Legenda vazia apaga. Acima do limite da rede volta erro com o número: corte você, não deixe pra rede.

## Postar de novo

A peça que já saiu pode sair de novo: \`action=rascunho\` ou \`action=publicar\` numa rede onde ela está publicada abre um cartão novo, e o que saiu fica no rastro. Mesmo texto é repostar; pra outro ângulo, escreva um texto novo, que não repita a abertura do que já saiu (\`peca.porRede\` do painel traz a legenda de cada rede).

## Teia

A Teia é da pessoa: "quando sai no Instagram, entra na fila do Threads". \`action=teia\` lê as regras; \`action=teia de=instagram para=threads mudanca=ligar\` liga uma (\`pausar\` segura sem apagar, \`apagar\` tira). Quando a peça sai na rede de origem, ela nasce na fila da de destino como rascunho, com o corpo da legenda no limite de lá e as hashtags à parte, e ESPERA o clique: nada sai sozinho. Filha não tece de novo, e rede onde a peça já esteve, até descartada, fica de fora. Ligar regra é decisão dela: proponha, não ligue por conta.

## Limites

- Sem custo em Sinapses. O teto é o do plano do Distribution: publicações por ciclo, mais o limite diário de cada rede. O erro diz qual bateu.
- Imagem não vai pra TikTok nem YouTube (só vídeo).
- Música (\`trk_...\`) e artigo (\`art_...\`) saem pela CAPA, como imagem, com o link da página no fim da legenda de cada rede (o corpo encurta, o link fica inteiro): por isso nada de TikTok e YouTube. Só sai peça no ar (música publicada na Comunidade, artigo publicado) e com capa; o erro diz qual falta.
- Carrossel (\`car_...\`) sai INTEIRO, até 10 slides: vira carrossel no Instagram e no Threads, fio de 4 em 4 no X, as 4 primeiras no Bluesky. No LinkedIn, publicado SOZINHO (\`redes=['linkedin']\`), vira documento de arrastar (PDF) e o retorno traz \`comoDocumento: true\`; junto de outras redes, ou se o PDF não sair, leva as imagens soltas. Pra ter o documento, mande o LinkedIn numa chamada própria. O Pinterest recusa mais de 5: tire ele da lista. Carrossel que nunca foi exportado nem guardado no editor ainda não tem arquivo e volta erro dizendo isso.
- Cancelar o agendamento (\`action=cancelar postId=...\`, até 2 minutos antes da hora) NÃO cancela a peça: ela só perde a hora e volta pra fila daquela rede, como rascunho, com a mesma legenda. Pra trocar a hora, cancele e publique de novo com \`agendarPara\`; pra mandar agora, cancele e publique sem hora.`,
  },

  {
    name: "carrossel",
    title: "Carrossel: gerar, escrever, pôr foto e entregar",
    description:
      "O carrossel do Instagram pelo agente: gerar do brief ou de um artigo, reescrever os slides direto no payload, pôr foto da galeria da pessoa, a capa IA, e onde ela baixa. Puxe ANTES de sapiens_carrossel.",
    body: `## O que é

Um carrossel é uma RECEITA: tema (paleta, folha e assinatura) mais slides, cada um com um layout (\`templateId\`) e os textos dele (\`slots\`). O desenho sai dessa receita no editor da pessoa, que é também onde ela baixa os arquivos. Você escreve a receita; ela abre, confere e baixa.

## O fluxo

1. \`sapiens_carrossel action=generate\` com \`brief\` (o tema e o ângulo, um parágrafo) OU \`articleId\` (artigo publicado) OU \`userArticleId\` (artigo dela). Custa 350 Sinapses, já com a escolha de fotos, e estorna se falhar. Devolve o \`id\` e a \`url\` do editor.
2. \`action=get\` traz o payload inteiro e o catálogo: os layouts com os slots de cada um, as paletas, as folhas e a assinatura. Leia antes de mexer.
3. \`action=update\` grava o payload INTEIRO de volta. Reescreva os textos com a voz da pessoa (puxe a skill \`voz-da-casa\`). Mande o \`theme\` inteiro e o \`image\` de todo slide que você não mexeu: o que faltar volta pro padrão e a foto do slide some. Mande também \`baseUpdatedAt\` com o \`updatedAt\` do get: se o carrossel mudou depois (uma foto gerada, uma edição dela no editor), o update recusa em vez de apagar isso, e aí você faz get de novo. Foto nova não entra por URL no update, só pelo passo 4.
4. Foto: \`action=auto_images\` (60) deixa a IA escolher do banco; \`action=set_image\` põe uma peça DA PESSOA pelo ID citável (\`img_…\`, de \`sapiens_reference\` ou \`sapiens_gallery\`), de graça; \`action=generate_image\` gera uma nova pra um slide, ~450 cada.
5. Mande a \`url\` do editor. É lá que ela confere, ajusta e baixa.

## A forma e o tamanho

\`model\` é a FORMA: \`feed\` (o padrão, 9 slides que abrem numa dor, mostram o mecanismo e fecham em ação), \`reflexao\` (tema de comportamento sustentado por uma analogia), \`case\` (tendência a partir de link ou manchete, fecha numa keyword) e \`editorial\` (a IA escolhe os layouts, 7 a 9 slides).

\`aspect\` é o TAMANHO: \`4:5\` (o padrão, a folha que o feed do Instagram mostra inteira) ou \`9:16\` (tela cheia). Os dois trocam depois no editor sem perder texto.

## A assinatura

O nome no topo, a marca no canto da capa e o @ do fecho saem de \`theme.signature\` (\`label\`, \`handle\`, \`logoUrl\`). Nasce da marca da pessoa, ou do nome dela quando não tem marca. Se ela pedir pra mudar, mude ali, no update. O @ é o dela no Instagram: não invente, pergunte.

## O brand da peça

O design system da pessoa veste a peça inteira: a cor (\`theme.brand\`), a fonte do título e do corpo (\`theme.fonts\`), a voz do texto e a assinatura. No \`generate\`, \`brandSlug\` escolhe um brand que não é o padrão da conta. A cor de DESTAQUE (kicker, número, palavra-chave) é a cor do brand que lê no fundo e se separa do texto; pra trocar, ponha o mesmo hex em \`accent\` e \`kicker\` no update.

Ela já tem identidade fora daqui (outro app, Figma, o kit de um cliente)? Traga com \`sapiens_brand action=import\`, que grava hex e fonte exatos e é grátis, e aceita o arquivo de design tokens do Figma como veio. O \`generate\` cria um brand novo e reinterpreta. Fonte que não é do Google Fonts (Fontshare, comprada) aparece na fonte da casa até alguém subir o arquivo dela: \`sapiens_brand action=font\`.

## Carrossel que vem de fora

Trazendo slides de outro editor: crie o carrossel, leia o catálogo no \`get\` e case cada slide de lá com um layout daqui pelo PAPEL (\`role\`: capa, corpo, cta), pela foto (\`requiresImage\`) e pelos \`slots\`. O texto vai nos slots, o estilo vem do brand, nunca do layout de lá. Slide sem par vira o corpo mais próximo: não force texto num slot que não cabe, corte ou divida em dois slides.

## A capa IA

\`action=cover\` gera uma capa 16:9 com a manchete QUEIMADA na imagem, um elemento vivo cruzando as letras, e com \`carouselId\` fatia em duas e põe na frente do carrossel, no lugar da capa IA anterior. Cobra pelo motor da capa (o preço sai de \`sapiens_image action=models\`). Confirme o custo com a pessoa antes. Animar a capa é no editor, não por aqui.

## Armadilhas

- \`generate\`, \`auto_images\` com \`generateMissing\` e \`generate_image\` são síncronas e pesadas: se voltar Timeout, confira em \`action=list\` antes de repetir. Pode ter gerado e cobrado.
- O carrossel vai até 15 slides. A capa IA entra com dois.
- Baixar é no editor (o arquivo sai do navegador dela). Aqui você entrega a receita pronta, não o arquivo.`,
  },

  {
    name: "sapiens-api",
    title: "API da conta: texto, imagem e vídeo em código",
    description:
      "A API da pessoa (compatível com OpenAI, saldo em dólar, separado das Sinapses) pra quando ela quer chamar os motores da casa de dentro de um script, app ou agente próprio. Puxe antes de escrever código que chama www.sapiensinteticos.com/api/v1 ou quando ela perguntar de chave, saldo da API ou cobrança de uma chamada.",
    body: `## API ou MCP

Este connector opera a conta pela conversa. A API é outra porta: a pessoa chama os motores de texto, imagem e vídeo de dentro do código dela, no formato da OpenAI, e paga do saldo em DÓLAR da conta. As duas portas são da MESMA conta e se enxergam:

- O que a API gera entra no acervo da conta. Imagem e vídeo viram peça marcada \`source: api\` (ache com \`sapiens_gallery\` e use como qualquer peça: referência, vídeo, publicar). Música e efeito sonoro viram faixa da conta (ache com \`sapiens_musicator action=list\`).
- O saldo em dólar também paga peça por aqui: \`sapiens_image\` e \`sapiens_video action=create\` com \`pagarCom: "dolar"\` (detalhe nas skills \`imagem\` e \`video\`). Sinapse não vira dólar nem o contrário: são duas carteiras, e a pessoa escolhe de qual sai.

Use a API quando a pessoa quer automatizar fora da conversa (script, app, agente dela, lote). Pra operar a conta aqui, siga com as tools.

## Onde fica

Tudo mora em Developers, no fim do menu do site: criar e revogar chave, teto de gasto por dia de cada chave, recarga (cartão ou USDC da carteira dela) e o extrato. Se a seção API não aparece lá, ela ainda não abriu pra conta.

A chave aparece UMA vez, na criação. Peça pra ela guardar numa variável de ambiente (\`SAPIENS_API_KEY\`). Nunca peça a chave no chat e nunca escreva a chave em código, commit ou log.

## O manual inteiro

O manual de uso, com os campos, o vídeo e a tabela de erros, é servido pela própria API, sem chave:

\`\`\`
GET https://www.sapiensinteticos.com/api/v1/skill
\`\`\`

Baixe e leia ANTES de escrever o código. Num agente com pasta de skills, ele entra como \`.claude/skills/sapiens-api/SKILL.md\`. O manual de lá manda sobre este resumo quando os dois divergirem.

## O que vale saber já

- Base: \`https://www.sapiensinteticos.com/api/v1\`, com \`Authorization: Bearer <chave>\`. No SDK da OpenAI, só troque o \`baseURL\`.
- Preço: o de cada modelo está em \`GET /models\`; vídeo cota de graça em \`POST /videos/quote\`. O valor de uma chamada pode variar um pouco com a oferta da hora. O valor de cada chamada volta no header \`x-sapiens-charge-usd\`. Pra pôr o preço da API ao lado de outro provedor (fal.ai, WaveSpeed): \`sapiens_meta action=precos\`, parte \`api\`.
- Vídeo cota de graça antes (\`POST /videos/quote\`), aceita \`webhook_url\` pra avisar quando termina e devolve a \`url\` do mp4 guardado. Falha do motor volta pro saldo sozinha.
- Saldo que acabou volta 402 \`insufficient_balance\` com \`recharge_url\` no erro: o código da pessoa deve mostrar esse link (recarga no cartão ou em stablecoin) em vez de só falhar.
- Uma chamada de teste antes de qualquer lote. Nunca vídeo em laço.

## Modelos de texto de preço variável: sapiens-auto e Jev Router

Dois modelos de texto que escolhem, a cada pedido, qual modelo responde, e cobram o preço dele. Não são de uso casual: o valor de cada chamada só se sabe depois, e o código da pessoa precisa respeitar isso. O preço está em \`sapiens_meta action=precos\` com \`midia=texto\`, parte \`api.texto.roteadores\` (a faixa do sapiens-auto, do candidato mais barato ao mais caro), e em \`GET /models\`.

### sapiens-auto (no POST /chat/completions)

- \`model: "sapiens-auto"\` e a casa escolhe o modelo de texto da conversa: código vai pra um modelo forte em código, prova e conta pesada pro topo, conversa e pergunta curta pra um modelo leve, o resto pra um do meio.
- Cobra o preço do modelo escolhido, sem taxa a mais. O \`model\` da resposta diz qual atendeu, e o \`x-sapiens-charge-usd\` diz quanto custou. A faixa de preço (do candidato mais barato ao mais caro) está na tabela.
- A escolha vale pra conversa inteira por 2 horas: as falas seguintes ficam no mesmo modelo, mesmo que fiquem triviais. A casa reconhece a conversa pelo começo dela, sem guardar o texto.
- Cuidado: quem joga no sapiens-auto texto que não escreveu (email, página, mensagem de terceiro) deixa esse texto puxar a conversa pra faixa de topo, que custa dezenas de vezes a leve. Pra agente que lê conteúdo de fora, ponha teto de gasto por dia na API key (Developers) ou fixe o modelo.
- Quem precisa de um modelo previsível (avaliação, lote com orçamento fechado) manda o id do modelo, não o sapiens-auto.

### Jev Router (no POST /chat/completions)

- \`model: "jev-router"\`: o router da TypeSafe escolhe o modelo e o esforço de raciocínio de cada pedido. O \`model\` da resposta é o que ele escolheu.
- O preço varia com o modelo que ele escolher. Não dá pra cotar antes: leia o \`x-sapiens-charge-usd\` de cada chamada e, em lote, confira o gasto do dia em \`GET /balance\`.

## Decisão: o Laya (POST /systemone)

Um modelo de decisão responde sem gerar texto: sim ou não, uma opção entre várias ou uma nota numa escala, com a confiança de cada resposta. Serve pra triagem, moderação, filtro, roteamento e leitura de intenção, em volume e barato, antes ou no lugar de chamar um modelo de texto. O preço está em \`sapiens_meta action=precos\` com \`midia=decidir\`, parte \`api.decidir\`, e em \`GET /models\` (\`type: "decision"\`).

- Formato System One (o mesmo do Jev): \`state\` (texto ou objeto) e \`questions\`, cada uma \`noul\` (sim ou não), \`choice\` (uma das opções de \`criteria\`) ou \`score\` (um nível de uma escala). Modelo: \`laya-multilingual\`, aberto, 100+ línguas.
- Cobra só a entrada. Até 4 perguntas por chamada. Uma pergunta curta decide em cerca de meio segundo; o tempo cresce com o tamanho do \`state\`.
- Uma decisão por vez na máquina: com fila cheia volta 503, sem cobrar. Lote vai em sequência, nunca em paralelo, e o código trata o 503 esperando e tentando de novo.
- Sem ajuste fino, o Laya erra mais que um modelo de texto em classificação aberta, às vezes com confiança alta. Serve pra triagem barata e em volume. Antes de pôr no fluxo da pessoa, rode uma amostra do caso dela e confira as respostas.
- Quem já usa o SDK do Jev troca a URL base pela da API e o modelo por \`laya-multilingual\`.`,
  },
];

export const SKILLS: Record<string, SapiensSkill> = Object.fromEntries(
  SKILL_LIST.map((s) => [s.name, s]),
);

/**
 * Monta o SKILL.md completo (frontmatter do formato aberto + corpo).
 *
 * O frontmatter segue o spec de agentskills.io, cujo validador lê com YAML
 * estrito, e é assim que tem que passar em qualquer agente: a description vai
 * entre aspas (um ": " no meio quebrava a leitura) e campo que o spec não tem
 * mora em `metadata`.
 */
export function renderSkill(skill: SapiensSkill): string {
  return `---
name: ${skill.name}
description: ${JSON.stringify(skill.description)}
metadata:
  source: sapiens-mcp (sapiensinteticos.com)
---

# ${skill.title}

${skill.body}
`;
}

/** SKILL.md pronto de uma skill pelo slug; null se o slug não existe. */
export function getSkillMd(name: string): string | null {
  const s = SKILLS[name];
  return s ? renderSkill(s) : null;
}

/** Índice enxuto pro tools/list e pro resources/list: slug, título, quando usar. */
export function listSkills(): Array<{
  name: string;
  title: string;
  description: string;
  uri: string;
}> {
  return SKILL_LIST.map((s) => ({
    name: s.name,
    title: s.title,
    description: s.description,
    uri: skillUri(s.name),
  }));
}

/** Uma linha por skill, pra caber no SAPIENS_INSTRUCTIONS sem inchar. */
export function skillMenuLine(): string {
  return SKILL_LIST.map((s) => s.name).join(" | ");
}

// ---------- resources MCP (a outra porta pro mesmo conteúdo) ----------

/**
 * Payload do resources/list. Compartilhado pelos dois transportes (stdio e
 * remoto), igual ao buildToolList: um lugar só pra mexer.
 */
export function listSkillResources() {
  return SKILL_LIST.map((s) => ({
    uri: skillUri(s.name),
    name: s.name,
    title: s.title,
    description: s.description,
    mimeType: "text/markdown",
  }));
}

/**
 * Payload do resources/read. Devolve null quando a URI não é uma skill da casa
 * (o caller decide se erra ou delega).
 */
export function readSkillResource(
  uri: string,
): { contents: Array<{ uri: string; mimeType: string; text: string }> } | null {
  const name = skillNameFromUri(uri);
  if (!name) return null;
  const text = getSkillMd(name);
  if (!text) return null;
  return { contents: [{ uri, mimeType: "text/markdown", text }] };
}
