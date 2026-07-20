import { z } from "zod";
import { httpUrl } from "../schema.js";
import { convexAction, convexQuery, getSessionToken } from "../convexClient.js";

// IDs canônicos do catálogo (apps/sapiens/convex/shared/imageModels.ts).
// IDs fora dessa lista caem no fallback e o pricing vira 999. Sempre usar os
// IDs canônicos.
const MODELS = [
  "nano-banana-max", // gemini-3-pro-image-preview · 450 + adder
  "nano-banana-2", // gemini-3.1-flash-image-preview (V2, Flash 3.1) · 450 + adder · COM refs · DEFAULT
  "nova-canvas", // Amazon Nova Canvas (AWS Bedrock). Corp/censurado, txt2img · 250
  "gpt-image-2-low", // Azure gpt-image-2 quality=low · 250
  "gpt-image-2-high", // Azure gpt-image-2 quality=high · 800
  // xAI Grok Imagine. Moderação frouxa (+18), aceita refs (img2img) + aspect.
  "grok-2-image", // grok-imagine-image · 450 + adder 2K · COM refs
  "grok-2-image-quality", // grok-imagine-image-quality, mais fiel pra character lock · 900 + adder 2K · COM refs
  // Degen (uncensored, gate +18 na galeria). WaveSpeed = rápido (6-25s):
  "wavespeed-chroma", // Chroma uncensored fotorrealista · 600
  "wavespeed-flux2", // Flux.2 Klein 9B · 600
  "wavespeed-flux-nsfw", // Flux dev + LoRA NSFW (AIDMA) · 600 · Ousadia regulável
  "wavespeed-klein-anime", // Flux.2 Klein + LoRA anime (inteligente + controlável) · 600
  "wavespeed-klein-anime-plus", // Klein Anime + SNOFS uncensored (+18) · 600 · Ousadia regulável
  // Civitai (sdcpp, rápido). Família FLUX no Civitai saiu: lenta demais (>5min,
  // estoura o poll). Pra flux uncensored use wavespeed-flux-nsfw.
  "civitai-wai-illustrious", // anime Illustrious · 400
  "civitai-nova-anime-xl", // anime Illustrious · 400
  "civitai-pony-v6", // Pony Diffusion V6 XL, a base nº1 do Civitai · 400
  // fal.ai (Krea-2 Turbo 12B + LoRA de realismo, ~4s). Grupo Degen (+18, checker
  // off). SEM referência: o endpoint krea-2/turbo/lora é text-to-image puro.
  "fal-krea2-realism", // Krea-2 + LoRA realismo (gokaygokay) · 600 · txt2img
  "fal-krea2-realism-v2", // Krea-2 + LoRA realismo alt (RudySen), pro A/B · 600 · txt2img
] as const;

export const imageSchema = z.object({
  action: z.enum(["generate", "request_generation", "compose", "models"]),
  prompt: z
    .string()
    .optional()
    .describe(
      "Prompt da imagem (obrigatório em generate/request_generation). Full-bleed, sujeito oversized.",
    ),
  model: z
    .enum(MODELS)
    .optional()
    .describe(
      "Default 'nano-banana-2' (Flash 3.1 com refs). 'nano-banana-max' (Pro 3) = qualidade alta. 'gpt-image-2-low/high' = Azure. 'grok-2-image'/'grok-2-image-quality' = xAI Grok Imagine (moderação frouxa +18, aceita refs e aspect; quality é mais fiel pra character lock). DEGEN (uncensored, gate +18): 'wavespeed-chroma' (fotorrealista rápido), 'wavespeed-flux2' (Flux.2 Klein), 'wavespeed-flux-nsfw' (flux+LoRA NSFW, Ousadia regulável via loraIntensity), 'wavespeed-klein-anime' (Flux.2 Klein + LoRA anime, inteligente+controlável), 'wavespeed-klein-anime-plus' (Klein anime +18, Ousadia regulável) = WaveSpeed rápido; 'civitai-wai-illustrious'/'civitai-nova-anime-xl' (anime), 'civitai-pony-v6' (Pony V6 XL, base nº1) = Civitai sdcpp rápido. 'fal-krea2-realism'/'fal-krea2-realism-v2' (Krea-2 Turbo 12B + LoRA de realismo, fal.ai, ~4s, fotorrealismo forte) = SÓ txt2img (não aceita referência).",
    ),
  aspectRatio: z
    .enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"])
    .optional()
    .describe("Default '1:1'. 9:16 = vertical pra story/short, 16:9 = landscape."),
  size: z
    .enum(["1K", "2K", "4K"])
    .optional()
    .describe(
      "Default '1K'. Adder de resolução só nos modelos com hasResolutionAdder: nano-banana-max e nano-banana-2 aceitam 2K (+100) e 4K (+300); grok-2-image e grok-2-image-quality aceitam só 2K (+100), sem 4K. Nos demais modelos o size é ignorado (fica em 1K).",
    ),
  styleId: z
    .string()
    .optional()
    .describe("Default 'none'. IDs de estilo no convex/shared/imageStyles.ts."),
  negativePrompt: z.string().optional(),
  referenceImageUrls: z
    .array(httpUrl())
    .optional()
    .describe(
      "Até 4 URLs públicas de referência pra combinar numa geração só (character/style lock), igual ao modal 'Selecionar Referência' do gerador web. Fontes: sua galeria (sapiens_gallery, campo url), o Acervo, e personagens públicos (sapiens_character action=list_public → mainImageUrl/imageUrls). Restrito a hosts do Sapiens (Bunny CDN / Convex) + Wikimedia. Requer model com refs: nano-banana-2, gpt-image-2-* ou grok-2-image*. Soma com sourceImageIds (teto total de 4).",
    ),
  sourceImageIds: z
    .array(z.string())
    .optional()
    .describe(
      "Até 4 IDs de imagens da SUA galeria (`generatedImages:_id` via sapiens_gallery) usadas como referência. Alternativa por-id ao referenceImageUrls pras suas próprias imagens (ownership checado). Soma com referenceImageUrls (teto total de 4).",
    ),
  brandSlug: z
    .string()
    .optional()
    .describe(
      "Slug do brand (design system) pra aplicar estilo visual. Fonte única: tabela `brands` (ex: 'sapiens', 'solarpunk', 'editorial-duotone', 'brutalista-mono'). Default: nenhum (prompt cru). Vale em action=generate (mode=create) e request_generation.",
    ),
  brandMark: z
    .enum(["persona", "logo", "none"])
    .optional()
    .describe(
      "Marca na imagem do brand: 'persona' (personagem do brand via character sheets, ex: Helen), 'logo' (carimba a logo no canto), 'none' (só o estilo). Default 'none'. Só aplica se brandSlug setado e o brand oferecer a marca.",
    ),
  templateSlug: z
    .string()
    .optional()
    .describe(
      "Slug de um template de imagem (super-prompt travado da casa). Quando setado, o `prompt` vira só a CENA (quem + pose + objeto-conceito) e o template embrulha com o estilo + fundo + enquadramento + ref de traço da casa. Ex: 'retrato-sapiens-v1' = retrato editorial cartoon de UM personagem no grid verde Sapiens (mesma 'mão' dos artigos). O template define model/aspect/size default (sobreponíveis) e injeta a ref da Helen como âncora de traço quando você não passa referenceImageUrls própria (passar refs = trocar quem aparece, mantendo o estilo). Mutuamente exclusivo com brandSlug. Vale em action=generate, mode=create.",
    ),
  useStudio: z
    .boolean()
    .optional()
    .describe(
      "Quando true, gera SEGUINDO o studio do user (o 'Meu Studio', ÚNICO, resolvido pela sessão — você NÃO passa id): marca + personagem-operador + a vibe + os presets do bloco de imagem entram sozinhos (o explícito sempre vence). O retorno traz studioApplied: true se aplicou o studio, false se caiu no Sapiens base (sem studio montado — aí avise o user). É o 'criar no meu studio' do Nível 2, e gerar assim faz o studio evoluir. SEM useStudio = geração base, fora da identidade dele: não misture. Cheque o studio com sapiens_studios action=mine. Vale em action=generate.",
    ),
  influencerId: z
    .string()
    .optional()
    .describe(
      "ID de personagem (influencer) pra character-lock. Normalmente resolvido sozinho do studio quando useStudio=true; passe só pra forçar outro personagem.",
    ),
  loraIntensity: z
    .enum(["suave", "medio", "forte"])
    .optional()
    .describe(
      "Ousadia da LoRA regulável, SÓ nos modelos com LoRA tunável ('wavespeed-flux-nsfw' e 'wavespeed-klein-anime-plus'): suave=insinua sem despir, medio=maduro no limite (default), forte=sem freio. Ideal pra remixar personagem (ex: a Helen) preservando a identidade e regulando a liberdade. Ignorado nos demais modelos.",
    ),
  mode: z
    .enum(["create", "edit", "variation"])
    .optional()
    .describe(
      "Default 'create' (gera do zero). 'edit' aplica prompt como mudança sobre sourceImageId. 'variation' gera similar mantendo estilo. Edit/variation exigem sourceImageId e enviam a imagem como referência inline pro modelo.",
    ),
  sourceImageId: z
    .string()
    .optional()
    .describe(
      "ID de imagem do gallery do próprio user (`generatedImages:_id`). Obrigatório pra mode=edit ou mode=variation. Use sapiens_gallery action=list pra descobrir IDs.",
    ),
  // v1.8 — compose frame (persona + screen via Gemini)
  personaBase64: z
    .string()
    .optional()
    .describe("Pra action=compose: base64 da imagem persona (start ref). 1 dos {personaBase64, screenImage*} obrigatório."),
  personaMimeType: z.string().optional(),
  screenImageBase64: z
    .string()
    .optional()
    .describe("Pra action=compose: base64 da tela. Alt: screenImageUrl."),
  screenImageMimeType: z.string().optional(),
  screenImageUrl: httpUrl()
    .optional()
    .describe("Pra action=compose: URL da tela (Bunny CDN). Convex baixa server-side."),
  instruction: z
    .string()
    .optional()
    .describe(
      "Pra action=compose: instrução em EN pro Gemini. Ex: 'Compose a vertical 9:16 photo: persona holding a smartphone facing the camera, the phone screen displaying the provided second image (clearly visible, sharp). Mobile photography aesthetic.'",
    ),
});

export type ImageArgs = z.infer<typeof imageSchema>;

export async function image(args: ImageArgs): Promise<any> {
  // models: catálogo VIVO dos modelos de imagem (ativos + preço atual com
  // override admin do systemConfig). READ-ONLY, sem custo e sem login — resolve o
  // drift da lista hardcoded: o operador descobre modelo/preço/capacidade em vez
  // de confiar no enum congelado. Antes de exigir sessão de propósito.
  if (args.action === "models") {
    const all: any[] = await convexQuery("imageModels:listWithOverrides", {});
    const models = (all ?? [])
      .filter((m) => m?.isActive)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((m) => ({
        id: m.id,
        label: m.label,
        priceSinapses: m.effectivePriceSinapses,
        maxResolution: m.maxResolution ?? "4K",
        resolutionAdders: m.resolutionAdders,
        supportsReferences: !!m.supportsReferences,
        degen: /^(civitai-|wavespeed-|fal-)/.test(String(m.id)),
        note: m.description ?? null,
      }));
    return {
      count: models.length,
      default: "nano-banana-2",
      models,
      note: "priceSinapses é o base (1K); 2K/4K somam resolutionAdders quando o modelo tem teto pra isso. degen=+18 (gate na galeria). O preço já inclui override admin.",
    };
  }

  const sessionToken = getSessionToken();

  // v1.8: compose tem args próprios, validação separada
  if (args.action === "compose") {
    if (!args.instruction || args.instruction.trim().length < 5) {
      throw new Error("action=compose exige 'instruction' (mínimo 5 chars).");
    }
    if (!args.personaBase64 && !args.screenImageBase64 && !args.screenImageUrl) {
      throw new Error("compose exige pelo menos um de: personaBase64, screenImageBase64, screenImageUrl.");
    }
    return await convexAction("mcpExtrasActions:mcpComposeFrame", {
      sessionToken,
      personaBase64: args.personaBase64,
      personaMimeType: args.personaMimeType,
      screenImageBase64: args.screenImageBase64,
      screenImageMimeType: args.screenImageMimeType,
      screenImageUrl: args.screenImageUrl,
      instruction: args.instruction,
    });
  }

  if (!args.prompt || args.prompt.trim().length < 5) {
    throw new Error("Faltando 'prompt' (mínimo 5 chars).");
  }

  // v1.7: request_generation cria row pendente em generatedImages e debita
  // créditos. Necessário antes de chamar sapiens_shorts/sapiens_video (que
  // exigem imageId pré-existente). Pra modelos de imagem (nano-banana-*,
  // gpt-image-2-*), prefira action="generate" que já faz tudo num call.
  if (args.action === "request_generation") {
    return await import("../convexClient.js").then(({ convexMutation }) =>
      convexMutation("mcpExtras:mcpRequestGeneration", {
        sessionToken,
        model: args.model ?? "nano-banana-2",
        styleId: args.styleId,
        prompt: args.prompt,
        negativePrompt: args.negativePrompt,
        aspectRatio: args.aspectRatio ?? "16:9",
        size: args.size ?? "1K",
        brandSlug: args.brandSlug,
        brandMark: args.brandMark,
      }),
    );
  }

  // Edit/variation usam desktopMcp.generateImageOnline (suporta sourceImageId
  // inline como reference). Create sem sourceImageId pode usar a rota mais
  // direta do pipelineMcpImage (catálogo legacy). Pra simplificar, usamos
  // sempre desktopMcp.generateImageOnline a partir da v1 do plugin, porque
  // ele cobre os 3 modos uniformemente e tem a coreografia completa (auth,
  // créditos, upload Bunny, patch row).
  const hasRefs =
    !!args.sourceImageId ||
    (args.sourceImageIds?.length ?? 0) > 0 ||
    (args.referenceImageUrls?.length ?? 0) > 0;

  if ((args.mode === "edit" || args.mode === "variation") && !hasRefs) {
    throw new Error(
      `mode='${args.mode}' exige referência: sourceImageId, sourceImageIds ou referenceImageUrls. Use sapiens_gallery / sapiens_character pra descobrir.`,
    );
  }

  // Caminho ÚNICO user-tier (desktopMcp.generateImageOnline). Cobre create,
  // edit, variation e multi-ref (galeria por id + URLs públicas do Sapiens),
  // resolvendo as referências server-side e cobrando do dono do token. O brand
  // (estilo + persona via refs server-side + logo) aplica dentro do
  // generateImageAction, igual ao gerador web. Substitui o antigo branch
  // referenceImageUrls→pipelineMcpImage (que era admin-only).
  const result = await convexAction("desktopMcp:generateImageOnline", {
    sessionToken,
    prompt: args.prompt,
    aspectRatio: args.aspectRatio,
    size: args.size,
    // Com templateSlug, deixa o model em branco pro default do template valer
    // (sem template, mantém o default nano-banana-2 da tool).
    model: args.model ?? (args.templateSlug ? undefined : "nano-banana-2"),
    negativePrompt: args.negativePrompt,
    mode: args.mode ?? "create",
    sourceImageId: args.sourceImageId,
    sourceImageIds: args.sourceImageIds,
    referenceImageUrls: args.referenceImageUrls,
    brandSlug: args.brandSlug,
    brandMark: args.brandMark,
    templateSlug: args.templateSlug,
    useStudio: args.useStudio,
    influencerId: args.influencerId,
    loraIntensity: args.loraIntensity,
  });
  const studioApplied = result?.studioApplied === true;
  return {
    imageId: result?.imageId,
    url: result?.url,
    mimeType: result?.mimeType,
    // studioApplied=true só quando useStudio achou e aplicou o studio do user.
    // false = geração base. É o sinal pra não confundir studio com base.
    studioApplied,
    // Pediu o studio mas não há um montado: caiu no base, avise o user.
    ...(args.useStudio && !studioApplied
      ? {
          note: "Você pediu o seu studio, mas não há um montado: gerei no Sapiens base. Monte o seu studio em sapiensinteticos.com/dashboard/studio (ferramentas + marca + a vibe).",
        }
      : {}),
    // Não incluir base64 no retorno (polui contexto). Quem quiser bytes
    // chama sapiens_gallery action=get com includeBase64=true.
  };
}
