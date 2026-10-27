import { z } from "zod";
import { convexAction, convexQuery, getSessionToken } from "../convexClient.js";

/**
 * sapiens_reference — o "popup global de referência" do Sapiens via MCP.
 *
 * Espelha o modal "Selecionar Referência" do gerador web: um lugar só pra
 * navegar os bancos e pegar o que vira referência em imagem (sapiens_image) ou
 * vídeo (sapiens_video).
 *
 * As duas são a MESMA porta em transportes diferentes (browser e agente), e a
 * lei das duas mora em `apps/sapiens/PICKER_PATTERNS.md`. A invariante que
 * importa aqui: banco novo no picker web nasce com bucket irmão neste arquivo,
 * senão o agente enxerga menos que o browser e a paridade quebra em silêncio.
 *
 * Buckets (as abas do popup, completas). `term` (busca escrita) vale em TODOS,
 * espelhando o campo único de busca do modal web:
 *   - history    imagens recentes do user (privadas + públicas)
 *   - favorites  imagens que o user curtiu (só as suas)
 *   - videos     vídeos do user (Meus Vídeos)
 *   - stock_video Banco de Vídeo da casa (clipes/B-roll); aceita `orientation`/`loopOnly`
 *   - acervo     stock + comunidade de IMAGEM (público); aceita `source`
 *   - characters personagens; `mode` = 'mine' (default) ou 'public'
 *   - depth map guias de movimento; `shadowSource` = 'house' (banco curado, default) ou 'mine'
 *
 * `semantic` lê o `term` como descrição e busca por SIGNIFICADO em history,
 * videos (creationEmbeddings) e pose_map (poseRefs): a prateleira "Pelo
 * sentido" do picker web, por outra porta porque vetor não pagina como lista.
 *
 * Cada item volta normalizado:
 *   - imagem PRÓPRIA (history/favorites): `imageId` + `url` → use imageId em
 *     sourceImageIds / startImageId / endImageId, ou url em referenceImageUrls.
 *   - acervo (stock/comunidade) e characters: use a `url` em referenceImageUrls
 *     (e startImageUrl/endImageUrl no vídeo). characters também trazem
 *     `characterId` + `imageUrls` (todas as imagens do personagem).
 */
export const referenceSchema = z.object({
  action: z
    .enum(["browse", "resolve"])
    .describe(
      "'browse' navega um bucket do acervo; 'resolve' acha UM asset pelo ID citável (handle <tipo>_<id>) " +
        "e diz se é seu / público + devolve a url pra usar de referência.",
    ),
  bucket: z
    // "deepshadow" é o nome ANTIGO do mesmo banco (a peça virou depth map em
    // set/2026). Fica no enum, depreciado e sem aparecer nas descrições, porque
    // client publicado continua mandando ele e a regra de retrocompat da casa
    // proíbe quebrar quem está atrasado. O servidor aceita os dois.
    .enum(["history", "favorites", "videos", "stock_video", "acervo", "characters", "depth_map", "pose_map", "deepshadow"])
    .optional()
    .describe(
      "Só 'browse': qual banco navegar: 'history' (suas imagens recentes; com term+semantic acha pelo significado), " +
        "'favorites' (as que você curtiu), 'videos' (seus vídeos; idem), 'stock_video' (Banco de Vídeo da casa: clipes/B-roll prontos, aceita term/orientation/loopOnly), " +
        "'acervo' (stock + comunidade públicos de IMAGEM), 'characters' (personagens), " +
        "'depth_map' (guias de movimento: os SEUS com shadowSource='mine', ou o banco curado da casa por default), " +
        "'pose_map' (seu banco privado de POSE: mapa de profundidade de corpo num quadro parado, mais de 8 mil poses organizadas por familia/vista/camera/enquadramento/leitura; aceita também term/orientation/people/hasObject/hasSuporte/objeto/favoritesOnly/collection/sort, grupo/porPose pra mesma pose em várias câmeras, mais semantic e similarTo pra busca por sentido).",
    ),
  handle: z
    .string()
    .optional()
    .describe(
      "Só 'resolve': o ID citável do asset, formato <tipo>_<id> — img_… (imagem), vid_… (vídeo), " +
        "film_… (vídeo programático), trk_… (música), comic_… (tirinha), char_… (personagem). " +
        "É o ID que o usuário copia no detalhe do item.",
    ),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Página (default 1). Use com hasMore pra paginar."),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe("Itens por página (default 20, máx 50)."),
  term: z
    .string()
    .optional()
    .describe(
      "Busca escrita, vale em QUALQUER bucket. Casa por pedaço de palavra, sem acento: 'board' acha 'storyboard'. " +
        "Olha prompt, título, folha, personagem e modelo nas suas imagens; prompt/título/modelo nos vídeos; " +
        "nome nos personagens; prompt/tag/mood no acervo e no banco de vídeo. " +
        "Pra achar UMA peça específica que você já sabe qual é, use action=resolve com o handle (img_…), é mais direto.",
    ),
  source: z
    .enum(["all", "stock", "community"])
    .optional()
    .describe("Só bucket 'acervo': fonte. Default 'all' (stock + comunidade)."),
  shadowSource: z
    .enum(["mine", "house"])
    .optional()
    .describe("Só bucket 'depth_map': 'mine' (os que VOCÊ extraiu) ou 'house' (o banco curado da casa, default)."),
  orientation: z
    .enum(["vertical", "horizontal", "square"])
    .optional()
    .describe(
      "Buckets 'stock_video' e 'pose_map': filtra formato (vertical 9:16, horizontal 16:9, square 1:1).",
    ),
  loopOnly: z
    .boolean()
    .optional()
    .describe("Só bucket 'stock_video': só clipes loopFriendly (loop limpo, bom pra fundo)."),
  people: z
    .enum(["solo", "dupla", "grupo"])
    .optional()
    .describe(
      "Só bucket 'pose_map': quantas figuras no quadro. 'solo' (uma pessoa), 'dupla' (duas), 'grupo' (três ou mais).",
    ),
  hasObject: z
    .boolean()
    .optional()
    .describe(
      "Só bucket 'pose_map': true = só poses que seguram/usam algo (corda, espada, arco, bastão); false = só corpo limpo, sem adereço. Omitir = as duas.",
    ),
  objeto: z
    .string()
    .optional()
    .describe("Só bucket 'pose_map': um objeto específico ('corda', 'espada', 'arco', 'cama')."),
  favoritesOnly: z
    .boolean()
    .optional()
    .describe(
      "Só bucket 'pose_map': apenas as poses que o dono marcou com estrela. É o recorte mais forte que existe — comece por ele quando o pedido for vago.",
    ),
  collection: z
    .string()
    .optional()
    .describe("Só bucket 'pose_map': uma coleção nomeada pelo dono ('ação', 'editorial', 'íntimo')."),
  semantic: z
    .boolean()
    .optional()
    .describe(
      "Buckets 'history', 'videos' e 'pose_map': lê o `term` como DESCRIÇÃO em vez de palavra-chave, e acha " +
        "pelo SIGNIFICADO. Em history/videos acha a peça da pessoa mesmo quando o prompt usou outras palavras " +
        "('praia ao entardecer' acha 'golden hour beach'); em pose_map, o pedido que nenhuma tag cobre " +
        "('alguém se protegendo do vento', 'caindo de costas apoiado num braço'). Frase inteira funciona melhor " +
        "que palavra solta. Sem paginação: volta até `limit` (máx 50), do mais parecido pro menos, com `score`.",
    ),
  similarTo: z
    .string()
    .optional()
    .describe(
      "Só bucket 'pose_map': o id de uma pose; devolve as MAIS PARECIDAS com ela. " +
        "Use quando o usuário gostou de uma e quer variações do mesmo gesto.",
    ),
  sort: z
    .enum(["recent", "used"])
    .optional()
    .describe(
      "Só bucket 'pose_map': 'recent' (entrada no banco, default) ou 'used' (as que ele acabou de usar, mais úteis pra continuar uma série).",
    ),
  // As categorias do pose_map. Os ids espelham apps/sapiens/convex/shared/poseTaxonomia.js
  // (fonte única; o teste convex/shared/poseTaxonomia.test.ts trava a paridade).
  familia: z
    .enum([
      "em-pe",
      "em-movimento",
      "inclinada",
      "agachada",
      "ajoelhada",
      "sentada",
      "deitada",
      "quatro-apoios",
      "no-ar",
      "invertida",
    ])
    .optional()
    .describe(
      "Só bucket 'pose_map': o que o corpo faz, a categoria principal do banco (lida por visão, não pela tag do esqueleto). " +
        "'em-movimento' = passada, corrida, chute, giro; 'inclinada' = em pé com o tronco dobrado; 'no-ar' = salto, queda, pendurada; " +
        "'invertida' = de cabeça pra baixo. Combina com vista e com semantic.",
    ),
  vista: z
    .enum(["frente", "tres-quartos", "perfil", "costas"])
    .optional()
    .describe(
      "Só bucket 'pose_map': de onde a câmera vê o corpo. 'costas' inclui três quartos de costas: a fronteira é peito ou costas pra câmera, que a sombra sem rosto não diz sozinha.",
    ),
  enquadramento: z
    .enum(["corpo-inteiro", "joelhos", "cintura", "busto"])
    .optional()
    .describe("Só bucket 'pose_map': até onde o quadro mostra o corpo."),
  leitura: z
    .enum(["clara", "confusa"])
    .optional()
    .describe(
      "Só bucket 'pose_map': 'clara' = a sombra se entende sozinha. 'confusa' = membro fundido, escondido ou cortado, a sombra que devolve braço sem dono ou duas pernas esquerdas. Pra gerar personagem, prefira 'clara'.",
    ),
  hasSuporte: z
    .boolean()
    .optional()
    .describe(
      "Só bucket 'pose_map': true = só poses apoiadas em algo além do chão (banco, bloco, parede, cama: vem em `suporte`); false = só no chão. Omitir = as duas.",
    ),
  camera: z
    .enum(["baixo", "nivel", "alto"])
    .optional()
    .describe(
      "Só bucket 'pose_map': a altura da câmera. 'baixo' = de baixo pra cima (contra-plongée), 'nivel' = na altura do corpo, 'alto' = de cima (plongée). Combina com vista: vista é o giro, camera é a altura.",
    ),
  grupo: z
    .string()
    .optional()
    .describe(
      "Só bucket 'pose_map': a chave de um CONJUNTO (vem no campo `grupo` de cada item). Devolve as outras câmeras da MESMA pose, cada uma com seu `angulo` (frente, de-cima, de-baixo, lado, diagonal). É a cobertura de câmera: o gesto travado e a câmera andando. Com grupo, `term` é ignorado (o conjunto já é a resposta); os outros recortes valem.",
    ),
  porPose: z
    .boolean()
    .optional()
    .describe(
      "Só bucket 'pose_map': true = só poses que vêm em conjunto de câmeras, na ordem do catálogo da fonte, com as câmeras de cada pose coladas. Use pra montar sequência ou história com a mesma pose de vários pontos.",
    ),
  mode: z
    .enum(["mine", "public"])
    .optional()
    .describe(
      "Só bucket 'characters': 'mine' (seus personagens, inclui rascunhos; default) ou 'public' (catálogo do Explorar).",
    ),
});

export type ReferenceArgs = z.infer<typeof referenceSchema>;

export async function reference(args: ReferenceArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "resolve") {
    if (!args.handle) {
      return {
        error:
          "resolve exige `handle` (ex: img_..., vid_..., trk_...). É o ID que o usuário copia no detalhe do item.",
      };
    }
    // resolveHandle é QUERY (read-only): posse + alcance server-side.
    const res: any = await convexQuery("assets:resolveHandle", {
      sessionToken,
      handle: args.handle,
    });
    return {
      ...res,
      note:
        "Asset resolvido por posse + alcance. `mine`=seu, `isPublic`=público (seu ou de terceiro). " +
        "Use a `url` como referência: em sapiens_image passe em referenceImageUrls; em sapiens_video em " +
        "startImageUrl/endImageUrl (a url da casa já é allowlistada). Se não for seu nem público, o servidor " +
        "recusa — não force.",
    };
  }

  if (args.action === "browse") {
    if (!args.bucket) {
      return {
        error:
          "browse exige `bucket` (history | favorites | videos | stock_video | acervo | characters | depth_map | pose_map).",
      };
    }
    // Busca por SENTIDO e "parecidas com esta" saem por outra porta: vetor não
    // pagina como lista, e o `referenceBrowse` é o navegador de banco, não o
    // buscador. Mesmo bucket, mesma identidade, resposta no mesmo formato.
    if (args.bucket === "pose_map" && (args.semantic || args.similarTo)) {
      const res: any = await convexAction("poseRefs:mcpSearchByMeaning", {
        sessionToken,
        term: args.semantic ? args.term : undefined,
        similarTo: args.similarTo,
        people: args.people,
        limit: args.limit,
        familia: args.familia,
        vista: args.vista,
        leitura: args.leitura,
      });
      const itens = res?.items ?? [];
      return {
        bucket: "pose_map",
        modo: args.similarTo ? "parecidas" : "sentido",
        count: itens.length,
        items: itens,
        note: itens.length
          ? "Vizinhança por SENTIDO, da mais parecida pra menos (`score` é a distância). " +
            "Cada item traz `descricao`: leia antes de escolher, é ela que diz o que o corpo faz. " +
            "Use a `url` em sapiens_image referenceImageUrls e cole `membros` no prompt (lado de cada braço e perna). " +
            "`usadaPor` diz quem já usou a pose: não repita na mesma personagem."
          : "Nenhuma pose do seu banco chegou perto disso. Tente descrever o CORPO (apoio, direção do tronco, " +
            "o que os braços fazem) em vez da cena, ou use browse com people/hasObject.",
      };
    }

    // A mesma porta de sentido pras SUAS imagens e vídeos (creationEmbeddings):
    // o `term` vira vetor e volta a vizinhança, no shape dos itens do browse.
    if ((args.bucket === "history" || args.bucket === "videos") && args.semantic && args.term?.trim()) {
      const video = args.bucket === "videos";
      const res: any = await convexAction("creationEmbeddings:mcpSearchByMeaning", {
        sessionToken,
        term: args.term,
        type: video ? "VIDEO" : "IMAGE",
        limit: args.limit,
      });
      const itens = (res?.items ?? []).map((r: any) => ({
        refKind: video ? "video" : "image",
        imageId: r.imageId,
        url: r.url,
        thumbnailUrl: r.posterUrl ?? null,
        title: r.seoTitle ?? null,
        prompt: r.prompt ?? null,
        model: r.model ?? null,
        aspectRatio: r.aspectRatio ?? null,
        isPublic: !!r.isPublic,
        createdAt: r.createdAt ?? null,
        source: args.bucket,
        score: r.score,
      }));
      return {
        bucket: args.bucket,
        modo: "sentido",
        count: itens.length,
        items: itens,
        note: itens.length
          ? "Peças SUAS por significado, da mais parecida pra menos (`score`). " +
            (video
              ? "Cada item é um vídeo seu (imageId reusável em sapiens_video)."
              : "Use o imageId em sapiens_image sourceImageIds ou sapiens_video startImageId/endImageId, ou a url em referenceImageUrls.")
          : `Nada do seu acervo chegou perto de "${args.term}" por significado. Tente descrever o que aparece na ` +
            "peça, ou browse com o mesmo `term` sem semantic (pedaço de palavra). Peça muito recente pode ainda " +
            "não estar no índice: ela entra alguns segundos depois de pronta.",
      };
    }

    const res: any = await convexAction("mcpReferences:referenceBrowse", {
      sessionToken,
      bucket: args.bucket,
      page: args.page,
      limit: args.limit,
      term: args.term,
      source: args.source,
      orientation: args.orientation,
      loopOnly: args.loopOnly,
      mode: args.mode,
      shadowSource: args.shadowSource,
      people: args.people,
      hasObject: args.hasObject,
      objeto: args.objeto,
      favoritesOnly: args.favoritesOnly,
      collection: args.collection,
      sort: args.sort,
      familia: args.familia,
      vista: args.vista,
      enquadramento: args.enquadramento,
      leitura: args.leitura,
      hasSuporte: args.hasSuporte,
      camera: args.camera,
      grupo: args.grupo,
      porPose: args.porPose,
    });

    let note: string;
    if (args.bucket === "videos") {
      note =
        "Cada item é um vídeo seu (imageId reusável em sapiens_video action=generate). Pra frame inicial/final de um vídeo NOVO use uma IMAGEM (bucket history/favorites/acervo/characters).";
    } else if (args.bucket === "stock_video") {
      note =
        "Clipes do Banco de Vídeo da casa (B-roll pronto). Use a `url` do clipe: como referência de vídeo em sapiens_video (mesma rail do Meus Vídeos), de fundo/atmosfera, ou baixe direto. orientation/durationSeconds/loopFriendly ajudam a escolher. Não são imagem: NÃO servem de frame inicial/final (pra frame use uma IMAGEM).";
    } else if (args.bucket === "depth_map" || args.bucket === "deepshadow") {
      note =
        "Guias de movimento (mapa de profundidade). Use a `url` em sapiens_video referenceVideoUrls: a coreografia e a câmera do clipe guiam o take. `thumbnailUrl` é só preview (a soma com esqueleto), nunca mande ela como driving. Teto de duração varia por motor.";
    } else if (args.bucket === "pose_map") {
      note =
        "Poses do SEU banco privado (mapa de profundidade de corpo). Use a `url` (a SOMBRA pura) em sapiens_image referenceImageUrls pra guiar a POSE da figura, com a linha 'adopt exactly the body pose of the <n>th reference; it is a pose guide only, ignore its grey tones'. Cada item traz `familia`, `vista`, `enquadramento` e `leitura` (prefira 'clara': a 'confusa' devolve membro sem dono), `people`, `objeto` (o que a mão segura), `suporte` (banco, bloco, parede: nomeie no prompt onde o corpo se apoia), `descricao` e `membros` (cada braço e perna com o LADO da pessoa, em inglês: cole no prompt, é o que evita duas pernas esquerdas). `skeletonUrl` é a SOMA (sombra + esqueleto colorido), guia OPCIONAL: em imagem, a sombra pura + `membros` no prompt já dizem o lado de cada membro e não deixam marca; a soma só vale quando a pose é difícil de ler, sempre com 'ignore any coloured overlay lines', e confira a peça, porque o traço às vezes fica na imagem (em VÍDEO a soma ganhou da sombra no A/B da casa). `usadaPor` diz quem já usou: não repita a pose na mesma personagem. Pra recortar, mande familia/vista/leitura/people/hasObject/hasSuporte em vez de tentar pela busca escrita; `poseId` vai em similarTo pra variações do mesmo gesto. Item com `grupo` faz parte de um CONJUNTO (a mesma pose de várias câmeras, `angulo` diz qual): peça grupo=<grupo> pra ver as outras. Pra cobertura de câmera numa sequência, cada plano leva só o rosto da ficha + a pose da câmera nova, com a roupa e o FUNDO que a câmera nova vê escritos no prompt; a peça anterior como referência prende o fundo e o motor gira o corpo em vez da câmera. Pedido vago ('uma pose boa pra isso') começa por favoritesOnly=true ou sort='used': é a curadoria que o dono já fez. É material privado seu: a peça gerada a partir dele é geração normal e publica normal, mas a pose em si não é acervo público da casa.";
    } else if (args.bucket === "acervo" || args.bucket === "characters") {
      note =
        "São referências públicas: use a `url` (characters trazem mainImageUrl + imageUrls) em sapiens_image referenceImageUrls, ou em sapiens_video startImageUrl/endImageUrl. Não são suas, então NÃO entram em sourceImageIds.";
    } else {
      note =
        "Pra usar como referência: em sapiens_image passe o imageId em sourceImageIds (ou a url em referenceImageUrls); em sapiens_video passe startImageId/endImageId (ou startImageUrl/endImageUrl).";
    }
    // Vazio COM termo não quer dizer banco vazio: sem essa linha o agente
    // conclui que a pessoa não tem nada e vai gerar de novo o que já existe.
    if (args.term && !res?.items?.length) {
      note =
        `Nenhuma peça deste banco casou com "${args.term}". O banco pode ter outras: tente um termo mais curto ` +
        `(a busca casa por pedaço de palavra), outro bucket, ou browse sem \`term\`. Se o usuário te deu o ID da ` +
        `peça (img_…, vid_…), use action=resolve.`;
    }
    return { ...res, note };
  }
}
