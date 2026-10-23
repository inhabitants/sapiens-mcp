import { z } from "zod";
import {
  convexQuery,
  convexMutation,
  convexAction,
  describeConvexError,
  getSessionToken,
} from "../convexClient.js";

/**
 * sapiens_distribution: o Despachar peças pelo agente.
 *
 * A peça pronta (imagem, vídeo, carrossel, artigo) entra na FILA do Distribution
 * Workflow com canal, copy e a aba de quem ela é. Nada aqui posta em rede
 * nenhuma: quem despacha continua sendo a tela, porque é lá que mora a conta
 * conectada. O que a tool faz é tirar o trabalho de digitar peça por peça.
 *
 * ADMIN-ONLY de propósito. A rota /experimentos/distribution-workflow também é:
 * despacho depende de rede conectada e hoje só a casa tem. Membro que chamar
 * recebe o recado do servidor, não uma tela vazia.
 *
 * A ABA (`voice`) é de quem é a peça: `sapiens` (a casa), `helen-ailith`,
 * `borderless`, ou o slug de um personagem novo. Slug livre: personagem novo
 * ganha aba sozinho quando a primeira peça dele é despachada. Ausente, o
 * servidor deriva do personagem da peça e cai em `sapiens` quando não há.
 *
 * Sub-actions:
 *   - queue:   põe uma peça na fila (title + channel obrigatórios). Num canal
 *     do Instagram, `format: "instagram_story"` faz a peça sair como STORY.
 *     Volta com `aviso` quando a mesma abertura já saiu na mesma rede.
 *   - list:    o que está na fila, filtrável por status, por aba e por
 *     categoria (o que a peça É; queue e edit também a declaram).
 *   - voices:  as abas que existem hoje, com a contagem de cada uma.
 *   - status:  move a peça de lane (fila, agendado, postado, descartado).
 *     Em agendado, volta com `aviso` quando a peça é capítulo de série e o
 *     anterior, no mesmo canal, não sai antes dela.
 *   - edit:    reescreve a peça que está na fila (copy, título, hashtags,
 *     notas, mídia, língua, comentário). Só manda o que muda. Texto de peça
 *     POSTADA não se reescreve: o post na rede não muda junto.
 *   - sign:    liga ou desliga a ASSINATURA da peça (imagem e vídeo). O carimbo
 *     é o da LINHAGEM de quem assina: sint.fyi/<endereço dela> (e o fecho de 2s
 *     no vídeo) ou a marca própria dela, sem nada da casa. A mesma chave da
 *     ficha, com as mesmas travas no servidor. Em queue, `signed: true` já
 *     enfileira assinada; em lineage-save, `assinatura` escolhe o carimbo.
 *   - lineages / lineage-new / lineage-save / lineage-archive: o CADASTRO das
 *     linhagens (personagens, produtos, a casa), o mesmo que a aba Teia edita:
 *     a mãe no Bluesky, as contas próprias, as galerias que a mãe alimenta, as
 *     fichas e o post do dia. É ele que decide por qual conta cada peça sai e
 *     o que viaja sozinho depois.
 *   - tree / tree-mark: a ÁRVORE DE CONTAS, o formulário de quem existe onde.
 *     Linhagem × rede, com o email e o @ de cada conta, o canal que ela ocupa e
 *     o que falta criar. tree lê; tree-mark registra o email ou o @ que existe
 *     lá fora, associa a conta da casa ou dispensa a rede opcional, a linhagem
 *     inteira de uma vez, tudo ou nada. A mesma função da aba Teia > Contas.
 *   - garimpo: o ACERVO em famílias, pra escolher o que vai pra fila. Versão
 *     velha (o original de um corte, o take de um vídeo montado) sai marcada
 *     como substituída; irmãs (a mesma ideia gerada de novo) vêm agrupadas pra
 *     escolha no olho; o painel cortado vem em `recortes`, o original e os
 *     quadros em ordem; e cada família diz por onde já saiu. Página por cursor,
 *     cortando só num buraco de uma hora entre peças.
 *
 * Sem custo em Sinapses: isto organiza, não gera.
 */

/**
 * Os canais do Distribution, espelhando o `channelValidator` de
 * `apps/sapiens/convex/distribution.ts`. Lista fechada dos dois lados, então
 * canal que nasce lá e não chega aqui simplesmente não existe pro agente.
 *
 * CONTA EXTRA DA MESMA REDE É UM CANAL PRÓPRIO. Não é detalhe de nomenclatura:
 * `bluesky` é uma conta, `bluesky-2` é outra, cada uma com credencial, idioma e
 * dono editorial próprios. Enquanto esta lista tinha só o primeiro slot de cada
 * rede, peça de personagem despachada pelo agente só tinha uma conta pra onde
 * ir, e saía assinada por quem não é dono dela (ago/2026, Bluesky).
 */
const CHANNELS = [
  "instagram",
  "youtube",
  "x",
  "tiktok",
  "threads",
  "linkedin",
  "google-business",
  "bluesky",
  "bluesky-2",
  "bluesky-3",
  "bluesky-4",
  "bluesky-5",
  "bluesky-6",
  "bluesky-7",
  "bluesky-8",
  "bluesky-9",
  "bluesky-10",
  "bluesky-11",
  "bluesky-12",
  "farcaster",
  "telegram",
  // Canais de personagem no Telegram (telegram-2 = Aria, telegram-3 = Arak,
  // telegram-4 = Helen, telegram-5 = Borderless), mesmo bot da casa.
  "telegram-2",
  "telegram-3",
  "telegram-4",
  "telegram-5",
  "telegram-6",
  "telegram-7",
  "telegram-8",
  "telegram-9",
  "telegram-10",
  // nostr: protocolo, nao empresa. Publica por WebSocket atras de "use node".
  "nostr",
  // Are.na: um canal por CANAL de la (o Are.na nao tem feed).
  "arena-characters",
  "arena-scenes",
  "arena-films",
  "reddit",
  "medium",
  "bilibili",
  "civitai",
  // O gemeo NSFW (civitai.red). Canal proprio porque o ToS do .com proibe
  // nudez desde 26/08/2026: peca +18 vai por aqui, o .com fica com o que veste.
  "civitai-red",
  "pinterest",
  // deviantart: OAuth + upload em dois passos.
  "deviantart",
  // tumblr: OAuth2 + publisher NPF.
  "tumblr",
  // Post de texto na aba Posts do canal (irmão do "youtube", que é vídeo).
  "youtube-community",
  // Update de Canal do WhatsApp: browser-driven, não há API de Canal.
  "whatsapp",
  // Fanvue: o feed (post) e a caixa de mensagem (mass message). Duas
  // superfícies da mesma conta, dois canais, os dois postando pela API. A peça
  // daqui escolhe QUEM ALCANÇA (audience: muro no feed, lista de destino na
  // mensagem) e POR QUANTO (priceCents, nos dois).
  "fanvue",
  "fanvue-dm",
  // Pornhub: a conta de model da Aria, foto e video, sem API. A peca nasce na
  // fila como pacote e a mao sobe. So ilustrada: fotorreal de IA e barrado la.
  "pornhub",
  // Segunda conta da mesma rede, nomeada (Model A).
  "instagram-pro",
  "threads-pro",
  "linkedin-page",
  // Segunda via pelo Buffer (conta que a casa liga lá).
  "x-buffer",
  "tiktok-buffer",
  "tiktok-buffer-2",
  // O TikTok, o YouTube e o Instagram de linhagem pelo upload-post, no profile
  // da linhagem dona do canal.
  "tiktok-up",
  "youtube-up",
  "instagram-up",
  // O segundo trio (11/10/2026), no profile de outra linhagem.
  "tiktok-up-2",
  "youtube-up-2",
  "instagram-up-2",
  "instagram-up-3",
  "instagram-up-4",
  // O X do Obsolete Human, pelo Buffer próprio do selo. O linkedin-page-2 saiu
  // em 11/10/2026: o selo não tem LinkedIn, e o servidor recusa o canal com o
  // motivo (convex/shared/canaisAposentados.ts) pra quem roda versão velha.
  "x-buffer-2",
  "x-buffer-3",
  "x-buffer-4",
  "x-buffer-5",
  // Vagas numeradas de conta extra.
  "instagram-3",
  "instagram-4",
  "instagram-5",
  "instagram-6",
  "instagram-7",
  "instagram-8",
  "threads-3",
  "threads-4",
  "threads-5",
  "youtube-2",
  "youtube-3",
  "youtube-4",
  "youtube-5",
] as const;

/**
 * As categorias da peça, espelhando `CATEGORIAS` de
 * `apps/sapiens/convex/shared/categoriaDaPeca.ts`. O eixo é o ASSUNTO: quem
 * assina é a aba, a mídia é o canal. "sem" só existe no list (a triagem).
 */
const CATEGORIAS = ["arte", "personagem", "tecnico", "novidade", "educativo", "mercado", "pessoal"] as const;

export const distributionSchema = z.object({
  action: z.enum([
    "queue",
    "list",
    "voices",
    "status",
    "edit",
    "sign",
    "bio",
    "lineages",
    "lineage-new",
    "lineage-save",
    "lineage-archive",
    "tree",
    "tree-mark",
    "garimpo",
  ]),
  title: z
    .string()
    .optional()
    .describe("queue: título INTERNO da peça (como você a acha na lista). Obrigatório."),
  channel: z
    .enum(CHANNELS)
    .optional()
    .describe(
      "queue: o canal de destino. Obrigatório. Conta extra da mesma rede é um canal próprio: bluesky-2 a bluesky-5 são OUTRAS contas no Bluesky, telegram-2 é o canal da Aria, telegram-3 o da Arak, telegram-4 o da Helen e telegram-5 o do Borderless no Telegram (o telegram é o da casa), instagram-pro e instagram-3..5 outras no Instagram, x-buffer-2 o X do Obsolete Human (selo de arte, em inglês, voice obsolete-human), e assim por diante. A peça sai pela conta de quem assina ela, então case o canal com a aba (`voice`) antes de despachar: peça de personagem no canal de outro só aparece como erro depois de publicada, no perfil errado. Case também o canal com a MÍDIA (ver assetKind): canal de vídeo não recebe foto, canal de imagem não recebe vídeo, e o servidor recusa na fila.",
    ),
  copy: z
    .string()
    .optional()
    .describe(
      "queue/edit: a legenda pronta pra colar, na voz de quem assina a peça. Sem em-dash. Em edit, troca a legenda inteira da peça da fila.",
    ),
  replyText: z
    .string()
    .optional()
    .describe(
      "queue: o COMENTÁRIO que sai junto do post, pra onde vai o link (a copy fica sem ele e fecha apontando pro comentário). Só dois lugares publicam: o X pelo Buffer (x-buffer, x-buffer-2..4) e o X da API própria (x), como resposta no mesmo fio, teto 280; e a Página do LinkedIn pelo Buffer (linkedin-page), como primeiro comentário, teto 1250. Threads (threads, threads-pro, threads-3..5), LinkedIn Perfil (linkedin) e o resto NÃO publicam comentário: lá o link mora na própria copy. O servidor recusa a peça com replyText num canal que não publica, e recusa o comentário acima do teto com a contagem; nada é cortado calado.",
    ),
  hashtags: z.array(z.string()).optional().describe("queue/edit: sem o #, o servidor limpa. Em edit, a lista troca a inteira (vazia tira todas)."),
  publicTitle: z
    .string()
    .max(100)
    .optional()
    .describe(
      "queue: o título PÚBLICO, o que vai ao ar (o YouTube põe no vídeo, o Reddit no post, o LinkedIn embaixo do player). Ausente, o servidor deriva da 1a linha da copy. No YouTube passe sempre: a descrição costuma abrir com crédito e link, e isso não é título.",
    ),
  captionTracks: z
    .array(z.object({ lang: z.string(), url: z.string(), name: z.string().optional() }))
    .max(4)
    .optional()
    .describe(
      "queue, só YouTube (youtube, youtube-2..5): as faixas de LEGENDA que sobem logo depois do vídeo, UM .srt por língua no CDN da casa (https, numa das zonas Bunny da casa: sapiensinteticos.b-cdn.net ou geracoes-usuario.b-cdn.net; pull zone de outra conta é recusada). lang no código do YouTube: en, pt-BR. name é o rótulo no seletor do player (default English / Português (Brasil)). A legenda só sobe nas vagas youtube-2..5 (as contas de linhagem, que pedem a permissão de legenda ao conectar; o youtube principal fica só com upload, de propósito) e com a conexão feita a partir de set/2026: conexão antiga ou o youtube principal sobem o vídeo e a peça avisa que a legenda ficou de fora. Outro canal recusa na fila.",
    ),
  localizations: z
    .array(z.object({ lang: z.string(), title: z.string().max(100), description: z.string().optional() }))
    .max(4)
    .optional()
    .describe(
      "queue, só YouTube: título e descrição em OUTRA língua, que o YouTube mostra pra quem assiste nela. A língua do vídeo é a da peça (lang en vira en, pt vira pt-BR), e localização na mesma língua do vídeo é ignorada. Ex: [{lang:'pt-BR', title:'...', description:'...'}].",
    ),
  videoCoverUrl: z
    .string()
    .optional()
    .describe(
      "queue/edit: a CAPA do vídeo, a imagem que o perfil do Instagram mostra no lugar de um quadro qualquer do Reel. Pela API ela só entra na hora de postar: Reel publicado só troca de capa à mão no app, então a capa nasce com a peça. É o molde de capa da casa (skill thumbnail, --formato reel, 1080x1920): renderize, suba com sapiens_gallery action=upload filePath=<o .jpg> e passe a url que ela devolve. Imagem (jpg, png, webp) num host da casa, e só em peça que leva vídeo; o servidor recusa o resto. Só o Reels do Instagram publica (instagram, instagram-pro, instagram-3..8 e instagram-up*); story e carrossel ignoram. Nas outras redes o campo viaja sem efeito: ponha a capa na MÃE do Bluesky e a teia leva até a filha do Instagram. Em edit, string vazia tira a capa.",
    ),
  assetUrl: z
    .string()
    .optional()
    .describe(
      "queue: a mídia da peça, UMA só (URL de host Sapiens, a que sapiens_image/sapiens_gallery devolvem). Pra post de várias imagens (carrossel, as 4 do X, álbum), use assets.",
    ),
  assets: z
    .array(
      z.object({
        url: z.string(),
        kind: z.enum(["image", "video", "audio"]).optional(),
      }),
    )
    .max(20)
    .optional()
    .describe(
      "queue: a mídia em LISTA, na ordem do post. Quando vem, ela manda: a 1ª vira a capa e assetUrl/assetKind são ignorados. Cada canal leva só o teto dele e o resto fica de fora na hora do despacho: instagram 10 (carrossel, imagem e vídeo juntos), threads 20, linkedin 20, telegram e telegram-2..5 10 (álbum), x-buffer 4, bluesky e bluesky-2..5 4, linkedin-page 4, farcaster 2, os demais 1. O canal x (API própria do X) NÃO sobe imagem nenhuma, só o texto: post do X com imagem vai por x-buffer. Canal que não mistura (x-buffer, bluesky, linkedin) segue o tipo da 1ª mídia. Exceção no bluesky (todas as contas): vídeo na 1ª e imagens depois é UMA peça só, o vídeo vai no post e as imagens (até 4) saem na RESPOSTA dele, no mesmo fio e no mesmo despacho; é o caminho do vídeo + prompt em cards, e partir em duas peças na fila quebra o fio. Não precisa mandar o imageId de cada obra: o servidor casa cada URL com a obra da casa, e toda imagem da casa na lista conta como compartilhada na ficha dela. O Distribution não faz quote de post do X: link de post na copy vai como link.",
    ),
  assetKind: z
    .enum(["image", "video", "audio"])
    .optional()
    .describe(
      "queue: o tipo da mídia. Ausente, o servidor infere pela URL. A MÍDIA ESCOLHE O CANAL, e o servidor recusa o par errado com o caminho certo no erro: youtube, youtube-2..5 e bilibili levam só vídeo (foto ou texto no YouTube vai por youtube-community); tiktok sobe só vídeo pro inbox (foto no TikTok vai por tiktok-buffer); tiktok-up e youtube-up (o TikTok e o YouTube de linhagem pelo upload-post) publicam e levam só vídeo, e instagram-up (o Instagram de linhagem pelo upload-post) leva vídeo (Reel) ou até 10 fotos; pinterest, google-business e youtube-community levam só imagem (vídeo nesses três: manda a capa como imagem, ou muda o canal). Áudio conta como imagem: nenhum canal sobe áudio pela API, a peça empacota pro post manual. O resto leva os três.",
    ),
  assetPageAssetId: z
    .string()
    .optional()
    .describe(
      "queue: o imageId da peça DA CASA que virou esta mídia (o que sapiens_gallery devolve; vídeo mora na mesma tabela). Passe SEMPRE que a mídia for obra da casa, e principalmente quando a assetUrl for uma VARIANTE do arquivo (a versão web de um master, um recorte, um corte): o servidor casa mídia com obra por igualdade EXATA de URL, então variante nasce órfã, e peça órfã perde o vínculo com o personagem e abre o visualizador cru em vez da ficha da peça.",
    ),
  assetPagePath: z
    .string()
    .optional()
    .describe(
      "queue: o endereço público da peça da casa, no formato '/video/<id>' ou '/imagem/<id>'. Mesma função do assetPageAssetId, pra quem já tem o caminho pronto em vez do id. Passar os dois não dói: o path ganha.",
    ),
  lang: z
    .enum(["pt", "en"])
    .optional()
    .describe(
      "lineage-new/lineage-save: a língua em que a linhagem fala. queue: em que LÍNGUA a copy JÁ ESTÁ. Declare sempre que escrever a copy você mesmo. Sem este campo, canal de rede internacional (bluesky, linkedin, youtube, tiktok, threads, farcaster, civitai, pinterest, reddit, medium, tumblr, deviantart, e os X que não são o x e o x-buffer do dono) presume que a copy chegou em português e agenda uma vertida automática que SOBRESCREVE o que você mandou, dois segundos depois de enfileirar. Copy que já estava em inglês volta reescrita, e na voz da CASA em vez da voz de quem assina a peça, o que estraga copy de personagem. Declarar o idioma desliga a vertida e o texto fica exatamente como você mandou.",
    ),
  voice: z
    .string()
    .optional()
    .describe(
      "A aba de quem é a peça: sapiens, helen-ailith, borderless, ou o slug de um personagem seu. Em queue, ausente = o servidor deriva. Em list, filtra.",
    ),
  categoria: z
    .enum([...CATEGORIAS, "sem"])
    .nullable()
    .optional()
    .describe(
      [
        "queue/edit/list: o que a peça É, o assunto dela (quem assina é a aba, a mídia é o canal). Uma por peça:",
        "arte: obra que se olha (série, cena, clipe, ilustração).",
        "personagem: a vida de alguém da casa (a Helen dançando, o Batkin no secador).",
        "tecnico: o como (páreo, teste medido, folha comparativa, receita, workflow).",
        "novidade: o que chegou (motor novo, feature da casa, lançamento). Sai SEMPRE com mídia: o servidor recusa novidade só texto, no queue e no edit que tira a mídia. Motor de vídeo sem take vai com uma imagem da casa (sapiens_image, templateSlug retrato-sapiens-v1, o nome do motor em inglês na arte), que é barata; o take pago só com ok do dono.",
        "educativo: o porquê (aula, artigo, framework, carrossel que explica, quote).",
        "mercado: o dinheiro e a carreira (cripto, startup, vaga, oportunidade).",
        "pessoal: a própria vida de quem assina (saúde, história, relato em primeira pessoa). Ganha das outras quando o assunto é a vida dele, mesmo que a peça ensine algo de passagem. A régua nunca chuta pessoal: declare.",
        "Fora pessoal, quando duas servem, vale a primeira desta ordem: novidade, tecnico, educativo, mercado, personagem, arte (o motor novo testado em páreo é novidade; o páreo com o Batkin no meio é técnico).",
        "queue: declare SEMPRE que souber o que a peça é. Ausente, a régua chuta pelo título e pela 1a frase da copy, e a peça cai na gaveta errada ou na triagem; a declarada aparece na gaveta certa da fila sem toque do dono e desce pras filhas da teia.",
        "edit: troca a categoria (vale em peça já postada) e null devolve pra régua.",
        "list: filtra pela que vale (a declarada, senão a da régua); 'sem' lista a triagem, o que a régua não sabe ler. Cada item volta com categoria e categoriaDeclarada.",
      ].join("\n"),
    ),
  allowOtherFront: z
    .boolean()
    .optional()
    .describe(
      "queue: despachar de propósito por uma conta de OUTRA frente (a peça da Helen saindo pelo canal da casa). Sem isto o servidor recusa quando a identidade da peça discorda da identidade declarada da conta, e o erro diz quais são as contas certas.",
    ),
  audience: z
    .enum(["public", "subscribers"])
    .optional()
    .describe(
      "queue, só canais fanvue e fanvue-dm: quem a peça alcança. No feed é QUEM VÊ (o muro do post); na mensagem é QUEM RECEBE (a lista de destino do disparo). subscribers = só quem paga a assinatura; public = quem segue de graça também. Ausente = subscribers, porque campo esquecido não pode abrir peça fechada nem mandar íntimo pra quem não pagou. Nos outros canais é ignorado.",
    ),
  priceCents: z
    .number()
    .optional()
    .describe(
      "queue, só canais fanvue e fanvue-dm: preço em CENTAVOS de dólar (pay-per-view). 1200 = $12. Piso de 300 na API deles, e peça paga EXIGE mídia. Ausente ou 0 = de graça pra quem já tem acesso.",
    ),
  notes: z.string().optional().describe("queue/edit: recado pra você mesmo na hora de postar."),
  format: z
    .enum(["instagram_story"])
    .optional()
    .describe(
      "queue, só canal do Instagram (instagram, instagram-pro, instagram-3..7): instagram_story faz a peça sair como STORY em vez de post no feed. O story leva UMA mídia (a 1a imagem ou vídeo; mande só ela em assets), some em 24h e vai SEM legenda, link nem sticker, porque a API do story não aceita: tudo que o post diz tem que estar na imagem (pro card do Repertório, o card em pé, --formato story no script da skill indica). A imagem sai num quadro 9:16 com a peça inteira no meio. Feed e story da mesma obra na mesma conta convivem; story repetido é recusado. Ausente = feed. Fora do Instagram o campo não muda nada.",
    ),
  signed: z
    .boolean()
    .optional()
    .describe(
      "sign: true liga (o default), false desliga. queue: true enfileira a peça já com a assinatura ligada. A ASSINATURA carimba a IMAGEM e o VÍDEO da peça que moram no CDN da casa (o que sapiens_image/sapiens_video/sapiens_gallery devolvem), com o carimbo da LINHAGEM de quem assina a peça (a aba dela, ver lineages): no estilo casa, sint.fyi/<conta da linhagem na casa, ou o dono> no canto e, no vídeo, o fecho de 2 segundos no fim (o vídeo fica 2s mais longo); no estilo propria, só a marca da linhagem (ex: Velourie), sem nada da casa e sem fecho; no estilo nenhuma, o servidor recusa. O carimbo da casa é RECUSADO em peça +18 e em praça com teto adulto (fanvue, fanvue-dm, pornhub, civitai-red), porque sint.fyi é endereço da casa; a marca própria passa. A imagem do feed do Instagram é carimbada já recortada pra 4:5 a 1.91:1. O carimbo leva uns 30s na primeira vez (na hora quando a mídia já foi assinada antes), e enquanto ele não fica pronto a peça NÃO sai: o botão de postar da tela devolve o motivo.",
    ),
  itemId: z.string().optional().describe("status/sign/edit: o id da peça (vem do list ou do queue)."),
  status: z
    .enum(["fila", "agendado", "postado", "descartado"])
    .optional()
    .describe("list: filtra a lane. status: a lane pra onde a peça vai."),
  postUrl: z
    .string()
    .optional()
    .describe("status=postado: o link do post que foi ao ar, pro rastro fechar."),
  scheduledFor: z
    .number()
    .optional()
    .describe("status=agendado: timestamp em ms de quando ela sai."),
  limit: z.number().int().positive().max(60).optional().describe("list: default 20."),
  bio: z
    .string()
    .optional()
    .describe(
      "bio: a bio INTEIRA nova da conta do Bluesky em `channel` (bluesky, bluesky-2 a bluesky-5). Reescreve tudo. Teto de 256 caracteres. Use bioLine quando só quer acrescentar.",
    ),
  bioLine: z
    .string()
    .optional()
    .describe(
      "bio: UMA linha acrescentada no fim da bio atual, sem mexer no resto (ex: o CTA com t.me/<handle> do Telegram da personagem). Linha que já está na bio não entra de novo. Bio NÃO aceita hiperlink: o endereço aparece escrito e o app pinta de azul.",
    ),
  slug: z
    .string()
    .optional()
    .describe(
      "lineage-save/lineage-archive/tree-mark: a linhagem (o slug que lineages devolve: sapiens, borderless, helen-inbt, aria, arak, giants...). lineage-new: opcional, sai do nome quando ausente. tree: opcional, filtra uma linhagem só.",
    ),
  celulas: z
    .array(
      z.object({
        rede: z.string(),
        handle: z.string().optional(),
        canal: z.string().optional(),
        dispensada: z.boolean().optional(),
      }),
    )
    .optional()
    .describe(
      "tree-mark: as células da linhagem em `slug`, uma por rede da árvore (x, instagram, bluesky, email, telegram, tumblr, deviantart, threads, tiktok, youtube, fanvue, pornhub; a lista viva sai em tree, campo redes). handle = o @ (ou a URL do perfil, que vira @) ou, na rede email, o endereço: é a conta que existe lá fora; string vazia limpa. canal = a conta da casa que é desta linhagem nessa rede (instagram-6, x-buffer-3), só em rede de conta própria e nunca no bluesky, que é a mãe (lineage-save). dispensada = true quando a linhagem decidiu não ter a rede; X, Instagram, Bluesky, email e Telegram são obrigatórias e o servidor recusa. Tudo ou nada: uma célula recusada não grava nenhuma.",
    ),
  nome: z.string().optional().describe("lineage-new: o nome da linhagem (obrigatório). lineage-save: renomeia."),
  grupo: z
    .enum(["casa", "personagens", "produtos"])
    .optional()
    .describe("lineage-new/lineage-save: a gaveta. casa é só da casa e do dono. Default produtos."),
  artigo: z.enum(["a", "o"]).optional().describe("lineage-new/lineage-save: o artigo do nome (a Aria, o Arak)."),
  ordem: z.number().optional().describe("lineage-save: a posição na lista."),
  quem: z
    .string()
    .nullable()
    .optional()
    .describe("lineage-save: como a tela diz de quem é (\"da casa\", \"do dono\"). null limpa."),
  mae: z
    .string()
    .nullable()
    .optional()
    .describe(
      "lineage-save: a MÃE da linhagem, a conta do Bluesky onde a peça nasce e de onde a teia desdobra pro resto (bluesky-2..9). Vaga livre sai de lineages (vagasLivres.bluesky). null tira a mãe. A mãe da casa e a do dono não trocam.",
    ),
  contas: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "lineage-save: as contas PRÓPRIAS da linhagem, rede -> canal, ex: {\"telegram\":\"telegram-6\",\"instagram\":\"instagram-6\",\"x\":\"x-buffer-3\"}. Substitui o mapa inteiro. O servidor recusa canal de outra rede e canal que já é de outra linhagem.",
    ),
  galerias: z
    .object({
      telegram: z.boolean(),
      arena: z.boolean(),
      tumblr: z.boolean(),
      deviantart: z.boolean(),
      civitai: z.boolean(),
      proprias: z.array(z.string()),
    })
    .optional()
    .describe(
      "lineage-save: o que a mãe alimenta sozinha quando a peça dela vai ao ar. telegram exige conta de telegram em contas; proprias lista as redes de contas (instagram, x...) que também recebem. Manda o objeto inteiro.",
    ),
  fichaIds: z
    .array(z.string())
    .optional()
    .describe(
      "lineage-save: as fichas de personagem da linhagem (ids de sapiens_character), a principal primeiro, até 6. É o que trava a peça dela fora das contas dela e o que dá a ficha ao post de texto na conta dela.",
    ),
  contaNaCasa: z
    .string()
    .nullable()
    .optional()
    .describe("lineage-save: o username da conta dela aqui na casa (o perfil público). null limpa."),
  rotina: z
    .object({ ligada: z.boolean(), canais: z.array(z.string()) })
    .nullable()
    .optional()
    .describe("lineage-save: o post do dia da linhagem, ligado ou não, e por quais canais sai. null volta ao padrão."),
  assinatura: z
    .object({
      estilo: z.enum(["casa", "propria", "nenhuma"]),
      marca: z.string().max(24).optional(),
      padrao: z.boolean().optional(),
    })
    .nullable()
    .optional()
    .describe(
      "lineage-save: como a peça da linhagem vai ao ar ASSINADA. estilo casa = sint.fyi/<contaNaCasa dela, ou o dono> no canto (e o fecho de 2s no vídeo); propria = só a `marca` (obrigatória, até 24 caracteres), sem nada da casa, que é o lado adulto (a Aria assina Velourie); nenhuma = a linhagem não assina. padrao=true faz a peça nova dela já nascer assinada. A casa e o dono (sapiens, borderless) não usam marca própria. null volta à da fábrica (casa sem nascer assinada, ou a marca que o código dá: a Aria nasce Velourie); pra forçar o carimbo da casa numa linhagem que a fábrica marca, mande {estilo:\"casa\"}.",
    ),
  arquivada: z
    .boolean()
    .optional()
    .describe("lineage-archive: true arquiva, false devolve. A casa e o dono não se arquivam."),
  antesDe: z
    .number()
    .optional()
    .describe(
      "garimpo e list: o cursor, o `proximoCursor` da página anterior. Ausente = a página mais recente. Em list, a fila com mais peças que o limit se lê inteira chamando de novo até proximoCursor voltar null.",
    ),
  limite: z
    .number()
    .int()
    .min(1)
    .max(150)
    .optional()
    .describe(
      "garimpo: peças por página, default 60. A página estica até achar um buraco de uma hora entre duas peças, pra sessão de criação nunca partir ao meio.",
    ),
  skill: z
    .string()
    .optional()
    .describe("garimpo: só famílias em que alguma peça saiu desta skill (ex: amiga, camarim, clipe)."),
  kind: z
    .enum(["image", "video", "all"])
    .optional()
    .describe("garimpo: só famílias com candidata desta mídia. Default all."),
  paraCanal: z
    .enum(CHANNELS)
    .optional()
    .describe(
      "garimpo: o canal pra onde a leva vai (a mãe da linhagem, em geral). Tira as famílias que já tiveram peça ali em qualquer lane, descartada inclusive: o dono já decidiu sobre elas naquele canal.",
    ),
  soResumo: z
    .boolean()
    .optional()
    .describe(
      "garimpo: só a contagem (famílias, candidatas, versões antigas, escolhas pro olho, inéditas, por voz), sem as famílias. É a varredura do inventário: repita com o proximoCursor até ele voltar null.",
    ),
});

export type DistributionArgs = z.infer<typeof distributionSchema>;

/** O recado que volta pro agente depois de ligar ou desligar a assinatura. */
function recadoDaAssinatura(
  signed: boolean,
  r: { videos: number; midias?: number; prontos: number; faltam: number },
): string {
  if (!signed) return "Assinatura desligada: a mídia sai como veio do gerador, sem marca.";
  // `midias` é o total desde 24/09/2026 (imagem e vídeo); servidor antigo só
  // mandava `videos`.
  const total = r.midias ?? r.videos;
  const fila = total - r.prontos - r.faltam;
  const partes = [
    "Assinatura ligada: a mídia vai ao ar com o carimbo da linhagem de quem assina a peça (sint.fyi/<endereço> ou a marca própria dela, ver lineages).",
    r.prontos === total
      ? "O carimbo já estava pronto (a mídia tinha sido assinada antes)."
      : fila > 0
        ? `${fila} mídia(s) na fila do carimbo, uns 30 segundos. Até lá a peça NÃO sai: o botão de postar da tela devolve o motivo.`
        : "",
    r.faltam > 0
      ? `A fila carimba 6 por minuto e ${r.faltam} ficaram pra depois; o servidor volta nelas sozinho daqui a um minuto.`
      : "",
    "A peça continua na fila do Distribution: quem posta é a tela.",
  ];
  return partes.filter(Boolean).join(" ");
}

type AvisoJaSaiu = { itemId: string; channel: string; title: string; postedAt: number | null; voice: string | null };

/**
 * A linha do "já saiu na rede": a mesma abertura já foi ao ar na mesma rede, de
 * qualquer aba. Aviso, não recusa (série de molde abre igual e é outra peça).
 * Servidor anterior a 15/10/2026 não manda `avisos`, e aí não há linha.
 */
function linhaDoJaSaiu(avisos: AvisoJaSaiu[] | undefined): string | null {
  if (!avisos?.length) return null;
  const [a, ...resto] = avisos;
  const dia = a.postedAt ? `, ${new Date(a.postedAt).toISOString().slice(0, 10)}` : "";
  const mais = resto.length ? ` e mais ${resto.length}` : "";
  return `JÁ SAIU no ${a.channel} com a mesma abertura: "${a.title}" (aba ${a.voice ?? "?"}${dia}, itemId ${a.itemId})${mais}. Confira com o dono antes de despachar. Se for repetição, descarte esta.`;
}

type CapituloAnterior = {
  capitulo: number;
  anterior: number;
  itemId: string;
  title: string;
  status: "fila" | "agendado";
  scheduledFor: number | null;
};

/**
 * A linha do "capítulo fora de ordem": a peça marcada é capítulo de série e o
 * anterior, no mesmo canal, não sai antes dela. Aviso, não recusa: a hora fica
 * marcada, mas na hora o tique devolve a peça pra fila em vez de soltar spoiler
 * (17/10/2026, A Vó Roubou a Fila). Servidor anterior a 18/10/2026 não manda o
 * campo, e aí não há linha.
 */
function linhaDoForaDeOrdem(c: CapituloAnterior | undefined): string | null {
  if (!c) return null;
  const onde =
    c.status === "fila" || c.scheduledFor === null
      ? "está na fila sem hora"
      : `está marcado pra ${new Date(c.scheduledFor).toISOString().slice(0, 16).replace("T", " ")} UTC, depois desta`;
  return `FORA DE ORDEM: esta peça é o capítulo ${c.capitulo} e o capítulo ${c.anterior} ("${c.title}", itemId ${c.itemId}) ainda não saiu neste canal: ${onde}. Na hora marcada esta NÃO sai sozinha: volta pra fila com o motivo. Marque o capítulo ${c.anterior} pra antes desta, ou poste ele primeiro, e mostre isto ao dono.`;
}

export async function distribution(args: DistributionArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if ((args.action === "queue" || args.action === "edit") && args.categoria === "sem") {
    throw new Error(`categoria "sem" só filtra o list (a triagem). Pra peça, uma de: ${CATEGORIAS.join(", ")}; em edit, null devolve pra régua.`);
  }

  if (args.action === "queue") {
    if (!args.title) throw new Error("action=queue exige title.");
    if (!args.channel) throw new Error("action=queue exige channel.");
    const r: any = await convexMutation("distributionMcp:mcpQueueItem", {
      sessionToken,
      title: args.title,
      channel: args.channel,
      copy: args.copy,
      replyText: args.replyText,
      hashtags: args.hashtags,
      publicTitle: args.publicTitle,
      captionTracks: args.captionTracks,
      localizations: args.localizations,
      videoCoverUrl: args.videoCoverUrl,
      assetUrl: args.assetUrl,
      assetKind: args.assetKind,
      assets: args.assets,
      assetPageAssetId: args.assetPageAssetId,
      assetPagePath: args.assetPagePath,
      lang: args.lang,
      voice: args.voice,
      allowOtherFront: args.allowOtherFront,
      audience: args.audience,
      priceCents: args.priceCents,
      notes: args.notes,
      format: args.format,
      // Só vai quando declarada: servidor anterior a 16/10/2026 não conhece o arg.
      categoria: args.categoria ?? undefined,
    });
    const jaSaiu = linhaDoJaSaiu(r.avisos);
    const fila = {
      itemId: r.itemId,
      status: "fila",
      voice: args.voice ?? "(derivado no servidor)",
      categoria: args.categoria ?? "(a régua chuta pelo título)",
      ...(jaSaiu ? { aviso: jaSaiu, jaSaiuNaRede: r.avisos } : {}),
      instruction: [
        jaSaiu,
        "A peça está na fila do Distribution Workflow, não foi ao ar. Quem posta é a tela, em /experimentos/distribution-workflow.",
      ]
        .filter(Boolean)
        .join(" "),
    };
    if (!args.signed) return fila;
    // A assinatura é um segundo passo de propósito: a peça JÁ está na fila, e
    // recusa aqui (peça +18, praça adulta, sem vídeo da casa) não pode desfazer
    // o enfileiramento. Volta o motivo e a peça fica sem marca.
    try {
      const a: any = await convexMutation("distributionMcp:mcpAssinarPeca", {
        sessionToken,
        itemId: r.itemId,
        signed: true,
      });
      return {
        ...fila,
        signed: true,
        assinatura: a,
        instruction: `${fila.instruction} ${recadoDaAssinatura(true, a)}`,
      };
    } catch (e) {
      const motivo = describeConvexError(e);
      return {
        ...fila,
        signed: false,
        assinatura: { ok: false, motivo },
        instruction: `${fila.instruction} A assinatura NÃO foi ligada: ${motivo} A peça ficou na fila sem marca.`,
      };
    }
  }

  if (args.action === "sign") {
    if (!args.itemId) throw new Error("action=sign exige itemId.");
    const signed = args.signed ?? true;
    const r: any = await convexMutation("distributionMcp:mcpAssinarPeca", {
      sessionToken,
      itemId: args.itemId,
      signed,
    });
    return { ok: true, itemId: args.itemId, signed, ...r, instruction: recadoDaAssinatura(signed, r) };
  }

  if (args.action === "list") {
    return await convexQuery("distributionMcp:mcpListItems", {
      sessionToken,
      status: args.status,
      voice: args.voice,
      categoria: args.categoria ?? undefined,
      limit: args.limit,
      antesDe: args.antesDe,
    });
  }

  if (args.action === "edit") {
    if (!args.itemId) throw new Error("action=edit exige itemId (vem do list ou do queue).");
    const campos = {
      title: args.title,
      publicTitle: args.publicTitle,
      copy: args.copy,
      replyText: args.replyText,
      hashtags: args.hashtags,
      notes: args.notes,
      lang: args.lang,
      assetUrl: args.assetUrl,
      assetKind: args.assetKind,
      assets: args.assets,
      videoCoverUrl: args.videoCoverUrl,
      // null viaja: é o gesto de devolver a peça pra régua.
      categoria: args.categoria,
    };
    const mudou = Object.entries(campos).filter(([, v]) => v !== undefined);
    if (mudou.length === 0) {
      throw new Error(
        "action=edit: mande ao menos um campo pra trocar (copy, title, publicTitle, hashtags, notes, lang, replyText, assetUrl/assetKind, assets, videoCoverUrl ou categoria).",
      );
    }
    await convexMutation("distributionMcp:mcpUpdateItem", {
      sessionToken,
      itemId: args.itemId,
      ...Object.fromEntries(mudou),
    });
    return {
      ok: true,
      itemId: args.itemId,
      mudou: mudou.map(([k]) => k),
      instruction:
        "A peça continua na mesma lane e na mesma posição da fila, só com o que mudou. Texto de peça já postada o servidor recusa: o post na rede não muda junto. A categoria vale em qualquer lane.",
    };
  }

  if (args.action === "voices") {
    return await convexQuery("distributionMcp:mcpVoices", { sessionToken });
  }

  if (args.action === "garimpo") {
    const r: any = await convexQuery("distributionMcp:mcpGarimpo", {
      sessionToken,
      antesDe: args.antesDe,
      limite: args.limite,
      voz: args.voice,
      skill: args.skill,
      kind: args.kind,
      paraCanal: args.paraCanal,
      soResumo: args.soResumo,
    });
    return {
      ...r,
      instruction: args.soResumo
        ? "Contagem desta página. Pra varrer o acervo inteiro, chame de novo com antesDe=proximoCursor até ele voltar null e some os resumos. A soma é aproximada pra cima: o still de um vídeo feito dias depois conta na família do vídeo e de novo na página dele."
        : "Cada família é UMA peça da casa, com as versões e as alternativas dela. Só `candidatas` podem sair: membro com `substituidaPor` é versão velha (o original de um corte, o take de um vídeo montado) e nunca vai pra fila. Cada grupo de `escolhaPorOlho` é a mesma ideia gerada mais de uma vez: sai UMA, escolhida olhando as peças, nunca a primeira da lista nem duas do grupo. Laço `sequencia` é o edit que continua a peça (a careta depois da pergunta): não é alternativa, as duas valem, juntas no mesmo post ou uma depois da outra. Laço `cena` liga a mesma cena em outra mídia ou outro nível (o vídeo que nasceu do still, o edit +18 da base vestida): cada uma serve a sua praça, nunca as duas na mesma mãe. Laço `recorte` é o painel cortado em quadros: cada item de `recortes` traz o `original` e as `partes` na ordem da esquerda pra direita. Quadro nunca sai sozinho (não é candidata): carrossel (Instagram, Threads) leva as partes em ordem em `assets`, a praça que não é carrossel (Bluesky) leva o original. `serieCom` aponta famílias do mesmo lugar em outro momento: não cabem na mesma leva. `jaSaiuEm` diz onde a família já está (fila, agendado ou postado). Página seguinte: antesDe=proximoCursor; peça que já apareceu numa página (mesmo id de membro) não conta de novo. Com extrasEsgotado=true, alguma família pode ter vindo sem a versão nova: peça a página com limite menor. O passo a passo da escolha e da copy é a skill distribuir.",
    };
  }

  if (args.action === "status") {
    if (!args.itemId) throw new Error("action=status exige itemId.");
    if (!args.status) throw new Error("action=status exige status.");
    const r: any = await convexMutation("distributionMcp:mcpSetStatus", {
      sessionToken,
      itemId: args.itemId,
      status: args.status,
      postUrl: args.postUrl,
      scheduledFor: args.scheduledFor,
    });
    const foraDeOrdem = linhaDoForaDeOrdem(r?.foraDeOrdem);
    return {
      ok: true,
      itemId: args.itemId,
      status: args.status,
      ...(foraDeOrdem ? { aviso: foraDeOrdem, capituloAnterior: r.foraDeOrdem, instruction: foraDeOrdem } : {}),
    };
  }

  if (args.action === "bio") {
    if (!args.channel) throw new Error("action=bio exige channel (bluesky, bluesky-2 a bluesky-5).");
    if (args.bio !== undefined && args.bioLine !== undefined) {
      throw new Error("action=bio: mande bio (a inteira) OU bioLine (uma linha no fim), não os dois.");
    }
    const r: any = await convexAction("blueskyProfile:mcpHouseBio", {
      sessionToken,
      channel: args.channel,
      bio: args.bio,
      bioLine: args.bioLine,
    });
    const lendo = args.bio === undefined && args.bioLine === undefined;
    return {
      ...r,
      instruction: lendo
        ? "Esta é a bio atual da conta. Pra acrescentar uma linha sem reescrever, chame de novo com bioLine."
        : r.mudou
          ? "A bio foi trocada e já está no ar no Bluesky. Mostre ao dono o antes e o depois."
          : "Nada mudou: a linha já estava na bio (ou o texto é igual ao atual).",
    };
  }

  if (args.action === "lineages") {
    const r: any = await convexQuery("distributionMcp:mcpLinhagens", { sessionToken });
    return {
      ...r,
      instruction:
        "Cada linhagem: mae (a conta do Bluesky onde a peça nasce), contas (as próprias, rede -> canal), galerias (o que a mãe alimenta sozinha), fichaIds, rotina (post do dia). regras é o que a teia desdobra desse cadastro. vagasLivres são as contas que existem no código e ainda não têm dona. semeada=false quer dizer que a tabela ainda roda a fábrica do código; a primeira edição grava.",
    };
  }

  if (args.action === "lineage-new") {
    if (!args.nome) throw new Error("action=lineage-new exige nome.");
    const r: any = await convexMutation("distributionMcp:mcpCriarLinhagem", {
      sessionToken,
      nome: args.nome,
      slug: args.slug,
      grupo: args.grupo,
      artigo: args.artigo,
      lang: args.lang,
    });
    return {
      ...r,
      instruction: r.voltou
        ? "A linhagem estava arquivada e voltou com o cadastro que tinha."
        : "A linhagem nasceu sem mãe e sem regra: nada viaja sozinho a partir dela até lineage-save dar a mãe (vaga livre em lineages).",
    };
  }

  if (args.action === "lineage-save") {
    if (!args.slug) throw new Error("action=lineage-save exige slug.");
    await convexMutation("distributionMcp:mcpSalvarLinhagem", {
      sessionToken,
      slug: args.slug,
      nome: args.nome,
      grupo: args.grupo,
      artigo: args.artigo,
      lang: args.lang,
      ordem: args.ordem,
      quem: args.quem,
      mae: args.mae,
      contas: args.contas,
      galerias: args.galerias,
      fichaIds: args.fichaIds,
      contaNaCasa: args.contaNaCasa,
      rotina: args.rotina,
      assinatura: args.assinatura,
    });
    return {
      ok: true,
      slug: args.slug,
      instruction:
        "Cadastro salvo. A teia já lê o novo (a próxima peça da mãe desdobra pelas regras novas). Vaga de reserva que a linhagem assumiu ganhou o nome dela; a credencial da conta (env do Convex) continua sendo do dono.",
    };
  }

  if (args.action === "lineage-archive") {
    if (!args.slug) throw new Error("action=lineage-archive exige slug.");
    if (args.arquivada === undefined) throw new Error("action=lineage-archive exige arquivada (true ou false).");
    await convexMutation("distributionMcp:mcpArquivarLinhagem", {
      sessionToken,
      slug: args.slug,
      arquivada: args.arquivada,
    });
    return { ok: true, slug: args.slug, arquivada: args.arquivada };
  }

  if (args.action === "tree") {
    const r: any = await convexQuery("distributionMcp:mcpArvore", { sessionToken });
    const linhas = (r.linhas as any[])
      .filter((l) => !args.slug || l.tema === args.slug)
      .map((l) => ({
        tema: l.tema,
        nome: l.nome,
        ficha: l.ficha,
        obrigatorias: `${l.obrigatoriasLigadas}/${l.obrigatorias}`,
        // `declarado` repete o que a célula já diz; o cadastro inteiro sai em lineages.
        celulas: Object.fromEntries(
          Object.entries(l.celulas as Record<string, any>).map(([rede, { declarado: _d, ...celula }]) => [rede, celula]),
        ),
      }));
    if (args.slug && !linhas.length) {
      throw new Error(`${args.slug} não está na árvore. As linhagens saem em action=lineages; linhagem nova nasce em lineage-new.`);
    }
    return {
      resumo: r.resumo,
      linhas,
      redes: (r.redes as any[]).map(({ id, nome, forma, obrigatoria, comoLigar }) => ({ id, nome, forma, obrigatoria, comoLigar })),
      ...(args.slug ? {} : { globais: r.globais, livres: r.livres }),
      instruction:
        "A árvore de contas: linhagem × rede. estado: ligada (a casa tem a conta e ela responde; no email, o endereço está registrado), desligada (a vaga existe, falta credencial ou o token venceu), fora (a conta existe lá fora com o @ e ainda não tem vaga), falta (é criar), dispensa (a linhagem decidiu não ter). origem diz de onde a casa sabe: codigo, ficha (a Presença da personagem) ou declarada. comoLigar, em redes, é o passo que falta em cada rede; livres são contas vivas que nenhuma linhagem ocupa. Conta que nasceu agora se registra com tree-mark, e o email e o @ moram no banco, nunca em arquivo do repo.",
    };
  }

  if (args.action === "tree-mark") {
    if (!args.slug) throw new Error("action=tree-mark exige slug (a linhagem).");
    if (!args.celulas?.length) {
      throw new Error("action=tree-mark exige celulas: [{ rede, handle?, canal?, dispensada? }].");
    }
    await convexMutation("distributionMcp:mcpMarcarNaArvore", {
      sessionToken,
      tema: args.slug,
      celulas: args.celulas,
    });
    return {
      ok: true,
      slug: args.slug,
      marcadas: args.celulas.map((c) => c.rede),
      instruction:
        "Marcado na árvore. Mostre ao dono a linha com action=tree e o slug: o @ sem vaga fica em 'fora' até a conta ganhar vaga e credencial (comoLigar diz o passo de cada rede).",
    };
  }

  throw new Error(`action desconhecida: ${(args as any).action}`);
}
