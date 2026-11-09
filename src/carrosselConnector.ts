import { z, ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { carrossel } from "./tools/carrossel.js";
import { describeConvexError, getSessionToken, touchSession } from "./convexClient.js";

/**
 * O CONECTOR DO CARROSSEL (Sint.fyi Carousel): a superfície enxuta que vai pro
 * diretório oficial de conectores do Claude, servida em /api/mcp/carrossel.
 *
 * Por que existe à parte do sapiens-mcp inteiro: a política do diretório
 * (Anthropic Software Directory Policy) barra conector que GERA imagem, vídeo
 * ou áudio por IA (4B), conteúdo adulto (4D) e instrução de comportamento
 * puxada de fonte externa (2F). O MCP da casa tem os três. Este aqui é só o
 * caminho GRÁTIS do carrossel: o Claude da pessoa escreve, a casa grava, as
 * fotos saem do banco público da casa, e a pessoa baixa pelo link do editor.
 *
 * Regras desta superfície (não afrouxe sem reler a política):
 *   - Nenhuma tool cobra Sinapse nem gera mídia. Gerar foto, capa IA, escolher
 *     foto por IA e o generate pago ficam no conector completo.
 *   - Foto só do banco da casa (stockImageId). O handle img_… do conector
 *     completo abre peça de qualquer acervo público, e isso inclui +18.
 *   - Uma tool por verbo, com readOnlyHint/destructiveHint honestos: o
 *     diretório exige as duas marcas em toda tool, e tool multi-action não tem
 *     como declarar as duas com verdade.
 *   - As descrições são em inglês (o diretório é global e o revisor lê em
 *     inglês); o Claude responde na língua da pessoa.
 *
 * Reusa o handler da sapiens_carrossel (tools/carrossel.ts): as mesmas funções
 * Convex, a mesma posse por createdBy, o mesmo rate-limit de criação.
 */

const CAROUSEL_ID = z
  .string()
  .min(1)
  .describe("The carousel id (returned by create_carousel and list_carousels).");

const PAYLOAD = z
  .any()
  .describe(
    "The WHOLE carousel payload, in the exact shape get_carousel returns: { theme: { palette, sheet, signature, brand?, fonts? }, slides: [{ id, templateId, slots, image }], meta }. " +
      "Pick each slide's templateId from the layout catalog in get_carousel (role: cover, body, cta; requiresImage tells which layouts show a photo) and fill ONLY the slots that layout declares, within each slot's character limit. " +
      "Keep the image field of slides you did not touch and keep the theme as get_carousel returned it: anything missing falls back to the default. " +
      "Photos never enter by URL here: use set_slide_photo with a photo id from search_photos.",
  );

const SCHEMAS = {
  create_carousel: z.object({
    title: z.string().optional().describe("A short title for the carousel (optional; it names the download)."),
    aspect: z
      .enum(["4:5", "9:16"])
      .optional()
      .describe("Slide size. '4:5' (default: the Instagram feed shows it whole) or '9:16' (full screen, Stories/Reels)."),
    payload: PAYLOAD.optional(),
  }),
  get_carousel: z.object({ carouselId: CAROUSEL_ID }),
  update_carousel: z.object({
    carouselId: CAROUSEL_ID,
    payload: PAYLOAD,
    title: z.string().optional().describe("Rename the carousel (optional)."),
    baseUpdatedAt: z
      .number()
      .optional()
      .describe(
        "The updatedAt that get_carousel returned. Always send it: if the carousel changed after your read (the person edited it in the editor), the update is refused instead of overwriting their edit. Then call get_carousel again and reapply.",
      ),
  }),
  list_carousels: z.object({}),
  search_photos: z.object({
    query: z
      .string()
      .optional()
      .describe("What the photo shows, in plain words (e.g. 'coffee cup', 'hands kneading dough', 'city at night'). Portuguese or English. Without a query, returns the newest photos."),
    orientation: z
      .enum(["vertical", "horizontal", "square"])
      .optional()
      .describe("Filter by photo shape. For 4:5 or 9:16 slides, prefer 'vertical'."),
    limit: z.number().int().min(1).max(40).optional().describe("How many photos (default 12, max 40)."),
  }),
  set_slide_photo: z.object({
    carouselId: CAROUSEL_ID,
    slideId: z.string().min(1).describe("The slide id (from get_carousel)."),
    photoId: z.string().min(1).describe("The id of a photo from search_photos."),
    focalX: z.number().min(0).max(1).optional().describe("Horizontal focal point, 0 to 1 (default 0.5)."),
    focalY: z.number().min(0).max(1).optional().describe("Vertical focal point, 0 to 1 (default 0.5)."),
  }),
} as const;

type ToolName = keyof typeof SCHEMAS;

type ToolDef = {
  title: string;
  description: string;
  /** Anotações MCP: o diretório exige readOnlyHint e destructiveHint em toda tool. */
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  handler: (args: any) => Promise<unknown>;
};

const TOOLS: Record<ToolName, ToolDef> = {
  create_carousel: {
    title: "Create carousel",
    description:
      "Creates a new Instagram carousel in the person's account and returns its id and the link where they open, review and download the slides. Free. " +
      "Usual start: call it with no payload, then get_carousel to read the layout catalog, then update_carousel with the slides you wrote. Pass a payload only if you already know the layouts.",
    readOnly: false,
    destructive: false,
    idempotent: false,
    handler: (a) =>
      carrossel({ action: "create", title: a.title, aspect: a.aspect, payload: a.payload }),
  },
  get_carousel: {
    title: "Read carousel",
    description:
      "Reads one of the person's carousels: the whole payload, its updatedAt, the link to the editor, and the catalog you need to write slides (layouts with their slots and character limits, palettes, slide sizes, signature). Read it before every update_carousel.",
    readOnly: true,
    destructive: false,
    idempotent: true,
    handler: (a) => carrossel({ action: "get", carouselId: a.carouselId }),
  },
  update_carousel: {
    title: "Write carousel slides",
    description:
      "Replaces the carousel's content with the payload you send (the slides, their text and layout, the theme), normalized on the server. Free. " +
      "It overwrites what is there, so always start from the latest get_carousel and send its updatedAt as baseUpdatedAt.",
    readOnly: false,
    destructive: true,
    idempotent: true,
    handler: (a) =>
      carrossel({
        action: "update",
        carouselId: a.carouselId,
        payload: a.payload,
        title: a.title,
        baseUpdatedAt: a.baseUpdatedAt,
      }),
  },
  list_carousels: {
    title: "List my carousels",
    description: "Lists the person's carousels (id, title, slide count, last update, editor link), newest first.",
    readOnly: true,
    destructive: false,
    idempotent: true,
    handler: () => carrossel({ action: "list" }),
  },
  search_photos: {
    title: "Search free photos",
    description:
      "Searches the free photo bank by subject and returns photo ids with title, description, tags, size and a thumbnail. Use the id in set_slide_photo. Free.",
    readOnly: true,
    destructive: false,
    idempotent: true,
    handler: async (a) => {
      const { dica: _dicaDoCompleto, ...fotos }: any = await carrossel({
        action: "search_images",
        query: a.query,
        orientation: a.orientation,
        limit: a.limit,
      });
      // A dica do handler fala das actions do conector completo (set_image).
      return {
        ...fotos,
        tip: "Put a photo on a slide with set_slide_photo (carouselId, slideId, photoId). Only layouts with requiresImage in get_carousel show a photo.",
      };
    },
  },
  set_slide_photo: {
    title: "Put photo on slide",
    description:
      "Puts a photo from the free bank (the id from search_photos) on one slide of the carousel, replacing the slide's current photo. Only layouts with requiresImage show it. Free.",
    readOnly: false,
    destructive: false,
    idempotent: true,
    handler: (a) =>
      carrossel({
        action: "set_image",
        carouselId: a.carouselId,
        slideId: a.slideId,
        stockImageId: a.photoId,
        focalX: a.focalX,
        focalY: a.focalY,
      }),
  },
};

/** As instruções do handshake: o fluxo inteiro, porque esta superfície não tem skill. */
export const CARROSSEL_INSTRUCTIONS = `Sint.fyi Carousel makes Instagram carousels with the person, for free. They tell you the topic; you write the slides, pick photos from the free photo bank, and hand them a link where they review the slides and download them ready to post.

The flow:
1. create_carousel (no payload) -> you get the carousel id and the link.
2. get_carousel -> the payload plus the layout catalog: each layout's role (cover, body, cta), its slots with character limits, and requiresImage.
3. Write the slides and save them with update_carousel (the whole payload, with baseUpdatedAt). A good carousel: a cover that hooks, 5 to 8 body slides with one idea each, a closing call to action. Respect every slot's limit.
4. For each slide whose layout has requiresImage, search_photos by the slide's subject and set_slide_photo with the best match.
5. Send the person the link. They open it, check the slides and download them.

Write the slides in the person's language, in their voice, without filler. Ask for the topic and the audience if they did not say. Everything in this connector is free.`;

export const CARROSSEL_SERVER_NAME = "sint-carrossel";

/** O payload do tools/list desta superfície. */
export function buildCarrosselToolList() {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => {
    const t = TOOLS[name];
    return {
      name,
      description: t.description,
      inputSchema: zodToJsonSchema(SCHEMAS[name] as any) as any,
      annotations: {
        title: t.title,
        readOnlyHint: t.readOnly,
        destructiveHint: t.destructive,
        idempotentHint: t.idempotent,
        // Domínio fechado: só a conta da própria pessoa e o banco da casa.
        openWorldHint: false,
      },
    };
  });
}

export function isCarrosselTool(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOLS, name);
}

/** Dispatch de uma tool desta superfície, no mesmo shape de resultado do registry. */
export async function callCarrosselTool(
  name: string,
  rawArgs: unknown,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  if (!isCarrosselTool(name)) {
    return {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}. This connector's tools are: ${Object.keys(TOOLS).join(", ")}.`,
        },
      ],
      isError: true,
    };
  }
  // Renova a sessão por uso, como no registry (janela deslizante do servidor).
  try {
    await touchSession(getSessionToken());
  } catch {
    // sem sessão: a própria tool devolve o erro
  }
  try {
    const args = SCHEMAS[name].parse(rawArgs ?? {});
    const result = await TOOLS[name].handler(args);
    const structuredContent =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : { result };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent,
    };
  } catch (e: any) {
    const fix =
      e instanceof ZodError
        ? " -> Call again with the field fixed. Never repeat the identical call."
        : "";
    return {
      content: [{ type: "text", text: `Error: ${describeConvexError(e)}${fix}` }],
      isError: true,
    };
  }
}
