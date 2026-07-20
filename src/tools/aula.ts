import { z } from "zod";
import { convexMutation, convexQuery, getSessionToken } from "../convexClient.js";
import { need } from "../schema.js";

/**
 * sapiens_aula — CRUD do deck de aula (Mentoria OPS) via session token.
 * ADMIN-ONLY (requireMcpAdmin no Convex): aula é conteúdo de mentor, não de
 * aluno. Substitui o script migrate-aulas-to-convex.mjs: o Claude gera o deck
 * e publica direto no Convex, fonte de verdade que o /aulas/<slug> lê.
 *
 * Sub-actions:
 *   - list: lista as aulas (slug/título/data/slideCount/voiceWarnings/url)
 *   - get: lê 1 aula completa por slug (pra editar local)
 *   - upsert: cria ou atualiza por slug (insere se não existe, senão patch)
 */

export const aulaSchema = z.object({
  action: z.enum(["list", "get", "upsert"]),
  slug: z
    .string()
    .optional()
    .describe(
      "kebab-case (a-z, 0-9, hífen), ex: 2026-06-25-minha-aula. Obrigatório pra get e upsert.",
    ),
  aula: z
    .any()
    .optional()
    .describe(
      "Objeto completo da aula (obrigatório pra upsert). Campos top-level: title (obrig), subtitle?, data? (YYYY-MM-DD), duration?, tag?, mentorAgenda?, slides[] (≥1). Cada slide é { type, ...campos }. Tipos: cover (eyebrow/title/subtitle/meta), cover-image/section-image/content-image (imageUrl + campos), agenda (items:[{num,title,subtitle,time}]), content (eyebrow/title/body[markdown ou HTML]/list[]/listType), two-col (cols:[{h,body}]), quote (text/attribution), callout (tone:tip|warn|note/tag/body), comic (panels:[{imageUrl,caption}]), pause, close (eyebrow/title/items[]). Voz Sapiens: 1ª pessoa, anti-corporate, SEM travessão (—). O servidor re-linta a voz e grava voiceWarnings.",
    ),
});

export type AulaArgs = z.infer<typeof aulaSchema>;


export async function aula(args: AulaArgs): Promise<any> {
  const sessionToken = getSessionToken();

  switch (args.action) {
    case "list":
      return await convexQuery("mcpExtras:mcpListAulas", { sessionToken });

    case "get": {
      const slug = need(args.slug, "slug");
      const found = await convexQuery("mcpExtras:mcpGetAula", {
        sessionToken,
        slug,
      });
      return found ? { found: true, aula: found } : { found: false, slug };
    }

    case "upsert": {
      const slug = need(args.slug, "slug");
      const raw = need(args.aula, "aula");
      // `aula` é z.any(): sem tipo declarado, o cliente costuma serializar o
      // objeto como string JSON. Normaliza aqui pra mandar objeto sempre (o
      // servidor também parseia string, mas o shape certo sai daqui).
      let aulaObj = raw;
      if (typeof aulaObj === "string") {
        try {
          aulaObj = JSON.parse(aulaObj);
        } catch {
          throw new Error(
            'Arg "aula" veio como string mas não é JSON válido. Mande o objeto da aula.',
          );
        }
      }
      return await convexMutation("mcpExtras:mcpUpsertAula", {
        sessionToken,
        slug,
        aula: aulaObj,
      });
    }
  }
}
