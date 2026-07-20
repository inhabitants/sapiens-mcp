import { z } from "zod";
import { convexMutation, getSessionToken } from "../convexClient.js";

/**
 * Publish curado pra Coluna Sapiens (quote) e Coluna Repertório (pop-article)
 * via session token. Substitui:
 *   - apps/sapiens/scripts/sapiens-quote-publish.js
 *   - apps/sapiens/scripts/sapiens-pop-article-publish.js
 *
 * Antes esses scripts usavam setAdminAuth (CONVEX_ADMIN_KEY). Agora o MCP
 * publica direto via `mcpExtras.mcpPublishQuote` / `mcpPublishPopArticle`,
 * que valida o sessionToken e exige user admin. Mesma garantia de segurança,
 * setup zero pro user (não precisa mais ter CONVEX_ADMIN_KEY no env).
 *
 * Sub-actions:
 *   - publish_quote: cria entry na Coluna Sapiens. Default status="draft"
 *     (admin revisa em /dashboard/admin/blog/sapiens-curation). publishNow=true
 *     pula direto pra published.
 *   - publish_pop: cria entry na Coluna Repertório (artigo longo com obra
 *     do acervo como lente). column="repertorio", format="pop-article".
 */

const quoteImageRef = z.object({
  url: z.string(),
  alt: z.string(),
  caption: z.string().optional(),
  credit: z.string().optional(),
  license: z.string().optional(),
});

const quotePayload = z.object({
  text: z.string(),
  author: z.string(),
  authorWikidataId: z.string().optional(),
  sourceWork: z.string().optional(),
  sourceUrl: z.string().optional(),
  year: z.number().optional(),
  page: z.string().optional(),
  originalLang: z.string().optional(),
  translation: z.string().optional(),
  translator: z.string().optional(),
  license: z.string().optional(),
  referenceImage: quoteImageRef.optional(),
  flowImage: z
    .object({
      url: z.string(),
      alt: z.string(),
      caption: z.string().optional(),
      prompt: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

const popReferencePayload = z.object({
  featuredItemId: z.string(),
  relatedItemIds: z.array(z.string()).optional(),
  lensTheme: z.string().optional(),
});

const educativeReferencePayload = z.object({
  sourceLessonId: z.string().describe("lessons:_id da aula fonte"),
  sourceCourseSlug: z.string().optional(),
  sourceModuleId: z.string().optional(),
  angle: z.string().optional().describe("fundamento, case, objecao, exemplo…"),
  partNumber: z.number().optional(),
  totalParts: z.number().optional(),
});

export const quotePopSchema = z.object({
  action: z.enum(["publish_quote", "publish_pop", "publish_educativo"]),

  // Comuns
  slug: z.string().describe("kebab-case único"),
  title: z.string(),
  excerpt: z.string().optional(),
  content: z.string().describe("Markdown completo do artigo/comentário."),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Tags. Pra publish_quote, 'sapiens-column' é adicionada automaticamente se faltar.",
    ),
  thumbnailUrl: z.string().optional(),
  generatedBy: z
    .string()
    .optional()
    .describe(
      "Marker do gerador (ex: 'claude-opus-4.7-max:sapiens-quote-skill'). Default genérico se omitido.",
    ),
  publishNow: z
    .boolean()
    .optional()
    .describe(
      "Default false (cria como draft). True publica direto sem passar por curation.",
    ),

  // Quote-specific
  tldr: z.string().optional(),
  category: z.string().optional().describe("Default 'filosofia-tech' pra quote, 'repertorio' pra pop"),
  format: z
    .string()
    .optional()
    .describe(
      "Pra publish_quote: 'short' (200-600 palavras) ou 'essay' (>600). Default 'short'.",
    ),
  readingTimeMinutes: z.number().optional(),
  connectedSlugs: z.array(z.string()).optional(),
  quote: quotePayload
    .optional()
    .describe("Obrigatório pra publish_quote."),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      "Pra publish_quote: se draft com mesmo slug existe (status='draft', column='sapiens'), apaga e recria. Não sobrescreve published.",
    ),

  // Pop-specific
  popReference: popReferencePayload
    .optional()
    .describe("Obrigatório pra publish_pop. featuredItemId vem de sapiens_repertorio."),

  // Educativo-specific
  educativeReference: educativeReferencePayload
    .optional()
    .describe(
      "Obrigatório pra publish_educativo. sourceLessonId vem da query lms:listLessonsForBlogPicker.",
    ),
});

export type QuotePopArgs = z.infer<typeof quotePopSchema>;

export async function quotePop(args: QuotePopArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "publish_quote") {
    if (!args.quote) {
      throw new Error("publish_quote exige campo 'quote' (objeto).");
    }
    const tags = args.tags ?? [];
    const result = await convexMutation("mcpExtras:mcpPublishQuote", {
      sessionToken,
      slug: args.slug,
      title: args.title,
      excerpt: args.excerpt,
      tldr: args.tldr,
      content: args.content,
      category: args.category ?? "filosofia-tech",
      tags,
      format: args.format ?? "short",
      readingTimeMinutes: args.readingTimeMinutes,
      connectedSlugs: args.connectedSlugs,
      quote: args.quote,
      thumbnailUrl: args.thumbnailUrl,
      generatedBy: args.generatedBy ?? "mcp-sapiens:quote",
      overwrite: args.overwrite,
      publishNow: args.publishNow,
    });
    return result;
  }

  if (args.action === "publish_pop") {
    if (!args.popReference) {
      throw new Error(
        "publish_pop exige popReference { featuredItemId, relatedItemIds?, lensTheme? }.",
      );
    }
    const result = await convexMutation("mcpExtras:mcpPublishPopArticle", {
      sessionToken,
      slug: args.slug,
      title: args.title,
      excerpt: args.excerpt,
      content: args.content,
      tags: args.tags,
      thumbnailUrl: args.thumbnailUrl,
      popReference: args.popReference,
      generatedBy: args.generatedBy ?? "mcp-sapiens:pop",
      publishNow: args.publishNow,
    });
    return result;
  }

  if (args.action === "publish_educativo") {
    if (!args.educativeReference) {
      throw new Error(
        "publish_educativo exige educativeReference { sourceLessonId, angle?, partNumber?, totalParts? }.",
      );
    }
    const result = await convexMutation("mcpExtras:mcpPublishEducativo", {
      sessionToken,
      slug: args.slug,
      title: args.title,
      excerpt: args.excerpt,
      tldr: args.tldr,
      content: args.content,
      category: args.category,
      tags: args.tags,
      thumbnailUrl: args.thumbnailUrl,
      readingTimeMinutes: args.readingTimeMinutes,
      educativeReference: args.educativeReference,
      generatedBy: args.generatedBy ?? "mcp-sapiens:educativo",
      publishNow: args.publishNow,
    });
    return result;
  }
}
