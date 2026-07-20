import { z } from "zod";
import { convexQuery, getSessionToken } from "../convexClient.js";

/**
 * sapiens_atlas — leitura do Atlas Ecossistema IA pelo Claude, TRAVADA na Lente
 * do Ecossistema (equipamento pago). READ-ONLY: serve pra se informar, tirar
 * dúvida e pedir leitura em cima dos dados (mapa de empresas da cadeia de valor
 * da IA, sinais do X dos autores curados, conselho de vozes, briefings
 * semanais). Identidade SEMPRE do sessionToken; quem não tem a Lente (nem é
 * admin) recebe um aviso pra adquirir, sem dado nenhum.
 *
 * Sub-actions:
 *   - overview:  ~52 empresas curadas (market cap, indústria, branding), o mapa.
 *   - signals:   sinais recentes do X (posts dos autores). Filtros opcionais
 *                ticker (ex 'NVDA') ou authorHandle.
 *   - voices:    o Conselho de Vozes — autores ativos + o digest mais recente
 *                de cada um (a destilação do que vêm dizendo).
 *   - briefings: o briefing semanal mais recente (conteúdo completo) + um
 *                histórico resumido dos anteriores.
 *
 * Nenhuma escrita: o Atlas pelo MCP é só pra consultar e raciocinar em cima.
 */

export const atlasSchema = z.object({
  action: z.enum(["overview", "signals", "voices", "briefings"]),
  limit: z
    .number()
    .optional()
    .describe("Pra signals (default 30, máx 100) ou briefings (default 8, máx 52)."),
  ticker: z
    .string()
    .optional()
    .describe("Pra signals: filtra por ticker mencionado (ex 'NVDA', 'TSM')."),
  authorHandle: z
    .string()
    .optional()
    .describe("Pra signals: filtra pelos posts de um autor (@handle sem o @)."),
});

export type AtlasArgs = z.infer<typeof atlasSchema>;

export async function atlas(args: AtlasArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "overview") {
    const companies: any = await convexQuery("atlasMcp:mcpOverview", { sessionToken });
    return {
      count: Array.isArray(companies) ? companies.length : 0,
      companies,
      note: "Mapa do ecossistema (empresas curadas). Pra sinais do X: action=signals. Pra leitura semanal: action=briefings.",
    };
  }

  if (args.action === "signals") {
    const signals: any = await convexQuery("atlasMcp:mcpSignals", {
      sessionToken,
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      ...(args.ticker?.trim() ? { ticker: args.ticker.trim() } : {}),
      ...(args.authorHandle?.trim() ? { authorHandle: args.authorHandle.trim() } : {}),
    });
    return {
      count: Array.isArray(signals) ? signals.length : 0,
      signals,
      note: "Sinais recentes do X. Pra ver as vozes curadas e seus digests: action=voices.",
    };
  }

  if (args.action === "voices") {
    const res: any = await convexQuery("atlasMcp:mcpVoices", { sessionToken });
    return {
      ...res,
      note: "Conselho de Vozes: authors (curados ativos) + digests (destilação mais recente por voz).",
    };
  }

  if (args.action === "briefings") {
    const res: any = await convexQuery("atlasMcp:mcpBriefings", {
      sessionToken,
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    });
    return {
      ...res,
      note: "latest = briefing semanal mais recente (completo); recent = resumo dos anteriores.",
    };
  }
}
