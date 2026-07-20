import { z } from "zod";
import { convexAction, getSessionToken } from "../convexClient.js";

/**
 * Helen Voice — Text-to-Speech via ElevenLabs ou Google Gemini.
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
    .describe("Texto a falar (action=speak). Max 5000 chars."),
  provider: z
    .enum(["elevenlabs", "google"])
    .optional()
    .describe(
      "elevenlabs (melhor natural, mais caro) ou google (Gemini TTS, mais barato). Default elevenlabs.",
    ),
  modelId: z
    .string()
    .optional()
    .describe(
      "ElevenLabs: 'eleven_v3' (default) ou 'eleven_multilingual_v2'. Google: 'gemini-3.1-flash-tts-preview' (default).",
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
  languageCode: z
    .string()
    .optional()
    .describe("ElevenLabs: ex 'pt' pra PT-BR otimizado."),
  stylePreamble: z
    .string()
    .optional()
    .describe(
      "Google: prefixo de instrução de mood ('Read this in a thoughtful tone:'). Não suportado em ElevenLabs.",
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
  outputFormat: z
    .string()
    .optional()
    .describe(
      "ElevenLabs ex 'mp3_44100_128'. Default da provider.",
    ),
  clientApiKey: z
    .string()
    .optional()
    .describe(
      "BYOK: chave do user. Se vazia, usa env default do deploy (ELEVENLABS_API_KEY ou GEMINI_API_KEY).",
    ),
});

export type HelenArgs = z.infer<typeof helenSchema>;

const PRESETS = {
  elevenlabs: {
    note: "ElevenLabs presets. modelId default 'eleven_v3'. Custa ~$0.30 USD pra 500 chars.",
    voices: [
      { voiceId: "pNInz6obpgDQGcFmaJgB", name: "Adam", use: "narração masculina pro/editorial, médio-grave" },
      { voiceId: "EXAVITQu4vr4xnSDxMAC", name: "Sarah", use: "narração feminina, calorosa" },
      { voiceId: "IKne3meq5aSn9XLyUdCD", name: "Charlie", use: "masculina jovem, articulada" },
      { voiceId: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", use: "feminina contemplativa" },
    ],
  },
  google: {
    note: "Google Gemini TTS. modelId 'gemini-3.1-flash-tts-preview'. Custa ~$0.01 USD pra 500 chars (mais barato).",
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
};

export async function helen(args: HelenArgs): Promise<any> {
  if (args.action === "list_presets") {
    return PRESETS;
  }

  if (args.action === "speak") {
    if (!args.text || !args.text.trim()) {
      throw new Error("action=speak exige text (não vazio).");
    }
    const provider = args.provider ?? "elevenlabs";
    const modelId =
      args.modelId ??
      (provider === "elevenlabs"
        ? "eleven_v3"
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
      languageCode: args.languageCode,
      stylePreamble: args.stylePreamble,
      voiceSettings: args.voiceSettings,
      outputFormat: args.outputFormat,
      clientApiKey: args.clientApiKey,
    });
  }
}
