import { z } from "zod";
import { convexQuery, convexMutation, getSessionToken } from "../convexClient.js";

/**
 * sapiens_publicidade — o acervo de publicidade da casa, pela porta do agente.
 *
 * Existe pra resolver um gargalo de curadoria, não pra expor mais um catálogo:
 * achar um comercial bom e precisar de terminal pra guardar significa que o
 * acervo só cresce quando o dono está na máquina. Aqui ele guarda de onde
 * estiver, com o link e uma frase.
 *
 * O acervo tem duas trilhas e as duas ensinam coisas opostas: `referencia` é
 * campanha premiada (o teto do ofício) e `replicavel` é anúncio veiculando
 * agora (o degrau). O membro vê tudo em /dashboard/acervo?tab=referencias.
 *
 * ADMIN-ONLY de ponta a ponta: o Convex recusa quem não é dono em toda action,
 * e a tool some do tools/list de membro. A curadoria é o valor deste acervo, e
 * acervo que qualquer agente alimenta vira lista.
 *
 * O que esta tool NÃO faz: guardar peça de biblioteca de anúncio (Meta,
 * TikTok). Aquelas servem por URL assinada que expira, então o vídeo precisa
 * ser espelhado no CDN da casa antes de virar ficha, e isso é trabalho do
 * script `apps/sapiens/scripts/ingest-ad-references.mjs`, com ffmpeg e
 * browser. Link do YouTube e do Vimeo, que têm embed oficial, entram aqui.
 */

export const publicidadeSchema = z.object({
  action: z.enum(["list", "save", "note"]),
  url: z
    .string()
    .optional()
    .describe(
      "Pra save: link do YouTube ou do Vimeo. Só essas duas, porque têm embed " +
        "oficial que não expira. Peça de Meta Ad Library ou TikTok entra pelo " +
        "script de ingestão da casa, não por aqui.",
    ),
  titulo: z.string().optional().describe("Pra save: o nome da campanha."),
  marca: z.string().optional().describe("Pra save: quem anuncia. Resolve o setor sozinho quando o setor não vem."),
  trilha: z
    .enum(["referencia", "replicavel"])
    .optional()
    .describe(
      "Pra save: 'referencia' (campanha premiada, o teto do ofício) ou " +
        "'replicavel' (anúncio veiculando agora). Default: referencia.",
    ),
  setor: z
    .string()
    .optional()
    .describe(
      "Pra save/list: o setor do catálogo (Alimentação e bebida, IA e software, " +
        "Moda e beleza...). Em save, sem isto o servidor deduz pela marca.",
    ),
  ano: z.number().optional().describe("Pra save: ano da campanha."),
  leitura: z
    .string()
    .optional()
    .describe(
      "Pra save/note: a leitura editorial. O que a peça faz que dá pra roubar, " +
        "onde está o gancho, por que ela segura. É o que o acervo tem e uma " +
        "busca no YouTube não tem.",
    ),
  fonte: z
    .enum(["youtube", "vimeo", "tiktok-library", "tiktok-creative-center", "meta-ad-library"])
    .optional()
    .describe("Pra note: a fonte da peça já guardada (vem do list)."),
  externalId: z.string().optional().describe("Pra note: o id da peça na fonte (vem do list)."),
  limite: z.number().optional().describe("Pra list: teto de fichas (default 60, máx 200)."),
});

export type PublicidadeArgs = z.infer<typeof publicidadeSchema>;

export async function publicidade(args: PublicidadeArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "list") {
    const fichas: any = await convexQuery("adReferences:mcpListar", {
      sessionToken,
      ...(args.trilha ? { trilha: args.trilha } : {}),
      ...(args.setor ? { setor: args.setor } : {}),
      ...(args.limite ? { limite: args.limite } : {}),
    });
    const n = Array.isArray(fichas) ? fichas.length : 0;
    const semLeitura = Array.isArray(fichas) ? fichas.filter((f: any) => !f.temLeitura).length : 0;
    return {
      count: n,
      fichas,
      note:
        n === 0
          ? "Nada nesse recorte ainda."
          : `${semLeitura} sem leitura escrita. A leitura é o que o acervo tem e uma busca no YouTube não tem: action=note fonte=<f> externalId=<id> leitura="...".`,
    };
  }

  if (args.action === "save") {
    if (!args.url) throw new Error("sapiens_publicidade save: exige url.");
    if (!args.titulo) throw new Error("sapiens_publicidade save: exige titulo.");
    const r: any = await convexMutation("adReferences:mcpGuardar", {
      sessionToken,
      url: args.url,
      titulo: args.titulo,
      ...(args.marca ? { marca: args.marca } : {}),
      ...(args.trilha ? { trilha: args.trilha } : {}),
      ...(args.setor ? { setor: args.setor } : {}),
      ...(args.ano ? { ano: args.ano } : {}),
      ...(args.leitura ? { leitura: args.leitura } : {}),
    });
    return {
      ...r,
      note: r?.novo
        ? "Guardada. Aparece pro membro em /dashboard/acervo?tab=referencias."
        : "Já estava no acervo; a ficha foi atualizada em vez de duplicar.",
    };
  }

  if (args.action === "note") {
    if (!args.fonte || !args.externalId) {
      throw new Error("sapiens_publicidade note: exige fonte e externalId (vêm do list).");
    }
    if (!args.leitura) throw new Error("sapiens_publicidade note: exige leitura.");
    return await convexMutation("adReferences:mcpAnotar", {
      sessionToken,
      fonte: args.fonte,
      externalId: args.externalId,
      leitura: args.leitura,
    });
  }

  throw new Error(`sapiens_publicidade: action desconhecida "${args.action}".`);
}
