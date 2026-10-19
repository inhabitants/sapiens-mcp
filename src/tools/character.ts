import { z } from "zod";
import { httpUrl } from "../schema.js";
import { convexQuery, convexMutation, convexAction, getSessionToken } from "../convexClient.js";
import { getClientName } from "../clientIdentity.js";

/**
 * sapiens_character — personagens (character sheets) do Sapiens.
 *
 * "Character" aqui é a tabela `influencers`: personagem reutilizável com
 * imagens (pra character-lock em geração) + alma (systemPrompt). Tudo amarrado
 * à conta do dono do sessionToken. Sem nada de admin.
 *
 * Sub-actions:
 *   - list_public:  catálogo global de personagens públicos (Explorar). Cada um
 *                   traz mainImageUrl/imageUrls usáveis como referência em
 *                   sapiens_image (referenceImageUrls). Sem custo.
 *   - get:          detalhe de 1 personagem por id. Público+ativo: qualquer um.
 *                   Draft/privado: só o dono. systemPrompt só volta pro dono.
 *   - list_mine:    os personagens do próprio user (inclui drafts/privados).
 *   - create:       cria um personagem (rascunho) na conta. name + gender, e
 *                   `form` quando ele não é gente + `style` quando ele tem
 *                   técnica definida (ver abaixo).
 *   - add_image:    adiciona imagem ao próprio personagem (imageUrl direto ou
 *                   sourceImageId da galeria). 1ª imagem vira a principal.
 *   - set_card:     edita a alma (systemPrompt), título, nome, nome por extenso,
 *                   `form` e/ou `style`.
 *   - set_presence: escreve onde ele existe FORA da casa (redes, Fanvue, site,
 *                   email). Merge: mandar uma rede não apaga as outras.
 *   - activate:     publica (sai de draft). Exige ≥1 imagem.
 *   - set_visibility: público (entra no Explorar, ganha slug) ou privado.
 *   - set_hidden:   oculta (ou mostra) o personagem na tela do DONO: some da
 *                   lista e as peças dele saem da galeria de fotos e vídeos
 *                   dele. Não despublica, não apaga; oculto não publica.
 *   - remove_image: tira UMA imagem do próprio personagem (por url).
 *   - set_main_image: define a principal (por url, entre as que já existem).
 *   - reorder_images: reordena as imagens (posição 0 = principal).
 *   - generate_sheet: desenha a ficha do personagem (COBRA), vertical ou
 *                   horizontal (`orientation`). A ficha entra na galeria dele e
 *                   já serve de referência; elas acumulam.
 *   - generate_plates: as PLACAS de ângulo (COBRA): uma grade 2K com seis
 *                   ângulos do mesmo rosto, recortada em seis referências com
 *                   papel (perfil, camera-alta, camera-baixa, frontal,
 *                   cabeca-baixa, outro-lado). Voltam em action=get no campo
 *                   `plates`, lote mais novo primeiro; os lotes acumulam e a
 *                   placa ruim sai com remove_image. Só personagem com
 *                   rosto de gente (form human ou humanoid).
 *   - generate_stickers: desenha stickers do personagem (COBRA), em dois
 *                   caminhos (`stickerTier`): 'folha' (default) traz 5 de uma
 *                   vez no Nano Banana 2.1, 'unica' desenha 1 no Gemini 3 Pro.
 *                   Nos dois, o fundo é chroma verde e o recorte devolve peças
 *                   512x512 transparentes, que entram no pack dele.
 *   - plan_video:   escreve os 6 planos do Character Video (COBRA 50, texto).
 *   - generate_video: renderiza o Character Video (COBRA CARO), com os planos
 *                   aprovados em `shots` e o degrau em `videoTier`.
 *   - delete:       apaga o próprio personagem (permanente).
 *
 * A FORMA (`form`) é que tipo de corpo o personagem tem: human (default),
 * humanoid, animal, creature, object, abstract. É o campo que a ficha, as figurinhas e
 * o vídeo leem pra saber se descrevem rosto e mãos ou silhueta e postura, e é
 * ele que impede uma criatura de voltar com cara humana. Personagem que não é
 * gente pede o arg no create; quem já existe sem ele conserta com set_card.
 *
 * O TRAÇO (`style`) é em que TÉCNICA ele é feito: auto (default), realista,
 * editorial (o cartum adulto da casa), anime, manhwa, concept (mídia
 * tradicional suja, o traço de criatura), 3d, custom. É o
 * vocabulário da CASA (convex/shared/visualStyle.ts), o mesmo que o Reflexo de
 * Si lê. As três peças do personagem leem daqui pra saber se estão
 * fazendo foto, desenho ou render. No automático a peça não afirma técnica
 * nenhuma e a referência manda, que é o conserto de ago/2026: a ficha cravava
 * vocabulário de desenho e devolvia personagem fotográfico virado em ilustração.
 *
 * Fluxo típico de criação: create → add_image (1+) → set_card (opcional) →
 * activate → set_visibility isPublic=true.
 */

export const characterSchema = z.object({
  action: z.enum([
    "list_public",
    "get",
    "list_mine",
    "create",
    "add_image",
    "set_card",
    "set_presence",
    "set_passport",
    "activate",
    "set_visibility",
    "set_hidden",
    "remove_image",
    "set_main_image",
    "reorder_images",
    "generate_sheet",
    "generate_plates",
    "generate_stickers",
    "plan_video",
    "replan_shot",
    "generate_video",
    "delete",
  ]),
  characterId: z
    .string()
    .optional()
    .describe(
      "ID do personagem (influencers:_id). Obrigatório em get/add_image/set_card/activate/set_visibility/generate_sheet. Descubra via list_public ou list_mine.",
    ),
  videoTier: z
    .enum(["draft", "final"])
    .optional()
    .describe(
      "Pra generate_video: qual MOTOR desenha. 'draft' (default) é o Seedance 2.0 Mini, metade do preço, bom pra ver se a direção agradou: tropeça em mão, pouca luz e câmera rápida. 'final' é o Seedance 2.0 Fast, que segura o que o Mini erra. Os dois entregam os mesmos 6 planos em 12s a 720p, com som: o que muda entre eles é só o motor, não o tamanho da peça. Ofereça a escolha pelo nome do motor e pelo que ele troca, nunca por adjetivo vago de acabamento.",
    ),
  shots: z
    .array(
      z.object({
        setting: z.string().describe("O ambiente do plano, inconfundível em relação aos outros."),
        act: z.string().describe("O que o personagem FAZ: ação intencional com expressão, nunca pose."),
        wardrobe: z.string().optional().describe("A roupa daquele mundo."),
        settingPt: z.string().optional().describe("O ambiente em pt-BR, como voltou do plan_video. Só pra leitura do autor."),
        actPt: z.string().optional().describe("O ato em pt-BR, como voltou do plan_video. Só pra leitura do autor."),
        wardrobePt: z.string().optional().describe("A roupa em pt-BR, como voltou do plan_video. Só pra leitura do autor."),
      }),
    )
    .optional()
    .describe(
      "Pra generate_video e replan_shot: os 6 planos APROVADOS pelo autor (o que voltou de plan_video, com as edições dele). Precisa ser exatamente 6, na ordem. Devolva os planos INTEIROS, com os campos pt junto, como vieram. Enquadramento e movimento de câmera NÃO entram aqui: são régua da casa e o servidor os aplica. Sem este campo o generate_video escreve um roteiro novo e cobra igual.",
    ),
  shotIndex: z
    .number()
    .int()
    .optional()
    .describe(
      "Pra replan_shot: qual dos 6 planos reescrever (1 a 6). Os outros cinco ficam exatamente como estão.",
    ),
  shotHint: z
    .string()
    .optional()
    .describe(
      "Pra replan_shot: o que o autor quer diferente naquele plano ('outro clima', 'sem água', 'de noite'). Tempera o plano novo, não substitui a régua da peça. Opcional: sem ele, o servidor só escreve outro plano.",
    ),
  limit: z
    .number()
    .int()
    .optional()
    .describe("Pra list_public: quantos retornar (default 100, max 200)."),
  name: z
    .string()
    .optional()
    .describe("Pra create (obrigatório) ou set_card (renomear): nome do personagem. É o APELIDO, o nome pelo qual ele é conhecido, e é o que TODA tela desenha."),
  fullName: z
    .string()
    .optional()
    .describe(
      "Pra create/set_card: o nome do personagem POR EXTENSO, quando o `name` " +
        "é um apelido ('Crow Girl' é como ela é chamada, 'Kaia Crowe' é quem ela " +
        "é). Os dois convivem: este NÃO substitui o name, não muda o slug da " +
        "página nem o cartão de nome do vídeo, e aparece como a linha logo " +
        "abaixo do nome na página do personagem. String vazia apaga. Até 80 " +
        "caracteres. Ausente = personagem que se chama de um jeito só.",
    ),
  gender: z
    .string()
    .optional()
    .describe("Pra create: 'masculino' | 'feminino' | 'nao-binario'. Default 'nao-binario'."),
  form: z
    .enum(["human", "humanoid", "animal", "creature", "object", "abstract"])
    .optional()
    .describe(
      "Pra create/set_card: que tipo de CORPO o personagem tem. 'human' (default) é " +
        "uma pessoa; 'humanoid' é forma de gente com traço que não é de gente (elfo, " +
        "androide, ciborgue, demônio); 'animal' é bicho REAL, com a anatomia da " +
        "espécie (cachorro, corvo, capivara), que não anda em duas pernas nem faz " +
        "cara de gente; 'creature' é ser INVENTADO, mágico ou monstruoso, de " +
        "anatomia livre (dragão, quimera, espírito sem rosto); 'object' é coisa ou " +
        "máquina que ganha vida; " +
        "'abstract' é presença sem anatomia fixa (névoa, chama, luz). Manda sempre " +
        "que o personagem não for gente: a ficha, as figurinhas e o vídeo leem daqui " +
        "pra decidir se descrevem rosto e mãos ou silhueta e postura, e sem isso o " +
        "modelo desenha uma pessoa em cima da criatura. Ausente no create = human.",
    ),
  style: z
    .enum([
      "auto",
      "realista",
      "editorial",
      "anime",
      "manhwa",
      "concept",
      "3d",
      "custom",
    ])
    .optional()
    .describe(
      "Pra create/set_card: em que TÉCNICA o personagem é feito. 'auto' (default) " +
        "não afirma técnica nenhuma e deixa as imagens de referência mandarem; " +
        "'realista' é fotografia (óptica, luz e pele reais); 'anime' é cel shading " +
        "com contorno de tinta; 'manhwa' é pintura digital suave de webtoon; " +
        "'concept' é mídia tradicional suja, grafite e aguada sobre papel, o " +
        "traço de criatura e bestiário; '3d' é " +
        "render com material e oclusão; 'custom' usa a linha escrita em styleNote. " +
        "Irmão de `form`, e a divisão é limpa: a forma diz que CORPO é esse, o traço " +
        "diz como ele é DESENHADO. Mande sempre que o personagem tiver técnica " +
        "definida: até ago/2026 a ficha cravava vocabulário de desenho e devolvia " +
        "personagem fotográfico virado em ilustração. Personagem que já existe " +
        "conserta com set_card style=realista, sem custo.",
    ),
  styleNote: z
    .string()
    .optional()
    .describe(
      "Pra create/set_card, só vale com style='custom': o traço em UMA linha " +
        "(ex: 'aquarela sobre papel texturizado, cor lavada'). Até 140 caracteres; " +
        "sem ela o custom cai no automático.",
    ),
  title: z
    .string()
    .optional()
    .describe("Pra create/set_card: subtítulo curto (ex: 'A guia do Sapiens')."),
  titleEn: z
    .string()
    .max(48)
    .optional()
    .describe(
      "Pra create/set_card: o MESMO subtítulo em inglês, o lema do personagem. " +
        "Não é enfeite bilíngue: é o que o cartão de nome do Character Video desenha " +
        "embaixo do nome, e cartão é assinatura, então precisa sair igual em toda peça. " +
        "Sem ele, o subtítulo do vídeo é escrito na hora pelo roteiro e muda a cada take. " +
        "Teto de 48 caracteres, que é o que cabe numa linha do cartão.",
    ),
  systemPrompt: z
    .string()
    .optional()
    .describe(
      "Pra create/set_card: a 'alma' do personagem (personalidade, jeito de falar, contexto). Usado no chat e como guia de geração.",
    ),
  email: z
    .string()
    .optional()
    .describe(
      "Pra set_presence: o email do personagem, o que cadastra e recupera as " +
        "contas dele nas redes. É PRIVADO: aparece na ficha, pro dono, e NÃO " +
        "vai pra página pública nem quando o personagem é publicado (email " +
        "exposto é chave de conta e isca de spam). String vazia apaga.",
    ),
  websiteUrl: z
    .string()
    .optional()
    .describe(
      "Pra set_presence: o site próprio do personagem. Aceita sem protocolo " +
        "('helenai.wtf'), que o servidor completa com https. String vazia apaga.",
    ),
  socials: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Pra set_presence: as contas dele por rede, {rede: handle}. Redes aceitas: " +
        "instagram, tiktok, youtube, x, threads, bluesky, twitch, spotify, fanvue, " +
        "patreon, onlyfans, telegram. Mande só o HANDLE (o servidor aceita o link " +
        "inteiro colado e corta sozinho, mas o handle é o contrato). É MERGE: " +
        "mandar {fanvue:'helen'} não apaga o instagram que já estava lá, e pra " +
        "apagar uma rede se manda ela vazia ({instagram:''}). Rede fora da lista " +
        "é ignorada em silêncio.",
    ),
  hashtag: z
    .string()
    .optional()
    .describe(
      "Pra set_presence: a HASHTAG do personagem, sem #, numa palavra ('AriaMaiven'). " +
        "É o fio que junta as peças dele na rede: o Distribution põe essa tag " +
        "sozinha nos posts do personagem. Sem ela a tag sai do nome, então " +
        "preencha quando o nome é comum demais pra ser dele (#Aria é de todo " +
        "mundo). Espaço e pontuação o servidor tira. String vazia apaga.",
    ),
  imageUrl: httpUrl()
    .optional()
    .describe(
      "Pra add_image: URL pública da imagem (Bunny CDN / Convex storage). Use a `url` que sapiens_image/sapiens_gallery devolvem. Pra remove_image/set_main_image: a url da imagem JÁ no personagem (pegue via action=get, campo imageUrls, ou sheetUrls pra apagar uma ficha, ou plates[].url pra apagar uma placa).",
    ),
  orderedUrls: z
    .array(z.string())
    .optional()
    .describe(
      "Pra reorder_images: as urls das imagens do personagem na nova ordem (posição 0 = principal). url ausente vai pro fim, nenhuma se perde. Pegue as urls atuais via action=get.",
    ),
  sourceImageId: z
    .string()
    .optional()
    .describe(
      "Pra add_image: alternativa ao imageUrl — ID de imagem da SUA galeria (generatedImages:_id, via sapiens_gallery action=list). O backend resolve a url e confere que é sua.",
    ),
  isMain: z
    .boolean()
    .optional()
    .describe("Pra add_image: marca esta como a imagem principal (avatar). 1ª imagem já vira main sozinha."),
  isPublic: z
    .boolean()
    .optional()
    .describe("Pra set_visibility: true = público no Explorar (gera slug), false = privado."),
  hidden: z
    .boolean()
    .optional()
    .describe(
      "Pra set_hidden: true = oculta o personagem da tela do dono (some da lista de personagens e as peças dele saem da galeria de fotos e vídeos do dono, voltando pelo filtro Ocultos), false = mostra de novo. Não mexe em isPublic.",
    ),
  orientation: z
    .enum(["portrait", "landscape"])
    .optional()
    .describe(
      "Pra generate_sheet: 'portrait' (default) é a página de processo vertical, composição livre, sem texto. 'landscape' é a prancha larga: volta completa à esquerda, figura grande no meio, poses à direita, estudos de silhueta/expressão/detalhe embaixo e painel CHARACTER ID na ponta. As duas acumulam no personagem, uma não substitui a outra.",
    ),
  moods: z
    .array(z.string())
    .optional()
    .describe(
      "Pra generate_stickers: até 5 humores do vocabulário comum, por slug. Faltando ou inválido, a casa completa com os mais usados. No tier 'unica' só o PRIMEIRO da lista é desenhado. Slugs: kkkkk, amei, isso, hmm, chega, que, aff, bora, socorro, seinao, valeu, ainao, seila, ideia, calma, contatudo, perfeito, euavisei, naovourir, zzz, somaisum, sextou, merecido, quedia, tudobem.",
    ),
  stickerTier: z
    .enum(["folha", "unica"])
    .optional()
    .describe(
      "Pra generate_stickers: qual dos dois caminhos. 'folha' (default) é o lote, cinco stickers de UMA folha 2K no motor rápido, o preço de uma imagem por cinco peças. 'unica' desenha UM sticker por vez no motor mais fiel da casa (Gemini 3 Pro), com a figura sozinha no quadro: custa mais por peça e é o que salva traço difícil ou reação que vai virar a cara do personagem. Na dúvida, ou pra encher o pack, use 'folha'.",
    ),
  hint: z
    .string()
    .max(140)
    .optional()
    .describe(
      "Pra generate_stickers: direcionamento curto do autor (roupa, adereço, clima). Tempera a folha, não substitui a receita. Máximo 140 caracteres.",
    ),
  descriptor: z
    .string()
    .optional()
    .describe(
      "Pra set_passport: o descritor de geracao dele em INGLES, pra colar verbatim no prompt. E o texto que faz o motor desenhar ESTE ser e nao um parecido. Manda vazio pra apagar.",
    ),
  negative: z
    .string()
    .optional()
    .describe(
      "Pra set_passport: os negativos travados deste personagem, sempre ligados em toda geracao. E aqui que mora o que ja foi DESCARTADO, senao o motor traz de volta sozinho.",
    ),
  locks: z
    .array(z.string())
    .optional()
    .describe(
      "Pra set_passport: o que TRAVA nele, um item por entrada (tatuagem nos dois antebracos, choker de argola). Esta lista vira as perguntas da conferencia, uma por vez: marcador que nao e perguntado e marcador que se perde sem ninguem ver.",
    ),
  refs: z
    .array(z.record(z.string(), z.string()))
    .optional()
    .describe(
      "Pra set_passport: as referencias por PAPEL, [{role, url, imageId}]. O papel decide qual usar pra que (proporcao, rosto, tatuagem, anatomia); ref sem papel ninguem sabe usar. A ref manda mais que adjetivo.",
    ),
  recipes: z
    .array(z.record(z.string(), z.string()))
    .optional()
    .describe(
      "Pra set_passport: a receita medida por tipo de peca, [{kind, engine, prompt, note}]. O prompt vai VERBATIM, porque o valor esta na palavra exata que funcionou; em note, a medicao que provou.",
    ),
  discarded: z
    .array(z.record(z.string(), z.string()))
    .optional()
    .describe(
      "Pra set_passport: o que foi descartado, [{what, why}]. Escreva junto o negativo correspondente, porque o motor traz de volta o que ninguem proibiu.",
    ),
});

export type CharacterArgs = z.infer<typeof characterSchema>;

export async function character(args: CharacterArgs): Promise<any> {
  // -------- list_public: catálogo global (sessionToken opcional, marca `mine`) --------
  if (args.action === "list_public") {
    let sessionToken: string | undefined;
    try {
      sessionToken = getSessionToken();
    } catch {
      sessionToken = undefined; // catálogo público funciona sem login
    }
    return await convexQuery("influencers:mcpListPublicCharacters", {
      sessionToken,
      limit: args.limit,
    });
  }

  // -------- get: detalhe de 1 personagem --------
  if (args.action === "get") {
    if (!args.characterId) {
      throw new Error("action=get exige characterId (pegue via list_public ou list_mine).");
    }
    let sessionToken: string | undefined;
    try {
      sessionToken = getSessionToken();
    } catch {
      sessionToken = undefined;
    }
    const res = await convexQuery("influencers:mcpGetCharacter", {
      sessionToken,
      characterId: args.characterId,
    });
    if (!res) {
      throw new Error(
        `Personagem "${args.characterId}" não encontrado (ou é privado de outro user).`,
      );
    }
    return res;
  }

  // -------- list_mine: personagens do próprio user (inclui drafts) --------
  if (args.action === "list_mine") {
    const sessionToken = getSessionToken();
    return await convexQuery("influencers:mcpListMyCharacters", { sessionToken });
  }

  // -------- create: novo rascunho na conta --------
  if (args.action === "create") {
    if (!args.name || !args.name.trim()) {
      throw new Error("action=create exige 'name'.");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpCreateCharacter", {
      sessionToken,
      client: getClientName(),
      name: args.name,
      fullName: args.fullName,
      gender: args.gender,
      form: args.form,
      style: args.style,
      styleNote: args.styleNote,
      title: args.title,
      titleEn: args.titleEn,
      systemPrompt: args.systemPrompt,
    });
  }

  // -------- add_image: imagem no próprio personagem --------
  if (args.action === "add_image") {
    if (!args.characterId) throw new Error("action=add_image exige characterId.");
    if (!args.imageUrl && !args.sourceImageId) {
      throw new Error("action=add_image exige 'imageUrl' ou 'sourceImageId'.");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpAddCharacterImage", {
      sessionToken,
      characterId: args.characterId,
      imageUrl: args.imageUrl,
      sourceImageId: args.sourceImageId,
      isMain: args.isMain,
    });
  }

  // -------- set_card: alma/título/nome do próprio personagem --------
  if (args.action === "set_card") {
    if (!args.characterId) throw new Error("action=set_card exige characterId.");
    // `form` e `style` entram na conta: a própria descrição da tool ensina a
    // consertar personagem desenhado como gente com `set_card form=creature` e
    // personagem fotográfico com `set_card style=realista`, e sozinhos eles
    // batiam neste guard e voltavam erro.
    if (
      args.systemPrompt === undefined &&
      args.title === undefined &&
      args.titleEn === undefined &&
      args.name === undefined &&
      args.fullName === undefined &&
      args.form === undefined &&
      args.style === undefined &&
      args.styleNote === undefined
    ) {
      throw new Error(
        "action=set_card precisa de pelo menos um: systemPrompt, title, titleEn, name, fullName, form, style ou styleNote.",
      );
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterCard", {
      sessionToken,
      characterId: args.characterId,
      systemPrompt: args.systemPrompt,
      title: args.title,
      titleEn: args.titleEn,
      name: args.name,
      fullName: args.fullName,
      form: args.form,
      style: args.style,
      styleNote: args.styleNote,
    });
  }

  // -------- set_presence: onde ele existe fora da casa --------
  if (args.action === "set_presence") {
    if (!args.characterId) throw new Error("action=set_presence exige characterId.");
    if (
      args.email === undefined &&
      args.websiteUrl === undefined &&
      args.socials === undefined &&
      args.hashtag === undefined
    ) {
      throw new Error(
        "action=set_presence precisa de pelo menos um: email, websiteUrl, socials ou hashtag.",
      );
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterPresence", {
      sessionToken,
      characterId: args.characterId,
      email: args.email,
      websiteUrl: args.websiteUrl,
      socials: args.socials,
      hashtag: args.hashtag,
    });
  }

  // -------- set_passport: como ACERTAR ele (a receita que ja foi medida) --------
  if (args.action === "set_passport") {
    if (!args.characterId) throw new Error("action=set_passport exige characterId.");
    if (
      args.descriptor === undefined &&
      args.negative === undefined &&
      args.locks === undefined &&
      args.refs === undefined &&
      args.recipes === undefined &&
      args.discarded === undefined
    ) {
      throw new Error(
        "action=set_passport precisa de pelo menos um: descriptor, negative, locks, refs, recipes ou discarded.",
      );
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterPassport", {
      sessionToken,
      characterId: args.characterId,
      descriptor: args.descriptor,
      negative: args.negative,
      locks: args.locks,
      refs: args.refs,
      recipes: args.recipes,
      discarded: args.discarded,
    });
  }

  // -------- activate: publica (sai de draft, exige >=1 imagem) --------
  if (args.action === "activate") {
    if (!args.characterId) throw new Error("action=activate exige characterId.");
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpActivateCharacter", {
      sessionToken,
      client: getClientName(),
      characterId: args.characterId,
    });
  }

  // -------- set_visibility: público (Explorar) ou privado --------
  if (args.action === "set_visibility") {
    if (!args.characterId) throw new Error("action=set_visibility exige characterId.");
    if (args.isPublic === undefined) {
      throw new Error("action=set_visibility exige isPublic (true=público, false=privado).");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterVisibility", {
      sessionToken,
      characterId: args.characterId,
      isPublic: args.isPublic,
    });
  }

  // -------- set_hidden: oculta ou mostra na tela do dono --------
  if (args.action === "set_hidden") {
    if (!args.characterId) throw new Error("action=set_hidden exige characterId.");
    if (args.hidden === undefined) {
      throw new Error("action=set_hidden exige hidden (true=oculta da sua tela, false=mostra de novo).");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterHidden", {
      sessionToken,
      characterId: args.characterId,
      hidden: args.hidden,
    });
  }

  // -------- remove_image: tira UMA imagem (por url) --------
  if (args.action === "remove_image") {
    if (!args.characterId) throw new Error("action=remove_image exige characterId.");
    if (!args.imageUrl) throw new Error("action=remove_image exige imageUrl (a url da imagem no personagem; veja em action=get).");
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpRemoveCharacterImage", {
      sessionToken,
      characterId: args.characterId,
      imageUrl: args.imageUrl,
    });
  }

  // -------- set_main_image: define a principal (por url) --------
  if (args.action === "set_main_image") {
    if (!args.characterId) throw new Error("action=set_main_image exige characterId.");
    if (!args.imageUrl) throw new Error("action=set_main_image exige imageUrl (uma das imagens já no personagem; veja em action=get).");
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterMainImage", {
      sessionToken,
      characterId: args.characterId,
      imageUrl: args.imageUrl,
    });
  }

  // -------- reorder_images: nova ordem (posição 0 = principal) --------
  if (args.action === "reorder_images") {
    if (!args.characterId) throw new Error("action=reorder_images exige characterId.");
    if (!args.orderedUrls || args.orderedUrls.length === 0) {
      throw new Error("action=reorder_images exige orderedUrls (as urls na nova ordem; veja em action=get).");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpReorderCharacterImages", {
      sessionToken,
      characterId: args.characterId,
      orderedUrls: args.orderedUrls,
    });
  }

  // -------- generate_sheet: a ficha (página-pôster) do personagem --------
  // Geração SÍNCRONA que COBRA: cai na regra do timeout. Se voltar Timeout,
  // NÃO repita às cegas: confira em action=get (campo imageUrls) se a peça caiu.
  // A ficha entra na galeria do personagem, então já vira referência das
  // próximas gerações sem passo extra.
  if (args.action === "generate_sheet") {
    if (!args.characterId) throw new Error("action=generate_sheet exige characterId.");
    const sessionToken = getSessionToken();
    return await convexAction("characterSheetActions:mcpGenerateCharacterSheet", {
      sessionToken,
      influencerId: args.characterId,
      orientation: args.orientation,
    });
  }

  // -------- generate_plates: seis ângulos do mesmo rosto --------
  // Geração SÍNCRONA que COBRA: cai na regra do timeout. Se voltar Timeout, NÃO
  // repita às cegas: confira em action=get (campo plates) se as placas caíram.
  // Quando o corte falha depois da geração, a resposta volta com ok=false e o
  // gridImageId da grade paga; o recorte de novo é grátis e mora na web.
  if (args.action === "generate_plates") {
    if (!args.characterId) throw new Error("action=generate_plates exige characterId.");
    const sessionToken = getSessionToken();
    return await convexAction("characterPlatesActions:mcpGenerateCharacterPlates", {
      sessionToken,
      influencerId: args.characterId,
    });
  }

  // -------- generate_stickers: o lote de 5, ou 1 no motor mais fiel --------
  // Geração SÍNCRONA que COBRA: cai na regra do timeout. Se voltar Timeout, NÃO
  // repita às cegas: a folha pode ter saído (confira em sapiens_gallery).
  // Quando o corte falha depois da geração, a resposta volta com ok=false e o
  // sheetImageId da folha paga — o recorte de novo é grátis e mora na web.
  //
  // `tier` vai como está: quem resolve o motor, a resolução e quantas figuras
  // procurar é o servidor (shared/stickerPrompt), pra tool e tela nunca
  // discordarem sobre o que cada caminho é.
  if (args.action === "generate_stickers") {
    if (!args.characterId) throw new Error("action=generate_stickers exige characterId.");
    const sessionToken = getSessionToken();
    return await convexAction("stickerActions:mcpGenerateStickerBatch", {
      sessionToken,
      influencerId: args.characterId,
      moods: args.moods,
      hint: args.hint,
      tier: args.stickerTier,
    });
  }

  // -------- plan_video: o roteiro dos seis planos (COBRA 50) --------
  // Passo de texto: devolve os seis planos (ambiente, ato, enquadramento,
  // roupa) escritos pela alma do personagem, sem renderizar nada. Cobra o flat
  // do roteiro, que é o preço de uma criação pequena. Existe pra você mostrar o
  // roteiro ao autor ANTES de queimar milhares de Sinapses num take: trocar o
  // roteiro é pedir de novo, por outras 50.
  //
  // Cada plano volta nas duas línguas: inglês (o que vira prompt) e pt-BR
  // (settingPt/actPt/wardrobePt). MOSTRE a versão em português.
  if (args.action === "plan_video") {
    if (!args.characterId) throw new Error("action=plan_video exige characterId.");
    const sessionToken = getSessionToken();
    return await convexAction("characterVideoActions:mcpPlanCharacterVideo", {
      sessionToken,
      influencerId: args.characterId,
    });
  }

  // -------- replan_shot: um plano de novo, os outros cinco ficam (COBRA 15) --
  // Os seis planos são cenas independentes, e quase sempre o autor gosta de
  // quatro e implica com um. Sem isto, discordar de um plano custava refazer o
  // roteiro inteiro e perder os que ele já tinha aprovado.
  //
  // Mande os SEIS em `shots` (é deles que sai o que o plano novo não pode
  // repetir) e o número em `shotIndex`. Volta só o plano trocado: monte o
  // roteiro de volta você, trocando aquele e mantendo os outros como estão.
  if (args.action === "replan_shot") {
    if (!args.characterId) throw new Error("action=replan_shot exige characterId.");
    if (!args.shotIndex) throw new Error("action=replan_shot exige shotIndex (1 a 6).");
    if (!Array.isArray(args.shots) || args.shots.length !== 6) {
      throw new Error(
        "action=replan_shot exige os 6 planos atuais em shots: é dos outros cinco que sai o que o plano novo não pode repetir.",
      );
    }
    const sessionToken = getSessionToken();
    return await convexAction("characterVideoActions:mcpReplanCharacterShot", {
      sessionToken,
      influencerId: args.characterId,
      index: args.shotIndex,
      shots: args.shots,
      hint: args.shotHint,
    });
  }

  // -------- generate_video: o Character Video (a ficha que anda) --------
  // Geração que COBRA CARO e demora minutos: cai na regra do timeout.
  // Se voltar Timeout, NÃO repita às cegas: confira em sapiens_gallery se o
  // take caiu.
  //
  // `pending: true` na resposta (sem `url`): o take foi ACEITO E COBRADO e o
  // servidor continua renderizando por conta própria (até 25 min). NÃO repita
  // a chamada, isso cobraria de novo; a peça chega na ficha do personagem
  // sozinha, já fechada (cartão + marca). Diga isso ao autor e confira depois
  // em sapiens_gallery (ou sapiens_character action=get).
  //
  // Mande `shots` com o roteiro que o autor APROVOU (o que veio do plan_video,
  // com edição dele se houver). Sem `shots`, o servidor escreve um roteiro novo
  // na hora e cobra do mesmo jeito, então o caminho educado é sempre planejar,
  // mostrar, e só então gerar.
  //
  // A peça volta FECHADA, sem você pedir nada: o personagem se apresenta (o
  // cartão com o nome dele e o lema em inglês da ficha, por cima do fim do
  // último plano) e depois a casa assina. O fecho é asset, não geração: custa
  // ZERO Sinapse a mais e sai igual toda vez, que é o ponto de uma assinatura.
  //
  // A resposta traz `closed` e `nameCard`. Fecho é fail-open: quando um dos
  // dois volta false, o take é seu do mesmo jeito (nada a mais foi cobrado),
  // só desceu cru. Diga isso ao autor em vez de prometer um cartão que não
  // está no arquivo. Sem lema em inglês na ficha o cartão sai só com o nome:
  // o conserto é sapiens_character action=set_card titleEn=..., de graça.
  if (args.action === "generate_video") {
    if (!args.characterId) throw new Error("action=generate_video exige characterId.");
    const sessionToken = getSessionToken();
    return await convexAction("characterVideoActions:mcpGenerateCharacterVideo", {
      sessionToken,
      influencerId: args.characterId,
      tier: args.videoTier,
      orientation: args.orientation,
      shots: args.shots,
    });
  }

  // -------- delete: apaga o próprio personagem (permanente) --------
  if (args.action === "delete") {
    if (!args.characterId) throw new Error("action=delete exige characterId.");
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpDeleteCharacter", {
      sessionToken,
      characterId: args.characterId,
    });
  }
}
