import { z } from "zod";
import {
  convexAction,
  convexQuery,
  convexMutation,
  getSessionToken,
  isRemoteContext,
} from "../convexClient.js";
import { httpUrl } from "../schema.js";

/**
 * Sapiens Video — gera vídeo (qualquer membro logado; vídeo é caro, cobra as
 * Sinapses da conta do sessionToken).
 *
 * Sub-actions:
 *   - create:   escolhe modelo + config e gera num call só (cria a row + renderiza).
 *               Habilita Seedance/Kling/WAN/Motion (WaveSpeed) e o Omni, sem o site.
 *               Com `templateSlug`, a RECEITA da casa embrulha a cena (estilo, arco,
 *               áudio, look) e escolhe o motor: `prompt` vira só a cena e `brief`
 *               preenche os campos do formato.
 *               TAKE LONGO VOLTA `pending: true` SEM `url`, e isso é SUCESSO, não
 *               falha: o pedido foi aceito, cobrado, e o servidor continua
 *               renderizando sozinho (o take de 30s do Seedance 2.5 leva mais que
 *               qualquer resposta síncrona aguenta). Nesse caso NÃO gere de novo,
 *               que cobraria duas vezes: acompanhe com `action=status` no imageId
 *               que veio junto, ou olhe a galeria depois.
 *   - extend:   CONTINUA um take SEU no tempo: o pedaço seguinte, colado no frame
 *               onde o anterior parou (mesmo elenco, mesma luz, mesma câmera,
 *               sem recomeçar a cena). Não escolhe motor nem config: proporção,
 *               resolução, som e modelo vêm do take-pai, porque é isso que faz o
 *               pedaço colar. `prompt` diz só O QUE ACONTECE em seguida (opcional:
 *               sem ele, a ação continua sozinha). Cada rodada é uma geração
 *               cheia e cobra como tal (no Omni, a duração do take-pai, 10s se
 *               ninguém escolheu; `durationSec` troca o tamanho do pedaço).
 *               Hoje só os motores Omni continuam; os outros recusam antes de
 *               cobrar. Assíncrono: volta imageId + parte, acompanhe em
 *               action=status. Encadeia (a parte 3 sai da parte 2), mas UMA POR
 *               VEZ: a próxima precisa da anterior pronta pra continuar dela.
 *               No Omni o arquivo de cada parte traz as anteriores na frente:
 *               a parte 2 de 4s é um arquivo de 8s. A última parte pronta é o
 *               filme inteiro, e emendar as partes repete a abertura.
 *   - chain:    a corrente inteira de um take (as partes na ordem, o pedaço
 *               novo que cada uma cobrou e o tamanho do arquivo dela, e qual
 *               parte serve de base pra próxima continuação). No Omni volta
 *               `filmeInteiro` (a última parte pronta, com a duração do
 *               arquivo) e `comoJuntar` diz pra não emendar. Sem custo.
 *               Qualquer parte serve de imageId.
 *   - models:   catálogo vivo dos motores ativos com a FAIXA de preço (o que uma
 *               chamada sem config debita + o canto mais barato e o mais caro).
 *               Sem custo, sem login.
 *   - price:    cotação exata de uma config (model + durationSec/resolution/audio),
 *               calculada pela mesma função que debita. Sem custo, sem login. Use
 *               antes de create pra dizer o número certo pra pessoa.
 *   - templates: catálogo das receitas de take (slug, spec default, whitelist de
 *               override e os campos de brief que cada uma usa). Sem custo, sem login.
 *               Comeu o antigo sapiens_shorts, que era admin-only e só falava Veo.
 *   - generate: renderiza um imageId de vídeo já criado no site (legado).
 *   - demos:    lista os SEUS demo films (kind=demo do Estúdio de Vídeo) + estado
 *               de vitrine. Sem custo. Base pra curar o mini-cinema da vitrine.
 *   - showcase: põe/tira um demo film (por slug) da vitrine /conectar-claude, com
 *               chip (showcaseTag) e ordem (showcaseOrder). Só entra na vitrine
 *               pública se for a conta da casa. Sem custo.
 *   - shadows:  (ADMIN) extrai a SOMBRA (mapa de profundidade) de um vídeo por
 *               URL e guarda no Acervo (Corpo) como depth map reutilizável.
 *               200 Sinapses/segundo (durationSec; sem ela, flat 2000). Refund se falhar.
 *   - shadows-list: (ADMIN) lista o banco de motion (depth maps + guias de corpo)
 *               com as duas views por ficha: url = depth map puro (driving pros
 *               geradores) e skeletonUrl = a soma (sombras + esqueleto, preview
 *               humano que separa personagem de objeto). Sem custo.
 *   - sonorize: dá som a um clipe SEU já gerado: imageId + prompt do som da cena
 *               -> VARIANTE nova com trilha sincronizada (o original fica intacto).
 *               engine escolhe o motor: Mirelo SFX 2.0 (default, guarda a fala
 *               do clipe), MMAudio v2 (mais barato, som do zero) ou ElevenLabs
 *               Video to Music (trilha musical que segue os cortes, por baixo do
 *               som do clipe). Cobra por segundo do clipe na tabela do motor;
 *               poll via action=status.
 *
 * Vídeos Programáticos (Estúdio de Vídeo, /experimentos/films) — ADMIN, sem custo.
 * O Lab de specs da casa (tabela videoSpecs, 5 kinds: demo | aula-tour | essay |
 * tipografia-musical | dataviz). A PRODUÇÃO do mp4 segue no agente local (skill
 * /film, repo films/); estas actions fecham o CICLO na plataforma sem browser:
 *   - film-list:    lista os specs (todos os kinds; filtros filmKind/filmStatus).
 *   - film-get:     um spec inteiro por slug (payload pronto pra produção).
 *   - film-upsert:  cria/atualiza spec por slug (idempotente; validação server).
 *   - film-status:  status/URL do render/duração por slug (fecho: pronto+URL).
 *   - film-publish: publica/despublica no Acervo (aba Fitas) + portfólio.
 *   - film-delete:  apaga um spec (limpar rascunho/duplicata).
 *
 * Modelos (action=create):
 *   - sapiens-video-seedance       Seedance 2.0 — cena com áudio nativo, 4-15s, 480/720/1080p (t2v/i2v).
 *                                   Aceita até 4 imagens de REFERÊNCIA (referenceImage*): guiam estilo/
 *                                   personagem/composição sem virar o 1º frame. É o fluxo storyboard:
 *                                   folha de key poses (template storyboard-sapiens-v1 do sapiens_image)
 *                                   + imagem do personagem como refs num t2v de take contínuo.
 *   - sapiens-video-seedance-2-fast Seedance 2.0 Fast — o MESMO repertório do 2.0 (referência, frame
 *                                   final, vídeo de movimento, áudio nativo), 20% mais barato e mais
 *                                   rápido. Teto 720p.
 *   - sapiens-video-seedance-2-mini Seedance 2.0 Mini — metade do preço do 2.0, mesmo repertório,
 *                                   teto 720p. É o take pra queimar tentativa e achar o enquadramento
 *                                   antes de fechar no 2.0 padrão. Pedir 1080p nos dois cai em 720p
 *                                   (cobrando 720p).
 *   - sapiens-video-seedance-25    Seedance 2.5 — a geração SEGUINTE, não um tier da 2.0. O take vai
 *                                   a 30s num fôlego (4-30s) contra os 15s da linha 2.0, e ela edita
 *                                   e ESTENDE vídeo. Mesmo repertório de referência (imagem, vídeo,
 *                                   frame inicial e final) mais ÁUDIO como referência. Teto 720p e
 *                                   ~1,5x o preço/s do 2.0 padrão: é o motor mais caro por segundo
 *                                   da casa, então confirme a duração com a pessoa antes de disparar
 *                                   (30s em 720p passa de 40 mil Sinapses). Quem precisa de 1080p
 *                                   continua no 2.0 padrão, que a 2.5 NÃO substitui.
 *   - sapiens-video-kling          Kling 3.0 Pro — dá vida a uma imagem, 3-15s, sound opcional (i2v/t2v)
 *   - sapiens-video-hailuo         Hailuo 2.3 (MiniMax) — física e movimento em 768p, 6 ou 10s (t2v/i2v).
 *                                   Motor puro: SEM áudio, SEM referência, SEM frame final.
 *   - sapiens-video-hailuo-pro     Hailuo 2.3 Pro — o mesmo em 1080p, 5s fixo (duração não é param).
 *                                   É o 1080p mais barato da casa.
 *   - sapiens-video-h3             MiniMax H3 — ÁUDIO nativo, frame final (role 'end'), t2v/i2v. O
 *                                   menor custo por pixel da prateleira. Áudio vem sempre e já está
 *                                   no preço (não tem toggle). 5 a 15s em '2k' (2560x1440) ou
 *                                   '768p', a escada inteira nos dois tiers. Sem `resolution` cai
 *                                   no 2k, que custa 33% mais por segundo. O 2K de 15s leva uns
 *                                   9min de render: o create volta na hora com status 'rendering',
 *                                   acompanhe em action=status e não gere de novo.
 *                                   ACEITA referência desde set/2026: até 9 imagens (role 'ref') e 3
 *                                   vídeos (role 'refvideo', somando 15s), que é o caminho de take
 *                                   longo com personagem travada. Referência e frame inicial são
 *                                   EXCLUSIVOS (endpoints diferentes no provider): mande um dos dois.
 *   - sapiens-video-pvideo-2-pro   P-Video-2 Pro (Pruna): o MiniMax H3 acelerado pela Pruna, o
 *                                   RASCUNHO de personagem travada: até 9 imagens (role 'ref' + frame
 *                                   inicial e final, tudo junto no mesmo pedido), 5 a 15s em '480p'
 *                                   ou '768p', áudio nativo sem toggle, e o take volta em segundos.
 *                                   Sem t2v: precisa de ao menos uma imagem (ou um vídeo de
 *                                   referência). COBRA POR IMAGEM além do segundo (o servidor conta
 *                                   as que você mandou), então cote em action=price passando as
 *                                   mesmas imagens do create. Aceita também até 3 vídeos
 *                                   (referenceVideoUrls) e 3 áudios (referenceAudioUrls) de
 *                                   referência, 15s somados por tipo, cobrados por SEGUNDO: o
 *                                   servidor baixa e mede antes de cobrar. keepAudio faz o único
 *                                   áudio virar a trilha do take.
 *   - sapiens-video-h3-spicy       MiniMax H3 Spicy — o H3 SEM freio de conteúdo, a partir de uma
 *                                   imagem sua (i2v puro: a identidade entra pela imagem, não pelo
 *                                   texto). 3 a 15s, 480p/768p/1080p, som nativo, frame final. É o
 *                                   segundo de vídeo mais barato da casa (250 Sinapses/s em 480p) e
 *                                   o render mais rápido (5s em 480p sai em meio minuto).
 *   - sapiens-video-seedance-spicy Seedance 2.0 Spicy — o Seedance 2.0 SEM freio, também i2v puro.
 *                                   Som nativo. 4 a 15s em 480p e 720p; em 1080p para em 10s até
 *                                   alguém medir o render nesse tier (15s ali é take de 9 mil
 *                                   Sinapses que ninguém viu sair).
 *   - sapiens-video-ltx-spicy      LTX 2.3 Spicy — o TAKE LONGO da linha sem freio, e o segundo de
 *                                   vídeo mais barato da casa. i2v puro, som nativo, e o único spicy
 *                                   que chega a 20s em TODOS os tiers (480p 125 Sinapses/s, 720p 250,
 *                                   1080p 375: o 1080p daqui custa menos que o 480p do Seedance
 *                                   Spicy). Sem frame final. Em take longo, escreva o prompt em BEATS
 *                                   (primeiro ela faz X, depois Y, então Z): sem isso o motor inventa
 *                                   quando o texto acaba antes do tempo.
 *     Nos três spicy o frame sai só de peça do acervo do membro (startImageId/startImageUrl): o
 *     servidor baixa o frame da peça e recusa arquivo local, base64, upload, ponte e foto de fora.
 *   - sapiens-video-wan            WAN 2.5 — imagem que fala/canta (áudio+lip-sync nativo), 5/10s (i2v)
 *   - sapiens-video-wan-3          WAN 3.0: a geração seguinte da linha WAN. Texto OU imagem (t2v/i2v),
 *                                   som nativo com interruptor (mesmo preço ligado ou desligado), frame
 *                                   final (role 'end'), 5/8/10s em 480/720/1080p. Sem imagem de
 *                                   referência (o reference-to-video do provider é outro endpoint,
 *                                   fora até o roteador saber escolher).
 *   - sapiens-video-flux-3-max     FLUX 3 Max (fal + Black Forest Labs): texto OU imagem (t2v/i2v),
 *                                   5 a 20s em 720p ou 1080p, som nativo com interruptor, frame final
 *                                   (role 'end', só junto do 'start'). Segue o prompt de perto e
 *                                   volta rápido. Sem referência de personagem nem vídeo de
 *                                   movimento: o servidor recusa e estorna.
 *   - sapiens-video-ltx-25-fast-a2v  LTX 2.5 Fast Audio-to-Video (Lightricks, API oficial): o ÁUDIO da
 *                                   pessoa vira o take. A faixa (UM áudio, mp3 ou m4a: a do
 *                                   sapiens_musicator por referenceAudioTrackIds, com posse conferida,
 *                                   ou um link de arquivo SEU em referenceAudioUrls) puxa a boca e o gesto e dita
 *                                   a duração; a foto (startImageId/startImageUrl, a da ficha) abre a
 *                                   cena, e sem ela o prompt descreve. Até 20s de áudio em 720p/1080p.
 *                                   COBRA PELO SEGUNDO DO ÁUDIO, medido pelo servidor antes do débito:
 *                                   durationSec não se usa no create (na cotação, durationSec = os
 *                                   segundos do áudio). Frame final (role 'end') só junto do inicial.
 *   - sapiens-video-ltx-25-pro-a2v   O mesmo com mais fidelidade, até 10s de áudio.
 *   - sapiens-video-ltx-23-pro-a2v   A geração anterior: até 20s, o segundo mais barato da linha.
 *   - sapiens-video-ltx-25-fast    LTX 2.5 Fast: texto OU imagem, 6 a 20s em 720p ou 1080p, som nativo
 *                                   com interruptor, frame final só junto do inicial. Sem referência.
 *   - sapiens-video-ltx-25-pro     LTX 2.5 Pro: o mesmo com mais fidelidade, 6 a 10s.
 *   - sapiens-video-kling-motion   Kling Motion — transfere o movimento de um vídeo pra uma imagem
 *                                   (PRECISA de pessoa com tronco visível na imagem E no vídeo;
 *                                   vídeo de referência MÁX 10s — o provider recusa acima disso —
 *                                   e cobra pela duração do clipe; corte antes de mandar)
 *   - sapiens-video-shot-mimic     Shot Mimic — recria o plano do vídeo de referência (câmera,
 *                                   cortes, blocking) como cena nova; personagem via role 'start'
 *                                   (vídeo de referência MÁX 15s — acima o provider corta em 15s)
 *   - sapiens-video-lite/fast/quality   Veo 3.1: SAIU. O Google apagou os três em
 *                                   22/10/2026; o backend recusa antes de cobrar. O
 *                                   sucessor é o sapiens-video-omni-11.
 *   - sapiens-video-omni-11        Gemini Omni 1.1: texto ou imagem -> vídeo de 4, 6, 8 ou 10s (sem
 *                                   durationSec, 10s), com áudio nativo embutido, em 360p, 720p,
 *                                   1080p ou 4k (preço por segundo: 1/3, 1x, 1,5x e 3x do 720p; sem
 *                                   resolution, 720p). Aceita até 3 imagens suas (frame inicial,
 *                                   frame final ou referência de personagem/estilo); vídeo de
 *                                   MOVIMENTO não (pra coreografia, Seedance).
 *                                   EDIÇÃO conversacional: `editOfImageId` aponta um vídeo Omni seu e
 *                                   o prompt edita a MESMA cena.
 *                                   VÍDEO-FONTE: `sourceVideoId` (vídeo da sua galeria) ou
 *                                   `sourceVideoUrl` (link da casa), até 10 s, editado
 *                                   (`sourceVideoMode` "edit", cobrado pelo tamanho do clipe) ou
 *                                   estendido ("extend", cobrado pelo durationSec do pedaço novo),
 *                                   com até 3 imagens de referência junto.
 *   - sapiens-video-omni           Gemini Omni 1.0, a versão preview: MESMO preço e mesmo repertório
 *                                   do 1.1, mantida pra comparação. Nasce DESLIGADA, então não sai em
 *                                   action=models (o create ainda aceita o id). Peça o 1.1 a não ser
 *                                   que a pessoa queira comparar as duas versões.
 *
 * FORA DE PROPÓSITO: hoje nenhum. O `sapiens-video-seedance-fast` (1.0 Fast) morava em
 * VIDEO_FORA_DE_PROPOSITO até sair do catálogo junto do 1.5 Pro, em 28/set/2026. Quem
 * quer queimar tentativa barata usa o `sapiens-video-seedance-2-mini`, que custa metade
 * do 2.0 com o repertório inteiro. O gate audit:catalog-parity cobra que todo motor
 * ATIVO do catálogo esteja no enum ou naquela lista, com motivo.
 *
 * CUSTO: server-side por config (duração x resolução [x áudio]). NÃO existe "o preço"
 * de um motor por segundo: existe faixa. Omitir `resolution` não pega o meio nem o
 * mais barato, pega o tier MAIS CARO do motor (é o clamp de `resolveBilledVideoConfig`,
 * que não subcobra), e omitir `durationSec` pega o piso de duração (no Omni,
 * o padrão do motor: 10s, o clipe que ele entregava antes de ter escolha). Antes de prometer
 * um número pra pessoa, tire a cotação em action=price (sem custo, sem login).
 * i2v/motion usam `references` em base64 (role 'start' = imagem inicial,
 * 'end' = frame final, 'driving' = vídeo de movimento do Motion).
 *
 * Retorna `{ success, url, imageId, cost }` ou `{ success: false, error }`.
 */

const VIDEO_MODELS = [
  "sapiens-video-seedance",
  "sapiens-video-seedance-2-fast",
  "sapiens-video-seedance-2-mini",
  "sapiens-video-seedance-25",
  "sapiens-video-kling",
  "sapiens-video-hailuo",
  "sapiens-video-hailuo-pro",
  "sapiens-video-h3",
  "sapiens-video-pvideo-2-pro",
  "sapiens-video-h3-spicy",
  "sapiens-video-seedance-spicy",
  "sapiens-video-ltx-spicy",
  "sapiens-video-wan",
  "sapiens-video-wan-3",
  "sapiens-video-flux-3-max",
  "sapiens-video-ltx-25-fast-a2v",
  "sapiens-video-ltx-25-pro-a2v",
  "sapiens-video-ltx-23-pro-a2v",
  "sapiens-video-ltx-25-fast",
  "sapiens-video-ltx-25-pro",
  "sapiens-video-kling-motion",
  "sapiens-video-shot-mimic",
  // Os três Veo 3.1 e o Omni 1.0 seguem no enum por retrocompat (cliente em
  // versão publicada manda o id e recebe a recusa limpa, sem cobrança): o Google
  // apagou os quatro em 22/10/2026. Peça o Omni 1.1.
  "sapiens-video-lite",
  "sapiens-video-fast",
  "sapiens-video-quality",
  "sapiens-video-omni-11",
  "sapiens-video-omni",
] as const;

// Motores que cobram cada imagem de entrada à parte do segundo (o catálogo diz
// `referenceImageSinapses`). A cotação manda a contagem só pra eles.
const COBRA_POR_IMAGEM: ReadonlySet<string> = new Set(["sapiens-video-pvideo-2-pro"]);
// Motores que cobram o SEGUNDO de vídeo e de áudio de referência à parte (o
// catálogo diz `referenceVideoSinapsesPerSecond`). Idem: a cotação manda os
// segundos só pra eles.
const COBRA_POR_SEGUNDO_DE_REFERENCIA: ReadonlySet<string> = new Set(["sapiens-video-pvideo-2-pro"]);

/** As imagens que o create mandaria: referências mais frame inicial e final. */
function imagensDoPedido(args: {
  references?: Array<{ role?: string }>;
  referenceImageIds?: string[];
  referenceImageUrls?: string[];
  referenceImagePaths?: string[];
  startImageId?: string;
  startImageUrl?: string;
  startImagePath?: string;
  endImageId?: string;
  endImageUrl?: string;
  endImagePath?: string;
}): number {
  const base64 = (args.references ?? []).filter((r) => !r.role || ["start", "end", "ref"].includes(r.role)).length;
  const refs = (args.referenceImageIds?.length ?? 0) + (args.referenceImageUrls?.length ?? 0) + (args.referenceImagePaths?.length ?? 0);
  const inicial = args.startImageId || args.startImageUrl || args.startImagePath ? 1 : 0;
  const final = args.endImageId || args.endImageUrl || args.endImagePath ? 1 : 0;
  return base64 + refs + inicial + final;
}

// Motor ATIVO no catálogo que fica fora do enum DE PROPÓSITO, com o motivo. O
// gate audit:catalog-parity (apps/sapiens) lê este mapa: id ativo que não está
// nem no enum nem aqui é erro, porque action=models lista, a skill manda usar e
// o create recusa com erro de schema (foi assim com o WAN 3.0 por dois meses).
export const VIDEO_FORA_DE_PROPOSITO: Record<string, string> = {};

const FILM_KINDS = ["demo", "aula-tour", "essay", "tipografia-musical", "dataviz"] as const;
const FILM_STATUSES = ["rascunho", "na_fila", "renderizando", "pronto"] as const;

export const videoSchema = z.object({
  action: z.enum([
    "create",
    "extend",
    "chain",
    "generate",
    "status",
    "models",
    "price",
    "templates",
    "demos",
    "showcase",
    "shadows",
    "shadows-list",
    "sonorize",
    "upscale",
    "trim",
    "join",
    "fecho",
    "render-ref",
    "film-list",
    "film-get",
    "film-upsert",
    "film-status",
    "film-publish",
    "film-delete",
    "caption-list",
    "caption-generate",
    "caption-translate",
  ]),
  // --- Legenda (caption-*): a fala da fita virando texto, em vários idiomas ---
  captionLang: z
    .enum(["pt", "en", "ja", "es", "ko", "zh", "fr", "it", "de"])
    .optional()
    .describe(
      "caption-generate: o idioma FALADO no vídeo. caption-translate: o idioma de DESTINO. " +
        "A legenda é desenhada pela casa e trocável no play; o trio da casa é pt+en+ja.",
    ),
  captionTrio: z
    .boolean()
    .optional()
    .describe(
      "caption-generate: true transcreve E traduz pro trio da casa (pt, en, ja) numa chamada. " +
        "Cobra cada etapa por vez, então falha numa tradução não perde as que já saíram.",
    ),
  // --- Vídeos Programáticos (film-*): Lab de specs da casa, ADMIN, sem custo ---
  filmKind: z
    .enum(FILM_KINDS)
    .optional()
    .describe("film-list: filtra por kind (demo | aula-tour | essay | tipografia-musical | dataviz)."),
  filmStatus: z
    .enum(FILM_STATUSES)
    .optional()
    .describe(
      "film-status: novo status de produção (rascunho | na_fila | renderizando | pronto). " +
        "film-list: filtra por status. O fecho do render é film-status com filmStatus='pronto' + videoUrl + durationSec.",
    ),
  spec: z
    .record(z.any())
    .optional()
    .describe(
      "film-upsert: o spec inteiro como objeto JSON (validação fica no servidor, fonte única). " +
        "Shape: { kind, musicMode ('default'|'file'|'track'), musicRef?, aulaSlug? (só aula-tour), " +
        "e o payload do kind: demo | aulaTour | essay | tipoMusical | dataviz }. " +
        "Mesmo shape do 'Copiar spec' da tela /experimentos/films; descubra um exemplo real com film-get.",
    ),
  published: z
    .boolean()
    .optional()
    .describe("film-publish: true publica no Acervo (aba Fitas) + portfólio (exige pronto + videoUrl), false despublica."),
  durationSecMeasured: z
    .number()
    .optional()
    .describe("film-status: duração MEDIDA do render em segundos (ffprobe), vira a duração do card."),
  // --- action=shadows (depth maps: extrai o mapa de profundidade de um vídeo) ---
  videoUrl: httpUrl()
    .optional()
    .describe(
      "action=shadows: URL pública (http/https) do vídeo-fonte. O servidor extrai a SOMBRA (depth), entrega ela na SUA timeline de vídeos (você vira dono) e guarda a ficha no Acervo (Corpo). ADMIN, 200 Sinapses/segundo (refund na falha). " +
        "film-status: a URL https do render no CDN (Bunny), o que acende o player do card.",
    ),
  title: z
    .string()
    .optional()
    .describe("action=shadows: nome do depth map (vira o slug no Acervo; re-extrair o mesmo título sobrescreve). Mín. 3 chars."),
  search: z
    .string()
    .optional()
    .describe("action=shadows-list: filtro de busca opcional (título/tags). Sem ele, lista o banco inteiro (até 300). Cada item traz url (depth map puro, driving) e skeletonUrl (soma com esqueleto, preview humano) quando existe."),
  // --- action=showcase (curadoria da vitrine /conectar-claude) ---
  slug: z
    .string()
    .optional()
    .describe(
      "action=showcase: slug do demo film a curar (descubra via action=demos). " +
        "film-get/film-status/film-publish/film-delete: slug do spec (descubra via film-list). " +
        "film-upsert: slug fixo do filme no repo films/ (idempotente: existe = atualiza, não existe = cria com esse slug); omita pra criar com slug gerado.",
    ),
  showcase: z
    .boolean()
    .optional()
    .describe("action=showcase: true põe na vitrine /conectar-claude, false tira."),
  showcaseTag: z
    .string()
    .optional()
    .describe("action=showcase: chip de capacidade do card (ex: 'Repertório', 'Galeria', 'Fórum'). Curto, até 24 chars."),
  showcaseOrder: z
    .number()
    .optional()
    .describe("action=showcase: ordem na trilha do mini-cinema (asc, 0..999; menor aparece primeiro)."),
  // --- Receita de take (templateSlug + brief) ---
  templateSlug: z
    .string()
    .optional()
    .describe(
      "action=create: slug de um TEMPLATE de vídeo (receita travada da casa, igual ao templateSlug da imagem). " +
        "Com ele, `prompt` vira só a CENA e o template embrulha com estilo, enquadramento, arco, áudio e look, " +
        "além de escolher o motor (por isso `model` fica opcional). O `brief` preenche os campos do formato. " +
        "Descubra os slugs em action=templates (sem custo, sem login): tem FORMATO de anúncio ('ugc-vertical-v1', " +
        "'unboxing-vertical-v1', 'app-demo-vertical-v1', 'reflexao-vertical-v1'), LOOK que é só estilo ('look-*') e " +
        "CLIPE de apresentação de personagem com tipografia cinética ('apresentacao-personagem-cinetica-v1', 15s, " +
        "13 cortes, personagem travada por referência). Override de model/aspectRatio/durationSec/resolution vale, " +
        "mas só dentro do que a receita aceita (o erro lista as opções).",
    ),
  brief: z
    .object({
      subject: z.string().optional().describe("O que o take é: o produto, a ideia, o tópico."),
      subjectType: z.string().optional().describe("app | physical | saas | ideia."),
      persona: z.string().optional().describe("Quem aparece (ou as mãos que aparecem)."),
      uvps: z.array(z.string()).optional().describe("2 a 4 pontos curtos a reforçar."),
      hook: z
        .object({
          line: z.string().optional().describe("A frase de abertura, 5-10 palavras."),
          emotion: z.string().optional().describe("Emoção alvo (curiosidade, frustração, espanto)."),
        })
        .optional(),
      shots: z
        .array(
          z.object({
            sec: z.number().optional().describe("Em que segundo o momento acontece."),
            role: z.string().optional().describe("hook | problem | solution | cta."),
            camera: z.string().optional().describe("close-up | medium | over-shoulder | product-pov."),
            action: z.string().optional().describe("A ação visual em uma frase."),
            emotion: z.string().optional(),
            voiceLine: z.string().optional().describe("A fala da cena, na língua do brief."),
            propVisible: z.string().optional().describe("Objeto/tela que precisa aparecer legível."),
          }),
        )
        .optional()
        .describe("Os momentos do take, na ordem. Sem eles, o template usa o arco de reserva dele."),
      language: z.string().optional().describe("'pt-BR' (default) ou 'en'."),
      energy: z.string().optional().describe("calm | high."),
    })
    .optional()
    .describe(
      "action=create com templateSlug: o formulário do template. Cada receita usa os campos que precisa " +
        "(veja `briefFields` em action=templates) e ignora o resto; campo vazio some do prompt em vez de virar buraco.",
    ),
  // --- action=create ---
  model: z
    .enum(VIDEO_MODELS)
    .optional()
    .describe(
      "action=create (opcional quando você passa templateSlug: a receita traz o motor) e action=price (obrigatório). O catálogo POR MODELO (capacidades, referências, tetos, FAIXA de preço) mora na description desta tool e VIVO em action=models; a skill 'video' (sapiens_skill) guia a escolha. " +
        "Atalho de famílias: seedance/seedance-2-*/seedance-25 = cena+áudio+referências (o 25 estica até 30s e o preço acompanha), kling = anima imagem, wan = WAN 2.5, imagem que fala, wan-3 = WAN 3.0, texto ou imagem com som e frame final, " +
"hailuo/hailuo-pro = movimento puro sem áudio, h3 = 2K ou 768p com áudio e até 9 imagens + 3 vídeos de referência, pvideo-2-pro = o H3 acelerado pela Pruna, rascunho barato e rápido de personagem travada (até 9 imagens, 3 vídeos e 3 áudios de referência, cobra por imagem e por segundo de clipe e de áudio, 480p/768p, sem t2v), h3-spicy/seedance-spicy = os mesmos motores sem freio de conteúdo, só a partir de imagem (i2v), kling-motion/shot-mimic = transferência de movimento/plano, lite/fast/quality = Veo 3.1, omni = Gemini com áudio nativo.",
    ),
  durationSec: z
    .number()
    .optional()
    .describe(
      "action=create e action=price: duração em segundos. Gemini Omni 1.1 4/6/8/10, Seedance 2.0/Shot Mimic 4-15, Seedance 2.5 4-30 (o preço acompanha: confirme a duração com a pessoa antes de passar de 15), Kling 3-15, WAN 2.5 5/10, WAN 3.0 5/8/10, H3 5/6/8/10/12/15 nos dois tiers (768p e 2k), P-Video-2 Pro 5/6/8/10/12/15, H3 Spicy 3-15, Seedance 2.0 Spicy 4-15 em 480p e 720p, 4-10 em 1080p. " +
        "O PREÇO ESCALA COM A DURAÇÃO. Duração ausente ou FORA do leque do motor cai no PISO, menos no Omni, que cai no padrão dele (10s). " +
        "action=shadows: duração do vídeo-fonte, se souber (cobra 200/s; sem ela, flat ~2000).",
    ),
  resolution: z
    .enum(["360p", "480p", "720p", "1080p", "768p", "2k", "4k"])
    .optional()
    .describe(
      "action=create e action=price: resolução (Seedance, WAN 2.5 e 3.0, Shot Mimic, H3, P-Video-2 Pro ('480p'/'768p'), H3 Spicy, Seedance Spicy, Gemini Omni 1.1). NÃO existe default 720p aqui: resolução ausente, ou fora do que o motor aceita, cai no tier MAIS CARO do motor, menos no Gemini Omni 1.1, que fica no 720p (o tier que ele vendeu antes de ter escolha). " +
        "O Gemini Omni 1.1 vai de '360p' a '4k' (360p custa 1/3 do 720p, 1080p 1,5x, 4k 3x). " +
        "É isso que faz um create sem este campo custar muito mais que o piso do catálogo (em sapiens-video-seedance vira 1080p, não 480p). Passe sempre a resolução que você quer pagar, e confira com action=price antes. " +
        "O H3 usa '768p' ou '2k' (sem eles cai no 2k, que custa 33% mais por segundo); o H3 Spicy usa '480p'/'768p'/'1080p'. Kling e a linha Hailuo 2.3 não usam este campo (resolução fixa pelo motor).",
    ),
  audio: z
    .boolean()
    .optional()
    .describe("action=create e action=price: liga áudio. Seedance = on por default; Kling 'sound' = +50% no preço. WAN 2.5 é áudio nativo sempre; WAN 3.0 tem interruptor, mesmo preço ligado ou desligado. H3 e H3 Spicy: o som vem sempre e já está no preço, o campo não muda nada. Seedance Spicy: tem interruptor (audio=false sai mudo, pra sonorizar depois), mesmo preço ligado ou desligado."),
  editOfImageId: z
    .string()
    .optional()
    .describe(
      "action=create model=sapiens-video-omni-11 (ou -omni): EDIÇÃO conversacional ('Nano Banana de vídeo'). " +
        "Passe o imageId de um vídeo Omni SEU já gerado e o prompt vira instrução de edição sobre a MESMA cena " +
        "(ex: 'troca o urso polar por um Papai Noel com um presente'), preservando câmera, ambiente e timing. " +
        "Cada edição debita como uma geração Omni nova e devolve um vídeo novo (que também pode ser editado). " +
        "Só funciona em vídeo gerado pelo Omni. Pra editar um vídeo SEU (feito em outro motor ou subido), use sourceVideoId/sourceVideoUrl.",
    ),
  sourceVideoId: z
    .string()
    .optional()
    .describe(
      "action=create model=sapiens-video-omni-11: VÍDEO-FONTE, o imageId de um vídeo SEU pronto (da galeria, qualquer motor ou subido por ingest), até 10 s. " +
        "O Omni recebe o clipe inteiro e o edita (sourceVideoMode='edit', o padrão: a MESMA cena com a mudança do prompt, ex: 'troca o homem pelo personagem da imagem de referência, mantém tudo o resto') " +
        "ou o estende (sourceVideoMode='extend': o pedaço seguinte no tempo). Imagens de personagem/estilo vão junto em referenceImageIds/Urls (até 3); startImage*/endImage* não, o primeiro quadro é o do vídeo. " +
        "Cobrança: a edição cobra o degrau de duração que cobre o clipe (7,3 s cobra 8 s) na resolution pedida; a extensão cobra o durationSec do pedaço novo. A proporção é a do clipe. " +
        "O Google fecha edição de vídeo enviado pra contas no EEE, Suíça e Reino Unido; se o provider recusar, as Sinapses voltam.",
    ),
  sourceVideoUrl: z
    .string()
    .optional()
    .describe(
      "action=create model=sapiens-video-omni-11: o mesmo que sourceVideoId, por URL pública de host da casa (Bunny/Convex), mp4 até 10 s. Mande um OU outro.",
    ),
  sourceVideoMode: z
    .enum(["edit", "extend"])
    .optional()
    .describe(
      "action=create com sourceVideoId/sourceVideoUrl: 'edit' (padrão) edita o clipe; 'extend' continua ele (durationSec = segundos do pedaço novo, 4/6/8/10).",
    ),
  // --- trim / join / fecho / render-ref: as ações da ficha que rodam ffmpeg ---
  startSec: z.number().min(0).optional().describe("action=trim: o segundo onde o corte começa."),
  endSec: z.number().optional().describe("action=trim: o segundo onde o corte acaba. Sem ele, vai até o fim do clipe."),
  imageIds: z
    .array(z.string())
    .optional()
    .describe("action=join: de 2 a 8 vídeos SEUS (ids da galeria), na ordem em que entram no compilado (até 180 s somados)."),
  ending: z
    .enum(["sapiens", "marca", "wavespeed", "both", "none"])
    .optional()
    .describe("action=fecho: a vinheta do fim. 'marca' é a assinatura da casa (Sint.fyi); 'none' sem vinheta."),
  watermark: z.boolean().optional().describe("action=fecho: marca d'água por cima (padrão: liga)."),
  musicUrl: z.string().optional().describe("action=fecho: trilha do acervo da casa (url do CDN) mixada por baixo do som do vídeo."),
  nameCard: z
    .object({ name: z.string(), subtitle: z.string().optional() })
    .optional()
    .describe("action=fecho: cartão de nome por cima do fim (o personagem se apresenta antes da vinheta)."),
  refUrl: z
    .string()
    .optional()
    .describe("action=render-ref: a url da folha ou referência que GEROU o take (está nas referências da peça ou nas imagens do personagem dela)."),
  pagarCom: z
    .enum(["sinapses", "dolar"])
    .optional()
    .describe(
      "action=create: de qual saldo sai o take. Default 'sinapses' (o saldo do App). 'dolar' cobra no saldo em dólar da API da conta (o mesmo de Developers), sem tocar nas Sinapses: mesmo motor, mesma config, preço em dólar do custo do motor naquela duração, resolução e áudio. Use quando a pessoa pedir pra pagar com o saldo da API ou estiver sem Sinapses e com saldo em dólar. Saldo em dólar curto recusa sem cobrar nada; motor sem preço em dólar recusa. Falha do render estorna no mesmo saldo. O valor cobrado volta em pagoEmDolarUsd. Sinapse nunca vira dólar nem o contrário: são duas carteiras.",
    ),
  engine: z
    .enum(["mmaudio-v2", "mirelo-sfx-2.0", "elevenlabs-video-to-music"])
    .optional()
    .describe(
      "action=sonorize: o motor de som. 'mirelo-sfx-2.0' (default) é o motor da casa pra sonorizar: GUARDA a fala que o clipe já tem, tira a música que veio junto e refaz o resto do som em volta; em clipe mudo, faz o som inteiro. " +
        "O Mirelo tira o som da IMAGEM e o texto só empurra: em cena refeita com bicho trocado (recast, Omni editando um take), ele devolve o som do bicho ORIGINAL (o gatinho no take do T-rex saiu com passo e rugido de T-rex). " +
        "'mmaudio-v2' segue o texto: é o motor quando a imagem engana (bicho trocado, cena famosa refeita) e o mais barato por segundo; refaz o som inteiro e a fala do clipe se perde. " +
        "'elevenlabs-video-to-music' não faz som de cena, faz TRILHA: uma música que acompanha os cortes do clipe, mixada por baixo do som que ele já tem (a fala e o ruído ficam); o prompt descreve a música (gênero, instrumentos, clima, onde cresce), não a cena. Recusa, sem cobrar, peça que já tem o fecho da casa (sonorize o take original) e clipe fora da CDN da casa. " +
        "Cote o preço com a pessoa antes. " +
        "O Mirelo e o Video to Music recusam, sem cobrar, peça que entrou de fora (ingest, a casa não sabe a duração dela) e clipe acima de 180s: " +
        "passe a peça de fora antes em action=trim e sonorize o corte; clipe longo, corte em partes.",
    ),
  // --- action=generate (legado) ---
  imageId: z
    .string()
    .optional()
    .describe(
      "action=generate ou action=status: generatedImages:_id do vídeo. O create devolve o imageId; " +
        "ou um vídeo já criado no site (o row define modelo + custo). Use sapiens_gallery action=list pra descobrir. " +
        "action=sonorize: o imageId do clipe SEU (status completed) que vai ganhar som. " +
        "action=extend: o take SEU (completed) que ganha o pedaço seguinte; pode ser a raiz ou a última parte " +
        "da corrente (o servidor resolve a posição). No Omni a parte pronta já traz as anteriores na frente: a última é o filme inteiro, " +
        "não junte as partes. action=chain: qualquer parte da corrente (devolve filmeInteiro quando o motor acumula).",
    ),
  // --- comum ---
  prompt: z
    .string()
    .optional()
    .describe("Prompt da cena. Pra i2v descreve o movimento. Default vago se omitido."),
  aspectRatio: z
    .string()
    .optional()
    .describe("'16:9' (horizontal), '9:16' (vertical), '1:1'. Vale pro t2v; i2v herda da imagem."),
  references: z
    .array(
      z.object({
        mimeType: z.string(),
        data: z.string(),
        role: z
          .string()
          .optional()
          .describe("'start' = imagem inicial (i2v), 'end' = frame final, 'driving' = vídeo de movimento (Motion)"),
      }),
    )
    .optional()
    .describe(
      "References em base64 (escape hatch / Motion / Shot Mimic). i2v: role 'start' (imagem). Motion: 'start' (pessoa) + 'driving' (vídeo de movimento, <=5MB, MÁX 10s — o Kling Motion recusa referência acima de 10s e cobra pela duração do clipe; corte o trecho antes). Shot Mimic: 'start' (personagem) + 'driving' (previs ou clipe do plano a imitar, <=5MB, MÁX 15s — acima o provider corta em 15s). Pra frame inicial/final a partir do seu acervo, prefira start/endImage* abaixo (sem precisar de base64). Nos Spicy (h3-spicy, seedance-spicy, ltx-spicy) references base64 NÃO vale: o frame vem só de startImageId/startImageUrl de peça sua gerada na casa.",
    ),
  // Frame inicial/final por REFERÊNCIA (resolvido server-side, igual à imagem):
  // id da própria galeria OU url allowlist (galeria/Acervo/personagens). Mais
  // simples que mandar base64. Descubra via sapiens_reference / sapiens_gallery.
  startImageId: z
    .string()
    .optional()
    .describe("Frame inicial (i2v): generatedImages:_id da SUA galeria. Vira reference role 'start'. No Seedance 2.x e no H3 NÃO combina com referenceImage*/referenceVideoUrls: é um ou outro. Nos Spicy é a única porta do frame junto com startImageUrl, e a peça precisa ser SUA e gerada na casa (upload, peça trazida por ponte e foto de fora são recusados)."),
  startImageUrl: httpUrl()
    .optional()
    .describe("Frame inicial (i2v): url pública (Bunny/Convex/Wikimedia) de galeria/Acervo/personagem. Vira reference role 'start'. Nos Spicy só vale url de peça SUA gerada na casa: Wikimedia, avatar, upload e peça trazida por ponte são recusados."),
  endImageId: z
    .string()
    .optional()
    .describe("Frame FINAL: generatedImages:_id da SUA galeria. Vira reference role 'end'. Pelo catálogo aceitam: Seedance 2.0/Fast/Mini/2.5, Kling 3.0 Pro, WAN 3.0, H3 e H3 Spicy; o resto não promete (Seedance Spicy, Hailuo e WAN 2.5 não expõem)."),
  endImageUrl: httpUrl()
    .optional()
    .describe("Frame FINAL: url pública de galeria/Acervo/personagem. Vira reference role 'end' (mesmos motores de endImageId)."),
  // Imagens de REFERÊNCIA (Seedance reference_images): guiam estilo/personagem/
  // composição SEM virar o 1º frame. Fluxo storyboard: folha de key poses +
  // personagem como refs num text-to-video.
  referenceImageIds: z
    .array(z.string())
    .optional()
    .describe(
      "action=create (Seedance 2.0/Fast/Mini/2.5 até 4; H3 até 9; Omni 1.1 até 3; Kling, Hailuo, WAN 2.5 e 3.0 e os dois Spicy NÃO): generatedImages:_id da SUA galeria " +
        "como imagens de REFERÊNCIA (role 'ref'). Diferente de startImageId: NÃO viram o 1º frame, guiam " +
        "estilo/personagem/composição. Fluxo storyboard: gere a folha com sapiens_image " +
        "templateSlug='storyboard-sapiens-v1' (ou -vertical-v1) e passe folha + personagem aqui. " +
        "Referência e frame de borda são EXCLUSIVOS no H3 (endpoints diferentes) e na linha Seedance 2.0/Fast/Mini/2.5 (o provider recusa a mistura): mande refs OU startImage*/endImage*, não os dois. " +
        "Quer a pessoa da foto no take? Mande a foto como referência e descreva o primeiro quadro no prompt.",
    ),
  referenceImageUrls: z
    .array(httpUrl())
    .optional()
    .describe(
      "action=create (mesmos motores e tetos de referenceImageIds: Seedance até 4, H3 até 9, Omni 1.1 até 3): URLs públicas (Bunny/Convex/Wikimedia) como imagens de " +
        "REFERÊNCIA (role 'ref'). Soma com referenceImageIds. No prompt, cite as referências por descrição " +
        "(ex: 'use the storyboard reference as ordered key poses; ignore line-sketch artifacts').",
    ),
  referenceVideoUrls: z
    .array(httpUrl())
    .optional()
    .describe(
      "action=create (Seedance 2.0/Fast/Mini/2.5: 1 vídeo; H3: até 3, somando 15s; P-Video-2 Pro: até 3, somando 15s, cada SEGUNDO cobrado à parte, medido pelo servidor antes do débito, e cada clipe cobra no máximo a duração do take + 1s): URL pública (host da casa) de um VÍDEO DE MOVIMENTO (role 'refvideo' -> reference_videos, <=15s): " +
        "a coreografia/câmera do clipe GUIA o take sem ser recriado plano a plano (isso é o Shot Mimic). " +
        "NÃO edita o clipe: o take sai com outra filmagem. Pra mudar um vídeo que já existe mantendo a filmagem, é model='sapiens-video-omni-11' com sourceVideoId/sourceVideoUrl. " +
        "Combina com o fluxo storyboard: folha = beats, vídeo = movimento, personagem = identidade. " +
        "Depth Maps do banco de motion servem direto (ADMIN: descubra com action=shadows-list).",
    ),
  referenceAudioUrls: z
    .array(httpUrl())
    .max(3)
    .optional()
    .describe(
      "action=create, model='sapiens-video-pvideo-2-pro': até 3 URLs públicas (host da casa) de ÁUDIO de referência (mp3, wav, m4a, flac ou ogg), somando 15s: a voz e o som que guiam o take. " +
        "Áudio nunca é a única referência: vai junto de uma imagem ou de um vídeo. Cada SEGUNDO é cobrado à parte, medido pelo servidor antes do débito (áudio que ele não mede, como webm, conta o teto de 15s). " +
        "Cote em action=price com referenceAudioSec. " +
        "No LTX Audio-to-Video (model='sapiens-video-ltx-25-fast-a2v', '-25-pro-a2v' ou '-23-pro-a2v') é OBRIGATÓRIO e é UM só: o áudio vira o take (canto ou fala), em mp3 ou m4a, até 20s (10s no 2.5 Pro); a duração e o preço saem dele, medidos pelo servidor. " +
        "Ali o link precisa ser de um arquivo da SUA conta (link de outra conta é recusado antes de cobrar). Se o áudio é uma faixa sua do sapiens_musicator, use referenceAudioTrackIds (o trackId): o servidor confere que a faixa é sua.",
    ),
  referenceAudioTrackIds: z
    .array(z.string())
    .max(3)
    .optional()
    .describe(
      "action=create: o mesmo áudio de referenceAudioUrls, por ID de faixa SUA (o trackId que sapiens_musicator action=list/get devolve, status 'ready'). " +
        "O servidor confere que a faixa é da sua conta e usa o áudio dela; faixa de outra conta é recusada antes de cobrar. Soma com referenceAudioUrls nos mesmos tetos. " +
        "É o caminho certo no LTX Audio-to-Video, onde a faixa VIRA o take: UM só, mp3 ou m4a, e a faixa precisa caber no teto (até 20s, 10s no 2.5 Pro; o durationSeconds do action=list diz). Faixa mais longa é recusada antes de cobrar: corte o trecho e mande o arquivo seu em referenceAudioUrls.",
    ),
  keepAudio: z
    .boolean()
    .optional()
    .describe(
      "action=create, com exatamente 1 áudio (referenceAudioUrls ou referenceAudioTrackIds): o áudio vira a TRILHA do take (toca primeiro, e o motor completa o resto com som próprio). " +
        "É o caminho de fazer a personagem falar com a voz que você mandou. Sem custo extra além dos segundos do áudio.",
    ),
  referenceVideoClipsSec: z
    .array(z.number())
    .max(3)
    .optional()
    .describe(
      "action=price, só no P-Video-2 Pro (PREFIRA este): a duração de CADA vídeo de referência que o create vai mandar, ex: [10, 4.2]. O servidor aplica a mesma régua do create: cada clipe arredonda pra cima e para na duração do take + 1s, e a soma tem teto 15. O create mede sozinho; isto é só pra cotar.",
    ),
  referenceVideoSec: z
    .number()
    .optional()
    .describe(
      "action=price, só no P-Video-2 Pro: o TOTAL já cobrável de vídeo de referência (você mesmo aplicou o limite de duração do take + 1s por clipe). Sem a duração de cada clipe na mão, use referenceVideoClipsSec, que o servidor aplica o limite. Com os dois, valem os clipes.",
    ),
  referenceAudioSec: z
    .number()
    .optional()
    .describe(
      "action=price, só no P-Video-2 Pro: segundos do(s) áudio(s) de referência que o create vai mandar (somados, arredonda pra cima, teto 15). O create mede sozinho; isto é só pra cotar.",
    ),
  // Frame inicial/final por ARQUIVO LOCAL (paridade com o upload do gerador do
  // site). Só no MCP instalado (stdio): o processo lê o arquivo do disco e sobe
  // como reference role 'start'/'end', sem o base64 passar pelo contexto do
  // modelo. No remoto é recusado (o path seria do servidor, não do usuário).
  startImagePath: z
    .string()
    .optional()
    .describe(
      "Frame INICIAL (i2v) a partir de um ARQUIVO LOCAL do seu PC — só no MCP instalado (stdio), não na conexão remota. " +
        "Passe o caminho absoluto (ex: 'C:\\\\Users\\\\voce\\\\HERO\\\\1.png'); o processo lê o arquivo e sobe como frame inicial, igual a subir a imagem no gerador do site. PNG/JPEG/WebP, até 8MB. " +
        "É 1 imagem inicial por vídeo (o modelo do site): pra vários vídeos, rode create uma vez por imagem. Mutuamente exclusivo com startImageId/startImageUrl. " +
        "Nos Spicy (h3-spicy, seedance-spicy, ltx-spicy) arquivo local NÃO vale: o frame vem só de startImageId/startImageUrl de peça sua gerada na casa.",
    ),
  endImagePath: z
    .string()
    .optional()
    .describe(
      "Frame FINAL a partir de um ARQUIVO LOCAL do seu PC — só no MCP instalado (stdio). Caminho absoluto; PNG/JPEG/WebP até 8MB. Vira reference role 'end' (suporte varia por modelo). 1 imagem por vídeo. Mutuamente exclusivo com endImageId/endImageUrl.",
    ),
  referenceImagePaths: z
    .array(z.string())
    .optional()
    .describe(
      "action=create (mesmos motores de referenceImageIds): imagens de REFERÊNCIA a partir de ARQUIVOS LOCAIS do seu PC, só no MCP instalado (stdio). " +
        "Caminhos absolutos; PNG/JPEG/WebP até 8MB cada, até o teto do motor no total (Seedance 4, H3 9, somando com referenceImageIds/Urls). Viram reference role 'ref'.",
    ),
});

export type VideoArgs = z.infer<typeof videoSchema>;

// Teto do arquivo local que vira frame de vídeo. Frame inicial/final não precisa
// ser pesado; 8MB cobre um PNG/JPEG grande com folga e evita estourar o payload
// da action (base64 infla ~33%).
const MAX_LOCAL_IMAGE_BYTES = 8 * 1024 * 1024;

// Detecta o mime por MAGIC BYTES (não confia na extensão). Frame de vídeo aceita
// só PNG/JPEG/WebP; qualquer outra coisa é recusada com erro claro.
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

// Lê um arquivo de imagem do disco e devolve uma reference base64 pro role dado.
// Guarda de segurança: só no stdio (o processo roda na máquina do dono do token).
// No remoto recusa ANTES de tocar o disco — ler um path arbitrário lá seria
// leitura de arquivo do servidor multi-tenant.
async function readLocalImageAsReference(
  filePath: string,
  role: "start" | "end" | "ref",
): Promise<{ mimeType: string; data: string; role: string }> {
  if (isRemoteContext()) {
    throw new Error(
      `${role}ImagePath (arquivo local) só funciona no MCP instalado na sua máquina (stdio). ` +
        `Na conexão remota, suba a imagem no site e passe ${role}ImageId (id da galeria) ou ${role}ImageUrl (host Sapiens).`,
    );
  }
  const [{ default: fs }, { default: path }] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const abs = path.resolve(filePath);
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    throw new Error(
      `Não achei/li o arquivo em ${role}ImagePath: "${filePath}". Use o caminho absoluto do arquivo (ex: C:\\Users\\voce\\HERO\\1.png).`,
    );
  }
  if (buf.length > MAX_LOCAL_IMAGE_BYTES) {
    const mb = (buf.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Imagem de ${role} muito grande (${mb}MB; teto ${Math.round(MAX_LOCAL_IMAGE_BYTES / (1024 * 1024))}MB). Exporte menor e tente de novo.`,
    );
  }
  const mimeType = detectImageMime(buf);
  if (!mimeType) {
    throw new Error(
      `O arquivo de ${role} não parece PNG/JPEG/WebP ("${filePath}"). O frame inicial/final aceita só imagem nesses formatos.`,
    );
  }
  return { mimeType, data: buf.toString("base64"), role };
}

// Monta as references de frame inicial/final a partir de arquivos locais,
// barrando o conflito com id/url (o site usa UMA via por frame: ou o arquivo,
// ou a imagem já hospedada). Devolve [] quando nenhum path foi passado.
export async function localFrameReferences(
  args: VideoArgs,
): Promise<Array<{ mimeType: string; data: string; role: string }>> {
  const refs: Array<{ mimeType: string; data: string; role: string }> = [];
  if (args.startImagePath) {
    if (args.startImageId || args.startImageUrl) {
      throw new Error(
        "Frame inicial: escolha UMA via — startImagePath (arquivo local) OU startImageId/startImageUrl (galeria/Acervo), não as duas.",
      );
    }
    refs.push(await readLocalImageAsReference(args.startImagePath, "start"));
  }
  if (args.endImagePath) {
    if (args.endImageId || args.endImageUrl) {
      throw new Error(
        "Frame final: escolha UMA via — endImagePath (arquivo local) OU endImageId/endImageUrl (galeria/Acervo), não as duas.",
      );
    }
    refs.push(await readLocalImageAsReference(args.endImagePath, "end"));
  }
  // Referências (role 'ref', Seedance): arquivos locais somam com ids/urls; o
  // teto total (4) é validado no servidor junto do resto.
  for (const p of args.referenceImagePaths ?? []) {
    refs.push(await readLocalImageAsReference(p, "ref"));
  }
  return refs;
}

export async function video(args: VideoArgs): Promise<any> {
  // models: catálogo VIVO dos modelos de vídeo (ativos + faixa de preço real +
  // config + disponibilidade). Público, sem custo e sem login, antes de exigir
  // sessão. Espelha sapiens_image action=models.
  //
  // A faixa vem calculada do servidor pela MESMA função que debita
  // (resolveVideoCostSinapses). Até ago/2026 esta action entregava só o
  // `basePriceSinapses`, que é o PISO do motor, e o agente do outro lado
  // repassava esse número como se fosse o preço: em `sapiens-video-seedance` o
  // piso é 1600 e um create sem resolução debita 9000, porque resolução ausente
  // cai no tier mais caro. Piso sozinho vira promessa quebrada, então ele saiu
  // do retorno e no lugar entrou o trio "sem config / mais barato / mais caro".
  if (args.action === "models") {
    const all: any[] = await convexQuery("videoModels:listWithOverrides", {});
    const models = (all ?? [])
      .filter((m) => m?.isActive)
      .map((m) => ({
        id: m.id,
        engine: m.engine,
        label: m.label,
        // Família + variante: o Seedance sozinho tem várias entradas nesta lista
        // (2.0, 2.0 Fast, 2.0 Mini, 2.5) e são o mesmo motor em geração/tier
        // diferente. Sem os dois campos o cliente lê motores sem relação.
        // Ausência = motor sozinho.
        family: m.family ?? null,
        variant: m.variantLabel ?? null,
        // Pra que este motor serve: audio, fala, referencia, movimento, longo.
        bestFor: m.bestFor ?? [],
        // "por-segundo" = o preço MUDA com duração, resolução e (no Kling) áudio.
        // "por-clipe" = preço fixo, config não mexe na conta.
        priceMode: m.priceMode ?? null,
        // O que um create SEM durationSec/resolution debita hoje neste motor,
        // com a config que esse preço paga de fato.
        priceDefault: m.priceDefault ?? null,
        // Os dois cantos do motor: a config mais barata e a mais cara possíveis.
        priceMin: m.priceMin ?? null,
        priceMax: m.priceMax ?? null,
        // +50% no Kling quando o som liga; null = som já embutido no preço.
        audioMultiplier: m.audioMultiplier ?? null,
        modes: m.modes,
        durationsSec: m.durationsSec,
        resolutions: m.resolutions,
        hasAudio: m.hasAudio,
        available: m.available,
        comingSoon: m.comingSoon,
        note: m.description,
      }));
    return {
      count: models.length,
      default: "sapiens-video-seedance",
      models,
      note:
        "NÃO EXISTE 'o preço' de um motor de vídeo com priceMode='por-segundo': o custo é duração x resolução [x áudio], então o que existe é uma FAIXA. " +
        "priceDefault.sinapses é o que um create SEM durationSec e SEM resolution debita hoje (o clamp da casa manda duração ausente pro piso e resolução ausente pro tier MAIS CARO, por isso ele costuma ser bem maior que priceMin). " +
        "priceMin e priceMax são os dois cantos do motor, cada um com a config que o produz. " +
        "Ao falar de preço com a pessoa, diga a faixa e a config, nunca um número solto. " +
        "Pro número exato de uma config antes de gerar, use action=price (sem custo, sem login): ele devolve o valor que o create vai debitar. " +
        "Motor com priceMode='por-clipe' tem preço fixo e as três pontas são iguais (hoje nenhum: o Omni cobra por segundo desde out/2026, e sem durationSec dá 10s). " +
        "available=false = 'em breve' (depende de env, ex: Omni).",
    };
  }

  // price: cotação EXATA de uma config, pela mesma função que debita. Sem custo
  // e sem login, igual ao models: confirmar o preço é de graça, errar o take é
  // que custa. É a porta pra dizer o número certo pra pessoa antes do create.
  if (args.action === "price") {
    if (!args.model) {
      throw new Error(
        "action=price exige model (o id do motor; a lista viva sai em action=models).",
      );
    }
    const quote: any = await convexQuery("videoModels:priceQuote", {
      model: args.model,
      durationSec: args.durationSec,
      resolution: args.resolution,
      audio: args.audio,
      // Motor que cobra por imagem: a cotação conta as imagens do pedido do
      // mesmo jeito que o create conta no servidor (refs + frame inicial e
      // final). Só vai pra esse motor, porque servidor anterior a ele recusa o
      // campo e derrubaria a cotação dos outros.
      ...(COBRA_POR_IMAGEM.has(args.model) ? { referenceCount: imagensDoPedido(args) } : {}),
      // E os segundos de clipe e de áudio que o caller disse que vai mandar.
      // Só quando vieram: servidor de antes do campo recusaria arg desconhecido.
      ...(COBRA_POR_SEGUNDO_DE_REFERENCIA.has(args.model) && args.referenceVideoSec !== undefined
        ? { referenceVideoSec: args.referenceVideoSec }
        : {}),
      ...(COBRA_POR_SEGUNDO_DE_REFERENCIA.has(args.model) && args.referenceVideoClipsSec?.length
        ? { referenceVideoClipsSec: args.referenceVideoClipsSec }
        : {}),
      ...(COBRA_POR_SEGUNDO_DE_REFERENCIA.has(args.model) && args.referenceAudioSec !== undefined
        ? { referenceAudioSec: args.referenceAudioSec }
        : {}),
    });
    // Três avisos possíveis, e a ordem importa: o clamp é o que mais surpreende
    // (a conta vem diferente do pedido), depois o campo omitido (que o servidor
    // preenche pelo lado CARO da régua) e por último o caso limpo.
    const perSecond = quote?.priceMode === "por-segundo";
    const omitiu =
      perSecond &&
      (args.resolution === undefined || args.durationSec === undefined) &&
      !quote?.clamped;
    return {
      ...quote,
      note: quote?.clamped
        ? "ATENÇÃO: a config cobrada (billed) não é a que você pediu (asked). Duração fora do leque do motor cai no piso e resolução inválida cai no tier MAIS CARO, e é esse valor clampado que o create vai debitar e mandar pro provider. Ajuste o pedido pra um valor que o motor aceita (veja durationsSec/resolutions em action=models)."
        : omitiu
          ? "Você não passou durationSec e/ou resolution, então o servidor preencheu (billed mostra o quê): duração ausente vira o piso, resolução ausente vira o tier MAIS CARO do motor. O valor em sinapses já é o desse preenchimento, e é o que o create vai debitar se você chamar do mesmo jeito. Passe os dois campos pra pagar o que você escolheu."
          : "sinapses é o valor que o create vai debitar com exatamente essa config. Confirme com a pessoa antes de gerar.",
    };
  }

  // templates: catálogo VIVO das receitas de take (estilo + spec + os campos de
  // brief que cada uma usa). Público, sem custo e sem login, igual ao models:
  // escolher a receita certa é de graça, errar o take é que custa.
  if (args.action === "templates") {
    const rows: any[] = await convexQuery("videoTemplates:list", {});
    return {
      count: rows?.length ?? 0,
      templates: rows ?? [],
      note:
        "Passe o slug em action=create como templateSlug: o `prompt` vira só a CENA e o `brief` preenche o resto. " +
        "briefFields diz o que vale a pena preencher em cada receita; allowedModels/allowedDurationsSec são o teto do override.",
    };
  }

  const sessionToken = getSessionToken();

  if (args.action === "demos") {
    return await convexQuery("videoSpecs:mcpListMyDemoFilms", { sessionToken });
  }

  // --- Vídeos Programáticos (Lab de specs, ADMIN, sem custo) ---

  if (args.action === "film-list") {
    return await convexQuery("videoSpecs:mcpListMyVideoSpecs", {
      sessionToken,
      kind: args.filmKind,
      status: args.filmStatus,
    });
  }

  if (args.action === "film-get") {
    if (!args.slug) throw new Error("film-get exige slug (descubra via film-list).");
    return await convexQuery("videoSpecs:mcpGetVideoSpec", { sessionToken, slug: args.slug });
  }

  // --- Legenda ---

  if (args.action === "caption-list") {
    if (!args.slug) throw new Error("caption-list exige slug (descubra via film-list).");
    return await convexAction("mcpExtrasActions:mcpCaptionList", {
      sessionToken,
      slug: args.slug,
    });
  }

  if (args.action === "caption-generate") {
    if (!args.slug) throw new Error("caption-generate exige slug (descubra via film-list).");
    if (!args.captionLang) {
      throw new Error(
        "caption-generate exige captionLang: o idioma FALADO no vídeo (o modelo transcreve nele).",
      );
    }
    return await convexAction("mcpExtrasActions:mcpCaptionGenerate", {
      sessionToken,
      slug: args.slug,
      lang: args.captionLang,
      trio: args.captionTrio,
    });
  }

  if (args.action === "caption-translate") {
    if (!args.slug) throw new Error("caption-translate exige slug (descubra via film-list).");
    if (!args.captionLang) throw new Error("caption-translate exige captionLang (idioma de destino).");
    return await convexAction("mcpExtrasActions:mcpCaptionTranslate", {
      sessionToken,
      slug: args.slug,
      lang: args.captionLang,
    });
  }

  if (args.action === "film-upsert") {
    if (!args.spec || typeof args.spec !== "object") {
      throw new Error(
        "film-upsert exige spec (objeto JSON com kind + musicMode + payload do kind: demo | aulaTour | essay | tipoMusical | dataviz).",
      );
    }
    const { kind, musicMode, musicRef, aulaSlug, demo, aulaTour, essay, tipoMusical, dataviz } =
      args.spec as Record<string, any>;
    return await convexMutation("videoSpecs:mcpUpsertVideoSpec", {
      sessionToken,
      slug: args.slug,
      kind,
      musicMode: musicMode ?? "default",
      musicRef,
      aulaSlug,
      demo,
      aulaTour,
      essay,
      tipoMusical,
      dataviz,
    });
  }

  if (args.action === "film-status") {
    if (!args.slug) throw new Error("film-status exige slug (descubra via film-list).");
    if (args.filmStatus === undefined && args.videoUrl === undefined && args.durationSecMeasured === undefined) {
      throw new Error("film-status: passe filmStatus, videoUrl e/ou durationSecMeasured (o fecho do render é os três).");
    }
    return await convexMutation("videoSpecs:mcpSetVideoStatus", {
      sessionToken,
      slug: args.slug,
      status: args.filmStatus,
      videoUrl: args.videoUrl,
      durationSec: args.durationSecMeasured,
    });
  }

  if (args.action === "film-publish") {
    if (!args.slug) throw new Error("film-publish exige slug (descubra via film-list).");
    if (typeof args.published !== "boolean") {
      throw new Error("film-publish exige published (true publica no Acervo, false despublica).");
    }
    return await convexMutation("videoSpecs:mcpSetVideoPublished", {
      sessionToken,
      slug: args.slug,
      published: args.published,
    });
  }

  if (args.action === "film-delete") {
    if (!args.slug) throw new Error("film-delete exige slug (descubra via film-list).");
    return await convexMutation("videoSpecs:mcpDeleteVideoSpec", { sessionToken, slug: args.slug });
  }

  if (args.action === "showcase") {
    if (!args.slug) {
      throw new Error("action=showcase exige slug (descubra via action=demos).");
    }
    if (typeof args.showcase !== "boolean") {
      throw new Error("action=showcase exige showcase (true pra pôr, false pra tirar).");
    }
    return await convexMutation("videoSpecs:mcpSetVideoShowcase", {
      sessionToken,
      slug: args.slug,
      showcase: args.showcase,
      showcaseTag: args.showcaseTag,
      showcaseOrder: args.showcaseOrder,
    });
  }

  if (args.action === "status") {
    if (!args.imageId) {
      throw new Error("action=status exige imageId (o que create/generate devolveu).");
    }
    return await convexQuery("mcpExtras:mcpVideoStatus", {
      sessionToken,
      imageId: args.imageId,
    });
  }

  // As ações da ficha que rodam ffmpeg no site: cada uma vira peça nova na
  // galeria, a de origem fica intacta. Síncronas (até uns minutos): Timeout
  // é o cliente desistindo, a peça pode ter saído.
  if (args.action === "trim") {
    if (!args.imageId || args.startSec == null) {
      throw new Error("action=trim exige imageId (o vídeo SEU) e startSec; endSec é opcional (sem ele, vai até o fim).");
    }
    return await convexAction("mcpExtrasActions:mcpVideoTrim", {
      sessionToken,
      sourceImageId: args.imageId,
      startSec: args.startSec,
      ...(args.endSec != null ? { endSec: args.endSec } : {}),
    });
  }

  if (args.action === "join") {
    if (!args.imageIds || args.imageIds.length < 2) {
      throw new Error("action=join exige imageIds com 2 a 8 vídeos SEUS, na ordem do compilado.");
    }
    return await convexAction("mcpExtrasActions:mcpVideoJoin", { sessionToken, sourceImageIds: args.imageIds });
  }

  if (args.action === "fecho") {
    if (!args.imageId) throw new Error("action=fecho exige imageId (o vídeo SEU, pronto).");
    return await convexAction("mcpExtrasActions:mcpVideoFecho", {
      sessionToken,
      sourceImageId: args.imageId,
      ...(args.ending ? { ending: args.ending } : {}),
      ...(args.watermark != null ? { watermark: args.watermark } : {}),
      ...(args.musicUrl ? { musicUrl: args.musicUrl } : {}),
      ...(args.nameCard ? { nameCard: args.nameCard } : {}),
    });
  }

  if (args.action === "render-ref") {
    if (!args.imageId || !args.refUrl) {
      throw new Error("action=render-ref exige imageId (o take) e refUrl (a folha ou referência que gerou ele).");
    }
    return await convexAction("mcpExtrasActions:mcpVideoRenderRef", { sessionToken, videoId: args.imageId, refUrl: args.refUrl });
  }

  if (args.action === "upscale") {
    if (!args.imageId) {
      throw new Error("action=upscale exige imageId (o clipe SEU, já completed, que vai ganhar resolução).");
    }
    if (!args.resolution) {
      throw new Error("action=upscale exige resolution, o alvo: '720p', '1080p', '2k' ou '4k'. O preço é por segundo do clipe e sobe com o alvo.");
    }
    return await convexAction("mcpExtrasActions:mcpVideoUpscale", {
      sessionToken,
      sourceImageId: args.imageId,
      target: args.resolution,
    });
  }

  if (args.action === "sonorize") {
    if (!args.imageId) {
      throw new Error("action=sonorize exige imageId (o clipe SEU, já completed, que vai ganhar som).");
    }
    if (!args.prompt || args.prompt.trim().length < 4) {
      throw new Error(
        "action=sonorize exige prompt descrevendo o som da cena (ambiente, materiais, impactos, textura), ou a música no elevenlabs-video-to-music.",
      );
    }
    return await convexAction("mcpExtrasActions:mcpVideoSonorize", {
      sessionToken,
      sourceImageId: args.imageId,
      prompt: args.prompt,
      // Vai sempre: sem o campo o servidor cai no MMAudio (o contrato das versões
      // de antes desta), e o motor da casa pra sonorizar agora é o Mirelo.
      engine: args.engine ?? "mirelo-sfx-2.0",
    });
  }

  if (args.action === "extend") {
    if (!args.imageId) {
      throw new Error(
        "action=extend exige imageId: o take SEU (já completed) que vai ganhar o pedaço seguinte. " +
          "Pode ser a raiz ou a última parte de uma corrente; o servidor resolve a posição.",
      );
    }
    return await convexAction("mcpExtrasActions:mcpVideoExtend", {
      sessionToken,
      imageId: args.imageId,
      prompt: args.prompt,
      durationSec: args.durationSec,
    });
  }

  if (args.action === "chain") {
    if (!args.imageId) {
      throw new Error("action=chain exige imageId (qualquer parte da corrente serve).");
    }
    return await convexQuery("mcpExtras:mcpVideoChain", {
      sessionToken,
      imageId: args.imageId,
    });
  }

  if (args.action === "create") {
    if (!args.model && !args.templateSlug) {
      throw new Error(
        "action=create exige model (ex: sapiens-video-seedance, sapiens-video-kling, sapiens-video-wan, sapiens-video-kling-motion) ou templateSlug (a receita traz o motor; veja action=templates).",
      );
    }
    // Frame inicial/final por arquivo local (paridade com o upload do site):
    // lê do disco e injeta em references role start/end. O backend
    // (buildVideoReferences) já mescla references + start/end e valida o teto.
    const localRefs = await localFrameReferences(args);
    const references = localRefs.length
      ? [...(args.references ?? []), ...localRefs]
      : args.references;
    return await convexAction("mcpExtrasActions:mcpVideoCreateAndRender", {
      sessionToken,
      model: args.model,
      templateSlug: args.templateSlug,
      brief: args.brief,
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      durationSec: args.durationSec,
      resolution: args.resolution,
      audio: args.audio,
      references,
      startImageId: args.startImageId,
      startImageUrl: args.startImageUrl,
      endImageId: args.endImageId,
      endImageUrl: args.endImageUrl,
      referenceImageIds: args.referenceImageIds,
      referenceImageUrls: args.referenceImageUrls,
      referenceVideoUrls: args.referenceVideoUrls,
      // Áudio de referência: só quando veio (servidor de antes do campo recusaria).
      ...(args.referenceAudioUrls?.length ? { referenceAudioUrls: args.referenceAudioUrls } : {}),
      ...(args.referenceAudioTrackIds?.length ? { referenceAudioTrackIds: args.referenceAudioTrackIds } : {}),
      ...(args.keepAudio ? { keepAudio: true } : {}),
      editOfImageId: args.editOfImageId,
      sourceVideoId: args.sourceVideoId,
      sourceVideoUrl: args.sourceVideoUrl,
      sourceVideoMode: args.sourceVideoMode,
      // Só vai quando veio: servidor de antes do campo recusaria arg desconhecido.
      ...(args.pagarCom === "dolar" ? { pagarCom: "dolar" } : {}),
    });
  }

  if (args.action === "shadows") {
    if (!args.videoUrl) {
      throw new Error("action=shadows exige videoUrl (URL pública do vídeo-fonte).");
    }
    if (!args.title || args.title.trim().length < 3) {
      throw new Error("action=shadows exige title (mín. 3 chars; vira o slug do depth map).");
    }
    return await convexAction("mcpExtrasActions:mcpExtractShadows", {
      sessionToken,
      videoUrl: args.videoUrl,
      title: args.title,
      durationSec: args.durationSec,
    });
  }

  if (args.action === "shadows-list") {
    return await convexAction("mcpExtrasActions:mcpListShadows", {
      sessionToken,
      search: args.search,
    });
  }

  if (args.action === "generate") {
    if (!args.imageId) {
      throw new Error("action=generate exige imageId (vídeo já criado no site).");
    }
    const localRefs = await localFrameReferences(args);
    const references = localRefs.length
      ? [...(args.references ?? []), ...localRefs]
      : args.references;
    return await convexAction("mcpExtrasActions:mcpVideoGenerate", {
      sessionToken,
      imageId: args.imageId,
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      references,
      startImageId: args.startImageId,
      startImageUrl: args.startImageUrl,
      endImageId: args.endImageId,
      endImageUrl: args.endImageUrl,
    });
  }
}
