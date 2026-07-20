import { z } from "zod";
import { convexQuery, convexAction, getSessionToken } from "../convexClient.js";

/**
 * Banco de som da casa (tabela stockAudio): trilha pronta E efeito sonoro.
 * Leitura pública (acervo free, sem auth); geração de efeito cobra Sinapses
 * (exige login). Espelha o padrão do stock de imagem.
 *
 * Fluxo típico numa skill de vídeo:
 *   1. action=categories   -> ver os moods/usos disponíveis
 *   2. action=list (mood=.. durationMax=.. | kind=sfx) -> achar candidatas
 *   3. pega a `url` da escolhida -> usa direto no ffmpeg como trilha/efeito
 *
 * Não achou o efeito? action=generate cria um novo (assíncrono):
 *   generate (prompt + durationSeconds + provider) -> generationId
 *   generation-status (generationId) até 'ready' -> audioUrl
 *   O efeito pronto também entra no acervo (action=list kind=sfx).
 */
export const stockAudioSchema = z.object({
  action: z
    .enum(["list", "get", "categories", "generate", "generation-status"])
    .describe(
      "list = busca faixas/efeitos; get = 1 item por id; categories = moods/usos; " +
        "generate = cria efeito sonoro novo (COBRA Sinapses, assíncrono); " +
        "generation-status = status de uma geração (até ready/failed).",
    ),
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
    .describe("stockAudioCategories:_id pra filtrar por mood/uso (action=list)."),
  search: z
    .string()
    .optional()
    .describe("Busca em título/álbum/mood/tags (action=list)."),
  mood: z
    .string()
    .optional()
    .describe("Filtra por mood exato: calmo, intenso, narrativo, épico, sombrio."),
  albumSlug: z
    .string()
    .optional()
    .describe("Filtra por lançamento: pulso-lento, meu-mundo-em-colapso, contos-de-dados, singles."),
  durationMax: z
    .number()
    .positive()
    .optional()
    .describe("Duração máxima em segundos (ex: 120 pra trilha de movie < 2min)."),
  kind: z
    .enum(["music", "sfx", "all"])
    .optional()
    .describe(
      "action=list: 'music' (default, trilhas) | 'sfx' (efeitos sonoros: whoosh, clique, ambiência, foley) | 'all'.",
    ),
  audioId: z.string().optional().describe("stockAudio:_id (obrigatório pra action=get)."),
  // --- action=generate (efeito sonoro novo) ---
  prompt: z
    .string()
    .optional()
    .describe(
      "action=generate: descreve o efeito (ex: 'whoosh curto de transição, grave e limpo'). " +
        "Mín. 4 chars. Efeito é CURTO (1-15s); música/trilha é no sapiens_musicator.",
    ),
  durationSeconds: z
    .number()
    .optional()
    .describe("action=generate: duração alvo em segundos, 1 a 15. Default 5. O custo escala por segundo."),
  provider: z
    .enum(["mirelo", "elevenlabs"])
    .optional()
    .describe(
      "action=generate: 'mirelo' (padrão, 30 Sinapses/s, mín 60) | 'elevenlabs' (premium, 60/s, mín 120).",
    ),
  promptInfluence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "action=generate, só provider='elevenlabs': fidelidade ao texto (0..1). Baixo = mais criativo, alto = segue o prompt à risca. Default 0.3. Ignorado no mirelo.",
    ),
  generationId: z
    .string()
    .optional()
    .describe("action=generation-status: o generationId que o generate devolveu."),
});

export type StockAudioArgs = z.infer<typeof stockAudioSchema>;

export async function stockAudio(args: StockAudioArgs): Promise<any> {
  if (args.action === "categories") {
    const cats = await convexQuery("stockAudio:getCategories", {});
    return { count: cats?.length ?? 0, categories: cats ?? [] };
  }

  if (args.action === "get") {
    if (!args.audioId) throw new Error("action=get exige audioId.");
    return await convexQuery("stockAudio:getAudioById", { id: args.audioId });
  }

  if (args.action === "generate") {
    if (!args.prompt || args.prompt.trim().length < 4) {
      throw new Error("action=generate exige prompt (mín. 4 chars descrevendo o efeito).");
    }
    const sessionToken = getSessionToken();
    return await convexAction("mcpExtrasActions:mcpStockAudioGenerate", {
      sessionToken,
      prompt: args.prompt,
      durationSeconds: args.durationSeconds,
      provider: args.provider,
      promptInfluence: args.promptInfluence,
    });
  }

  if (args.action === "generation-status") {
    if (!args.generationId) {
      throw new Error("action=generation-status exige generationId (o que o generate devolveu).");
    }
    const sessionToken = getSessionToken();
    return await convexQuery("mcpExtras:mcpSfxStatus", {
      sessionToken,
      generationId: args.generationId,
    });
  }

  // action=list
  return await convexQuery("stockAudio:getAudio", {
    limit: args.limit ?? 20,
    categoryId: args.categoryId,
    search: args.search,
    mood: args.mood,
    albumSlug: args.albumSlug,
    durationMax: args.durationMax,
    kind: args.kind,
  });
}
