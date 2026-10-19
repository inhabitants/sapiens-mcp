import { z } from "zod";
import {
  convexAction,
  convexMutation,
  convexQuery,
  getSessionToken,
} from "../convexClient.js";
import { need } from "../schema.js";

// Espelho canônico dos formatos do app (peças surface:'format' em PIECES,
// apps/sapiens/src/features/content-pipeline/registry.jsx). Mantido em sync por
// lint: `npm run audit:mcp-format-parity` falha o CI se divergir. Ao adicionar
// ou remover formato, mexa nos dois lados.
const FORMATS = [
  "carrossel_ig",
  "musica",
  "aula",
] as const;

// Formatos legados: fora do FORMAT_GUIDE (não advertidos), mas ainda aceitos na
// validação pra editar productions antigas sem quebrar. cena_visual ("Vídeo
// Programático") saiu de linha em jul/2026: Films + gerador de vídeo cobrem o
// caso. tirinha saiu de linha em ago/2026 (peça aposentada; as publicadas
// seguem de pé). mega_grafico saiu do picker web em ago/2026 mas o fluxo MCP
// segue vivo e ADVERTIDO (propose_mega_grafico_plan / run_mega_grafico_full
// criam a production no servidor; o formato aqui é só tolerância de validação).
// post_social, shorts_yt e video_yt saíram do picker em out/2026: vídeo vive no
// gerador de vídeo (uma tela só) e o post de texto perdeu o lugar.
const LEGACY_FORMATS = [
  "post_linkedin",
  "post_twitter",
  "post_threads",
  "cena_visual",
  "tirinha",
  "mega_grafico",
  "post_social",
  "shorts_yt",
  "video_yt",
] as const;

const ACCEPTED_FORMATS = [...FORMATS, ...LEGACY_FORMATS] as const;

const STATUSES = ["draft", "ready", "finalized"] as const;

export const pipelineSchema = z.object({
  action: z.enum([
    "list_sources",
    "list_articles",
    "get_source",
    "get_production",
    "list_versions",
    "add_article_as_source",
    "create_draft_article_and_source",
    "create_production",
    "update_production",
    "finalize_production",
    "remove_production",
    "remove_source",
    "set_source_done",
    "update_source_notes",
    "restore_version",
    "set_publishable_title",
    "backfill_via",
    "propose_mega_grafico_plan",
    "run_mega_grafico_full",
    "generate_carousel",
    "generate_carousel_production",
    "list_carousels",
    "get_carousel",
    "update_carousel",
    "carousel_auto_images",
    "carousel_generate_image",
    "capa_ia",
  ]),

  // capa_ia: a capa seamless 16:9 que vira os DOIS primeiros slides 3:4.
  // O texto é queimado dentro da imagem (é o que deixa o elemento passar na
  // frente e atrás das letras), então quem escreve a manchete aqui é quem
  // escolhe o que vai aparecer desenhado na peça.
  capaHeadline: z
    .string()
    .optional()
    .describe(
      "capa_ia: a manchete da capa, desenhada DENTRO da imagem. Curta: ela ocupa a folha inteira.",
    ),
  capaSubline: z
    .string()
    .optional()
    .describe("capa_ia: linha de apoio embaixo da manchete (opcional)."),
  capaRightText: z
    .string()
    .optional()
    .describe("capa_ia: texto que cai na METADE DIREITA, ou seja, no 2º slide (opcional)."),
  capaElement: z
    .string()
    .optional()
    .describe(
      "capa_ia: o que atravessa a cena (koi, aguas-vivas, petalas, borboletas, fagulhas, passaros, corujas). Omitido = a IA escolhe pela pauta.",
    ),
  capaVibe: z
    .string()
    .optional()
    .describe(
      "capa_ia: a atmosfera (futuro-etereo, pedra-serena, aurora, concreto-frio). Omitido = a IA escolhe pela pauta.",
    ),
  capaImageModel: z
    .string()
    .optional()
    .describe(
      "capa_ia: motor da imagem. gpt-image-2-high (default, 1200, letra pequena legível), gpt-image-2-low (200), nano-banana-max (900, cena mais fiel e 2K, letra erra mais), nano-banana-2 (450, o rápido).",
    ),

  // propose_mega_grafico_plan / run_mega_grafico_full
  withHelen: z
    .boolean()
    .optional()
    .describe(
      "Se TRUE, plano reserva 1 painel pra Helen Ailith interagindo com o tema (cartoon editorial). Se FALSE, poster 100% diagramático sem figura humana. Pergunte ao user antes de definir.",
    ),

  // run_mega_grafico_full
  skipFinalize: z
    .boolean()
    .optional()
    .describe(
      "Se TRUE, gera plano + imagem + branding + salva payload mas NÃO cria publishable (deixa production em 'ready' pro admin revisar). Default false.",
    ),
  skipBranding: z
    .boolean()
    .optional()
    .describe(
      "Se TRUE, pula o composite do selo Sapiens + tEXt chunks. Use só quando o Convex storage está fora ou pra debug. Default false.",
    ),
  templateSlug: z
    .string()
    .optional()
    .describe(
      "Slug do template de receita (admin edita em /dashboard/admin/image-templates). Se omitido, usa o template marcado isDefault=true pro formato. Ex: 'mega-grafico-blueprint-v1'.",
    ),
  specOverride: z
    .object({
      model: z.string().optional(),
      aspectRatio: z.string().optional(),
      size: z.string().optional(),
    })
    .optional()
    .describe(
      "Override de model/aspectRatio/size sobre os defaults do template. Cada um valida contra o allowedX do template; se sair do whitelist, action throws.",
    ),

  // generate_carousel
  brief: z
    .string()
    .optional()
    .describe(
      "Tema/ângulo do carrossel (fonte 'brief'). Quanto mais específico, melhor. Alternativa: articleId pra partir de um artigo publicado.",
    ),
  autoPickImages: z
    .boolean()
    .optional()
    .describe(
      "generate_carousel: a IA escolhe imagens do banco pros slides de foto (default true).",
    ),
  useSintetico: z
    .boolean()
    .optional()
    .describe(
      "generate_carousel: se TRUE, a voz do Sintético do dono dirige o copy (amplificar). Default false = estilo do dono.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "generate_carousel / generate_carousel_production: a FORMA. Folha travada da casa ('feed', o padrão; 'reflexao'; 'case'), em que a espinha de slides vem do servidor e a IA (ou seus beats) só escreve a prosa, ou 'editorial' (a IA escolhe os layouts livremente). Ausente = o Feed.",
    ),
  aspect: z
    .enum(["4:5", "9:16"])
    .optional()
    .describe(
      "generate_carousel: PROPORÇÃO da peça. Não confunda com `format` (que é o tipo da production: carrossel_ig, reels...) nem com `model` (que é a FORMA: quais beats, quais layouts). Aqui é o TAMANHO da folha: '4:5' (default) é a folha que o feed do Instagram, o LinkedIn e o X mostram inteira; '9:16' ocupa a tela inteira do celular. Dá pra trocar depois no editor ou por update_carousel (theme.sheet).",
    ),
  beats: z
    .union([
      z.array(
        z.object({
          n: z.number().describe("número do beat na espinha (1 a 9)"),
          slots: z
            .record(z.string())
            .describe("só os slots de PROSA daquele beat (title/body/punch/tagline...), já contados e na voz"),
        }),
      ),
      // Defesa: cliente que serializa o array como string JSON (mesmo caso do
      // arg payload). O handler normaliza.
      z.string(),
    ])
    .optional()
    .describe(
      "generate_carousel_production: copy PRONTO por beat da espinha, [{n, slots}]. Exige model. Com beats o Gemini de escrita NÃO roda e a rodada cobra só o picker de imagens (zero com autoPickImages=false). Use quando a skill do carrossel já escreveu e validou os blocos (o contador emite este JSON com --beats).",
    ),
  keyword: z
    .string()
    .optional()
    .describe(
      "generate_carousel_production (com beats): a palavra única do comment-to-DM, vira meta.keyword do pacote de publicação.",
    ),

  // carrossel standalone (get/update/imagens)
  carouselId: z
    .string()
    .optional()
    .describe(
      "carousels_standalone:_id — get_carousel/update_carousel/carousel_auto_images/carousel_generate_image. Vem de generate_carousel ou list_carousels. No carousel_auto_images, alternativa: productionId (carrossel da pipeline).",
    ),
  slideId: z
    .string()
    .optional()
    .describe("carousel_generate_image: id do slide (ex: 'slide-3'), do payload do get_carousel."),
  force: z
    .boolean()
    .optional()
    .describe("carousel_auto_images: TRUE substitui as imagens já aplicadas por escolhas novas. Default false = preenche só o que falta."),
  makeVisual: z
    .boolean()
    .optional()
    .describe(
      "carousel_auto_images: TRUE converte slides de texto pra layouts de foto antes de escolher (ritmo visual pro carrossel texto-pesado). O texto fica, muda a moldura.",
    ),
  generateMissing: z
    .boolean()
    .optional()
    .describe(
      "carousel_auto_images: TRUE gera imagem NOVA (nanoBanana, ~450 Sinapses cada, até 4) pros slides que o banco não cobriu. O fallback stock→gerador. Avise o usuário do custo antes.",
    ),
  customPrompt: z
    .string()
    .optional()
    .describe("carousel_generate_image: direção extra da cena (opcional; sem ela a IA usa o texto do slide)."),

  // list_articles
  includeDrafts: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
  onlyAvailable: z
    .boolean()
    .optional()
    .describe("Se true, só artigos que ainda NÃO foram virados em source"),

  // por id
  sourceId: z
    .string()
    .optional()
    .describe("contentSources:_id — get_source/create_production/generate_carousel_production/remove_source/set_source_done/update_source_notes. Vem de list_sources/add_article_as_source."),
  productionId: z
    .string()
    .optional()
    .describe("contentProductions:_id — get_production/update_production/finalize_production/remove_production/list_versions/carousel_auto_images (carrossel da pipeline). Vem de create_production ou generate_carousel_production."),
  publishableId: z
    .string()
    .optional()
    .describe("contentPublishables:_id — set_publishable_title/restore_version."),
  articleId: z
    .string()
    .optional()
    .describe("articles:_id — add_article_as_source e generate_carousel (fonte artigo). Vem de list_articles."),

  // create / add
  format: z.enum(ACCEPTED_FORMATS).optional(),
  payload: z.any().optional().describe("Payload livre por formato"),
  status: z
    .enum(STATUSES)
    .optional()
    .describe("update_production: muda o status junto do payload (ex: 'ready')."),
  notes: z.string().optional().describe("update_source_notes: nota livre no source."),

  // create_draft_article_and_source
  title: z.string().optional(),
  slug: z.string().optional(),
  excerpt: z.string().optional(),
  tldr: z.string().optional(),
  content: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  thumbnailUrl: z.string().optional(),

  // finalize_production
  assets: z
    .array(
      z.object({
        kind: z.string(),
        url: z.string().optional(),
        text: z.string().optional(),
        meta: z.any().optional(),
      }),
    )
    .optional(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),

  // set_source_done
  isDone: z.boolean().optional().describe("set_source_done: true fecha o source, false reabre."),

  // backfill_via
  sinceCreatedAt: z.number().optional(),
  beforeCreatedAt: z.number().optional(),
  via: z
    .string()
    .optional()
    .describe("Ex: 'claude-mcp', 'modo-antigo', 'manual'"),
  dryRun: z.boolean().optional(),
});

export type PipelineArgs = z.infer<typeof pipelineSchema>;


// `payload` é z.any(): sem tipo declarado, o cliente costuma serializar o
// objeto como string JSON (mesmo caso do upsert de aula em aula.ts). Normaliza
// aqui pra mandar objeto sempre (o servidor também parseia string por defesa,
// mas o shape certo sai daqui). String crua no banco = editor abre "vazio".
function coercePayloadArg(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      'Arg "payload" veio como string mas não é JSON válido. Mande o objeto do payload.',
    );
  }
}

// Mesma defesa pro `beats` do generate_carousel_production: aceita o array já
// estruturado ou a string JSON dele, e valida o shape mínimo antes de mandar.
function coerceBeatsArg(
  raw: unknown,
): Array<{ n: number; slots: Record<string, string> }> | undefined {
  if (raw == null) return undefined;
  let val: unknown = raw;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      throw new Error(
        'Arg "beats" veio como string mas não é JSON válido. Mande o array [{n, slots}].',
      );
    }
  }
  if (!Array.isArray(val) || val.some((b: any) => typeof b?.n !== "number" || !b?.slots)) {
    throw new Error('Arg "beats" deve ser um array de { n: número do beat, slots: {slot: texto} }.');
  }
  return val as Array<{ n: number; slots: Record<string, string> }>;
}

export async function pipeline(args: PipelineArgs): Promise<any> {
  const sessionToken = getSessionToken();

  switch (args.action) {
    case "list_sources":
      return await convexQuery("pipelineMcp:mcpListSources", { sessionToken });

    case "list_articles":
      return await convexQuery("pipelineMcp:mcpListArticles", {
        sessionToken,
        includeDrafts: args.includeDrafts,
        includeArchived: args.includeArchived,
        onlyAvailable: args.onlyAvailable,
      });

    case "get_source":
      return await convexQuery("pipelineMcp:mcpGetSource", {
        sessionToken,
        sourceId: need(args.sourceId, "sourceId"),
      });

    case "get_production":
      return await convexQuery("pipelineMcp:mcpGetProduction", {
        sessionToken,
        productionId: need(args.productionId, "productionId"),
      });

    case "list_versions":
      return await convexQuery("pipelineMcp:mcpListPublishableVersions", {
        sessionToken,
        productionId: need(args.productionId, "productionId"),
      });

    case "add_article_as_source": {
      const id = await convexMutation("pipelineMcp:mcpAddArticleAsSource", {
        sessionToken,
        articleId: need(args.articleId, "articleId"),
        notes: args.notes,
      });
      return { sourceId: id };
    }

    case "create_draft_article_and_source": {
      const result = await convexMutation(
        "pipelineMcp:mcpCreateDraftArticleAndSource",
        {
          sessionToken,
          title: need(args.title, "title"),
          slug: need(args.slug, "slug"),
          excerpt: args.excerpt,
          tldr: args.tldr,
          content: need(args.content, "content"),
          category: args.category,
          tags: args.tags,
          thumbnailUrl: args.thumbnailUrl,
        },
      );
      return result;
    }

    case "create_production": {
      const id = await convexMutation("pipelineMcp:mcpCreateProductionDraft", {
        sessionToken,
        sourceId: need(args.sourceId, "sourceId"),
        format: need(args.format, "format"),
        payload: coercePayloadArg(args.payload),
      });
      return { productionId: id };
    }

    case "update_production":
      await convexMutation("pipelineMcp:mcpUpdateProductionPayload", {
        sessionToken,
        productionId: need(args.productionId, "productionId"),
        payload: coercePayloadArg(need(args.payload, "payload")),
        status: args.status,
      });
      return { ok: true };

    case "finalize_production": {
      const id = await convexMutation("pipelineMcp:mcpFinalizeProduction", {
        sessionToken,
        productionId: need(args.productionId, "productionId"),
        assets: need(args.assets, "assets"),
        caption: args.caption,
        hashtags: args.hashtags,
        title: args.title,
      });
      return { publishableId: id };
    }

    case "set_publishable_title":
      await convexMutation("pipelineMcp:mcpSetPublishableTitle", {
        sessionToken,
        publishableId: need(args.publishableId, "publishableId"),
        title: need(args.title, "title"),
      });
      return { ok: true };

    case "backfill_via":
      return await convexMutation("pipelineMcp:mcpBackfillVia", {
        sessionToken,
        sinceCreatedAt: args.sinceCreatedAt,
        beforeCreatedAt: args.beforeCreatedAt,
        via: need(args.via, "via"),
        dryRun: args.dryRun,
      });

    case "remove_production":
      await convexMutation("pipelineMcp:mcpRemoveProduction", {
        sessionToken,
        productionId: need(args.productionId, "productionId"),
      });
      return { ok: true };

    case "remove_source":
      await convexMutation("pipelineMcp:mcpRemoveSource", {
        sessionToken,
        sourceId: need(args.sourceId, "sourceId"),
      });
      return { ok: true };

    case "set_source_done":
      await convexMutation("pipelineMcp:mcpSetSourceDone", {
        sessionToken,
        sourceId: need(args.sourceId, "sourceId"),
        isDone: need(args.isDone, "isDone"),
      });
      return { ok: true };

    case "update_source_notes":
      await convexMutation("pipelineMcp:mcpUpdateSourceNotes", {
        sessionToken,
        sourceId: need(args.sourceId, "sourceId"),
        notes: need(args.notes, "notes"),
      });
      return { ok: true };

    case "restore_version": {
      const productionId = await convexMutation(
        "pipelineMcp:mcpRestoreVersion",
        {
          sessionToken,
          publishableId: need(args.publishableId, "publishableId"),
        },
      );
      return { productionId };
    }

    case "propose_mega_grafico_plan": {
      // Gemini propõe um plano denso de mega gráfico a partir do source
      // (artigo ou brief). Devolve fullPrompt + spec recomendada (vem do
      // template) e referenceImageUrls se withHelen=true. templateSlug e
      // specOverride respeitam o que o admin configurou em
      // /dashboard/admin/image-templates.
      // Use APENAS quando quiser controle granular (revisar plano antes de
      // gerar imagem). Pra fluxo end-to-end, prefira run_mega_grafico_full
      // que faz tudo numa chamada só.
      const result = await convexAction(
        "megaGraficoActions:mcpProposeMegaGraficoPlan",
        {
          sessionToken,
          sourceId: need(args.sourceId, "sourceId"),
          withHelen: args.withHelen ?? false,
          templateSlug: args.templateSlug,
          specOverride: args.specOverride,
        },
      );
      return result;
    }

    case "run_mega_grafico_full": {
      // One-shot do fluxo mega gráfico inteiro: cria production (ou reusa
      // se productionId passado), propõe plano com guard de qualidade (1
      // retry se fraco), gera imagem via gpt-image-2-high, aplica selo
      // Sapiens (logo + PNG tEXt chunks), salva payload, e finaliza como
      // publishable (skipFinalize=true pula essa etapa).
      //
      // Custo: ~900 sinapses da geração de imagem + 0-100 sinapses Gemini
      // text. Total ~900-1000.
      //
      // ANTES de chamar: pergunte ao user se withHelen=true (Helen
      // interage com tema, ~15-25% do poster) ou false (poster 100%
      // diagramático, sem humanos).
      //
      // Receita usada: o templateSlug do payload (admin edita em
      // /dashboard/admin/image-templates). Sem templateSlug, usa o default.
      // specOverride permite trocar model/aspect/size dentro do whitelist
      // do template (ex: aspectRatio="1:1" pra IG, "16:9" pra og:image).
      const result = await convexAction(
        "megaGraficoRunner:mcpRunMegaGraficoFull",
        {
          sessionToken,
          sourceId: need(args.sourceId, "sourceId"),
          withHelen: args.withHelen ?? false,
          productionId: args.productionId,
          skipFinalize: args.skipFinalize,
          skipBranding: args.skipBranding,
          caption: args.caption,
          templateSlug: args.templateSlug,
          specOverride: args.specOverride,
        },
      );
      return result;
    }

    case "generate_carousel": {
      // Gera um carrossel editorial standalone (7-9 slides na voz Sapiens) a
      // partir de um brief OU de um artigo publicado, escolhe imagens do banco, e
      // devolve { id, url, title, slidesCount } — o humano abre a URL do editor
      // pra ajustar e exportar. ADMIN-ONLY. Cobra Sinapses (reembolsa se falhar).
      const brief = args.brief?.trim();
      const articleId = args.articleId;
      if (!brief && !articleId) {
        throw new Error(
          'generate_carousel: passe brief (tema/ângulo) OU articleId (artigo publicado como fonte).',
        );
      }
      return await convexAction("carouselAutofill:mcpCreateCarousel", {
        sessionToken,
        sourceKind: articleId ? "published_article" : "brief",
        ...(brief ? { brief } : {}),
        ...(articleId ? { publishedArticleId: articleId } : {}),
        autoPickImages: args.autoPickImages,
        useSintetico: args.useSintetico,
        ...(args.model ? { model: args.model } : {}),
        ...(args.aspect ? { aspect: args.aspect } : {}),
      });
    }

    case "generate_carousel_production": {
      // Gera um carrossel EDITORIAL como PRODUCTION da pipeline, a partir do
      // artigo de um source (sourceId de list_sources/add_article_as_source):
      // cria a production carrossel_ig e a preenche pelo MESMO motor do editor
      // (shape templateId+slots), então o resultado JÁ abre pronto no editor de
      // pipeline, ao contrário do create_production cru. ADMIN-ONLY, cobra
      // Sinapses (reembolsa se falhar). Devolve productionId + url do editor.
      // SÍNCRONA e pesada (Gemini + imagens): vale a REGRA DO TIMEOUT — se voltar
      // Timeout, confira em get_production/list_sources antes de repetir.
      //
      // model trava a folha registrada; beats = copy pronto do agente (pula o
      // Gemini de escrita, cobra só o picker). beats pode chegar serializado
      // como string JSON (mesmo caso do payload): normaliza antes de mandar.
      const beats = coerceBeatsArg(args.beats);
      return await convexAction("carouselAutofill:mcpFillCarouselFromArticle", {
        sessionToken,
        sourceId: need(args.sourceId, "sourceId"),
        autoPickImages: args.autoPickImages,
        useSintetico: args.useSintetico,
        ...(args.model ? { model: args.model } : {}),
        ...(beats ? { beats } : {}),
        ...(args.caption ? { caption: args.caption } : {}),
        ...(args.keyword ? { keyword: args.keyword } : {}),
      });
    }

    case "list_carousels":
      // Carrosséis standalone do dono (id + título + url do editor).
      return await convexQuery("carouselMcp:mcpListCarousels", { sessionToken });

    case "get_carousel":
      // Devolve payload completo + catálogo de templates (id/slots/limites) +
      // paletas válidas: tudo que você precisa pra ESCREVER os slides direto.
      return await convexQuery("carouselMcp:mcpGetCarousel", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
      });

    case "update_carousel":
      // Payload INTEIRO (mesmo shape do get_carousel). Sanitizado no servidor.
      // Preserve os campos image dos slides que você não mexeu — mandar slide
      // sem image derruba a foto dele.
      return await convexMutation("carouselMcp:mcpUpdateCarousel", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
        payload: coercePayloadArg(need(args.payload, "payload")),
        ...(args.title ? { title: args.title } : {}),
      });

    case "carousel_auto_images": {
      // IA escolhe imagens do banco pros slides de foto sem imagem (60 Sinapses).
      // Aceita carouselId (standalone) OU productionId (carrossel da pipeline).
      // makeVisual dá ritmo a carrossel texto-pesado; generateMissing gera as que
      // o banco não cobriu (custo por imagem). SÍNCRONA e pesada com
      // generateMissing: vale a REGRA DO TIMEOUT.
      if (!args.carouselId && !args.productionId) {
        throw new Error(
          "carousel_auto_images: passe carouselId (standalone) OU productionId (carrossel da pipeline).",
        );
      }
      return await convexAction("carouselAutofill:mcpCarouselAutoImages", {
        sessionToken,
        ...(args.carouselId ? { carouselId: args.carouselId } : {}),
        ...(!args.carouselId && args.productionId ? { productionId: args.productionId } : {}),
        force: args.force,
        makeVisual: args.makeVisual,
        generateMissing: args.generateMissing,
      });
    }

    case "capa_ia": {
      // Gera a capa 16:9 com o texto baked, fatia em duas 3:4 no servidor (o
      // corte que o editor faz no canvas) e, com carouselId, já põe os dois
      // slides na frente do carrossel. SÍNCRONA e paga: vale a REGRA DO TIMEOUT.
      return await convexAction("capaIa:mcpCapaIa", {
        sessionToken,
        headline: need(args.capaHeadline, "capaHeadline"),
        ...(args.capaSubline ? { subline: args.capaSubline } : {}),
        ...(args.capaRightText ? { rightText: args.capaRightText } : {}),
        ...(args.capaElement ? { element: args.capaElement } : {}),
        ...(args.capaVibe ? { vibe: args.capaVibe } : {}),
        ...(args.capaImageModel ? { imageModel: args.capaImageModel } : {}),
        ...(args.carouselId ? { carouselId: args.carouselId } : {}),
      });
    }

    case "carousel_generate_image":
      // Gera imagem NOVA pra UM slide (nanoBanana, ~450 Sinapses) e salva no
      // carrossel. SÍNCRONA (~20-60s): vale a REGRA DO TIMEOUT.
      return await convexAction("carouselAutofill:mcpCarouselGenerateImage", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
        slideId: need(args.slideId, "slideId"),
        ...(args.customPrompt ? { customPrompt: args.customPrompt } : {}),
      });
  }
}
