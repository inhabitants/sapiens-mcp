import { z } from "zod";
import { convexAction, getSessionToken } from "../convexClient.js";

/**
 * sapiens_reference — o "popup global de referência" do Sapiens via MCP.
 *
 * Espelha o modal "Selecionar Referência" do gerador web: um lugar só pra
 * navegar os bancos e pegar o que vira referência em imagem (sapiens_image) ou
 * vídeo (sapiens_video).
 *
 * Buckets (os 4 tabs do popup, completos):
 *   - history    imagens recentes do user (privadas + públicas)
 *   - favorites  imagens que o user curtiu (só as suas)
 *   - videos     vídeos do user (Meus Vídeos)
 *   - stock_video Banco de Vídeo da casa (clipes/B-roll); aceita `term`/`orientation`/`loopOnly`
 *   - acervo     stock + comunidade de IMAGEM (público); aceita `term` (busca) e `source`
 *   - characters personagens; `mode` = 'mine' (default) ou 'public'
 *
 * Cada item volta normalizado:
 *   - imagem PRÓPRIA (history/favorites): `imageId` + `url` → use imageId em
 *     sourceImageIds / startImageId / endImageId, ou url em referenceImageUrls.
 *   - acervo (stock/comunidade) e characters: use a `url` em referenceImageUrls
 *     (e startImageUrl/endImageUrl no vídeo). characters também trazem
 *     `characterId` + `imageUrls` (todas as imagens do personagem).
 */
export const referenceSchema = z.object({
  action: z
    .enum(["browse"])
    .describe("Só 'browse' por enquanto: navega um bucket do acervo."),
  bucket: z
    .enum(["history", "favorites", "videos", "stock_video", "acervo", "characters"])
    .describe(
      "Qual banco navegar: 'history' (suas imagens recentes), 'favorites' (as que você curtiu), " +
        "'videos' (seus vídeos), 'stock_video' (Banco de Vídeo da casa: clipes/B-roll prontos, aceita term/orientation/loopOnly), " +
        "'acervo' (stock + comunidade públicos de IMAGEM), 'characters' (personagens).",
    ),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Página (default 1). Use com hasMore pra paginar."),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe("Itens por página (default 20, máx 50)."),
  term: z
    .string()
    .optional()
    .describe("Buckets 'acervo' e 'stock_video': busca por texto (prompt/título/tag/mood). Ex: 'chuva'."),
  source: z
    .enum(["all", "stock", "community"])
    .optional()
    .describe("Só bucket 'acervo': fonte. Default 'all' (stock + comunidade)."),
  orientation: z
    .enum(["vertical", "horizontal", "square"])
    .optional()
    .describe("Só bucket 'stock_video': filtra formato (vertical 9:16, horizontal 16:9, square 1:1)."),
  loopOnly: z
    .boolean()
    .optional()
    .describe("Só bucket 'stock_video': só clipes loopFriendly (loop limpo, bom pra fundo)."),
  mode: z
    .enum(["mine", "public"])
    .optional()
    .describe(
      "Só bucket 'characters': 'mine' (seus personagens, inclui rascunhos; default) ou 'public' (catálogo do Explorar).",
    ),
});

export type ReferenceArgs = z.infer<typeof referenceSchema>;

export async function reference(args: ReferenceArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "browse") {
    const res: any = await convexAction("mcpReferences:referenceBrowse", {
      sessionToken,
      bucket: args.bucket,
      page: args.page,
      limit: args.limit,
      term: args.term,
      source: args.source,
      orientation: args.orientation,
      loopOnly: args.loopOnly,
      mode: args.mode,
    });

    let note: string;
    if (args.bucket === "videos") {
      note =
        "Cada item é um vídeo seu (imageId reusável em sapiens_video action=generate). Pra frame inicial/final de um vídeo NOVO use uma IMAGEM (bucket history/favorites/acervo/characters).";
    } else if (args.bucket === "stock_video") {
      note =
        "Clipes do Banco de Vídeo da casa (B-roll pronto). Use a `url` do clipe: como referência de vídeo em sapiens_video (mesma rail do Meus Vídeos), de fundo/atmosfera, ou baixe direto. orientation/durationSeconds/loopFriendly ajudam a escolher. Não são imagem: NÃO servem de frame inicial/final (pra frame use uma IMAGEM).";
    } else if (args.bucket === "acervo" || args.bucket === "characters") {
      note =
        "São referências públicas: use a `url` (characters trazem mainImageUrl + imageUrls) em sapiens_image referenceImageUrls, ou em sapiens_video startImageUrl/endImageUrl. Não são suas, então NÃO entram em sourceImageIds.";
    } else {
      note =
        "Pra usar como referência: em sapiens_image passe o imageId em sourceImageIds (ou a url em referenceImageUrls); em sapiens_video passe startImageId/endImageId (ou startImageUrl/endImageUrl).";
    }
    return { ...res, note };
  }
}
