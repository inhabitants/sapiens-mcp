import { z } from "zod";
import { convexAction, getSessionToken } from "../convexClient.js";

/**
 * Sapiens Shorts — vídeo vertical 9:16 via VEO (v1.5).
 *
 * Sub-action:
 *   - render: dispara render com brief structured + imageId persona pré-existente.
 *
 * Pré-requisitos pro caller:
 *   1. Gerar imagem persona via sapiens_image (ou escolher do gallery via sapiens_gallery)
 *   2. Ter créditos suficientes (custo varia por modelo)
 *   3. Brief montado segundo schema (product/hook/shots/vibe)
 *
 * Estilos:
 *   - ugc: real-life talking-head (mais comum)
 *   - unboxing: close em produto físico
 *   - app-demo: persona + tela
 *   - reflexao: atmosfera mais lenta, contemplativa
 *
 * Retorna `{ success:true, imageId, status:'rendering', url:null }` (ASSÍNCRONO):
 * o render VEO roda fora da chamada. Acompanhe com sapiens_video action=status
 * imageId=<id> até status='completed' (traz a url VEO, expiração curta, baixe
 * logo) ou 'error'/'blocked'.
 */

export const shortsSchema = z.object({
  action: z.enum(["render"]),
  imageId: z.string().describe("generatedImages:_id da persona base. Use sapiens_gallery action=list pra descobrir."),
  styleId: z.enum(["ugc", "unboxing", "app-demo", "reflexao"]),
  brief: z.object({
    product: z.object({
      name: z.string(),
      type: z.enum(["app", "physical", "saas"]),
      uvps: z.array(z.string()).describe("Unique Value Propositions, 2-4 bullets curtos"),
      persona: z.string().describe("Descrição da persona-protagonista (idade/contexto/estilo)"),
    }),
    hook: z.object({
      line: z.string().describe("Frase de abertura punchy, 5-10 palavras"),
      emotion: z.string().describe("Emoção alvo (ex: 'curiosity', 'frustration', 'awe')"),
    }),
    shots: z
      .array(
        z.object({
          sec: z.number().describe("Duração em segundos (cap 8 por shot)"),
          role: z.enum(["hook", "problem", "solution", "cta"]),
          camera: z.enum(["close-up", "medium", "over-shoulder", "product-pov"]),
          action: z.string().describe("Ação visual descrita em 1 frase"),
          emotion: z.string(),
          voiceLine: z.string().optional().describe("Linha falada na cena (PT-BR)"),
          propVisible: z.string().optional(),
        }),
      )
      .min(2)
      .max(6)
      .describe("2-6 shots. Total 15-60s. Geralmente: hook → problem → solution → cta."),
    vibe: z.object({
      energy: z.enum(["calm", "high"]).describe("Energia geral do edit"),
      language: z.enum(["pt-BR", "en"]).optional().describe("Default 'pt-BR'"),
    }),
  }),
  references: z
    .array(
      z.object({
        mimeType: z.string(),
        data: z.string(),
        role: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "References opcionais (start/end frames) em base64. Se omitido, persona é o start frame default.",
    ),
});

export type ShortsArgs = z.infer<typeof shortsSchema>;

export async function shorts(args: ShortsArgs): Promise<any> {
  if (args.action === "render") {
    const sessionToken = getSessionToken();
    if (args.brief.shots.length === 0) {
      throw new Error("brief.shots vazio — passe 2-6 shots descrevendo a sequência.");
    }
    return await convexAction("mcpExtrasActions:mcpShortsRender", {
      sessionToken,
      imageId: args.imageId,
      styleId: args.styleId,
      brief: args.brief,
      references: args.references,
    });
  }
}
