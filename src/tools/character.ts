import { z } from "zod";
import { httpUrl } from "../schema.js";
import { convexQuery, convexMutation, getSessionToken } from "../convexClient.js";

/**
 * sapiens_character — personagens (character sheets) do Sapiens.
 *
 * "Character" aqui é a tabela `influencers`: personagem reutilizável com
 * imagens (pra character-lock em geração) + alma (systemPrompt). Tudo amarrado
 * à conta do dono do sessionToken. Sem nada de admin.
 *
 * Sub-actions:
 *   - list_public:  catálogo global de personagens públicos (Explorar). Cada um
 *                   traz mainImageUrl/imageUrls usáveis como referência em
 *                   sapiens_image (referenceImageUrls). Sem custo.
 *   - get:          detalhe de 1 personagem por id. Público+ativo: qualquer um.
 *                   Draft/privado: só o dono. systemPrompt só volta pro dono.
 *   - list_mine:    os personagens do próprio user (inclui drafts/privados).
 *   - create:       cria um personagem (rascunho) na conta. name + gender.
 *   - add_image:    adiciona imagem ao próprio personagem (imageUrl direto ou
 *                   sourceImageId da galeria). 1ª imagem vira a principal.
 *   - set_card:     edita a alma (systemPrompt), título e/ou nome do próprio.
 *   - activate:     publica (sai de draft). Exige ≥1 imagem.
 *   - set_visibility: público (entra no Explorar, ganha slug) ou privado.
 *   - remove_image: tira UMA imagem do próprio personagem (por url).
 *   - set_main_image: define a principal (por url, entre as que já existem).
 *   - reorder_images: reordena as imagens (posição 0 = principal).
 *   - delete:       apaga o próprio personagem (permanente).
 *
 * Fluxo típico de criação: create → add_image (1+) → set_card (opcional) →
 * activate → set_visibility isPublic=true.
 */

export const characterSchema = z.object({
  action: z.enum([
    "list_public",
    "get",
    "list_mine",
    "create",
    "add_image",
    "set_card",
    "activate",
    "set_visibility",
    "remove_image",
    "set_main_image",
    "reorder_images",
    "delete",
  ]),
  characterId: z
    .string()
    .optional()
    .describe(
      "ID do personagem (influencers:_id). Obrigatório em get/add_image/set_card/activate/set_visibility. Descubra via list_public ou list_mine.",
    ),
  limit: z
    .number()
    .int()
    .optional()
    .describe("Pra list_public: quantos retornar (default 100, max 200)."),
  name: z
    .string()
    .optional()
    .describe("Pra create (obrigatório) ou set_card (renomear): nome do personagem."),
  gender: z
    .string()
    .optional()
    .describe("Pra create: 'masculino' | 'feminino' | 'nao-binario'. Default 'nao-binario'."),
  title: z
    .string()
    .optional()
    .describe("Pra create/set_card: subtítulo curto (ex: 'A guia do Sapiens')."),
  systemPrompt: z
    .string()
    .optional()
    .describe(
      "Pra create/set_card: a 'alma' do personagem (personalidade, jeito de falar, contexto). Usado no chat e como guia de geração.",
    ),
  imageUrl: httpUrl()
    .optional()
    .describe(
      "Pra add_image: URL pública da imagem (Bunny CDN / Convex storage). Use a `url` que sapiens_image/sapiens_gallery devolvem. Pra remove_image/set_main_image: a url da imagem JÁ no personagem (pegue via action=get, campo imageUrls).",
    ),
  orderedUrls: z
    .array(z.string())
    .optional()
    .describe(
      "Pra reorder_images: as urls das imagens do personagem na nova ordem (posição 0 = principal). url ausente vai pro fim, nenhuma se perde. Pegue as urls atuais via action=get.",
    ),
  sourceImageId: z
    .string()
    .optional()
    .describe(
      "Pra add_image: alternativa ao imageUrl — ID de imagem da SUA galeria (generatedImages:_id, via sapiens_gallery action=list). O backend resolve a url e confere que é sua.",
    ),
  isMain: z
    .boolean()
    .optional()
    .describe("Pra add_image: marca esta como a imagem principal (avatar). 1ª imagem já vira main sozinha."),
  isPublic: z
    .boolean()
    .optional()
    .describe("Pra set_visibility: true = público no Explorar (gera slug), false = privado."),
});

export type CharacterArgs = z.infer<typeof characterSchema>;

export async function character(args: CharacterArgs): Promise<any> {
  // -------- list_public: catálogo global (sessionToken opcional, marca `mine`) --------
  if (args.action === "list_public") {
    let sessionToken: string | undefined;
    try {
      sessionToken = getSessionToken();
    } catch {
      sessionToken = undefined; // catálogo público funciona sem login
    }
    return await convexQuery("influencers:mcpListPublicCharacters", {
      sessionToken,
      limit: args.limit,
    });
  }

  // -------- get: detalhe de 1 personagem --------
  if (args.action === "get") {
    if (!args.characterId) {
      throw new Error("action=get exige characterId (pegue via list_public ou list_mine).");
    }
    let sessionToken: string | undefined;
    try {
      sessionToken = getSessionToken();
    } catch {
      sessionToken = undefined;
    }
    const res = await convexQuery("influencers:mcpGetCharacter", {
      sessionToken,
      characterId: args.characterId,
    });
    if (!res) {
      throw new Error(
        `Personagem "${args.characterId}" não encontrado (ou é privado de outro user).`,
      );
    }
    return res;
  }

  // -------- list_mine: personagens do próprio user (inclui drafts) --------
  if (args.action === "list_mine") {
    const sessionToken = getSessionToken();
    return await convexQuery("influencers:mcpListMyCharacters", { sessionToken });
  }

  // -------- create: novo rascunho na conta --------
  if (args.action === "create") {
    if (!args.name || !args.name.trim()) {
      throw new Error("action=create exige 'name'.");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpCreateCharacter", {
      sessionToken,
      name: args.name,
      gender: args.gender,
      title: args.title,
      systemPrompt: args.systemPrompt,
    });
  }

  // -------- add_image: imagem no próprio personagem --------
  if (args.action === "add_image") {
    if (!args.characterId) throw new Error("action=add_image exige characterId.");
    if (!args.imageUrl && !args.sourceImageId) {
      throw new Error("action=add_image exige 'imageUrl' ou 'sourceImageId'.");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpAddCharacterImage", {
      sessionToken,
      characterId: args.characterId,
      imageUrl: args.imageUrl,
      sourceImageId: args.sourceImageId,
      isMain: args.isMain,
    });
  }

  // -------- set_card: alma/título/nome do próprio personagem --------
  if (args.action === "set_card") {
    if (!args.characterId) throw new Error("action=set_card exige characterId.");
    if (args.systemPrompt === undefined && args.title === undefined && args.name === undefined) {
      throw new Error("action=set_card precisa de pelo menos um: systemPrompt, title ou name.");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterCard", {
      sessionToken,
      characterId: args.characterId,
      systemPrompt: args.systemPrompt,
      title: args.title,
      name: args.name,
    });
  }

  // -------- activate: publica (sai de draft, exige ≥1 imagem) --------
  if (args.action === "activate") {
    if (!args.characterId) throw new Error("action=activate exige characterId.");
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpActivateCharacter", {
      sessionToken,
      characterId: args.characterId,
    });
  }

  // -------- set_visibility: público (Explorar) ou privado --------
  if (args.action === "set_visibility") {
    if (!args.characterId) throw new Error("action=set_visibility exige characterId.");
    if (args.isPublic === undefined) {
      throw new Error("action=set_visibility exige isPublic (true=público, false=privado).");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterVisibility", {
      sessionToken,
      characterId: args.characterId,
      isPublic: args.isPublic,
    });
  }

  // -------- remove_image: tira UMA imagem (por url) --------
  if (args.action === "remove_image") {
    if (!args.characterId) throw new Error("action=remove_image exige characterId.");
    if (!args.imageUrl) throw new Error("action=remove_image exige imageUrl (a url da imagem no personagem; veja em action=get).");
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpRemoveCharacterImage", {
      sessionToken,
      characterId: args.characterId,
      imageUrl: args.imageUrl,
    });
  }

  // -------- set_main_image: define a principal (por url) --------
  if (args.action === "set_main_image") {
    if (!args.characterId) throw new Error("action=set_main_image exige characterId.");
    if (!args.imageUrl) throw new Error("action=set_main_image exige imageUrl (uma das imagens já no personagem; veja em action=get).");
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpSetCharacterMainImage", {
      sessionToken,
      characterId: args.characterId,
      imageUrl: args.imageUrl,
    });
  }

  // -------- reorder_images: nova ordem (posição 0 = principal) --------
  if (args.action === "reorder_images") {
    if (!args.characterId) throw new Error("action=reorder_images exige characterId.");
    if (!args.orderedUrls || args.orderedUrls.length === 0) {
      throw new Error("action=reorder_images exige orderedUrls (as urls na nova ordem; veja em action=get).");
    }
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpReorderCharacterImages", {
      sessionToken,
      characterId: args.characterId,
      orderedUrls: args.orderedUrls,
    });
  }

  // -------- delete: apaga o próprio personagem (permanente) --------
  if (args.action === "delete") {
    if (!args.characterId) throw new Error("action=delete exige characterId.");
    const sessionToken = getSessionToken();
    return await convexMutation("influencers:mcpDeleteCharacter", {
      sessionToken,
      characterId: args.characterId,
    });
  }
}
