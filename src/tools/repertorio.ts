import { z } from "zod";
import {
  convexAction,
  convexMutation,
  convexQuery,
  getSessionToken,
} from "../convexClient.js";
import { need } from "../schema.js";

/**
 * Acesso ao Repertório do Sapiens (acervo pessoal de filme/série/anime/jogo/livro/música).
 *
 * Reads (v1.0): list, search, get, popArticles. Sem auth necessária —
 * só vê items públicos (isPublic !== false). (A action `lists` saiu em jul/2026:
 * as listas curadas foram removidas do produto em 2026-06-22, e a query
 * repertorio:listLists não existe mais no backend.)
 *
 * Mutations (v1.1+): add_item, update_item, remove_item. Usam sessionToken
 * e valem pra QUALQUER conta logada (`requireMcpUser`) — cada um mexe no
 * PRÓPRIO acervo. Ownership: tudo vai pro userId da sessão (o user logado).
 * Caller NÃO escolhe pra quem adicionar.
 *
 * add_item é TRAVADO na lista de providers (anti-fabricação): você passa só
 * mediaType + source + externalId vindos de um `resolve` anterior + campos
 * pessoais (status/rating/tags/note/isPublic). O servidor RE-RESOLVE no
 * provider por id e grava o metadado canônico (título/capa/ano). Não dá pra
 * inventar título/capa nem criar entry "manual" à mão — externalId que não
 * resolve é rejeitado. Fluxo: resolve → escolhe candidato → add_item com o
 * source+externalId dele.
 *
 * Action-based design (memoria: consolidar tools via args).
 */

const mediaTypeEnum = z.enum(["movie", "series", "anime", "game", "book", "music", "tool"]);
const statusEnum = z.enum([
  "backlog",
  "active",
  "completed",
  "paused",
  "dropped",
]);
const sourceEnum = z.enum(["tmdb", "anilist", "rawg", "twitch", "googlebooks", "itunes", "manual"]);

export const repertorioSchema = z.object({
  action: z.enum([
    "list",
    "search",
    "get",
    "popArticles",
    "resolve",
    "add_item",
    "update_item",
    "remove_item",
    "search_tools",
    "add_tool",
  ]),
  // Reads
  userId: z
    .string()
    .optional()
    .describe(
      "users:_id (obrigatório pra list/search/lists). Descobre via sapiens_meta action=whoami.",
    ),
  itemId: z
    .string()
    .optional()
    .describe(
      "repertorioItems:_id (obrigatório pra get/update_item/remove_item).",
    ),
  query: z.string().optional().describe("Texto pra action=search."),
  mediaType: mediaTypeEnum.optional(),
  status: statusEnum.optional(),
  limit: z.number().int().positive().max(500).optional().default(100),

  // add_item — só identifica o item; o servidor re-resolve e grava o metadado.
  source: sourceEnum
    .optional()
    .describe(
      "Pra add_item: o source EXATO de um candidato do action=resolve (manual=filme/série via OMDb, anilist, twitch=jogo, googlebooks, itunes). Não invente.",
    ),
  externalId: z
    .string()
    .optional()
    .describe(
      "Pra add_item: o externalId EXATO do candidato do resolve (imdbID p/ manual, id do provider p/ resto). NÃO fabrique/UUID — id que não resolve no provider é rejeitado. Dedup por (userId, source, externalId).",
    ),
  // NOTA: metadado da obra (title/year/posterUrl/genres/...) NÃO é aceito aqui
  // de propósito: o servidor re-resolve no provider e grava o canônico
  // (anti-fabricação). Campos que existiam no schema eram descartados em
  // silêncio e saíram em jul/2026.
  // Ferramenta de IA (Repertório de Ferramentas — catálogo aitag)
  toolId: z
    .string()
    .optional()
    .describe(
      "Pra add_tool: o toolId EXATO de um candidato do action=search_tools (catálogo aitag). Dedup por (userId, source aitag, externalId=toolId).",
    ),
  favorite: z
    .boolean()
    .optional()
    .describe(
      "Pra add_tool: marca a ferramenta como favorita (estrela). Estar no acervo já é 'usei'; favorita é o eixo separado de 'curto/indico'.",
    ),
  rating: z
    .number()
    .nullable()
    .optional()
    .describe("0-10. Pra update_item: passe null pra remover rating."),
  tags: z.array(z.string()).optional(),
  note: z.string().optional().describe("Nota pessoal sobre a obra."),
  containsSpoilers: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

export type RepertorioArgs = z.infer<typeof repertorioSchema>;


export async function repertorio(args: RepertorioArgs): Promise<any> {
  // popArticles: sem auth necessário (lê públicos)
  if (args.action === "popArticles") {
    const articles = await convexQuery(
      "popArticles:listPublishedPopArticles",
      { limit: args.limit },
    );
    return {
      count: Array.isArray(articles) ? articles.length : 0,
      articles: (articles || []).map((a: any) => ({
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        lensTheme: a.lensTheme,
        publishedAt: a.publishedAt,
        url: `/articles/${a.slug}`,
      })),
    };
  }

  // search_tools: busca no catálogo de ferramentas do aitag (aitagTools).
  // Read público (catálogo), sem sessão. Devolve toolId pra usar no add_tool.
  if (args.action === "search_tools") {
    const tools = await convexQuery("aitag/tools:searchTools", {
      query: need(args.query, "query"),
    });
    return {
      count: Array.isArray(tools) ? tools.length : 0,
      tools: (tools || []).map((t: any) => ({
        toolId: t.toolId,
        name: t.name,
        category: t.categoryPt || t.categoryEn || null,
        slug: t.slug ?? null,
        iconUrl: t.iconUrl ?? null,
        aitagUrl: `https://www.aitag.app/tool/${t.toolId}`,
      })),
    };
  }

  // resolve: busca metadado (capa/ano/id) nos providers server-side, com as
  // keys que vivem no env do Convex. Faz a captura por conversa de filme/série/
  // jogo entrar COM capa (anime/livro/música já vêm keyless). Devolve
  // { candidates: [...], providerKeyMissing } pro Claude escolher e gravar via
  // add_item; se providerKeyMissing, cai em manual.
  if (args.action === "resolve") {
    const sessionToken = getSessionToken();
    return await convexAction("repertorioResolve:resolveMedia", {
      sessionToken,
      mediaType: need(args.mediaType, "mediaType"),
      query: need(args.query, "query"),
      limit: 8,
    });
  }

  // Mutations: sempre exigem sessionToken
  if (
    args.action === "add_item" ||
    args.action === "add_tool" ||
    args.action === "update_item" ||
    args.action === "remove_item"
  ) {
    const sessionToken = getSessionToken();

    if (args.action === "add_tool") {
      // Ferramenta de IA: resolve no catálogo aitag por toolId (achado via
      // action=search_tools) e grava como mediaType "tool". Estar no acervo =
      // usei (status completed); favorite liga a estrela.
      return await convexAction("repertorioResolve:addToolItem", {
        sessionToken,
        toolId: need(args.toolId, "toolId"),
        favorite: args.favorite,
        rating: args.rating === null ? undefined : args.rating,
        tags: args.tags,
        note: args.note,
        isPublic: args.isPublic,
      });
    }

    if (args.action === "add_item") {
      // Travado na lista de providers: manda só o identificador (source +
      // externalId de um resolve) + campos pessoais. O servidor re-resolve no
      // provider e grava título/capa/ano canônicos; título/capa do caller são
      // ignorados de propósito (anti-fabricação).
      return await convexAction("repertorioResolve:addResolvedItem", {
        sessionToken,
        mediaType: need(args.mediaType, "mediaType"),
        source: need(args.source, "source"),
        externalId: need(args.externalId, "externalId"),
        status: args.status,
        rating: args.rating === null ? undefined : args.rating,
        tags: args.tags,
        note: args.note,
        isPublic: args.isPublic,
      });
    }

    if (args.action === "update_item") {
      return await convexMutation("mcpExtras:mcpUpdateRepertorioItem", {
        sessionToken,
        itemId: need(args.itemId, "itemId"),
        status: args.status,
        rating: args.rating,
        tags: args.tags,
        note: args.note,
        containsSpoilers: args.containsSpoilers,
        isPublic: args.isPublic,
      });
    }

    if (args.action === "remove_item") {
      return await convexMutation("mcpExtras:mcpRemoveRepertorioItem", {
        sessionToken,
        itemId: need(args.itemId, "itemId"),
      });
    }
  }

  // Reads que exigem userId
  if (!args.userId) {
    throw new Error(
      `action=${args.action} exige userId. Use sapiens_meta action=whoami pra descobrir o user atual.`,
    );
  }

  if (args.action === "get") {
    const item = await convexQuery("repertorio:getById", {
      itemId: need(args.itemId, "itemId"),
    });
    if (!item) return { error: "not found" };
    return slimItem(item);
  }

  // list / search
  const queryArgs: any = { userId: args.userId, limit: args.limit };
  if (args.mediaType) queryArgs.mediaType = args.mediaType;
  if (args.status) queryArgs.status = args.status;
  const items = await convexQuery("repertorio:listByUser", queryArgs);

  let filtered = items || [];
  if (args.action === "search" && args.query?.trim()) {
    const q = args.query.toLowerCase();
    filtered = filtered.filter(
      (it: any) =>
        (it.title || "").toLowerCase().includes(q) ||
        (it.titleOriginal || "").toLowerCase().includes(q) ||
        (it.genres || []).some((g: string) => g.toLowerCase().includes(q)) ||
        (it.tags || []).some((t: string) => t.toLowerCase().includes(q)),
    );
  }

  return {
    count: filtered.length,
    items: filtered.map(slimItem),
  };
}

function slimItem(it: any) {
  return {
    _id: it._id,
    title: it.title,
    titleOriginal: it.titleOriginal,
    year: it.year,
    mediaType: it.mediaType,
    genres: it.genres || [],
    tags: it.tags || [],
    rating: it.rating,
    note: it.note,
    status: it.status,
    posterUrl: it.posterUrl,
    source: it.source,
    externalId: it.externalId,
  };
}
