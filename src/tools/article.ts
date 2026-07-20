import { z } from "zod";
import { httpUrl, need } from "../schema.js";
import {
  convexAction,
  convexMutation,
  convexQuery,
  getSessionToken,
} from "../convexClient.js";

/**
 * CRUD direto de artigos do blog Sapiens via session token. Substitui o
 * pattern antigo (admin-auth + scripts node). Sub-actions cobrem todo o
 * ciclo de vida de um article publishado:
 *   - get: lê by slug (lê o documento completo pra edit local)
 *   - update: patch nos campos editáveis (title/excerpt/content/tags/etc)
 *   - publish: muda status="published", set publishedAt
 *   - unpublish: volta status="draft" (não apaga)
 *   - delete: apaga (irreversível, sem cleanup de tabelas relacionadas)
 *
 * Cria article novo via sapiens_quote_pop (quote ou pop) ou via
 * sapiens_pipeline action=create_draft_article_and_source (artigo cru do
 * blog que vira source pra fan-out). Este tool é só pra editar/publicar
 * articles que JÁ existem.
 */

export const articleSchema = z.object({
  action: z.enum([
    "get",
    "update",
    "publish",
    "unpublish",
    "delete",
    "ensure_visuals",
  ]),
  slug: z
    .string()
    .optional()
    .describe("Obrigatório pra action=get. Forma kebab-case."),
  articleId: z
    .string()
    .optional()
    .describe(
      "Obrigatório pra update/publish/unpublish/delete/ensure_visuals. Pode descobrir via action=get (o retorno tem _id).",
    ),
  // Campos pra update (todos opcionais)
  title: z.string().optional(),
  excerpt: z.string().optional(),
  tldr: z.string().optional(),
  content: z.string().optional(),
  // Versão EN do artigo (espinha /en). titleEn+contentEn publicados fazem o
  // artigo aparecer em /en/articles/<slug>, no sitemap e no llms.txt.
  titleEn: z.string().optional().describe("update: título em inglês. Com contentEn, publica a versão EN em /en/articles/<slug>."),
  excerptEn: z.string().optional(),
  tldrEn: z.string().optional(),
  contentEn: z.string().optional().describe("update: corpo em inglês (markdown, mesmo formato do content). Transcreation na voz da casa, não tradução literal."),
  seoDescriptionEn: z.string().optional(),
  tags: z.array(z.string()).optional(),
  thumbnailUrl: httpUrl().optional(),
  ogImageUrl: httpUrl()
    .optional()
    .describe(
      "update: JPEG scraper-safe pro preview social (og:image/twitter:image). Ao recapear um artigo, troque junto com thumbnailUrl (webp), senão o card de compartilhamento do WhatsApp/LinkedIn fica com a imagem antiga.",
    ),
  bodyImages: z
    .array(
      z.object({
        url: z.string(),
        alt: z.string(),
        caption: z.string().optional(),
        prompt: z.string().optional(),
        model: z.string().optional(),
        imageId: z.string().optional(),
        generatedAt: z.number().optional(),
      }),
    )
    .optional()
    .describe(
      "update: SUBSTITUI as ilustrações inline do corpo (tabela article_visuals). Passe o array COMPLETO (não faz merge) — todas as imagens que o artigo deve ter, na ordem. O conjunto antigo vai pro histórico (manual_replace). Use pra recapear artigo num novo estilo. url tem que ser host Sapiens (Bunny/Convex).",
    ),
  conceptMap: z
    .object({
      url: z.string(),
      alt: z.string(),
      caption: z.string().optional(),
      prompt: z.string().optional(),
      model: z.string().optional(),
      imageId: z.string().optional(),
      generatedAt: z.number().optional(),
    })
    .optional()
    .describe("update: substitui o mapa visual (conceptMap) do artigo."),
  seoDescription: z.string().optional(),
  readingTimeMinutes: z.number().optional(),
  category: z.string().optional(),
  connectedSlugs: z.array(z.string()).optional(),
  // ensure_visuals: força regeneração de visuais específicos. Default é
  // gerar APENAS o que falta (banner sem thumbnailUrl, inline sem bodyImages,
  // conceptMap sem conceptMap). force* manda regerar mesmo se existe.
  forceBanner: z
    .boolean()
    .optional()
    .describe("ensure_visuals: regera banner mesmo se já existe."),
  forceInline: z
    .boolean()
    .optional()
    .describe("ensure_visuals: regera ilustrações inline mesmo se já existem."),
  forceConceptMap: z
    .boolean()
    .optional()
    .describe("ensure_visuals: regera mapa visual mesmo se já existe."),
  inlineCount: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional()
    .describe(
      "ensure_visuals: quantas ilustrações inline gerar (1-3). Default 1.",
    ),
  // Classifica retroativamente como Educativo (Trilhas → Blog).
  educativeReference: z
    .object({
      sourceLessonId: z.string().describe("lessons:_id"),
      sourceCourseSlug: z.string().optional(),
      sourceModuleId: z.string().optional(),
      angle: z.string().optional(),
      partNumber: z.number().optional(),
      totalParts: z.number().optional(),
    })
    .optional(),
});

export type ArticleArgs = z.infer<typeof articleSchema>;


export async function article(args: ArticleArgs): Promise<any> {
  const sessionToken = getSessionToken();

  switch (args.action) {
    case "get": {
      const slug = need(args.slug, "slug");
      const result = await convexQuery("mcpExtras:mcpGetArticleBySlug", {
        sessionToken,
        slug,
      });
      if (!result) return { found: false, slug };
      // Retorna documento completo (não-slim) — caller usa pra edit local.
      return { found: true, article: result };
    }

    case "update": {
      const articleId = need(args.articleId, "articleId");
      const updated = await convexMutation("mcpExtras:mcpUpdateArticle", {
        sessionToken,
        articleId,
        title: args.title,
        excerpt: args.excerpt,
        tldr: args.tldr,
        content: args.content,
        titleEn: args.titleEn,
        excerptEn: args.excerptEn,
        tldrEn: args.tldrEn,
        contentEn: args.contentEn,
        seoDescriptionEn: args.seoDescriptionEn,
        tags: args.tags,
        thumbnailUrl: args.thumbnailUrl,
        ogImageUrl: args.ogImageUrl,
        bodyImages: args.bodyImages,
        conceptMap: args.conceptMap,
        seoDescription: args.seoDescription,
        readingTimeMinutes: args.readingTimeMinutes,
        category: args.category,
        connectedSlugs: args.connectedSlugs,
        educativeReference: args.educativeReference,
      });
      return { ok: true, article: updated };
    }

    case "publish": {
      const articleId = need(args.articleId, "articleId");
      return await convexMutation("mcpExtras:mcpPublishArticle", {
        sessionToken,
        articleId,
      });
    }

    case "unpublish": {
      const articleId = need(args.articleId, "articleId");
      return await convexMutation("mcpExtras:mcpUnpublishArticle", {
        sessionToken,
        articleId,
      });
    }

    case "delete": {
      const articleId = need(args.articleId, "articleId");
      return await convexMutation("mcpExtras:mcpDeleteArticle", {
        sessionToken,
        articleId,
      });
    }

    case "ensure_visuals": {
      // Gera banner / inline / conceptMap que estiverem faltando.
      // Idempotente: pula o que já existe. Custo: ~1700 sinapses pra
      // artigo novo (450+450+800), só do que regerar pros que existem.
      const articleId = need(args.articleId, "articleId");
      return await convexAction(
        "articleVisuals:ensureArticleVisualsBySession",
        {
          sessionToken,
          articleId,
          forceBanner: args.forceBanner,
          forceInline: args.forceInline,
          forceConceptMap: args.forceConceptMap,
          inlineCount: args.inlineCount,
        },
      );
    }
  }
}
