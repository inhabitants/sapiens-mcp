import { z } from "zod";
import {
  convexAction,
  convexMutation,
  convexQuery,
  getSessionToken,
} from "../convexClient.js";
import { need } from "../schema.js";

/**
 * O CARROSSEL PELO AGENTE, pra qualquer conta logada.
 *
 * Até out/2026 tudo de carrossel no MCP morava dentro da sapiens_pipeline, que
 * é admin e some do tools/list do membro. A vitrine prometia ao membro o que o
 * gate recusava. Esta tool é a porta do membro: opera os carrosséis do PRÓPRIO
 * usuário (posse conferida no servidor, por createdBy), cobra pelo catálogo e
 * estorna o que falhar. As mesmas funções Convex atendem a sapiens_pipeline do
 * admin, então o contrato antigo segue de pé.
 *
 * O que fica de fora de propósito: o carrossel atrelado a uma jogada do
 * Workflow (production), que segue pela sapiens_pipeline. Aqui é o Lab: o
 * carrossel solto, que o membro abre no editor pra ajustar e baixar.
 */

const MODELS = ["feed", "reflexao", "case", "editorial"] as const;

export const carrosselSchema = z.object({
  action: z
    .enum([
      "generate",
      "list",
      "get",
      "update",
      "auto_images",
      "generate_image",
      "set_image",
      "cover",
    ])
    .describe(
      "generate (gera um carrossel do zero a partir de brief OU artigo, 350 Sinapses, estorna se falhar) · list (seus carrosséis) · get (payload inteiro + catálogo de layouts, paletas, folhas e a assinatura, tudo pra você escrever os slides) · update (grava o payload inteiro de volta, normalizado no servidor) · auto_images (a IA escolhe fotos do banco pros slides, 60 Sinapses; generateMissing gera as que faltarem, ~450 cada) · generate_image (foto nova pra UM slide, ~450) · set_image (põe no slide uma peça SUA ou pública, pelo ID citável img_…, sem custo) · cover (a Capa IA: capa 16:9 com o texto queimado, fatiada em duas e posta na frente do carrossel, cobra pelo motor da capa).",
    ),
  // generate
  brief: z
    .string()
    .optional()
    .describe("generate: o tema e o ângulo do carrossel, em um parágrafo. Use brief OU articleId OU userArticleId."),
  articleId: z
    .string()
    .optional()
    .describe("generate: id de um artigo PUBLICADO do blog da casa, usado como fonte (o carrossel fica fiel ao argumento dele)."),
  userArticleId: z
    .string()
    .optional()
    .describe("generate: id de um artigo SEU do perfil (sapiens_write), usado como fonte."),
  model: z
    .enum(MODELS)
    .optional()
    .describe(
      "generate: a FORMA. 'feed' (padrão: 9 slides, abre numa dor, mostra o mecanismo, fecha em ação), 'reflexao' (tema existencial sustentado por uma analogia), 'case' (análise de tendência a partir de link ou manchete, fecha em keyword), 'editorial' (a IA escolhe os layouts livremente, 7 a 9 slides).",
    ),
  aspect: z
    .enum(["4:5", "9:16"])
    .optional()
    .describe("generate: o TAMANHO da folha. '4:5' (padrão, o feed do Instagram mostra inteira) ou '9:16' (tela cheia). Dá pra trocar depois no editor."),
  brandSlug: z
    .string()
    .optional()
    .describe(
      "generate: o brand da peça (slug de sapiens_brand action=list), quando não é o padrão da conta. Veste a cor, a fonte, a voz e a assinatura dele. Sem isso vale o padrão da conta. Brand que a pessoa não pode usar cai no padrão.",
    ),
  useSintetico: z
    .boolean()
    .optional()
    .describe("generate: true = a voz do seu Sintético escreve o texto por cima da voz da sua marca."),
  autoPickImages: z
    .boolean()
    .optional()
    .describe("generate: false = só o texto, sem escolher fotos (default true, incluso no preço)."),
  // por carrossel
  carouselId: z
    .string()
    .optional()
    .describe("O id do carrossel (vem do generate e do list). Obrigatório em get, update, auto_images, generate_image, set_image; opcional no cover (sem ele a capa só é gerada)."),
  payload: z
    .any()
    .optional()
    .describe(
      "update: o payload INTEIRO, no shape do get: { theme: { palette, sheet, signature, brand?, fonts? }, slides: [{ id, templateId, slots, image }], meta }. Preserve image dos slides que você não mexeu e o theme inteiro (folha, assinatura, cor e fonte do brand): o que faltar volta pro padrão. " +
        "Na peça que veste um brand (palette 'brand'), theme.brand traz os tokens de cor (bg, text, accent, kicker em hex) e theme.fonts a tipografia ({ display: família do título, text: família do corpo }, sem fonts = a da casa). Pra trocar a cor de DESTAQUE, ponha o mesmo hex em accent e kicker. " +
        "Carrossel que vem de FORA (outro app, outro editor): case cada slide de lá com um layout do catálogo do get pelo PAPEL (role: capa, corpo, cta), pela foto (requiresImage) e pelos slots, e ponha o texto nos slots daquele layout; o estilo (cor, fonte, logo) vem do brand, não do layout. Layout de fora sem par no catálogo vira o corpo mais próximo, nunca layout inventado. " +
        "Foto NOVA não entra por URL aqui: use set_image (ID da peça) ou generate_image.",
    ),
  title: z.string().optional().describe("update: novo título do carrossel (opcional)."),
  baseUpdatedAt: z
    .number()
    .optional()
    .describe(
      "update: o updatedAt que o get devolveu. Mande sempre: se o carrossel mudou depois do get (uma foto gerada, uma edição no editor), o update recusa em vez de apagar isso com o payload velho. Aí faça get de novo e reaplique.",
    ),
  force: z.boolean().optional().describe("auto_images: true troca também as fotos que já estão nos slides."),
  makeVisual: z
    .boolean()
    .optional()
    .describe("auto_images: true converte slides só de texto em layouts com foto antes de escolher (dá ritmo a carrossel texto-pesado)."),
  generateMissing: z
    .boolean()
    .optional()
    .describe("auto_images: true gera foto nova pros slides que o banco não cobriu (até 4, ~450 Sinapses cada). Avise o custo antes."),
  slideId: z.string().optional().describe("generate_image e set_image: o id do slide (vem do get)."),
  customPrompt: z.string().optional().describe("generate_image: direção da cena (opcional; sem ela a cena sai do texto do slide)."),
  handle: z
    .string()
    .optional()
    .describe("set_image: o ID citável da peça (img_…), que o usuário copia no detalhe dela ou vem de sapiens_reference/sapiens_gallery. Peça sua ou pública."),
  focalX: z.number().min(0).max(1).optional().describe("set_image: ponto focal horizontal (0 a 1, default 0.5)."),
  focalY: z.number().min(0).max(1).optional().describe("set_image: ponto focal vertical (0 a 1, default 0.5)."),
  // cover
  capaHeadline: z.string().optional().describe("cover: a manchete que vai queimada na capa (obrigatória)."),
  capaSubline: z.string().optional().describe("cover: linha de apoio (opcional)."),
  capaRightText: z.string().optional().describe("cover: o texto que cai no 2º slide (opcional)."),
  capaElement: z.string().optional().describe("cover: o elemento vivo que cruza as letras (omita e a IA escolhe pela pauta)."),
  capaVibe: z.string().optional().describe("cover: o cenário (omita e a IA escolhe)."),
  capaImageModel: z
    .string()
    .optional()
    .describe("cover: o motor da capa. Default o que escreve letra pequena legível; veja o preço em sapiens_image action=models."),
});

export type CarrosselArgs = z.infer<typeof carrosselSchema>;

// O payload pode chegar serializado como string JSON (cliente que serializa v.any()).
function coercePayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("update: payload chegou como string que não é JSON. Mande o objeto do get_carousel.");
  }
}

export async function carrossel(args: CarrosselArgs): Promise<any> {
  const sessionToken = getSessionToken();

  switch (args.action) {
    case "generate": {
      const brief = args.brief?.trim();
      const fontes = [brief, args.articleId, args.userArticleId].filter(Boolean).length;
      if (fontes !== 1) {
        throw new Error("generate: passe UMA fonte, brief OU articleId OU userArticleId.");
      }
      const sourceKind = brief ? "brief" : args.articleId ? "published_article" : "user_article";
      // SÍNCRONA e pesada (texto + fotos): vale a REGRA DO TIMEOUT. Se voltar
      // Timeout, confira em action=list antes de repetir.
      return await convexAction("carouselAutofill:mcpCreateCarousel", {
        sessionToken,
        sourceKind,
        ...(brief ? { brief } : {}),
        ...(args.articleId ? { publishedArticleId: args.articleId } : {}),
        ...(args.userArticleId ? { sourceUserArticleId: args.userArticleId } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.aspect ? { aspect: args.aspect } : {}),
        ...(args.brandSlug?.trim() ? { brandSlug: args.brandSlug.trim() } : {}),
        ...(args.useSintetico !== undefined ? { useSintetico: args.useSintetico } : {}),
        ...(args.autoPickImages !== undefined ? { autoPickImages: args.autoPickImages } : {}),
      });
    }

    case "list":
      return await convexQuery("carouselMcp:mcpListCarousels", { sessionToken });

    case "get":
      return await convexQuery("carouselMcp:mcpGetCarousel", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
      });

    case "update":
      return await convexMutation("carouselMcp:mcpUpdateCarousel", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
        payload: coercePayload(need(args.payload, "payload")),
        ...(args.title ? { title: args.title } : {}),
        ...(typeof args.baseUpdatedAt === "number" ? { baseUpdatedAt: args.baseUpdatedAt } : {}),
      });

    case "auto_images":
      return await convexAction("carouselAutofill:mcpCarouselAutoImages", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
        ...(args.force !== undefined ? { force: args.force } : {}),
        ...(args.makeVisual !== undefined ? { makeVisual: args.makeVisual } : {}),
        ...(args.generateMissing !== undefined ? { generateMissing: args.generateMissing } : {}),
      });

    case "generate_image":
      return await convexAction("carouselAutofill:mcpCarouselGenerateImage", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
        slideId: need(args.slideId, "slideId"),
        ...(args.customPrompt ? { customPrompt: args.customPrompt } : {}),
      });

    case "set_image":
      return await convexMutation("carouselMcp:mcpSetSlideImage", {
        sessionToken,
        carouselId: need(args.carouselId, "carouselId"),
        slideId: need(args.slideId, "slideId"),
        handle: need(args.handle, "handle"),
        ...(args.focalX !== undefined ? { focalX: args.focalX } : {}),
        ...(args.focalY !== undefined ? { focalY: args.focalY } : {}),
      });

    case "cover":
      return await convexAction("capaIa:mcpCapaIa", {
        sessionToken,
        headline: need(args.capaHeadline, "capaHeadline"),
        ...(args.capaSubline ? { subline: args.capaSubline } : {}),
        ...(args.capaRightText ? { rightText: args.capaRightText } : {}),
        ...(args.capaElement ? { element: args.capaElement } : {}),
        ...(args.capaVibe ? { vibe: args.capaVibe } : {}),
        ...(args.capaImageModel ? { imageModel: args.capaImageModel } : {}),
        ...(args.carouselId ? { carouselId: args.carouselId } : {}),
      });
  }
}
