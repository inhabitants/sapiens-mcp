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
    .enum(["list", "get", "categories", "generate", "generation-status", "scene", "scene-status"])
    .describe(
      "list = busca faixas/efeitos; get = 1 item por id; categories = moods/usos; " +
        "generate = cria efeito sonoro novo (COBRA Sinapses, assíncrono); " +
        "generation-status = status de uma geração (até ready/failed); " +
        "scene = cria uma CENA de áudio completa, voz + trilha + efeito + ambiência num passe só " +
        "(COBRA Sinapses, assíncrono); scene-status = status de uma cena (até ready/failed).",
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
    .describe(
      "Duração alvo em segundos. action=generate: 1 a 15, default 5. action=scene: 3 a 120, default 15. " +
        "O custo escala por segundo nos dois. Na CENA a duração não é parâmetro do modelo, ela sai da " +
        "direção escrita: o alvo entra no pedido como instrução e o preço é acertado pela duração que voltou.",
    ),
  provider: z
    .enum(["mirelo", "elevenlabs"])
    .optional()
    .describe(
      "action=generate: 'mirelo' (padrão, 35 Sinapses/s, mín 70) | 'elevenlabs' (premium, 60/s, mín 120).",
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
  // --- action=scene (cena de áudio completa, Seed Audio 1.0) ---
  scenePrompt: z
    .string()
    .optional()
    .describe(
      "action=scene: a DIREÇÃO da cena inteira, não só a fala. Diga quem fala, com que timbre e " +
        "humor, em que idioma, o que toca atrás e o que se ouve no fundo, e ponha a fala entre aspas. " +
        "Ex: 'Voz masculina adulta, calma e um pouco rouca, em português do Brasil. Estúdio à noite, " +
        "um teclado bem baixo atrás. Ela fala: Sapiens Sintéticos, o Lab onde a sua ideia vira peça " +
        "pronta.' Mín. 10 chars, máx. 2.000. Escreva como quem dirige, não como quem preenche campo: " +
        "o modelo entende cena inteira e é daí que sai a qualidade.",
    ),
  loudnessRate: z
    .number()
    .int()
    .min(-50)
    .max(100)
    .optional()
    .describe("action=scene: volume. -50 = metade, 100 = dobro. Default 0 (natural do modelo)."),
  pitchRate: z
    .number()
    .int()
    .min(-12)
    .max(12)
    .optional()
    .describe("action=scene: tom da voz. Default 0 (natural do modelo)."),
  speechRate: z
    .number()
    .int()
    .min(-50)
    .max(100)
    .optional()
    .describe("action=scene: velocidade da fala. -50 = metade, 100 = dobro. Default 0."),
  withSubtitles: z
    .boolean()
    .optional()
    .describe(
      "action=scene: guarda a legenda com o tempo de cada palavra, pra casar texto com a fala " +
        "sem transcrever depois. Default false.",
    ),
  sceneId: z
    .string()
    .optional()
    .describe("action=scene-status: o sceneId que o scene devolveu."),
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

  if (args.action === "scene") {
    if (!args.scenePrompt || args.scenePrompt.trim().length < 10) {
      throw new Error(
        "action=scene exige scenePrompt (mín. 10 chars dirigindo a cena: quem fala, como, o que se ouve atrás).",
      );
    }
    const sessionToken = getSessionToken();
    return await convexAction("mcpExtrasActions:mcpAudioSceneGenerate", {
      sessionToken,
      scenePrompt: args.scenePrompt,
      durationSeconds: args.durationSeconds,
      loudnessRate: args.loudnessRate,
      pitchRate: args.pitchRate,
      speechRate: args.speechRate,
      withSubtitles: args.withSubtitles,
    });
  }

  if (args.action === "scene-status") {
    if (!args.sceneId) {
      throw new Error("action=scene-status exige sceneId (o que o scene devolveu).");
    }
    const sessionToken = getSessionToken();
    return await convexQuery("mcpExtras:mcpAudioSceneStatus", {
      sessionToken,
      sceneId: args.sceneId,
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
