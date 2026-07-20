import { z } from "zod";
import {
  convexAction,
  convexQuery,
  convexMutation,
  getSessionToken,
} from "../convexClient.js";

/**
 * Brand Sapiens (= Design System). Espelha o Estúdio de Brand do app: um Brand
 * é a FONTE ÚNICA de estilo (paleta, tipografia, voz, estilo de imagem,
 * persona). O conteúdo (Source) diz O QUÊ; o Brand diz o COMO. Depois de criado,
 * o brand aparece em todos os seletores do app (pipeline, /escrever, vitrine) e
 * pode virar o padrão da conta.
 *
 * Sub-actions:
 *   - list:     oficiais (curados) + os custom do user, versão leve (paleta,
 *               tipografia, card). De graça.
 *   - get:      um brand COMPLETO por slug (voz + imageStyle + persona/logo).
 *               Só oficial ou custom do próprio user. De graça.
 *   - generate: cria um design system NOVO a partir de descrição em texto livre
 *               (Gemini monta paleta+tipografia+voz+imageStyle e já nasce com
 *               card premium gpt-image-2). Cobra ~950 Sinapses (texto + card),
 *               reembolsa se falhar. Identidade vem do sessionToken.
 *   - refine:   ajusta um brand custom existente por feedback em texto livre
 *               ("fundo mais escuro", "voz menos professoral"). ~75 Sinapses.
 *   - reroll:   regenera SÓ uma peça (voice | palette | imageStyle) numa direção
 *               diferente, mantendo o resto. De graça (rate-limited).
 *   - card:     (re)gera o card premium (gpt-image-2). Cobra o preço de catálogo
 *               do modelo (gpt-image-2-high default, ou gpt-image-2-low).
 *   - delete:   apaga um brand custom do próprio user (oficiais são intocáveis).
 *   - set_visibility: torna um brand custom do user público/privado (isPublic).
 *               Público = aparece no perfil dele + galeria da comunidade, e
 *               qualquer logado pode adotar. De graça.
 *   - list_public: galeria de design systems PÚBLICOS da comunidade (opt-in pelos
 *               donos), com atribuição. De graça.
 *   - adopt:    clona um brand público (ou oficial) numa cópia NOVA e PRIVADA na
 *               conta do user (vira dono, edita à vontade). A persona é dropada.
 *
 * Auth: qualquer conta logada (sessionToken). As Sinapses saem do dono do token.
 * NÃO mexe em brand custom de terceiro (só lê o estilo público via list_public e
 * clona via adopt); seu custom é privado por dono.
 */

const APP = "https://sapiensinteticos.com";

export const brandSchema = z.object({
  action: z.enum([
    "list",
    "get",
    "generate",
    "refine",
    "reroll",
    "card",
    "delete",
    "set_visibility",
    "list_public",
    "adopt",
  ]),
  slug: z
    .string()
    .optional()
    .describe(
      "Slug do brand. Obrigatório em get/refine/reroll/card/delete/set_visibility/adopt. Pegue via action=list (seus) ou action=list_public (da comunidade).",
    ),
  isPublic: z
    .boolean()
    .optional()
    .describe(
      "Pra action=set_visibility: true publica o brand (aparece no teu perfil + galeria da comunidade, qualquer um pode adotar), false volta a privado.",
    ),
  limit: z
    .number()
    .optional()
    .describe("Pra action=list_public: quantos brands públicos trazer (1-96, default 24)."),
  description: z
    .string()
    .optional()
    .describe(
      "Pra action=generate: descrição em texto livre do brand (o que o projeto/pessoa é, vibe, cores, voz, referências). Mínimo 30 chars; quanto mais rico, melhor o design system. Se o user colou um texto de amostra dele, inclua aqui pra a voz sair dali.",
    ),
  name: z
    .string()
    .optional()
    .describe("Pra action=generate: nome sugerido pro brand (opcional, ≤40 chars). Sem isso o Gemini sugere um."),
  feedback: z
    .string()
    .optional()
    .describe(
      "Pra action=refine: o que ajustar, em texto livre ('escurece o fundo', 'fonte do título mais bruta', 'voz mais seca'). 5..2000 chars.",
    ),
  piece: z
    .enum(["voice", "palette", "imageStyle"])
    .optional()
    .describe("Pra action=reroll: qual peça regenerar numa direção diferente."),
  model: z
    .enum(["gpt-image-2-high", "gpt-image-2-low"])
    .optional()
    .describe("Pra action=card: tier do card premium (default gpt-image-2-high)."),
});

export type BrandArgs = z.infer<typeof brandSchema>;

export async function brand(args: BrandArgs): Promise<any> {
  const sessionToken = getSessionToken();

  // -------- list: oficiais + custom do user (leve, grátis) --------
  if (args.action === "list") {
    const brands: any[] = await convexQuery("brands:mcpListBrands", { sessionToken });
    return {
      count: Array.isArray(brands) ? brands.length : 0,
      brands: (brands || []).map((b) => ({
        slug: b.slug,
        name: b.name,
        tagline: b.tagline ?? null,
        palette: b.palette,
        typography: b.typography ?? null,
        cardUrl: b.card?.url ?? null,
        persona: b.persona?.label ?? null,
      })),
      note:
        "Oficiais (curados) + os seus custom. Pra detalhe completo (voz + estilo " +
        "de imagem): action=get slug=<slug>. Pra criar um novo: action=generate.",
    };
  }

  // -------- get: brand completo por slug (grátis) --------
  if (args.action === "get") {
    if (!args.slug) throw new Error("action=get exige slug (pegue via action=list).");
    const b: any = await convexQuery("brands:mcpGetBrand", {
      sessionToken,
      slug: args.slug.trim(),
    });
    if (!b) {
      throw new Error(
        `Brand "${args.slug}" não encontrado (ou é custom de outro user). Veja os seus em action=list.`,
      );
    }
    return b;
  }

  // -------- generate: cria design system novo (cobra Sinapses) --------
  if (args.action === "generate") {
    const description = (args.description || "").trim();
    if (description.length < 30) {
      throw new Error(
        "action=generate exige description com pelo menos 30 chars (vibe, cores, voz, referências). " +
          "Quanto mais rico, melhor o brand. Converse com o user e monte a descrição antes de chamar.",
      );
    }
    const res: any = await convexAction("customBrandsActions:mcpGenerateBrand", {
      sessionToken,
      description,
      name: args.name?.trim() || undefined,
    });
    return {
      ...res,
      cardNote:
        res.cardTier === "premium"
          ? "Card premium gerado (gpt-image-2)."
          : "Card premium falhou, caiu no pôster SVG (grátis). Pra tentar de novo: action=card slug=" +
            res.slug,
      viewUrl: `${APP}/experimentos/brands`,
      next:
        "Ajustar: action=refine slug=" +
        res.slug +
        " feedback='...'. Regenerar uma peça: action=reroll slug=" +
        res.slug +
        " piece=voice|palette|imageStyle.",
    };
  }

  // -------- refine: ajusta brand custom existente (cobra Sinapses) --------
  if (args.action === "refine") {
    if (!args.slug) throw new Error("action=refine exige slug do brand custom.");
    const feedback = (args.feedback || "").trim();
    if (feedback.length < 5) {
      throw new Error("action=refine exige feedback (ex: 'fundo mais escuro', 'voz mais seca').");
    }
    const res: any = await convexAction("customBrandsActions:mcpRefineBrand", {
      sessionToken,
      slug: args.slug.trim(),
      feedback,
    });
    return {
      ...res,
      viewUrl: `${APP}/experimentos/brands`,
      note: "Brand ajustado. Veja o resultado com action=get slug=" + res.slug,
    };
  }

  // -------- reroll: regenera 1 peça numa direção diferente (grátis) --------
  if (args.action === "reroll") {
    if (!args.slug) throw new Error("action=reroll exige slug do brand custom.");
    if (!args.piece) throw new Error("action=reroll exige piece: voice | palette | imageStyle.");
    const res: any = await convexAction("customBrandsActions:mcpRerollBrandPiece", {
      sessionToken,
      slug: args.slug.trim(),
      piece: args.piece,
    });
    return {
      ...res,
      note:
        "Peça '" +
        args.piece +
        "' regenerada (grátis). Não gostou? Roda de novo. Veja com action=get slug=" +
        res.slug,
    };
  }

  // -------- card: (re)gera o card premium (cobra Sinapses) --------
  if (args.action === "card") {
    if (!args.slug) throw new Error("action=card exige slug do brand custom.");
    const res: any = await convexAction("customBrandsActions:mcpGenerateBrandCard", {
      sessionToken,
      slug: args.slug.trim(),
      model: args.model || undefined,
    });
    return {
      ...res,
      note: `Card premium gerado (${res.cost} Sinapses). URL: ${res.url}`,
    };
  }

  // -------- delete: apaga brand custom do próprio user --------
  if (args.action === "delete") {
    if (!args.slug) throw new Error("action=delete exige slug do brand custom.");
    const res: any = await convexMutation("brands:mcpDeleteBrand", {
      sessionToken,
      slug: args.slug.trim(),
    });
    return {
      ...res,
      note: "Brand apagado. Sources/artigos que apontavam pra ele caem no fallback (sapiens).",
    };
  }

  // -------- set_visibility: torna público/privado um brand custom do user --------
  if (args.action === "set_visibility") {
    if (!args.slug) throw new Error("action=set_visibility exige slug do brand custom.");
    if (typeof args.isPublic !== "boolean") {
      throw new Error("action=set_visibility exige isPublic (true=publica, false=privado).");
    }
    const res: any = await convexMutation("brands:mcpSetBrandVisibility", {
      sessionToken,
      slug: args.slug.trim(),
      isPublic: args.isPublic,
    });
    return {
      ...res,
      note: res.isPublic
        ? "Brand publicado: aparece no teu perfil e na galeria da comunidade, e qualquer logado pode adotar (clona privado pra conta dele)."
        : "Brand voltou a privado: só você vê.",
    };
  }

  // -------- list_public: galeria de design systems públicos da comunidade --------
  if (args.action === "list_public") {
    const brands: any[] = await convexQuery("brands:mcpListPublicBrands", {
      sessionToken,
      limit: args.limit,
    });
    return {
      count: Array.isArray(brands) ? brands.length : 0,
      brands: (brands || []).map((b) => ({
        slug: b.slug,
        name: b.name,
        tagline: b.tagline ?? null,
        palette: b.palette,
        cardUrl: b.card?.url ?? null,
        ownerUsername: b.ownerUsername ?? null,
        ownerName: b.ownerName ?? null,
      })),
      note:
        "Design systems públicos da comunidade. Pra clonar um pra sua conta " +
        "(cópia privada e editável): action=adopt slug=<slug>.",
    };
  }

  // -------- adopt: clona um brand público/oficial pra conta do user --------
  if (args.action === "adopt") {
    if (!args.slug) throw new Error("action=adopt exige slug de um brand público ou oficial (pegue via action=list_public).");
    const res: any = await convexMutation("brands:mcpAdoptBrand", {
      sessionToken,
      slug: args.slug.trim(),
    });
    return {
      ...res,
      viewUrl: `${APP}/experimentos/brands`,
      note:
        "Cópia privada criada na sua conta (slug novo: " +
        res.slug +
        "). Edita à vontade com action=refine, ou gera imagem 'nessa marca'. A persona do original não vem junto.",
    };
  }
}
