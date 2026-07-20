import { z } from "zod";
import { httpUrl } from "../schema.js";
import {
  convexQuery,
  convexMutation,
  convexAction,
  getSessionToken,
} from "../convexClient.js";

/**
 * sapiens_write — artigos self-serve do PRÓPRIO usuário (qualquer conta logada).
 *
 * Diferente de `sapiens_article` (CRUD do blog editorial, owner-only): aqui o
 * usuário escreve no espaço pessoal dele (tabela user_articles, aparece em
 * /u/<username>), gastando as Sinapses dele. Identidade vem do sessionToken.
 *
 * Sub-actions:
 *   - generate: gera 1 artigo na voz Sapiens a partir de um brief livre
 *     (ou reescrevendo um artigo publicado / um texto teu). Cobra 400 Sinapses,
 *     reembolsa se a geração falhar. Salva como rascunho no teu perfil.
 *   - list: lista os teus artigos (rascunhos + publicados).
 *   - get: lê 1 artigo teu por id (corpo completo) pra revisar/editar.
 *   - update: edita title/content/excerpt/tldr do teu artigo.
 *   - publish: publica no teu perfil (publish=true) ou volta pra rascunho (false).
 */
export const writeSchema = z.object({
  action: z.enum(["generate", "list", "get", "update", "publish"]),
  // --- generate ---
  brief: z
    .string()
    .optional()
    .describe(
      "Briefing livre (1 parágrafo, até ~600 palavras). Caminho padrão de 'generate'. A IA expande na voz Sapiens. Custa 400 Sinapses.",
    ),
  sourceKind: z
    .enum(["brief", "published_article", "user_article"])
    .optional()
    .describe(
      "Default 'brief'. 'published_article' reescreve um artigo do blog (passe publishedArticleId); 'user_article' reescreve um texto teu (passe sourceUserArticleId).",
    ),
  publishedArticleId: z
    .string()
    .optional()
    .describe("articles:_id (quando sourceKind='published_article')."),
  sourceUserArticleId: z
    .string()
    .optional()
    .describe("user_articles:_id (quando sourceKind='user_article')."),
  voiceStyle: z
    .string()
    .optional()
    .describe("Preset de tom da voz (opcional)."),
  customVoice: z
    .string()
    .optional()
    .describe("Instrução de voz custom (opcional)."),
  voiceSource: z
    .enum(["sapiens", "minha", "sintetico"])
    .optional()
    .describe(
      "Qual voz molda o texto: 'sapiens' (default, piso da casa) | 'minha' (a tua alma, destilada do teu rastro) | 'sintetico' (a alma do teu Sintético, se tiveres um acordado em Sintonia). Omitido = comportamento igual a 'sapiens'.",
    ),
  repertorioItemIds: z
    .array(z.string())
    .max(5)
    .optional()
    .describe(
      "Até 5 ids de obras do Repertório do usuário (repertorioItems:_id) pra IA usar como lente/referência do texto (sinopse + nota do dono entram no prompt). Ache os ids via sapiens_repertorio (action=list/search). Só do próprio usuário; ids de outros são ignorados.",
    ),
  coverImageId: z
    .string()
    .optional()
    .describe(
      "Capa PRONTA (opcional, só generate): id de uma imagem da TUA galeria (generatedImages:_id, ache via sapiens_gallery/sapiens_reference) que vira a capa do artigo em vez da capa-cortesia gerada do zero. Use quando você JÁ gerou a imagem (sapiens_image) e o artigo é sobre ela — assim a peça não nasce sem capa se a cortesia falhar.",
    ),
  coverImageUrl: httpUrl()
    .optional()
    .describe(
      "Alternativa a coverImageId: URL de imagem do Sapiens (Bunny CDN / Convex) pra usar como capa pronta. Host fora da allowlist é recusado.",
    ),
  // --- list ---
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Default 50. Max 100. Só pra action=list."),
  // --- get / update / publish ---
  articleId: z
    .string()
    .optional()
    .describe("user_articles:_id (obrigatório pra get/update/publish)."),
  // --- update ---
  title: z.string().optional(),
  content: z
    .string()
    .optional()
    .describe("Markdown completo do corpo (substitui o conteúdo)."),
  excerpt: z.string().optional(),
  tldr: z.string().optional(),
  // --- publish ---
  publish: z
    .boolean()
    .optional()
    .describe(
      "action=publish: true publica no teu perfil (/u/<username>), false volta pra rascunho. Default true.",
    ),
});

export type WriteArgs = z.infer<typeof writeSchema>;

export async function write(args: WriteArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "generate") {
    const sourceKind = args.sourceKind ?? "brief";
    if (
      sourceKind === "brief" &&
      (!args.brief || args.brief.trim().length < 20)
    ) {
      throw new Error(
        "Pra gerar a partir de brief, escreve pelo menos 1 parágrafo (>=20 chars).",
      );
    }
    if (sourceKind === "published_article" && !args.publishedArticleId) {
      throw new Error(
        "sourceKind='published_article' exige publishedArticleId.",
      );
    }
    if (sourceKind === "user_article" && !args.sourceUserArticleId) {
      throw new Error("sourceKind='user_article' exige sourceUserArticleId.");
    }
    return await convexAction("userArticlesActions:mcpUserGenerateArticle", {
      sessionToken,
      sourceKind,
      brief: args.brief,
      publishedArticleId: args.publishedArticleId,
      sourceUserArticleId: args.sourceUserArticleId,
      voiceStyle: args.voiceStyle,
      customVoice: args.customVoice,
      voiceSource: args.voiceSource,
      repertorioItemIds: args.repertorioItemIds,
      coverImageId: args.coverImageId,
      coverImageUrl: args.coverImageUrl,
    });
  }

  if (args.action === "list") {
    return await convexQuery("mcpExtras:mcpUserListArticles", {
      sessionToken,
      limit: args.limit ?? 50,
    });
  }

  if (args.action === "get") {
    if (!args.articleId) throw new Error("action=get exige articleId.");
    return await convexQuery("mcpExtras:mcpUserGetArticle", {
      sessionToken,
      articleId: args.articleId,
    });
  }

  if (args.action === "update") {
    if (!args.articleId) throw new Error("action=update exige articleId.");
    return await convexMutation("mcpExtras:mcpUserUpdateArticle", {
      sessionToken,
      articleId: args.articleId,
      title: args.title,
      content: args.content,
      excerpt: args.excerpt,
      tldr: args.tldr,
    });
  }

  if (args.action === "publish") {
    if (!args.articleId) throw new Error("action=publish exige articleId.");
    return await convexMutation("mcpExtras:mcpUserPublishArticle", {
      sessionToken,
      articleId: args.articleId,
      publish: args.publish ?? true,
    });
  }
}
