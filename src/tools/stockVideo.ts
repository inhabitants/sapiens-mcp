import { z } from "zod";
import { convexQuery } from "../convexClient.js";

/**
 * Banco de clipe/B-roll stock (tabela stockVideo). Catálogo de vídeo curto pronto
 * pra usar: fundo/atmosfera de página, B-roll que a IA escolhe pela cena, e clipe
 * de começo/fim no criar vídeo. Acervo BAIXÁVEL (mp4 direto do Bunny CDN, não
 * stream). Leitura pública, sem auth. Espelha o stock de som.
 *
 * Fluxo típico:
 *   1. action=categories   -> ver os moods/usos disponíveis
 *   2. action=list (mood=.. orientation=.. loopOnly=.. durationMax=..) -> candidatos
 *   3. pega a `url` do escolhido -> usa direto (fundo, B-roll no ffmpeg, start/end)
 */
export const stockVideoSchema = z.object({
  action: z
    .enum(["list", "get", "categories"])
    .describe("list = busca clipes; get = 1 clipe por id; categories = moods/usos."),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Default 20, max 100. Só action=list."),
  categoryId: z
    .string()
    .optional()
    .describe("stockVideoCategories:_id pra filtrar por mood/uso (action=list)."),
  search: z
    .string()
    .optional()
    .describe("Busca em título/mood/tags/descrição (action=list)."),
  mood: z
    .string()
    .optional()
    .describe("Filtra por mood exato (action=list)."),
  orientation: z
    .enum(["vertical", "horizontal", "square"])
    .optional()
    .describe("Filtra por formato: vertical (9:16), horizontal (16:9), square (1:1)."),
  loopOnly: z
    .boolean()
    .optional()
    .describe("true = só clipes loopFriendly (loop limpo, bom pra fundo de página)."),
  durationMax: z
    .number()
    .positive()
    .optional()
    .describe("Duração máxima em segundos (ex: 8 pra fundo curto / clipe de começo)."),
  videoId: z.string().optional().describe("stockVideo:_id (obrigatório pra action=get)."),
});

export type StockVideoArgs = z.infer<typeof stockVideoSchema>;

export async function stockVideo(args: StockVideoArgs): Promise<any> {
  if (args.action === "categories") {
    const cats = await convexQuery("stockVideo:getCategories", {});
    return { count: cats?.length ?? 0, categories: cats ?? [] };
  }

  if (args.action === "get") {
    if (!args.videoId) throw new Error("action=get exige videoId.");
    return await convexQuery("stockVideo:getVideoById", { id: args.videoId });
  }

  // action=list
  return await convexQuery("stockVideo:getVideos", {
    limit: args.limit ?? 20,
    categoryId: args.categoryId,
    search: args.search,
    mood: args.mood,
    orientation: args.orientation,
    loopOnly: args.loopOnly,
    durationMax: args.durationMax,
  });
}
