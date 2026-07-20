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
  "tirinha",
  "carrossel_ig",
  "post_social",
  "mega_grafico",
  "shorts_yt",
  "video_yt",
  "musica",
  "aula",
] as const;

// Formatos legados: fora do FORMAT_GUIDE (não advertidos), mas ainda aceitos na
// validação pra editar productions antigas sem quebrar. cena_visual ("Vídeo
// Programático") saiu de linha em jul/2026: Films + gerador de vídeo cobrem o caso.
const LEGACY_FORMATS = ["post_linkedin", "post_twitter", "post_threads", "cena_visual"] as const;

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
  ]),

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

  // carrossel standalone (get/update/imagens)
  carouselId: z
    .string()
    .optional()
    .describe(
      "carousels_standalone:_id — get_carousel/update_carousel/carousel_auto_images/carousel_generate_image. Vem de generate_carousel ou list_carousels.",
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
    .describe("contentProductions:_id — get_production/update_production/finalize_production/remove_production/list_versions. Vem de create_production."),
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
      return await convexAction("carouselAutofill:mcpFillCarouselFromArticle", {
        sessionToken,
        sourceId: need(args.sourceId, "sourceId"),
        autoPickImages: args.autoPickImages,
        useSintetico: args.useSintetico,
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

    case "carousel_auto_images":
      // IA escolhe imagens do banco pros slides de foto sem imagem (60 Sinapses).
      // makeVisual dá ritmo a carrossel texto-pesado; generateMissing gera as que
      // o banco não cobriu (custo por imagem). SÍNCRONA e pesada com
      // generateMissing: vale a REGRA DO TIMEOUT.
      return await convexAction("carouselAutofill:mcpCarouselAutoImages", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
        force: args.force,
        makeVisual: args.makeVisual,
        generateMissing: args.generateMissing,
      });

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
