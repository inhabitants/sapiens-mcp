import { z } from "zod";
import { readFile } from "node:fs/promises";
import {
  convexAction,
  convexQuery,
  convexMutation,
  getSessionToken,
  isRemoteContext,
} from "../convexClient.js";
import { fetchPublicHttps } from "../publicFetch.js";

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
 *               card premium gpt-image-2). Cobra 1350 Sinapses (150 do texto + card),
 *               reembolsa se falhar. Identidade vem do sessionToken. Pode
 *               partir do briefing de um brand JÁ SEU (fromSlug) e aplicar uma
 *               torção (twist): é assim que se desenha várias direções pro
 *               mesmo projeto sem redigitar o briefing a cada uma.
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
 *   - persona:  pluga um personagem DO PRÓPRIO user como a cara recorrente das
 *               imagens do brand custom dele (character=<slug|id>), ou tira
 *               (character=null). As refs saem da galeria do personagem. De
 *               graça. É o que faz "gera na minha marca, com o meu personagem"
 *               funcionar sem anexar referência a cada geração.
 *   - import:   TRANSCREVE um design system que já existe fora (Figma, outro app,
 *               o kit de um cliente): o que veio é o que grava, sem IA no meio,
 *               fonte e hex exatos. Grátis (card nasce em SVG). É a porta de
 *               quem já tem brand; generate é a de quem quer um.
 *   - font:     sobe o ARQUIVO de uma fonte do brand (a que não é do Google
 *               Fonts: Fontshare, comprada, do cliente) pro papel headline,
 *               body ou mono. Os bytes saem de filePath (stdio), sourceUrl
 *               (https público) ou base64. De graça, até 2 MB.
 *   - logo:     põe a logo no brand custom pelo ID da imagem na galeria do
 *               user (img_…, de sapiens_gallery action=upload), ou tira
 *               (handle=null). De graça.
 *   - favorite: marca (isFavorite=true, default) ou desmarca um brand custom do
 *               user como FAVORITO, o escolhido entre as tentativas de um
 *               projeto. Favorito sobe pro topo das listas dele (list, seletores
 *               do app). Oficial não se favorita. De graça.
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
    "persona",
    "favorite",
    "import",
    "logo",
    "font",
  ]),
  slug: z
    .string()
    .optional()
    .describe(
      "Slug do brand. Obrigatório em get/refine/reroll/card/delete/set_visibility/adopt/persona/favorite/logo. Pegue via action=list (seus) ou action=list_public (da comunidade).",
    ),
  brand: z
    .any()
    .optional()
    .describe(
      "Pra action=import: o design system que JÁ EXISTE. Serve o ARQUIVO DE DESIGN TOKENS como veio (DTCG com $value/$type, ou Tokens Studio com value/type: o servidor mapeia por papel lendo o caminho do token, color.brand.primary vira primary, color.text vira foreground, e devolve em `mapping` de onde saiu cada cor e fonte; aí mande o nome em `name`) " +
        "OU o shape do Brand da casa (o mesmo que action=get devolve): " +
        "{ name (obrigatório, ≤40), tagline?, description?, " +
        "palette: { primary, secondary?, tertiary?, accent?, background, foreground, swatches?: [{name, hex}] }, " +
        "typography: { headline, body, mono? } (cada uma a família como string, ou {family, note}), " +
        "voice?: { rules (texto ou lista de regras), lexicon?, avoid?, sampleLines? }, " +
        "imageStyle?: { styleBase (em inglês), negative?, backgroundSignature? } }. " +
        "Cor em hex (#RRGGBB, aceita #RGB e sem #). Obrigatórios: name, background, foreground, primary (ou accent), headline e body. " +
        "PAPÉIS DAS CORES na casa: primary é a cor da marca, accent é a que DESTACA a peça (kicker, número, palavra-chave). " +
        "Se no sistema de origem o accent é só cor de botão, mande assim mesmo: o carrossel escolhe sozinho a cor que lê no fundo e se separa do texto, e o editor deixa trocar. " +
        "Mapeie o que a origem chama por outro nome (brand/main → primary, bg/surface → background, text/ink → foreground, cta/highlight → accent). " +
        "Fonte fora do Google Fonts grava como veio (fidelidade) e aparece na fonte da casa onde o navegador não acha a dela; o retorno avisa em `warnings`.",
    ),
  source: z
    .string()
    .optional()
    .describe("Pra action=import: de onde o brand veio (o nome do app, 'Figma', 'kit do cliente'). Vai pro briefing e pro aviso. ≤60 chars."),
  handle: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Pra action=logo: o ID citável da imagem da logo na galeria do user (img_…). Suba antes com sapiens_gallery action=upload (PNG com fundo transparente é o ideal) e use o ID que voltar. null tira a logo.",
    ),
  role: z
    .enum(["headline", "body", "mono"])
    .optional()
    .describe("Pra action=font: o papel da fonte no brand (headline = título, body = corpo, mono = código)."),
  family: z
    .string()
    .optional()
    .describe(
      "Pra action=font: o nome da família, como o CSS chama (ex: 'Clash Display'). Omita pra usar a família que o papel já tem no brand (o caso comum: o brand importado com Clash Display ganha o arquivo dela).",
    ),
  filePath: z
    .string()
    .optional()
    .describe("Pra action=font: caminho ABSOLUTO do arquivo de fonte local (.woff2, .woff, .ttf, .otf). Só no MCP instalado (stdio); no remoto use sourceUrl."),
  sourceUrl: z
    .string()
    .optional()
    .describe("Pra action=font: URL https pública do arquivo de fonte (o servidor baixa e confere os bytes)."),
  base64: z
    .string()
    .optional()
    .describe("Pra action=font: o arquivo de fonte em base64, quando você já tem os bytes."),
  wordmark: z
    .string()
    .optional()
    .describe("Pra action=logo: o nome escrito que acompanha a logo, quando ele difere do nome do brand (≤60 chars)."),
  isFavorite: z
    .boolean()
    .optional()
    .describe(
      "Pra action=favorite: true (default) marca o brand como o favorito, o escolhido entre as tentativas; false tira. Só brand custom seu.",
    ),
  character: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Pra action=persona: slug OU id de um personagem SEU (pegue em sapiens_character action=list_mine). Passe null pra tirar o personagem do brand. O personagem precisa ter pelo menos uma imagem na galeria: são elas que viram as referências.",
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
    .describe("Pra action=generate e import: o nome do brand (≤40 chars). Vem exatamente como mandado. No generate, sem ele o Gemini sugere um; no import, vence o nome que vier dentro do arquivo."),
  fromSlug: z
    .string()
    .optional()
    .describe(
      "Pra action=generate: slug de um brand SEU cujo briefing vira a base da variação (o brand original não é tocado, nasce um novo). Com isso, `description` fica opcional. Só funciona em brand que guarda briefing (os criados a partir de ago/2026); veja em action=get, campo `brief`.",
    ),
  twist: z
    .string()
    .optional()
    .describe(
      "Pra action=generate: a torção aplicada sobre o briefing ('mais bruto', 'mais editorial', 'paleta clara'). Combina com fromSlug (variação de um brand seu) ou com description (torção sobre o briefing que você acabou de escrever). ≤400 chars.",
    ),
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
        // Ausente em servidor antigo: aí ninguém é favorito, e a lista segue igual.
        isFavorite: b.isFavorite === true,
      })),
      note:
        "Oficiais (curados) + os seus custom, os favoritos (isFavorite) primeiro. " +
        "Pra detalhe completo (voz + estilo de imagem): action=get slug=<slug>. " +
        "Pra criar um novo: action=generate. Pra marcar o escolhido: action=favorite.",
    };
  }

  // -------- favorite: marca/desmarca o escolhido entre as tentativas --------
  if (args.action === "favorite") {
    if (!args.slug) throw new Error("action=favorite exige slug de um brand custom SEU (pegue via action=list).");
    const isFavorite = args.isFavorite ?? true;
    const res: any = await convexMutation("brands:mcpSetBrandFavorite", {
      sessionToken,
      slug: args.slug.trim(),
      isFavorite,
    });
    return {
      ...res,
      note: isFavorite
        ? "Favorito marcado: ele sobe pro topo das suas listas e dos seletores do app. As outras tentativas ficam guardadas como estão. Pra juntar o projeto inteiro (o brand, as imagens, as notas de escolhida e tentativa), sapiens_collection."
        : "Favorito tirado: o brand volta pra ordem de sempre.",
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
    return {
      ...b,
      // O briefing só vem em brand seu (ou oficial) e só existe nos criados a
      // partir de ago/2026. Quando existe, é o atalho pra desenhar variações.
      briefNote: b.brief?.text
        ? `Esse brand guarda o briefing que gerou ele. Pra desenhar outra direção a partir dele: action=generate fromSlug=${b.slug} twist='mais bruto' (não toca neste aqui, nasce um brand novo).`
        : "Esse brand não guarda o briefing (nasceu antes disso existir), então variação por fromSlug não funciona nele. Pra criar um parecido, escreva a description na mão.",
    };
  }

  // -------- generate: cria design system novo (cobra Sinapses) --------
  if (args.action === "generate") {
    const description = (args.description || "").trim();
    const fromSlug = args.fromSlug?.trim();
    // Com fromSlug o briefing vem do brand de origem (o servidor lê e confere a
    // posse), então a description deixa de ser obrigatória.
    if (!fromSlug && description.length < 30) {
      throw new Error(
        "action=generate exige description com pelo menos 30 chars (vibe, cores, voz, referências). " +
          "Quanto mais rico, melhor o brand. Converse com o user e monte a descrição antes de chamar. " +
          "Pra variar um brand que já é dele, use fromSlug=<slug> (+ twist='mais bruto').",
      );
    }
    const res: any = await convexAction("customBrandsActions:mcpGenerateBrand", {
      sessionToken,
      description,
      name: args.name?.trim() || undefined,
      fromSlug: fromSlug || undefined,
      twist: args.twist?.trim() || undefined,
    });
    return {
      ...res,
      cardNote:
        res.cardTier === "premium"
          ? `Card premium gerado (gpt-image-2). Debitado: ${res.cost} Sinapses (texto + card).`
          : `Card premium falhou, caiu no pôster SVG (grátis). Debitado só o texto: ${res.cost} Sinapses. Pra tentar de novo: action=card slug=` +
            res.slug,
      viewUrl: `${APP}/experimentos/brands`,
      next:
        "Ajustar: action=refine slug=" +
        res.slug +
        " feedback='...'. Regenerar uma peça: action=reroll slug=" +
        res.slug +
        " piece=voice|palette|imageStyle. Outra direção do MESMO briefing: " +
        "action=generate fromSlug=" +
        res.slug +
        " twist='mais bruto'.",
    };
  }

  // -------- import: transcreve brand de fora, sem IA (grátis) --------
  if (args.action === "import") {
    let raw: unknown = args.brand;
    // Cliente que serializa `any` manda string JSON: confere aqui e segue.
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw new Error("action=import: `brand` chegou como texto que não é JSON. Mande o objeto do design system.");
      }
    }
    if (!raw || typeof raw !== "object") {
      throw new Error(
        "action=import exige `brand` com o design system que já existe (name, palette, typography; voz e imagem opcionais). " +
          "Pra CRIAR um brand do zero a partir de uma descrição, o caminho é action=generate.",
      );
    }
    const res: any = await convexAction("customBrandsActions:mcpImportBrand", {
      sessionToken,
      // Vai como TEXTO: o cliente do Convex recusa campo com `$` ($value,
      // $type do design token) e fora do ASCII; o servidor faz o parse.
      brand: JSON.stringify(raw),
      source: args.source?.trim() || undefined,
      name: args.name?.trim() || undefined,
    });
    return {
      ...res,
      viewUrl: `${APP}/experimentos/brands`,
      next:
        "Logo: suba a imagem com sapiens_gallery action=upload e rode action=logo slug=" +
        res.slug +
        " handle=img_…. Card premium (pago): action=card slug=" +
        res.slug +
        ". Carrossel nesse brand: sapiens_carrossel action=generate brandSlug=" +
        res.slug +
        " (ou escolha no Tema do editor).",
    };
  }

  // -------- font: arquivo da fonte que não é do Google Fonts (grátis) --------
  if (args.action === "font") {
    if (!args.slug) throw new Error("action=font exige slug de um brand custom SEU (pegue via action=list).");
    if (!args.role) throw new Error("action=font exige role=headline|body|mono (o papel da fonte no brand).");
    const base64 = await resolveFontBytes(args);
    const res: any = await convexAction("customBrandsActions:mcpUploadBrandFont", {
      sessionToken,
      slug: args.slug.trim(),
      role: args.role,
      ...(args.family?.trim() ? { family: args.family.trim() } : {}),
      base64,
    });
    return {
      ...res,
      note:
        `Arquivo da ${res.family} no papel ${res.role}. O carrossel, o preview e a gaveta do brand passam a desenhar com ele. ` +
        "Só suba fonte com licença pra uso na web (Google Fonts e Fontshare liberam; fonte comprada, confira a licença).",
    };
  }

  // -------- logo: pelo ID da imagem na galeria do user (grátis) --------
  if (args.action === "logo") {
    if (!args.slug) throw new Error("action=logo exige slug de um brand custom SEU (pegue via action=list).");
    if (args.handle === undefined) {
      throw new Error(
        "action=logo exige handle=img_… (a imagem da logo na sua galeria; suba com sapiens_gallery action=upload) ou handle=null pra tirar.",
      );
    }
    const res: any = await convexMutation("brands:mcpSetBrandLogo", {
      sessionToken,
      slug: args.slug.trim(),
      handle: args.handle === null ? null : args.handle.trim(),
      wordmark: args.wordmark?.trim() || undefined,
    });
    return {
      ...res,
      note: res.logo
        ? "Logo no brand: ela assina o carrossel e entra nas imagens com brandMark=logo."
        : "Logo tirada do brand.",
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
        "). Edita à vontade com action=refine, ou gera imagem 'nessa marca'. A persona do original não vem junto: pra pôr um personagem SEU no lugar, action=persona slug=" +
        res.slug +
        " character=<slug do seu personagem>.",
    };
  }

  // -------- persona: pluga/tira o personagem do brand custom do user --------
  if (args.action === "persona") {
    if (!args.slug) {
      throw new Error("action=persona exige slug de um brand custom SEU (pegue via action=list).");
    }
    if (args.character === undefined) {
      throw new Error(
        "action=persona exige character=<slug ou id de um personagem SEU> (lista em sapiens_character action=list_mine), ou character=null pra tirar o personagem do brand.",
      );
    }
    const res: any = await convexMutation("brands:mcpSetBrandPersona", {
      sessionToken,
      slug: args.slug.trim(),
      character: args.character === null ? null : args.character.trim(),
    });
    return {
      ...res,
      viewUrl: `${APP}/experimentos/brands`,
      note: res.persona
        ? `${res.persona.label} é a cara desse brand agora (${res.persona.refCount} refs tiradas da galeria dele). ` +
          `Pra ele aparecer de verdade na imagem, a marca tem que ser persona: sapiens_image action=generate ` +
          `brandSlug=${res.slug} brandMark=persona prompt='...'. As refs são um retrato do momento: mexeu na ` +
          `galeria do personagem, roda esta action de novo pra atualizar.`
        : "Personagem tirado do brand: as imagens voltam a ser cena e objeto, só no estilo dele.",
    };
  }
}

// Os bytes do arquivo de fonte: arquivo local (stdio), URL pública (o fetch roda
// aqui, então com a mesma régua de host do upload da galeria) ou base64 pronto.
// O formato quem confere é o servidor, pelos bytes.
const FONT_MAX_BYTES = 2 * 1024 * 1024;

async function resolveFontBytes(args: BrandArgs): Promise<string> {
  if (args.base64?.trim()) return args.base64.trim().replace(/^data:[^;]+;base64,/, "");
  if (args.filePath) {
    if (isRemoteContext()) throw new Error("filePath só funciona no MCP instalado (stdio). No remoto, mande sourceUrl.");
    const buf = await readFile(args.filePath);
    if (buf.byteLength > FONT_MAX_BYTES) throw new Error("Arquivo de fonte grande demais (teto 2 MB). Prefira o .woff2.");
    return buf.toString("base64");
  }
  if (args.sourceUrl) {
    const res = await fetchPublicHttps(args.sourceUrl, { timeoutMs: 30_000, maxBytes: FONT_MAX_BYTES });
    if (!res.ok) throw new Error(`Baixar a fonte falhou: HTTP ${res.status}`);
    return res.bytes.toString("base64");
  }
  throw new Error("action=font exige o arquivo: filePath (local, stdio), sourceUrl (https) ou base64.");
}

