import { z } from "zod";
import { convexAction, getSessionToken } from "../convexClient.js";

/**
 * Helen Voice — Text-to-Speech via ElevenLabs, Google Gemini ou Fish Audio.
 *
 * Sub-actions:
 *   - speak: sintetiza fala. Retorna audioBase64 + mimeType + sizeBytes.
 *   - list_presets: catálogo de voiceIds/voiceNames recomendados pra cada
 *     provider, com sugestões de uso.
 *
 * Speak retorna áudio inline base64. Pra arquivos grandes (>10s), salve em
 * disco no caller (skill /sapiens:voice faz isso em apps/sapiens/.tmp/).
 */

export const helenSchema = z.object({
  action: z.enum(["speak", "list_presets"]),
  text: z
    .string()
    .optional()
    .describe(
      "Texto a falar (action=speak). Max 5000 chars. Cobra pelo tamanho, igual em todo motor: 500 Sinapses por 1.200 caracteres, mínimo 50.",
    ),
  provider: z
    .enum(["elevenlabs", "google", "fish"])
    .optional()
    .describe(
      "elevenlabs (inglês expressivo), google (Gemini TTS) ou fish (S2.1 Pro, o melhor em japonês e nas línguas asiáticas; ou Drama 3 com modelId='drama-3', a fala dirigida). Os três cobram igual. Default elevenlabs.",
    ),
  modelId: z
    .string()
    .optional()
    .describe(
      "ElevenLabs: 'eleven_v3' (default) ou 'eleven_multilingual_v2'. Google: 'gemini-3.1-flash-tts-preview' (default). Fish: 's2.1-pro-free' (S2.1 Pro, default) ou 'drama-3' (Drama 3: a direção vai no próprio text, '[sussurrando] frase' muda a atuação, '<emphasis>palavra</emphasis>' crava uma palavra; mesmo preço). Id desconhecido no Fish vira S2.1 Pro.",
    ),
  voiceId: z
    .string()
    .optional()
    .describe(
      "ElevenLabs voice_id (obrigatório se provider=elevenlabs). Use list_presets pra ver opções.",
    ),
  googleVoiceName: z
    .string()
    .optional()
    .describe(
      "Google prebuilt voice (default Kore). Use list_presets pra ver opções.",
    ),
  fishReferenceId: z
    .string()
    .optional()
    .describe(
      "Fish: id da voz no acervo do fish.audio. Sem ele vai a voz default do modelo.",
    ),
  language: z
    .enum(["auto", "pt", "en", "ja", "es", "ko", "zh", "fr", "it", "de"])
    .optional()
    .describe(
      "Idioma da fala. Cada motor recebe no dialeto dele; fish e google detectam pelo texto, então lá isto é informativo. Default pt.",
    ),
  languageCode: z
    .string()
    .optional()
    .describe("ElevenLabs: ex 'pt' pra PT-BR otimizado. Vence o `language` quando os dois vêm."),
  stylePreamble: z
    .string()
    .optional()
    .describe(
      "Google: prefixo de instrução de mood ('Read this in a thoughtful tone:'), conta no tamanho cobrado. Não suportado em ElevenLabs.",
    ),
  voiceSettings: z
    .object({
      stability: z.number().min(0).max(1).optional(),
      similarity_boost: z.number().min(0).max(1).optional(),
      style: z.number().min(0).max(1).optional(),
      use_speaker_boost: z.boolean().optional(),
      speed: z.number().optional(),
    })
    .optional()
    .describe(
      "ElevenLabs voice_settings. Default razoável: stability=0.45, similarity_boost=0.75, style=0.30.",
    ),
  store: z
    .boolean()
    .optional()
    .describe(
      "action=speak: a fala gerada entra no acervo da pessoa como faixa privada ('Fala da Helen'), uma vez por texto e voz. false deixa ela fora, pra fala descartável (teste, resposta de bot). A resposta que vem do cache não cria faixa.",
    ),
  outputFormat: z
    .string()
    .optional()
    .describe(
      "ElevenLabs ex 'mp3_44100_128'. Default da provider.",
    ),
  // Fica no schema de propósito, pra RECUSAR: sem o campo, o Zod descartaria a
  // chave calado e a fala sairia cobrando Sinapses de quem achou que pagava com
  // a própria chave. Desde 27/09/2026 a casa não recebe chave de provedor por
  // caminho nenhum (docs/infra/pontes-traga-seu-motor.md).
  clientApiKey: z
    .string()
    .optional()
    .describe(
      "DESLIGADO desde 27/09/2026: a casa não recebe chave de provedor. Não mande: a chamada é recusada sem cobrar. A fala sai sempre em Sinapses.",
    ),
});

export type HelenArgs = z.infer<typeof helenSchema>;

const PRESETS = {
  elevenlabs: {
    note: "ElevenLabs presets. modelId default 'eleven_v3'. Mesmo preço dos outros motores: 500 Sinapses por 1.200 caracteres, mínimo 50.",
    voices: [
      { voiceId: "pNInz6obpgDQGcFmaJgB", name: "Adam", use: "narração masculina pro/editorial, médio-grave" },
      { voiceId: "EXAVITQu4vr4xnSDxMAC", name: "Sarah", use: "narração feminina, calorosa" },
      { voiceId: "IKne3meq5aSn9XLyUdCD", name: "Charlie", use: "masculina jovem, articulada" },
      { voiceId: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", use: "feminina contemplativa" },
    ],
  },
  google: {
    note: "Google Gemini TTS. modelId 'gemini-3.1-flash-tts-preview'. Mesmo preço dos outros motores: 500 Sinapses por 1.200 caracteres, mínimo 50.",
    voices: [
      { voiceName: "Kore", use: "feminina, neutra (default)" },
      { voiceName: "Aoede", use: "feminina, melódica" },
      { voiceName: "Charon", use: "masculina, profunda" },
      { voiceName: "Fenrir", use: "masculina, mais áspera" },
    ],
    stylePreambles: [
      "Read this in a thoughtful, almost-whispered tone:",
      "Read this with skeptical curiosity:",
      "Read this fast, like reciting a manifesto:",
      "Read this slow and contemplative, with pauses:",
    ],
  },
  fish: {
    note: "Fish Audio, dois modelos no mesmo preço, os dois detectam o idioma pelo texto. S2.1 Pro (default, sem modelId) é o motor mais forte da casa em japonês, mandarim e coreano: cena de anime, fala de personagem, narração em ja pedem ele. Drama 3 (modelId='drama-3') é a fala dirigida: a direção vai escrita no text, entre colchetes antes da frase ('[sussurrando, meio sem graça] ...') ou em tag por palavra (<whisper>, <emphasis>, <soft>, <fast>, <slow>, <stress>, <forceful>); a direção não é lida em voz alta. Voz opcional em fishReferenceId; sem ela, a voz default.",
    voices: [
      {
        fishReferenceId: null,
        name: "Voz default do modelo",
        use: "o caminho normal: escreve o texto no idioma que quer e manda",
      },
    ],
  },
};

export async function helen(args: HelenArgs): Promise<any> {
  if (args.action === "list_presets") {
    return PRESETS;
  }

  if (args.action === "speak") {
    if (!args.text || !args.text.trim()) {
      throw new Error("action=speak exige text (não vazio).");
    }
    if (args.clientApiKey?.trim()) {
      throw new Error(
        "A voz com a sua chave saiu: a casa não recebe chave de provedor por caminho nenhum, ela fica na sua máquina. Esta fala não foi feita e nada foi cobrado. Mande de novo sem clientApiKey e ela sai em Sinapses. Se a chave foi colada no chat, gere uma nova no provedor.",
      );
    }
    const provider = args.provider ?? "elevenlabs";
    const modelId =
      args.modelId ??
      (provider === "elevenlabs"
        ? "eleven_v3"
        : provider === "fish"
          // S2.1 Pro. O Drama 3 vem pedido em modelId ('drama-3'); o servidor
          // resolve pela allowlist dele e id desconhecido vira S2.1.
          ? "s2.1-pro-free"
          // 3.1 Flash é o único TTS do Google que gera nas contas free da casa
          // (o 2.5 responde 200 sem áudio nelas e só sai na conta central).
          : "gemini-3.1-flash-tts-preview");

    if (provider === "elevenlabs" && !args.voiceId) {
      throw new Error(
        "provider=elevenlabs exige voiceId. Use action=list_presets pra ver opções.",
      );
    }

    const sessionToken = getSessionToken();
    return await convexAction("mcpExtrasActions:mcpHelenSpeak", {
      sessionToken,
      text: args.text,
      provider,
      modelId,
      voiceId: args.voiceId,
      googleVoiceName: args.googleVoiceName,
      fishReferenceId: args.fishReferenceId,
      language: args.language,
      languageCode: args.languageCode,
      stylePreamble: args.stylePreamble,
      voiceSettings: args.voiceSettings,
      outputFormat: args.outputFormat,
      // Só vai quando veio: servidor de antes do campo recusaria arg desconhecido.
      ...(args.store === false ? { store: false } : {}),
    });
  }
}
