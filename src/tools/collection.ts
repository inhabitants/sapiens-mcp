import { z } from "zod";
import { convexQuery, convexMutation, getSessionToken } from "../convexClient.js";

/**
 * Collections: o álbum generalizado do Acervo, operado pelo agente. Uma
 * Collection junta as peças de um mesmo mundo (imagens, vídeos, o design
 * system, o personagem, a música) e cada peça leva uma NOTA do dono. É o lugar
 * do "escolhido entre as tentativas": as tentativas e a escolhida na mesma
 * Collection, cada uma com a sua nota, a escolhida no topo.
 *
 * Sub-actions:
 *   - list:    as Collections do user (rascunho e publicadas). Grátis.
 *   - get:     uma Collection (por id ou slug) com as peças, na ordem, e as notas.
 *   - create:  nasce uma Collection, rascunho e privada (title obrigatório).
 *   - update:  troca nome e descrição.
 *   - add:     põe uma peça (itemType + refId, com nota opcional). Peça que já
 *              está dentro e chega com nota tem a nota trocada.
 *   - remove:  tira uma peça (a peça em si não é tocada).
 *   - note:    troca a nota de uma peça que já está dentro (sem note, apaga).
 *   - reorder: nova ordem pelos refId, o primeiro no topo; os não citados vêm
 *              depois, na ordem em que estavam.
 *
 * Publicar a Collection e escolher capa são gestos do dono no Acervo, de
 * propósito: Collection publicada não volta a rascunho.
 *
 * Auth: qualquer conta logada (sessionToken). Só mexe nas Collections e nas
 * peças da própria conta.
 */

const APP = "https://sapiensinteticos.com";

export const collectionSchema = z.object({
  action: z.enum(["list", "get", "create", "update", "add", "remove", "note", "reorder"]),
  collection: z
    .string()
    .optional()
    .describe(
      "A Collection: o id OU o slug (o nome também serve, ele vira slug). Obrigatório em get/update/add/remove/note/reorder. As suas saem em action=list.",
    ),
  title: z
    .string()
    .optional()
    .describe("Pra action=create (obrigatório) e update: o nome da Collection, até 80 caracteres."),
  description: z
    .string()
    .optional()
    .describe("Pra action=create e update: uma linha sobre o mundo que a Collection junta, até 600 caracteres."),
  itemType: z
    .string()
    .optional()
    .describe(
      "Pra add/remove/note: o tipo da peça. image (imageId de sapiens_image/sapiens_gallery), video (o mesmo id da galeria), brand (o design system: aceita o SLUG, ex 'adult-blue-madrugada'), character (characterId), track (música), article, aula, carousel, comic, sticker, fita, app.",
    ),
  refId: z
    .string()
    .optional()
    .describe("Pra add/remove/note: o id da peça (no brand, o slug serve)."),
  note: z
    .string()
    .optional()
    .describe(
      "Pra add e note: a nota do dono sobre a peça DENTRO desta Collection, até 240 caracteres. Pra marcar o escolhido de um projeto: 'escolhida' na que venceu e 'tentativa' nas outras.",
    ),
  refIds: z
    .array(z.string())
    .optional()
    .describe(
      "Pra action=reorder: os refId na ordem nova, o primeiro vai pro topo. Basta citar os que mudam de lugar: 'põe a escolhida em primeiro' é mandar só o refId dela.",
    ),
});

export type CollectionArgs = z.infer<typeof collectionSchema>;

function exigir<T>(valor: T | undefined, mensagem: string): T {
  if (valor === undefined || valor === null || (typeof valor === "string" && !valor.trim())) {
    throw new Error(mensagem);
  }
  return valor;
}

export async function collection(args: CollectionArgs): Promise<any> {
  const sessionToken = getSessionToken();
  const qual = () =>
    exigir(args.collection, `action=${args.action} exige collection (o id ou o slug; as suas saem em action=list).`).trim();
  const peca = () => ({
    itemType: exigir(args.itemType, `action=${args.action} exige itemType (image, video, brand, character...).`).trim(),
    refId: exigir(args.refId, `action=${args.action} exige refId (o id da peça; no brand, o slug serve).`).trim(),
  });

  if (args.action === "list") {
    const cols: any[] = await convexQuery("collections:mcpListCollections", { sessionToken });
    return {
      count: Array.isArray(cols) ? cols.length : 0,
      collections: cols,
      note:
        "No site, as suas Collections moram no seu perfil, nas Criações privadas, aba Collections " +
        `(${APP}/u/<seu @>?tab=private&criacoes=collections). As publicadas também aparecem na aba Collections do Acervo.`,
    };
  }

  if (args.action === "get") {
    return await convexQuery("collections:mcpGetCollection", { sessionToken, collection: qual() });
  }

  if (args.action === "create") {
    const title = exigir(args.title, "action=create exige title (o nome da Collection).").trim();
    const res: any = await convexMutation("collections:mcpCreateCollection", {
      sessionToken,
      title,
      description: args.description?.trim() || undefined,
    });
    return {
      ...res,
      note:
        "Collection criada, rascunho e privada. Junte as peças com action=add collection=" +
        res.slug +
        ". Publicar e escolher capa são no Acervo, pelo dono.",
    };
  }

  if (args.action === "update") {
    if (args.title === undefined && args.description === undefined) {
      throw new Error("action=update exige title ou description.");
    }
    return await convexMutation("collections:mcpUpdateCollection", {
      sessionToken,
      collection: qual(),
      title: args.title,
      description: args.description,
    });
  }

  if (args.action === "add") {
    return await convexMutation("collections:mcpAddCollectionItem", {
      sessionToken,
      collection: qual(),
      ...peca(),
      note: args.note,
    });
  }

  if (args.action === "remove") {
    return await convexMutation("collections:mcpRemoveCollectionItem", {
      sessionToken,
      collection: qual(),
      ...peca(),
    });
  }

  if (args.action === "note") {
    return await convexMutation("collections:mcpSetCollectionItemNote", {
      sessionToken,
      collection: qual(),
      ...peca(),
      note: args.note,
    });
  }

  if (args.action === "reorder") {
    const refIds = exigir(args.refIds, "action=reorder exige refIds (a ordem nova, o primeiro no topo).");
    return await convexMutation("collections:mcpReorderCollection", {
      sessionToken,
      collection: qual(),
      refIds,
    });
  }
}
