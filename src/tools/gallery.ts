import { z } from "zod";
import { convexAction, getSessionToken } from "../convexClient.js";

/**
 * Read-only do gallery do usuário desktop (imagens geradas via nanoBanana).
 * Wrapper sobre `desktopMcp.galleryList` / `desktopMcp.galleryGet`.
 *
 * Usado pra:
 *   - Listar imagens recentes do user (pra reusar como referenceImage)
 *   - Pegar bytes de uma imagem pra mostrar inline no Claude
 *   - Descobrir imageId pra passar como sourceImageId em sapiens_image edit/variation
 *   - Publicar/despublicar a própria imagem (galeria pública + feed Pinterest)
 */
export const gallerySchema = z.object({
  action: z.enum(["list", "get", "publish", "unpublish"]),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Default 20. Max 100. Só pra action=list."),
  model: z
    .string()
    .optional()
    .describe(
      "Filtro de model (action=list). Ex: 'nano-banana-max' pra ver só Pro.",
    ),
  imageId: z
    .string()
    .optional()
    .describe("generatedImages:_id (obrigatório pra action=get/publish/unpublish)"),
  includeBase64: z
    .boolean()
    .optional()
    .describe(
      "Default false. Quando true, action=get devolve os bytes em base64 (pesado, evite em listagens).",
    ),
});

export type GalleryArgs = z.infer<typeof gallerySchema>;

export async function gallery(args: GalleryArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "list") {
    const result = await convexAction("desktopMcp:galleryList", {
      sessionToken,
      limit: args.limit ?? 20,
      model: args.model,
    });
    return {
      count: result?.items?.length ?? 0,
      items: result?.items ?? [],
    };
  }

  if (args.action === "get") {
    if (!args.imageId) {
      throw new Error("action=get exige imageId.");
    }
    return await convexAction("desktopMcp:galleryGet", {
      sessionToken,
      imageId: args.imageId,
      includeBase64: args.includeBase64 ?? false,
    });
  }

  // publish/unpublish: liga/desliga isPublic na própria imagem. Public = entra
  // na galeria pública + feed Pinterest (e /imagem/<id> se não for degen).
  if (args.action === "publish" || args.action === "unpublish") {
    if (!args.imageId) {
      throw new Error(
        `action=${args.action} exige imageId. Use action=list pra descobrir.`,
      );
    }
    return await convexAction("desktopMcp:gallerySetPublic", {
      sessionToken,
      imageId: args.imageId,
      isPublic: args.action === "publish",
    });
  }
}
