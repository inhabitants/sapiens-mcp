import { z } from "zod";
import { convexQuery, getSessionToken } from "../convexClient.js";

/**
 * Busca por substring nos artigos do blog Sapiens (v1.2).
 *
 * Não é full-text engine — substring case-insensitive em
 * title/excerpt/tldr/slug/tags. Suficiente pro fluxo "qual era o slug
 * daquele artigo que falei sobre Stallman e modelos abertos?".
 *
 * Filtros opcionais ajudam a estreitar:
 *   - column: "sapiens" / "repertorio" / outra
 *   - format: "short" / "essay" / "pop-article" / etc
 *   - status: "draft" / "published" / "archived"
 *   - tag: tag específica (string match exato em tags[])
 */

export const searchSchema = z.object({
  query: z.string().describe("Substring pra buscar (min 2 chars)."),
  column: z
    .string()
    .optional()
    .describe("Default: todos. 'sapiens' (Coluna) ou 'repertorio' (Coluna Repertório) são os mais usados."),
  format: z
    .string()
    .optional()
    .describe("Ex 'short', 'essay', 'pop-article', 'long'."),
  status: z
    .enum(["draft", "published", "archived"])
    .optional()
    .describe("Default: todos. Use 'published' pra evitar drafts no resultado."),
  tag: z
    .string()
    .optional()
    .describe("Match exato em tags[] do article. Ex: 'foss', 'estoico', 'sapiens-column'."),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Default 30, max 100."),
});

export type SearchArgs = z.infer<typeof searchSchema>;

export async function search(args: SearchArgs): Promise<any> {
  const sessionToken = getSessionToken();
  if (!args.query || args.query.trim().length < 2) {
    return {
      count: 0,
      results: [],
      note: "query muito curta — passe pelo menos 2 chars",
    };
  }
  return await convexQuery("mcpExtras:mcpSearchArticles", {
    sessionToken,
    query: args.query,
    column: args.column,
    format: args.format,
    status: args.status,
    tag: args.tag,
    limit: args.limit,
  });
}
