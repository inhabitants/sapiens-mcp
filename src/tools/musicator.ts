import { z } from "zod";
import { convexAction, convexQuery, getSessionToken } from "../convexClient.js";

/**
 * Musicator — loop completo de música via MCP (v2.1).
 *
 * Sub-actions:
 *   - create:  cria brief + track draft num passo, devolve trackId (custo 0).
 *   - lyrics:  gera letra (voz Sapiens) + stylePrompt EN. Se passar trackId,
 *              GRAVA na track (status=lyrics_ready) pronta pra render; sem
 *              trackId, só devolve o texto inline (300 sinapses).
 *   - list:    lista as tracks do próprio user (id, título, status, áudio).
 *   - get:     detalhe de uma track (status/áudio/letra) — pra acompanhar render.
 *   - render:  schedula o synth numa track pronta. Motor em `model` (Lyria 3.5
 *              default, Lyria 3 Clip, Mureka 9.5, MiniMax Music 2.6, ElevenLabs
 *              Music). 3000 sinapses; ElevenLabs cobra pela duração.
 *   - publish: publica uma faixa PRONTA do user no Acervo da Comunidade (aba
 *              Músicas) + eco no Chat e Fórum. CURADO: só admin (dono). Custo 0.
 *   - list_public: lê o Acervo público de músicas da Comunidade (sem custo, sem
 *              login). Faixas publicadas por todo mundo.
 *
 * Fluxo cheio sem UI: create → lyrics(trackId) → render → get (poll status) →
 * publish (dono).
 */

export const musicatorSchema = z.object({
  action: z.enum(["lyrics", "render", "create", "list", "get", "publish", "list_public"]),

  // create / lyrics args
  title: z.string().optional().describe("Título da faixa (create/lyrics). Vai no brief/metadata. Mín 3 chars."),
  context: z
    .string()
    .optional()
    .describe("Tema/argumento (create exige ≥20 chars; lyrics ≥10). 1-2 frases com ângulo/provocação."),
  direction: z
    .string()
    .optional()
    .describe(
      "Gênero/mood (ex: 'synthwave melancólico 1980s', 'lo-fi hip-hop 80 BPM', 'acoustic indie folk'). Default 'livre'.",
    ),
  language: z
    .string()
    .optional()
    .describe("Default 'pt-BR'. Pode ser 'en', 'es', etc."),

  // trackId: obrigatório p/ render e get; opcional p/ lyrics (grava na track).
  trackId: z
    .string()
    .optional()
    .describe(
      "musicator_tracks:_id. Obrigatório p/ action=render e action=get. Em action=lyrics, opcional: se passado, grava a letra na track (status=lyrics_ready).",
    ),

  // list / list_public args
  limit: z
    .number()
    .optional()
    .describe("action=list: quantas tracks trazer (1-50, default 20). action=list_public: faixas do Acervo (1-48, default 18)."),
  page: z
    .number()
    .optional()
    .describe("action=list_public: página do Acervo público (0-based, default 0)."),

  // publish args
  toChat: z
    .boolean()
    .optional()
    .describe("action=publish: ecoar no Chat da comunidade (card tocável). Default true."),
  toForum: z
    .boolean()
    .optional()
    .describe("action=publish: ecoar no Fórum como tese-raiz. Default true."),

  // render args
  stylePromptOverride: z
    .string()
    .optional()
    .describe("Pra action=render: sobrescreve stylePrompt antes do render (não muda track persistido)."),
  negativePrompt: z
    .string()
    .optional()
    .describe("Pra action=render: negative prompt do synth (provider-dependent)."),
  seed: z
    .number()
    .optional()
    .describe("Pra action=render: seed pra reprodutibilidade do synth."),
  model: z
    .enum(["pro", "clip", "mureka", "minimax", "elevenlabs"])
    .optional()
    .describe(
      "Pra action=render: motor da faixa. 'pro' = Lyria 3.5 (default, faixa inteira até 3 min, lê imagem de referência). " +
        "'clip' = Lyria 3 Clip (rascunho de 30s). 'mureka' = Mureka 9.5 (faixa inteira, letra até 5.000 caracteres). " +
        "'minimax' = MiniMax Music 2.6 (faixa inteira até 5 min, letra de 10 a 3.000 caracteres). " +
        "'elevenlabs' = ElevenLabs Music (duração escolhida em durationSeconds, letra até 3.500 caracteres). " +
        "Preço: o mesmo render fixo em todos, menos 'elevenlabs', que cobra pela duração (tabela na skill 'musica'; confirme com a pessoa antes). " +
        "Só o Lyria lê imagem de referência; negativePrompt e seed são ignorados nos motores de fora do Lyria.",
    ),
  durationSeconds: z
    .number()
    .optional()
    .describe(
      "Pra action=render com model='elevenlabs': duração da faixa em segundos, uma de 30, 60, 120 ou 180 (default 120). Ignorado nos outros motores.",
    ),
});

export type MusicatorArgs = z.infer<typeof musicatorSchema>;

export async function musicator(args: MusicatorArgs): Promise<any> {
  // list_public é o Acervo público de músicas da Comunidade (sem custo, sem
  // login): resolve ANTES de exigir sessão. Sem isto, getSessionToken() lança
  // pra quem não está logado e mata o caminho público (mesmo bug do meta.start).
  if (args.action === "list_public") {
    return await convexQuery("musicator:listPublicTracks", {
      page: args.page,
      limit: args.limit,
    });
  }

  const sessionToken = getSessionToken();

  if (args.action === "create") {
    if (!args.title || !args.context) {
      throw new Error("action=create exige title + context (context ≥20 chars).");
    }
    if (args.context.length < 20) {
      throw new Error("context muito curto (mínimo 20 chars pra criar a faixa).");
    }
    return await convexAction("mcpExtrasActions:mcpMusicatorCreate", {
      sessionToken,
      title: args.title,
      context: args.context,
      direction: args.direction,
      language: args.language ?? "pt-BR",
    });
  }

  if (args.action === "lyrics") {
    if (!args.title || !args.context) {
      throw new Error("action=lyrics exige title + context.");
    }
    if (args.context.length < 10) {
      throw new Error("context muito curto (mínimo 10 chars).");
    }
    return await convexAction("mcpExtrasActions:mcpMusicatorLyrics", {
      sessionToken,
      title: args.title,
      context: args.context,
      direction: args.direction,
      language: args.language ?? "pt-BR",
      trackId: args.trackId,
    });
  }

  if (args.action === "list") {
    return await convexAction("mcpExtrasActions:mcpMusicatorList", {
      sessionToken,
      limit: args.limit,
    });
  }

  if (args.action === "get") {
    if (!args.trackId) {
      throw new Error("action=get exige trackId.");
    }
    return await convexAction("mcpExtrasActions:mcpMusicatorGet", {
      sessionToken,
      trackId: args.trackId,
    });
  }

  if (args.action === "render") {
    if (!args.trackId) {
      throw new Error(
        "action=render exige trackId. Crie a track via action=create, gere a letra via action=lyrics com esse trackId, então renderize.",
      );
    }
    return await convexAction("mcpExtrasActions:mcpMusicatorRender", {
      sessionToken,
      trackId: args.trackId,
      stylePromptOverride: args.stylePromptOverride,
      negativePrompt: args.negativePrompt,
      seed: args.seed,
      // Só vão quando escolhidos: servidor anterior a 11/out/2026 não conhece os
      // dois args e recusaria o pedido inteiro.
      ...(args.model ? { model: args.model } : {}),
      ...(args.model === "elevenlabs" && args.durationSeconds !== undefined
        ? { durationSeconds: args.durationSeconds }
        : {}),
    });
  }

  if (args.action === "publish") {
    if (!args.trackId) {
      throw new Error(
        "action=publish exige trackId de uma faixa pronta (status=ready, com áudio). Publicar no Acervo é curado: só o dono (admin).",
      );
    }
    return await convexAction("mcpExtrasActions:mcpMusicatorPublish", {
      sessionToken,
      trackId: args.trackId,
      toChat: args.toChat,
      toForum: args.toForum,
    });
  }

}
