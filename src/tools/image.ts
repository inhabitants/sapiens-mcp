import { z } from "zod";
import { httpUrl } from "../schema.js";
import { convexAction, convexQuery, describeConvexError, getSessionToken } from "../convexClient.js";

// IDs canônicos do catálogo (apps/sapiens/convex/shared/imageModels.ts).
// IDs fora dessa lista caem no fallback e o pricing vira 999. Sempre usar os
// IDs canônicos.
//
// SEM PREÇO AQUI de propósito: esta lista já carregou o valor de cada motor em
// comentário, e os números ficaram anos-luz da fonte (o gpt-image-2-high dizia
// 800 quando o catálogo cobrava 1200, o nano-banana-max dizia 450 contra 900).
// Preço de imagem tem UMA fonte viva, `action=models`, que já traz o override
// admin e o adder de resolução clampado ao teto do motor.
const MODELS = [
  "nano-banana-max", // gemini-3-pro-image · COM refs · adder até 4K
  "nano-banana-2", // gemini-nano-banana-2.1 (Nano Banana 2.1) · COM refs · adder até 4K · DEFAULT
  "gpt-image-2-low", // Azure gpt-image-2 quality=low
  "gpt-image-2-high", // Azure gpt-image-2 quality=high · o motor de texto legível
  "gpt-image-2-5-flare", // GPT Image 2.5 Flare quality=high · o 2.5 de volume, mais rápido · COM refs
  "gpt-image-2-5-sunburst", // GPT Image 2.5 Sunburst quality=high · o 2.5 de precisão e edição em várias voltas · COM refs
  "mai-image-2-6", // MAI Image 2.6 (Microsoft), no mesmo recurso Foundry do gpt-image-2 · foto rápida · cobra por ÁREA, então o adder de resolução é real · teto 2K (1536²) · SEM refs
  "muse-image", // Meta Muse Image · barato na edição por referência (10 refs no catálogo, 5 pelo MCP) · sem escada de resolução · moderação apertada, não é +18
  "flux-3", // FLUX 3 (Black Forest Labs) · texto e composição precisos · COM refs (10 no catálogo, 5 pelo MCP) · adder até 2K · moderado, não é +18
  "flux-3-klein", // FLUX 3 Image Klein (BFL, pela fal) · o FLUX 3 leve, rápido e barato · COM refs (10 no catálogo, 5 pelo MCP) · adder até 2K · moderado, não é +18
  "krea-3", // Krea 3 (Krea, beta) · edita por referência e segura personagem · COM refs (8 no catálogo, 5 pelo MCP), CADA ref soma no preço · adder até 2K · moderado, não é +18
  "krea-3-high", // O MESMO Krea 3 com thinking high: planeja a edição antes, pra várias refs combinadas · mais caro e mais lento
  // ByteDance via ModelArk direto. Corp/censurado, 2K nativo, COM refs (10 no catálogo, 5 pelo MCP).
  // (O "nova-canvas" ficava aqui e saiu: a AWS matou o modelo. Pedido antigo
  // ainda funciona, o backend faz o alias pro gpt-image-2-low.)
  "seedream-4-5", // Seedream 4.5 · cinematográfico
  "seedream-5-0", // Seedream 5.0, a geração nova · lê prompt complexo melhor
  "seedream-5-0-pro", // Seedream 5.0 Pro, topo da linha (roda no pacote pago)
  // xAI Grok Imagine. Moderação frouxa (+18), aceita refs (img2img) + aspect.
  "grok-2-image", // grok-imagine-image · COM refs · adder até 2K
  "grok-2-image-quality", // grok-imagine-image-quality, mais fiel pra character lock · COM refs · adder até 2K
  "grok-imagine-2", // grok-imagine-image-2.0, a geração nova (ago/2026) · COM refs · adder até 2K
  // Degen (uncensored, gate +18 na galeria). WaveSpeed = rápido (6-25s):
  // NUDEZ É NÍVEL, NÃO MOTOR (set/2026): três pares abaixo são a MESMA escolha com
  // e sem nudez. Sem nudez = o primeiro id; com nudez = o id "com Ousadia" +
  // loraIntensity. A tela do site mostra só o primeiro e troca pelo segundo quando
  // a Ousadia liga. action=models devolve o par no campo `ousadia`.
  "wavespeed-chroma", // Chroma uncensored fotorrealista
  "wavespeed-flux2", // Flux.2 Klein Base · com Ousadia = wavespeed-klein-nu
  "wavespeed-klein-plus", // FORA da prateleira: era Klein + LoRA de ANATOMIA, a escolha virou Klein Base com Ousadia. O id segue gerando.
  "wavespeed-flux-nsfw", // Flux dev + LoRA NSFW (AIDMA) · Ousadia regulável (sem par: a nudez é dele mesmo)
  "wavespeed-klein-anime", // Flux.2 Klein + LoRA anime (inteligente + controlável) · com Ousadia = wavespeed-klein-anime-plus
  "wavespeed-klein-anime-plus", // Klein Anime COM Ousadia (+ SNOFS uncensored) · loraIntensity regula
  "wavespeed-klein-celular", // O MESMO Klein 9B + LoRA de foto de celular (candid), segura o rosto da ref
  "wavespeed-klein-nu", // Klein Base COM Ousadia: + SNOFS no registro de FOTO. O Klein em edit VESTE a
  // modelo sozinho mesmo sem safety checker: é esta LoRA que destrava o nível, e a referência é que
  // segura a identidade. loraIntensity regula.
  "wavespeed-klein-transparencia", // O MESMO Klein 9B + Transparent Clothes: tecido que a luz
  // atravessa de verdade. Aqui o efeito é a LoRA e não a descrição (prompt caprichado sobre renda e
  // trama, sem ela, devolve tecido opaco). Trigger no começo do prompt: "sheer clothes, revealing her
  // breasts underneath". Segura o rosto da ref.
  "wavespeed-krea2-transparencia", // A MESMA LoRA de transparência na base Krea 2: fotografia mais
  // rica (luz com caráter, grão, profundidade) e identidade mais frouxa que a irmã Klein.
  "wavespeed-krea2-realism", // Krea 2 Realism pela WaveSpeed, sem nudez: sem o classificador de entrada
  // da fal, img2img de verdade, 2K nativo · com Ousadia = wavespeed-krea2
  "wavespeed-krea2", // Krea 2 Realism COM Ousadia (a antiga "Livre"): mesmo realismo + LoRA NSFW. loraIntensity regula.
  "wavespeed-krea2-base", // FORA da prateleira: Krea 2 sem LoRA nenhuma, a escolha virou o Krea 2 Realism. O id segue gerando.
  "wavespeed-krea2-broken-tears", // LABORATÓRIO: só admin gera, o servidor recusa o resto antes de cobrar.
  // Civitai (sdcpp, rápido). Família FLUX no Civitai saiu: lenta demais (>5min,
  // estoura o poll). Pra flux uncensored use wavespeed-flux-nsfw.
  "civitai-wai-illustrious", // anime Illustrious
  "civitai-nova-anime-xl", // anime Illustrious
  "civitai-anima", // Anima 2B: anime de produção (linha fechada, sombra chapada), e entende frase
  "civitai-pony-v6", // Pony Diffusion V6 XL, a base nº1 do Civitai
  // fal.ai (Krea-2 Turbo 12B + LoRA de realismo, ~4s). Grupo Degen (+18, checker
  // off). Aceitam até 3 referências de ESTILO (endpoint krea-2/turbo/style): trava
  // paleta/luz/textura de uma série, não trava a mesma pessoa. Com referência a
  // LoRA do catálogo não vai junto (o endpoint de style não a aceita).
  "fal-krea2-realism-v2", // FORA da prateleira: Krea 2 Realism pela fal (LoRA RudySen, venceu o A/B de 30/ago) · txt2img. A escolha virou o wavespeed-krea2-realism; o id segue gerando.
] as const;

// Motor ATIVO no catálogo que fica fora do enum DE PROPÓSITO, com o motivo. O
// gate audit:catalog-parity (apps/sapiens) lê este mapa: id ativo que não está
// nem no enum nem aqui é erro (o Krea 2 Base e o Muse Image ficaram semanas
// assim, listados em action=models e recusados no generate). Hoje vazio: todo
// motor ativo de imagem entra.
export const IMAGE_FORA_DE_PROPOSITO: Record<string, string> = {};

/**
 * Motores que NASCEM em 2K quando quem chama não diz o tamanho. Padrão do MCP
 * desde 20/09/2026, decisão do dono depois do take de aferição.
 *
 * Por que só estes dois grupos: na família Krea 2 o 2K é nativo do endpoint
 * (2720x1536 em 16:9, o dobro do lado do 1K) e a peça de teste segurou fio de
 * cabelo, poro e trama de tricô sem virar cera. No Gemini o 2K não custa NADA a
 * mais pro provider (mesma conta de tokens de saída do 1K; o salto de custo só
 * aparece no 4K), então ali é detalhe de graça.
 *
 * Quem fica de fora e por quê, pra ninguém tentar de novo: no gpt-image-2 e nos
 * 2.5 o size é vestigial, quem decide o tamanho é o aspect ratio
 * (mapAspectRatioToImageSize no backend, teto de 1536x1024), então não existe 2K
 * pra pedir ali. O Seedream já entrega 2K nativo sem escada. Grok e MAI aceitam,
 * mas ficaram de fora por decisão: neles o 2K custa mais pro provider.
 *
 * É padrão do MCP, não da casa: o gerador web continua abrindo em 1K, porque lá
 * quem escolhe vê o preço mudar na tela. O size explícito manda em tudo,
 * inclusive pra baixo (size="1K" volta ao barato).
 */
const DEFAULT_2K_MODELS = new Set([
  "wavespeed-krea2",
  "wavespeed-krea2-realism",
  "wavespeed-krea2-base",
  "wavespeed-krea2-transparencia",
  "wavespeed-krea2-broken-tears",
  "nano-banana-max",
  "nano-banana-2",
]);

/** Teto de referências somadas (urls + ids) que o servidor aceita numa chamada (MAX_REFERENCES do referenceResolver). */
const MAX_REFS_PELO_MCP = 5;

/** Tamanho padrão do motor, quando quem chama não passou o size. */
function defaultSizeFor(model: string | undefined): string | undefined {
  return model && DEFAULT_2K_MODELS.has(model) ? "2K" : undefined;
}

/**
 * Onde conferir quando o generate passa do teto do cliente (o fim da mensagem
 * de Timeout). Antes a frase genérica mandava ler "o status do mesmo tool", que
 * não existia aqui, e as instruções mandavam pra galeria, que só mostra peça
 * pronta: a que ainda gerava sumia, o agente repetia e a conta pagava duas vezes.
 */
export const ONDE_CONFERIR_GENERATE =
  "Leia sapiens_image action=status: ela lista as gerações recentes da conta com o estado de cada uma, inclusive a que ainda está gerando (a galeria só mostra peça pronta). gerando = ainda no servidor, volte em 1 ou 2 minutos; pronta = a peça está no acervo, mostre essa; falhou = o débito voltou, e só aí gere de novo.";

/**
 * Upscale e sombra não abrem row antes de terminar: a peça nova nasce pronta,
 * então durante o trabalho não há nada pra ver. Os prazos somam os tetos de
 * imageUpscale.ts e depthFoto.ts (pedido, poll, download).
 */
export const ONDE_CONFERIR_UPSCALE_SOMBRA =
  "A peça nova só aparece quando fica pronta, em até uns 6 minutos: leia sapiens_image action=status (ou sapiens_gallery action=list), onde ela entra pronta ao lado da original, com o prompt começando por 'Resolução ampliada:' (upscale) ou 'Sombra da foto:' (sombra). Passados 6 minutos sem ela, a ação falhou e as Sinapses voltaram: só aí repita.";

/**
 * Gerando há mais que isto = presa. A régua é a da varredura do servidor
 * (loadingAindaVale, LOADING_SEM_JOB_MS): 15 minutos contados do maior entre a
 * criação e o claim do render, senão a row do site que o MCP renderizou depois
 * viraria "presa" aqui com o render pago ainda vivo lá.
 */
const PRESA_MS = 15 * 60 * 1000;

const LEITURA_STATUS =
  "As gerações de imagem mais recentes da conta, a mais nova primeiro. As que estão gerando vêm todas; o resto vem cortado. gerando: o servidor ainda está nela e ela JÁ cobrou; NÃO gere de novo, leia de novo em 1 ou 2 minutos. pronta: está no acervo (imageId, url, acervoUrl): mostre essa em vez de gerar outra. falhou: não virou peça e o que saiu em Sinapses volta sozinho; pode gerar de novo. bloqueada: o motor recusou o conteúdo e o que saiu em Sinapses volta sozinho; mude o prompt ou o motor antes de tentar de novo. presa: gerando há mais de 15 minutos, não termina mais; a varredura do servidor marca como falha e devolve as Sinapses, então pode gerar de novo. Pra achar a peça de um Timeout, case pelo model, pelo começo do prompt e pelo haMinutos. Upscale e sombra só aparecem quando ficam prontos.";

/**
 * A leitura do action=status: o servidor devolve o estado cru e as horas da
 * row (sem relógio nele), e a idade e o "presa" saem daqui.
 */
export function lerGeracoesRecentes(items: any[], agora: number, truncado = false) {
  const lidas = items.map((i) => {
    const idadeMs = Math.max(0, agora - Number(i.createdAt));
    const desde = Math.max(Number(i.createdAt), Number(i.renderClaimedAt ?? 0));
    const presa = i.estado === "gerando" && agora - desde >= PRESA_MS;
    return { ...i, estado: presa ? "presa" : i.estado, haMinutos: Math.floor(idadeMs / 60000) };
  });
  return {
    gerando: lidas.filter((i) => i.estado === "gerando").length,
    count: lidas.length,
    items: lidas,
    // A leitura parou no teto de varredura: geração mais antiga que isso não entrou.
    ...(truncado ? { truncado: true } : {}),
    leitura: LEITURA_STATUS,
  };
}

export const imageSchema = z.object({
  action: z.enum(["generate", "request_generation", "compose", "models", "upscale", "sombra", "status"]),
  prompt: z
    .string()
    .optional()
    .describe(
      "Prompt da imagem (obrigatório em generate). Full-bleed, sujeito oversized.",
    ),
  model: z
    .enum(MODELS)
    .optional()
    .describe(
      "Default 'nano-banana-2' (Nano Banana 2.1 com refs). 'nano-banana-max' (Pro 3) = qualidade alta. 'gpt-image-2-low/high' = GPT Image 2 nos tiers low e high. 'gpt-image-2-5-flare'/'gpt-image-2-5-sunburst' = GPT Image 2.5, a geração de set/2026, os dois em quality high e com referência: o Flare é o rápido, pra volume; o Sunburst é o de precisão, pra composição complexa e edição em várias voltas. 'mai-image-2-6' (MAI Image 2.6, da Microsoft) = foto rápida no mesmo recurso do gpt-image-2, e o único da casa que cobra por ÁREA: o adder de resolução aqui é real, o teto é 2K (1536², porque acima disso o provider recusa por total de pixels) e ele não aceita referência. 'muse-image' (Muse Image, da Meta) = barato na edição por referência e bom pra segurar personagem (10 refs no catálogo; pelo MCP vale o teto de 5 do campo referenceImageUrls); sem escada de resolução (o motor decide o tamanho e cobra o mesmo) e moderação apertada, NÃO serve pra +18. 'flux-3' (FLUX 3, da Black Forest Labs) = texto na arte e composição precisos, aceita referência (10 no catálogo; pelo MCP vale o teto de 5 do campo referenceImageUrls), resolução até 2K; com referência a proporção segue a primeira imagem; moderado, NÃO serve pra +18. 'flux-3-klein' (FLUX 3 Image Klein, o irmão leve de pesos abertos do FLUX 3) = foto e personagem rápidos (~5 s) e baratos, aceita referência (10 no catálogo; pelo MCP vale o teto de 5 do campo referenceImageUrls) e segura a pessoa da ref numa cena nova, resolução até 2K; moderado, NÃO serve pra +18. 'krea-3' (Krea 3, da Krea, em beta) = edição por referência que SEGURA PERSONAGEM, inclusive anime e criatura com marcador no rosto, e foto com pele crua; aceita referência (8 no catálogo; pelo MCP vale o teto de 5 do campo referenceImageUrls), resolução até 2K. É o ÚNICO da casa que cobra cada referência à parte: o preço sobe por ref (o valor vivo sai em action=models), então mande só as refs que a cena precisa. Escreva em linguagem simples e chame cada referência pelo que ela mostra ('a primeira imagem é o rosto, a segunda o figurino'); pra edição, a mudança primeiro e uma frase de preservação no fim. 'krea-3-high' = o MESMO Krea 3 com thinking high: monta um plano de edição a partir do prompt e das refs antes de gerar; use quando combinar várias refs ou quando o 'krea-3' errou o pedido. Moderado, NÃO serve pra +18. 'seedream-4-5'/'seedream-5-0'/'seedream-5-0-pro' = ByteDance 2K nativo, cinematográfico, aceita referência (10 no catálogo; pelo MCP vale o teto de 5 do campo referenceImageUrls) (o 5.0 é a geração nova, entende prompt complexo melhor; o 5.0-pro é o topo da linha). 'grok-2-image'/'grok-2-image-quality' = xAI Grok Imagine da geração anterior (moderação frouxa +18, aceita refs e aspect; quality é mais fiel pra character lock); 'grok-imagine-2' = Grok Imagine Image 2.0, a geração nova de ago/2026, que é a melhor da linha integrando desenho e foto na mesma peça. Daqui em diante, a LINHA DEGEN (sem freio de conteúdo, gate +18; o Grok fica fora dela). NUDEZ É NÍVEL, NÃO MOTOR: três escolhas têm um par com nudez, e o par vem no campo `ousadia` de action=models. Sem nudez = o id da escolha; com nudez = o id do par + loraIntensity. Não existe motor '+18', 'Nu' ou 'Livre' separado pra procurar. 'wavespeed-chroma' (fotorrealista rápido, sem referência), 'wavespeed-flux2' (Flux.2 Klein Base: foto rápida, até 4 referências, segura o rosto) · com nudez = 'wavespeed-klein-nu' (o mesmo Klein com a LoRA de nudez no registro de foto; a identidade continua vindo da referência), 'wavespeed-klein-anime' (Flux.2 Klein + LoRA anime, inteligente e controlável) · com nudez = 'wavespeed-klein-anime-plus', 'wavespeed-flux-nsfw' (Flux dev + LoRA NSFW, sem par: a Ousadia é dele mesmo, via loraIntensity), 'wavespeed-klein-celular' (o MESMO Klein 9B com a LoRA Phone Photography por cima: foto de celular, candid, luz de janela; no edit com a referência da personagem o rosto fica quase idêntico, e é a receita de conteúdo de perfil de criadora pra personagem FOTOGRÁFICA. Em personagem cel-shaded o edit troca o traço, então não use com a Aria. Comece o prompt com 'This is a candid photograph taken with a smartphone of' e enumere 'same face, same hair' antes da cena; sem Ousadia), 'wavespeed-klein-transparencia' (o MESMO Klein 9B com a LoRA de tecido transparente: o efeito vem da LoRA e não da descrição; segura o rosto da ref; sem Ousadia), 'wavespeed-krea2-realism' (Krea 2 Realism: base 12B com LoRA de realismo, pele crua, hospedada na WaveSpeed SEM o classificador de entrada da fal, que devolve 422 até em prompt sem palavra de nudez; img2img de verdade com 1 referência, força regulável em refStrength, e 2K) · com nudez = 'wavespeed-krea2' (o mesmo realismo + LoRA NSFW; é a antiga 'Krea 2 Livre'), 'wavespeed-krea2-transparencia' (a mesma LoRA de transparência na base Krea 2: fotografia mais rica, identidade mais frouxa que a irmã Klein; 1 referência; sem Ousadia) = WaveSpeed rápido. LEGADO, fora da escolha da tela e ainda gerando pelo id (não ofereça): 'wavespeed-klein-plus' (a escolha virou 'wavespeed-klein-nu'), 'wavespeed-krea2-base' (Krea 2 sem LoRA nenhuma; a escolha virou 'wavespeed-krea2-realism'), 'fal-krea2-realism-v2' (Krea 2 Realism pela fal, ~4s: aceita até 3 referências de ESTILO, paleta/luz/textura de uma série, não character lock, e com referência a LoRA não vai junto; a escolha virou 'wavespeed-krea2-realism'). 'civitai-wai-illustrious'/'civitai-nova-anime-xl' (anime), 'civitai-pony-v6' (Pony V6 XL, base nº1) = Civitai sdcpp rápido. 'civitai-anima' (Anima: 2B da CircleStone com a Comfy Org, base própria e não SDXL; entrega anime de PRODUÇÃO, linha fechada e sombra chapada, em vez do registro de ilustração dos Illustrious. O encoder é um LLM, então escreva a cena em FRASE e não em tag booru, e não cole score_9/masterpiece aqui).",
    ),
  aspectRatio: z
    .enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"])
    .optional()
    .describe("Default '1:1'. 9:16 = vertical pra story/short, 16:9 = landscape."),
  size: z
    .enum(["1K", "2K", "4K"])
    .optional()
    .describe(
      "PADRÃO DO MCP: quem NÃO passa size nasce em 2K no Gemini (nano-banana-max, nano-banana-2) e na família Krea 2 da WaveSpeed, e em 1K no resto. Nesses dois grupos o 2K soma o adder ao preço (+100 hoje), e é decisão da casa pagar por ele: no Gemini o 2K não custa nada a mais pro provider, e na Krea 2 ele dobra o lado da peça (2720x1536 em 16:9) sem perder pele. Passe size='1K' explícito quando o barato importar mais que o detalhe. Resolução acima de 1K só existe nos modelos com hasResolutionAdder (o Gemini vai até 4K; grok-2-image, grok-2-image-quality e a família Krea 2 param em 2K, e pedir 4K neles entrega 2K e cobra o adder de 2K). Nos demais modelos o size é ignorado (fica em 1K): no gpt-image-2 e nos 2.5, por exemplo, quem decide o tamanho é o aspect ratio. O valor VIVO do adder por modelo sai em action=models (campo resolutionAdders, já clampado ao teto do motor): não escreva o número de cabeça, ele muda quando o provider reajusta.",
    ),
  styleId: z
    .string()
    .optional()
    .describe("Legado, sem efeito: o servidor não lê este campo. Estilo vem de brandSlug, templateSlug ou registro."),
  negativePrompt: z.string().optional(),
  referenceImageUrls: z
    .array(httpUrl())
    .optional()
    .describe(
      "URLs públicas de referência pra combinar numa geração só (character/style lock), igual ao modal 'Selecionar Referência' do gerador web. Fontes: sua galeria (sapiens_gallery, campo url), o Acervo, e personagens públicos (sapiens_character action=list_public → mainImageUrl/imageUrls). Restrito a hosts do Sapiens (Bunny CDN / Convex) + Wikimedia. Requer model com refs (o campo supportsReferences em action=models é a fonte): nano-banana-*, gpt-image-2-*, muse-image, flux-3, flux-3-klein, krea-3 e krea-3-high (cada ref soma no preço), seedream-*, grok-* (até 3), a família Klein (wavespeed-flux2 e wavespeed-klein-*, até 4), wavespeed-flux-nsfw (1), a família Krea 2 da WaveSpeed (wavespeed-krea2-realism, wavespeed-krea2 e wavespeed-krea2-transparencia; img2img: a primeira referência vira a imagem-base, 1 ref, e refStrength diz quanto dela fica) ou fal-krea2-* (referência de ESTILO, teto de 3). Soma com sourceImageIds: até 5 no total (acima disso o servidor recusa a chamada), e cada motor corta no seu teto quando ele é menor, SEM erro: a ref a mais some (nano-banana-2 e Klein 4, Grok 3, Krea 2 da WaveSpeed e Flux NSFW 1; o campo maxReferences em action=models é a fonte).",
    ),
  sourceImageIds: z
    .array(z.string())
    .optional()
    .describe(
      "IDs de imagens da SUA galeria (`generatedImages:_id` via sapiens_gallery) usadas como referência. Alternativa por-id ao referenceImageUrls pras suas próprias imagens (ownership checado). Soma com referenceImageUrls: até 5 no total, e o motor corta no teto dele quando é menor (ver referenceImageUrls).",
    ),
  brandSlug: z
    .string()
    .optional()
    .describe(
      "Slug do brand (design system) pra aplicar estilo visual. Fonte única: tabela `brands` (ex: 'sapiens', 'solarpunk', 'editorial-duotone', 'brutalista-mono'). Default: nenhum (prompt cru). NÃO herda o padrão da conta de propósito: aqui o estilo é escolha do momento, e quem só quer uma imagem pra outra coisa não deve nascer preso num visual. O padrão da pessoa (quando existe) vem em sapiens_meta action=start, campo designSystem: OFEREÇA quando a peça for da marca dela, deixe cru no resto. Vale em action=generate (mode=create).",
    ),
  brandMark: z
    .enum(["persona", "logo", "none"])
    .optional()
    .describe(
      "Marca na imagem do brand: 'persona' (personagem do brand via character sheets, ex: Helen), 'logo' (carimba a logo no canto), 'none' (só o estilo). Default 'none'. Só aplica se brandSlug setado e o brand oferecer a marca.",
    ),
  skills: z
    .array(z.string())
    .optional()
    .describe(
      "COMO A PEÇA FOI FEITA: os slugs das skills que dirigiram esta geração (ex: ['camarim'], ['dop','escala-gigantismo']). Metadado puro: não muda preço, motor nem resultado, e serve pra ACHAR depois tudo que saiu de uma skill. Passe sempre que a geração estiver saindo de uma skill da casa, na ordem em que elas entraram (quem escreveu o prompt primeiro). Fica no registro da peça e volta em sapiens_gallery.",
    ),
  templateSlug: z
    .string()
    .optional()
    .describe(
      "Slug de um template de imagem (super-prompt travado da casa). Quando setado, o `prompt` vira só a CENA (quem + pose + objeto-conceito) e o template embrulha com o estilo + fundo + enquadramento + ref de traço da casa. Ex: 'retrato-sapiens-v1' = retrato editorial cartoon de UM personagem no grid verde Sapiens (mesma 'mão' dos artigos). O template define model/aspect/size default (sobreponíveis) e injeta a ref da Helen como âncora de traço quando você não passa referenceImageUrls própria (passar refs = trocar quem aparece, mantendo o estilo). Mutuamente exclusivo com brandSlug. Vale em action=generate, mode=create.",
    ),
  registro: z
    .enum(["anos-90", "candid", "noturno-intimo", "camera-baixa"])
    .optional()
    .describe(
      "REGISTRO fotografico: COMO a foto foi tirada, nao o que ela mostra. Eixo separado do motor e do templateSlug, e convive com os dois. O bloco entra ANTES da sua cena, server-side, e o `prompt` continua sendo so a cena. 'anos-90' = camera descartavel dos anos 90, flash direto, cor lavada e data queimada no canto (o mais barato de todos: nao carrega LoRA); 'candid' = retrato natural, luz do dia, pele com poro, e e o que MAIS obedece a referencia, entao e o mais seguro pra personagem da casa e pra inventar personagem novo por texto; 'noturno-intimo' = tom escuro, luz de abajur, clima de serie curta (o bloco e em chines de proposito, que e o que alcanca esse tom); 'camera-baixa' = olho de peixe no chao, perspectiva exagerada e desfoque de movimento, o registro pra still que vai virar video. AVISO medido: 'camera-baixa' troca o traco de personagem CEL-SHADED por foto, entao nele use personagem fotografica. Omitir e escolha legitima: sem registro o prompt vai intacto.",
    ),
  influencerId: z
    .string()
    .optional()
    .describe(
      "ID de personagem pra character-lock: a imagem sai com ESSE personagem. Descubra o id com sapiens_character.",
    ),
  loraIntensity: z
    .enum(["suave", "medio", "forte"])
    .optional()
    .describe(
      "Ousadia: o nível de nudez. Só vale nos modelos COM Ousadia ('wavespeed-klein-nu' = Klein Base, 'wavespeed-klein-anime-plus' = Klein Anime, 'wavespeed-krea2' = Krea 2 Realism, 'wavespeed-flux-nsfw', e o legado 'wavespeed-klein-plus'): suave=insinua sem despir, medio=maduro no limite (default), forte=sem freio. Sem nudez, use o par sem Ousadia ('wavespeed-flux2', 'wavespeed-klein-anime', 'wavespeed-krea2-realism'): o par vem no campo `ousadia` de action=models. Ideal pra remixar personagem (ex: a Helen) preservando a identidade e regulando a liberdade. Ignorado nos demais modelos.",
    ),
  refStrength: z
    .number()
    .min(0.2)
    .max(0.9)
    .optional()
    .describe(
      "Força da referência, só nas Krea 2 da WaveSpeed ('wavespeed-krea2-realism', 'wavespeed-krea2', 'wavespeed-krea2-transparencia', 'wavespeed-krea2-base'), onde a primeira referência vira a imagem-base: quanto a peça repinta. 0.2 guarda a foto quase inteira, com o rosto; 0.45 guarda pose, roupa e fundo, e o prompt muda luz e clima (o rosto sai parecido, não igual); 0.65 (o default) guarda enquadramento e roupa, e rosto e cenário saem do prompt; 0.9 guarda só a proporção. A peça sai no formato da referência, não no aspectRatio. Pra segurar rosto de personagem, o caminho é o Klein ('wavespeed-flux2' e família), não baixar a força. O campo refStrength de action=models diz quais motores aceitam e o default de cada um. Ignorado nos outros motores.",
    ),
  transparentBackground: z
    .boolean()
    .optional()
    .describe(
      "FUNDO TRANSPARENTE: true devolve PNG com alpha, recortado pelo próprio motor na geração, pronto pra overlay, slide, sticker ou editor de vídeo, sem pagar o Remover Fundo depois. Mesmo preço da geração comum. Só nos motores com supportsTransparentBackground=true em action=models (hoje a linha GPT Image: gpt-image-2-low, gpt-image-2-high, gpt-image-2-5-flare e gpt-image-2-5-sunburst); em qualquer outro, inclusive no default nano-banana-2, o servidor recusa sem cobrar, então passe o model junto. No prompt, descreva SÓ o sujeito isolado ('a single red ceramic teapot, isolated subject, crisp edges, no shadow'), sem cenário nem chão: fundo descrito vira fundo pintado. A peça sobe em PNG (não webp) e volta em sapiens_gallery com transparentBackground=true. Se o motor devolver fundo chapado, a geração falha e estorna. Vale em action=generate.",
    ),
  pagarCom: z
    .enum(["sinapses", "dolar"])
    .optional()
    .describe(
      "De qual saldo sai a imagem. Default 'sinapses' (o saldo do App). 'dolar' cobra no saldo em dólar da API da conta (o mesmo de Developers), sem tocar nas Sinapses: mesmo motor, mesma peça, mesmas referências e tamanhos, preço em dólar do custo do motor naquela resolução. Use quando a pessoa pedir pra pagar com o saldo da API ou estiver sem Sinapses e com saldo em dólar. Motor sem preço em dólar (os do Civitai) recusa, e saldo em dólar curto recusa sem cobrar nada. O valor cobrado volta em pagoEmDolarUsd. Sinapse nunca vira dólar nem o contrário: são duas carteiras.",
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
      "ID de imagem do gallery do próprio user (`generatedImages:_id`). Obrigatório pra mode=edit ou mode=variation, e pra action=upscale e action=sombra (a peça de origem). Use sapiens_gallery action=list pra descobrir IDs.",
    ),
  maskRegions: z
    .array(
      z.object({
        shape: z.enum(["ellipse", "rect"]).optional(),
        x: z.number().min(0).lt(1),
        y: z.number().min(0).lt(1),
        w: z.number().gt(0).max(1),
        h: z.number().gt(0).max(1),
      }),
    )
    .min(1)
    .max(8)
    .optional()
    .describe(
      "EDIÇÃO POR ÁREA: só a região marcada muda, e o resto da peça volta igual ao pixel (a casa cola a área editada sobre a original). Caixas em FRAÇÃO da imagem, de 0 a 1, com origem no canto SUPERIOR ESQUERDO: x,y = canto superior esquerdo da caixa; w,h = largura e altura. shape 'ellipse' (default) marca a elipse inscrita na caixa, que cobre objeto sem pegar canto vazio; 'rect' marca a caixa inteira. Até 8 caixas, somadas numa área só. Exige UMA referência só (sourceImageId da sua galeria, sem sourceImageIds extra e sem templateSlug) e motor com supportsMaskEdit=true em action=models (hoje nano-banana-2 e nano-banana-max). O prompt descreve SÓ o que entra na área (ex.: 'a red umbrella held in her hand'), nunca a cena inteira. Marque com folga em volta do objeto: área justa demais corta a sombra e o reflexo. Antes, OLHE a peça (sapiens_gallery action=get) pra estimar as coordenadas. A peça sai na proporção e no tamanho da origem, lado maior até 2048 (4K vira 2K). Mesmo preço da geração comum. Recusa sem cobrar: área vazia, área que cobre quase a imagem toda (aí é edit comum, sem maskRegions) e motor sem supportsMaskEdit.",
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
    const active = (all ?? []).filter((m) => m?.isActive);
    // Nudez é nível, não motor (set/2026): a entrada com `ousadiaOf` é a mesma
    // escolha com nudez, e a com `mergedInto` saiu da prateleira. As duas seguem
    // gerando pelo id, mas não viram linha: a irmã com Ousadia vira o campo
    // `ousadia` da escolha que ela completa, igual à tela do site. Backend sem os
    // campos (deploy anterior) só devolve a lista como sempre.
    const ousadiaByShelf: Record<string, { model: string; priceSinapses: number }> = {};
    for (const m of active) {
      if (m.ousadiaOf) ousadiaByShelf[m.ousadiaOf] = { model: m.id, priceSinapses: m.effectivePriceSinapses };
    }
    const models = active
      .filter((m) => !m.ousadiaOf && !m.mergedInto)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((m) => ({
        id: m.id,
        label: m.label,
        // Família + variante: várias entradas da lista são o MESMO motor em
        // tempero ou geração diferente (Krea 2 Realism/Livre/Base, Gemini 3
        // Pro/Nano Banana 2.1). Sem estes dois campos o cliente vê ids soltos e trata
        // como motores sem relação, que foi o mesmo problema que a prateleira
        // do browser tinha antes de agrupar. Ausência = motor sozinho.
        family: m.family ?? null,
        variant: m.variantLabel ?? null,
        // Pra que este motor serve, no vocabulário fechado do catálogo: foto,
        // anime, texto, personagem, adulto. É o que responde "qual motor pra
        // isso" sem o cliente ter que interpretar vinte taglines.
        bestFor: m.bestFor ?? [],
        priceSinapses: m.effectivePriceSinapses,
        maxResolution: m.maxResolution ?? "4K",
        resolutionAdders: m.resolutionAdders,
        // Motor que cobra CADA referência (Krea 3): Sinapses por ref, por
        // resolução. null = referência não muda o preço.
        referenceAdders: m.referencePriceSinapses ?? null,
        supportsReferences: !!m.supportsReferences,
        // Quantas referências chegam ao motor PELO MCP: o teto do motor no
        // catálogo (ausente = 4, o DEFAULT_MAX_REFERENCES do servidor) cortado
        // no teto de 5 do resolvedor. As descrições de referenceImageUrls e
        // sourceImageIds mandam olhar este campo, que até a 1.103 não existia:
        // a 5ª ref no nano-banana-2 sumia sem aviso. 0 = não aceita referência.
        maxReferences: m.supportsReferences
          ? Math.min(typeof m.maxReferences === "number" ? m.maxReferences : 4, MAX_REFS_PELO_MCP)
          : 0,
        degen: /^(civitai-|wavespeed-|fal-)/.test(String(m.id)),
        // O id que gera esta mesma escolha COM nudez (manda junto loraIntensity).
        // null = sem par; se o próprio motor tem LoRA tunável, a Ousadia é dele.
        ousadia: ousadiaByShelf[m.id] ?? null,
        // A força da referência quando o motor deixa regular (Krea 2 da
        // WaveSpeed): o default que vale sem refStrength. null = sem o controle.
        refStrength: m.refStrengthDefault ?? null,
        // Edita só a área marcada (arg maskRegions). Backend de antes do campo
        // não manda, e aí sai false.
        supportsMaskEdit: m.supportsMaskEdit === true,
        // Gera com fundo transparente (arg transparentBackground). Mesma regra
        // de backend antigo: sem o campo, false.
        supportsTransparentBackground: m.supportsTransparentBackground === true,
        note: m.description ?? null,
      }));
    // Índice por família, pro cliente escolher em dois passos como a tela faz:
    // primeiro o motor, depois a versão. Só entra família com 2+ variantes.
    const families: Record<string, { variants: string[] }> = {};
    for (const m of models) {
      if (!m.family) continue;
      (families[m.family] ??= { variants: [] }).variants.push(m.id);
    }
    for (const key of Object.keys(families)) {
      if (families[key].variants.length < 2) delete families[key];
    }
    return {
      count: models.length,
      default: "nano-banana-2",
      models,
      families,
      note:
        "priceSinapses é o preço COBRADO em 1K (já com override admin). Acima de 1K some o adder de resolutionAdders[size], que vem clampado ao teto do motor: em modelo que para em 2K, a chave '4K' repete o valor de 2K porque é isso que a cobrança aplica quando você pede 4K nele. " +
        "Preço final = priceSinapses + resolutionAdders[size]. Sem size, nano-banana-* e a família Krea 2 geram em 2K (somam o adder de 2K); o valor debitado volta em custoSinapses no generate. degen=+18 (gate na galeria). " +
        "maxReferences é quantas referências chegam ao motor por aqui (o teto dele, cortado em 5): a mais, somem sem erro. " +
        "Quando referenceAdders vem preenchido (Krea 3), cada referência soma referenceAdders[size] ao preço, até o teto do motor. " +
        "Modelos com a MESMA family são o mesmo motor em versão diferente (o variant diz qual): compare preço e nota entre eles antes de trocar de família. " +
        "Nudez é nível, não motor: quando `ousadia` vem preenchido, gere com ousadia.model + loraIntensity pra ter nudez e com o id da linha pra não ter (o preço com nudez vem em ousadia.priceSinapses).",
    };
  }

  // request_generation saiu de linha em set/2026. Ele só abria a row e
  // debitava, e o render que vinha depois (vídeo) nasce hoje inteiro no
  // sapiens_video action=create. Fica no enum pra quem chega com instrução
  // velha receber o caminho em vez de um erro de schema, e recusa ANTES de
  // falar com o servidor: nada é cobrado.
  if (args.action === "request_generation") {
    throw new Error(
      "request_generation saiu de linha e não cobrou nada. Imagem: action=generate (gera e cobra num call só). Vídeo: sapiens_video action=create (cria a row de vídeo e renderiza).",
    );
  }

  const sessionToken = getSessionToken();

  // status: a leitura depois de um Timeout. Somente leitura, sem custo. Mostra
  // a peça que AINDA está gerando, que a galeria não mostra.
  if (args.action === "status") {
    let r: any;
    try {
      r = await convexQuery("imagemRecentes:mcpGeracoesRecentes", { sessionToken });
    } catch (e) {
      // Pacote na frente do deploy: o servidor ainda não tem a leitura.
      if (!/Could not find public function/i.test(describeConvexError(e))) throw e;
      throw new Error(
        "action=status ainda não chegou no servidor. Enquanto isso, sapiens_gallery action=list mostra só a peça PRONTA: a que ainda está gerando não aparece lá. Depois de um Timeout, espere uns minutos e olhe a galeria antes de gerar de novo.",
      );
    }
    return lerGeracoesRecentes(r?.items ?? [], Date.now(), r?.truncado === true);
  }

  // v1.8: compose tem args próprios, validação separada
  // Ações da ficha do site sobre uma imagem SUA pronta: a peça nova entra no
  // acervo como versão, e a de origem fica intacta. Síncronas e com custo fixo;
  // o servidor prova a posse e cobra pelo token, nunca por arg.
  if (args.action === "upscale" || args.action === "sombra") {
    if (!args.sourceImageId) {
      throw new Error(`action=${args.action} exige sourceImageId (uma imagem SUA pronta; ache em sapiens_gallery action=list).`);
    }
    const fn = args.action === "upscale" ? "imageUpscale:aumentarResolucao" : "depthFoto:extrairSombraDaFoto";
    return await convexAction(
      fn,
      { imageId: args.sourceImageId, sessionToken },
      { ondeConferir: ONDE_CONFERIR_UPSCALE_SOMBRA },
    );
  }

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

  // Edição por área: uma referência só, e ela é a peça editada. O servidor
  // confere de novo (e confere o motor), mas aqui a recusa sai antes da rede.
  if (args.maskRegions) {
    const total =
      (args.sourceImageId ? 1 : 0) +
      (args.sourceImageIds?.length ?? 0) +
      (args.referenceImageUrls?.length ?? 0);
    if (total !== 1) {
      throw new Error(
        "maskRegions edita UMA imagem: mande só sourceImageId (sem sourceImageIds nem referenceImageUrls extras).",
      );
    }
  }

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
  // Com templateSlug e sem model, fica undefined DE PROPÓSITO: quem manda no
  // motor (e no tamanho) é o default do template.
  const genModel = args.model ?? (args.templateSlug ? undefined : "nano-banana-2");

  const result = await convexAction(
    "desktopMcp:generateImageOnline",
    {
      sessionToken,
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      // Sem size explícito, o motor decide (ver DEFAULT_2K_MODELS). Quando nem ele
      // manda, o campo vai undefined e o backend fica no 1K de sempre.
      size: args.size ?? defaultSizeFor(genModel),
      // Com templateSlug, deixa o model em branco pro default do template valer
      // (sem template, mantém o default nano-banana-2 da tool).
      model: genModel,
      negativePrompt: args.negativePrompt,
      // Com área marcada a geração é edição, seja o que vier em mode.
      mode: args.maskRegions ? "edit" : args.mode ?? "create",
      sourceImageId: args.sourceImageId,
      sourceImageIds: args.sourceImageIds,
      referenceImageUrls: args.referenceImageUrls,
      brandSlug: args.brandSlug,
      brandMark: args.brandMark,
      skills: args.skills,
      templateSlug: args.templateSlug,
      registro: args.registro,
      influencerId: args.influencerId,
      loraIntensity: args.loraIntensity,
      refStrength: args.refStrength,
      // Só vai quando veio: servidor de antes do campo recusaria arg desconhecido.
      ...(args.maskRegions ? { maskRegions: args.maskRegions } : {}),
      ...(args.pagarCom === "dolar" ? { pagarCom: "dolar" } : {}),
      ...(args.transparentBackground === true ? { transparentBackground: true } : {}),
    },
    { ondeConferir: ONDE_CONFERIR_GENERATE },
  );
  // Backend de antes do campo não devolve motor nem ficha: cai no id pedido e
  // monta a ficha aqui. O nome bonito (modelName) só vem do servidor.
  const model: string | undefined = result?.model ?? genModel;
  const acervoUrl: string | undefined =
    result?.acervoUrl ??
    (result?.imageId ? `https://sapiensinteticos.com/dashboard/acervo?image=${result.imageId}` : undefined);
  return {
    imageId: result?.imageId,
    url: result?.url,
    model,
    modelName: result?.modelLabel ?? model,
    // Ficha PRIVADA: é onde a peça mora até alguém publicar. O /imagem/<id>
    // (que este campo era antes, como webUrl) dá 404 até pro dono enquanto a
    // peça não passa por sapiens_gallery action=publish.
    acervoUrl,
    entrega:
      "Ao mostrar a peça, diga o motor pelo modelName e mande o acervoUrl como link 'no acervo'. A peça é PRIVADA: link público só existe depois de sapiens_gallery action=publish (que devolve o endereço público).",
    mimeType: result?.mimeType,
    // Recorte: o servidor só chega aqui depois de medir o alpha do arquivo.
    ...(args.transparentBackground === true ? { transparentBackground: true } : {}),
    // Pago com o saldo em dólar da API: quanto saiu. Ausente quando foi em Sinapses.
    ...(typeof result?.pagoEmDolarUsd === "number" ? { pagoEmDolarUsd: result.pagoEmDolarUsd } : {}),
    // Pago em Sinapses: o que o extrato debitou (resolução, refs pagas e
    // override já dentro). Backend de antes do campo não manda, e aí não vem.
    ...(typeof result?.custoSinapses === "number" ? { custoSinapses: result.custoSinapses } : {}),
    // Não incluir base64 no retorno (polui contexto). Quem quiser bytes
    // chama sapiens_gallery action=get com includeBase64=true.
  };
}
