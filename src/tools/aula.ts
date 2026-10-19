import { z } from "zod";
import { convexMutation, convexQuery, getSessionToken } from "../convexClient.js";
import { need } from "../schema.js";

/**
 * sapiens_aula — CRUD do deck de aula via session token.
 * ADMIN-ONLY (requireMcpAdmin no Convex): aula é conteúdo de mentor, não de
 * aluno. Substitui os scripts de disco: o Claude edita e publica direto no
 * Convex, fonte de verdade que o /aulas/<slug> lê.
 *
 * Duas famílias de sub-action, porque existem dois tipos de aula:
 *
 *   AULA MODULAR (tem `source = { recipe, modules[] }`, o padrão hoje): os
 *   slides são MATERIALIZADOS na leitura a partir da fonte. Editar o slide
 *   materializado não adianta, some no próximo materialize. Fluxo certo:
 *     map -> module -> module-save   (conteúdo)
 *     recipe-op                       (ordem dos módulos na aula)
 *     recipe-set                      (moldura: perguntas do bloco 01, close, blocos)
 *   O `map` é o índice barato: dá os blocos e os ids de módulo sem arrastar os
 *   45 slides junto. Só depois dele você sabe qual `moduleId` pedir.
 *
 *   AULA LEGADA (sem source): o `slides` É a fonte, e o caminho é get/upsert
 *   com o objeto inteiro.
 *
 * `meta` (título, série, data, duração, draft/published) e `delete` valem pras
 * duas.
 */

export const aulaSchema = z.object({
  action: z.enum([
    "list",
    "get",
    "map",
    "module",
    "module-save",
    "recipe-op",
    "recipe-set",
    "meta",
    "upsert",
    "delete",
  ]),
  slug: z
    .string()
    .optional()
    .describe(
      "kebab-case (a-z, 0-9, hífen), ex: 2026-06-25-minha-aula. Obrigatório em tudo menos list.",
    ),
  aula: z
    .any()
    .optional()
    .describe(
      "Objeto completo da aula (obrigatório pra upsert). Campos top-level: title (obrig), subtitle?, data? (YYYY-MM-DD), duration?, tag?, mentorAgenda?, slides[] (≥1). Cada slide é { type, ...campos }. Tipos: cover (eyebrow/title/subtitle/meta), cover-image/section-image/content-image (imageUrl + campos), agenda (items:[{num,title,subtitle,time}]), content (eyebrow/title/body[markdown ou HTML]/list[]/listType), two-col (cols:[{h,body}]), video (videoUrl OU videos:[{h,videoUrl,caption}] pra comparar lado a lado), quote (text/attribution), callout (tone:tip|warn|note/tag/body), comic (panels:[{imageUrl,caption}]), pause, close (eyebrow/title/items[]). Voz Sapiens: 1ª pessoa, anti-corporate, SEM travessão (—). O servidor re-linta a voz e grava voiceWarnings.",
    ),
  moduleId: z
    .string()
    .optional()
    .describe(
      "id do módulo dentro da fonte (kebab-case, ex: folha-tres-takes). Obrigatório pra module, module-save e recipe-op. Descubra os ids com action=map.",
    ),
  module: z
    .any()
    .optional()
    .describe(
      "action=module-save: o módulo inteiro { id, title, concept, audience[], slides[] }. Mesmo shape de slide do `aula.slides`. Omita (ou mande null) pra REMOVER o módulo da fonte e de todos os blocos.",
    ),
  placeAfter: z
    .string()
    .optional()
    .describe(
      "action=module-save de módulo NOVO: id de um módulo já na receita; o novo entra logo depois dele, no mesmo bloco. Alternativa ao `bloco`.",
    ),
  bloco: z
    .string()
    .optional()
    .describe(
      "Título do bloco da receita (ex: 'A Folha'). Em module-save de módulo novo, entra no fim desse bloco. Em recipe-op, é o bloco de destino.",
    ),
  field: z
    .enum([
      "duvidas.prompts",
      "duvidas.mais",
      "close.title",
      "close.eyebrow",
      "close.items",
      "bloco.titulo",
      "bloco.time",
      "bloco.agendaSub",
    ])
    .optional()
    .describe(
      "action=recipe-set: qual pedaço da MOLDURA editar. 'duvidas.prompts' são as perguntas na tela do bloco 01 e 'duvidas.mais' as da gaveta; 'close.*' é o cartão de fechamento; 'bloco.*' pede blocoIndex.",
    ),
  valorLista: z
    .array(z.string())
    .optional()
    .describe(
      "action=recipe-set: o valor pros campos de lista (duvidas.prompts, duvidas.mais, close.items). Substitui a lista inteira.",
    ),
  valorTexto: z
    .string()
    .optional()
    .describe(
      "action=recipe-set: o valor pros campos de texto (close.title, close.eyebrow, bloco.titulo, bloco.time, bloco.agendaSub).",
    ),
  blocoIndex: z
    .number()
    .optional()
    .describe(
      "action=recipe-set com field=bloco.*: qual bloco, por índice (0 = o primeiro). Descubra a ordem com action=map.",
    ),
  op: z
    .enum(["move", "remove", "add"])
    .optional()
    .describe(
      "action=recipe-op: 'move' reordena (use toIndex, e bloco pra mudar de bloco), 'remove' tira o módulo da aula sem apagar o conteúdo dele da fonte, 'add' cita na receita um módulo que já existe na fonte.",
    ),
  toIndex: z
    .number()
    .optional()
    .describe("action=recipe-op op=move|add: posição (0 = primeiro do bloco). Sem ele, vai pro fim."),
  title: z.string().optional().describe("action=meta: novo título."),
  subtitle: z.string().optional().describe("action=meta: novo subtítulo."),
  tag: z.string().optional().describe("action=meta: série/etiqueta (ex: 'Produção · Vídeo dirigido')."),
  data: z.string().optional().describe("action=meta: data YYYY-MM-DD."),
  duration: z.string().optional().describe("action=meta: duração legível (ex: '3h30')."),
  status: z
    .enum(["draft", "published"])
    .optional()
    .describe("action=meta: 'draft' tira do ar (só admin vê), 'published' põe no ar."),
  force: z
    .boolean()
    .optional()
    .describe(
      "action=delete: apaga mesmo estando publicada. Sem isso, aula no ar é recusada e o caminho é tirar de circulação antes (action=meta status=draft).",
    ),
});

export type AulaArgs = z.infer<typeof aulaSchema>;

export async function aula(args: AulaArgs): Promise<any> {
  const sessionToken = getSessionToken();

  switch (args.action) {
    case "list":
      return await convexQuery("mcpExtras:mcpListAulas", { sessionToken });

    case "get": {
      const slug = need(args.slug, "slug");
      const found = await convexQuery("mcpExtras:mcpGetAula", {
        sessionToken,
        slug,
      });
      return found ? { found: true, aula: found } : { found: false, slug };
    }

    case "map":
      return await convexQuery("mcpExtras:mcpAulaMap", {
        sessionToken,
        slug: need(args.slug, "slug"),
      });

    case "module":
      return await convexQuery("mcpExtras:mcpAulaModule", {
        sessionToken,
        slug: need(args.slug, "slug"),
        moduleId: need(args.moduleId, "moduleId"),
      });

    case "module-save": {
      // `module` é z.any(): cliente costuma serializar objeto sem tipo como
      // string JSON. Normaliza aqui (o servidor também parseia, mas o shape
      // certo sai daqui). Ausente vira null: é o sinal de remoção.
      let mod = args.module;
      if (typeof mod === "string") {
        try {
          mod = JSON.parse(mod);
        } catch {
          throw new Error('Arg "module" veio como string mas não é JSON válido.');
        }
      }
      return await convexMutation("mcpExtras:mcpAulaModuleSave", {
        sessionToken,
        slug: need(args.slug, "slug"),
        moduleId: need(args.moduleId, "moduleId"),
        module: mod ?? null,
        placeAfter: args.placeAfter,
        bloco: args.bloco,
      });
    }

    case "recipe-op":
      return await convexMutation("mcpExtras:mcpAulaRecipeOp", {
        sessionToken,
        slug: need(args.slug, "slug"),
        op: need(args.op, "op"),
        moduleId: need(args.moduleId, "moduleId"),
        bloco: args.bloco,
        toIndex: args.toIndex,
      });

    case "recipe-set":
      return await convexMutation("mcpExtras:mcpAulaRecipeSet", {
        sessionToken,
        slug: need(args.slug, "slug"),
        field: need(args.field, "field"),
        valorLista: args.valorLista,
        valorTexto: args.valorTexto,
        blocoIndex: args.blocoIndex,
      });

    case "meta":
      return await convexMutation("mcpExtras:mcpAulaMeta", {
        sessionToken,
        slug: need(args.slug, "slug"),
        title: args.title,
        subtitle: args.subtitle,
        tag: args.tag,
        data: args.data,
        duration: args.duration,
        status: args.status,
      });

    case "upsert": {
      const slug = need(args.slug, "slug");
      const raw = need(args.aula, "aula");
      let aulaObj = raw;
      if (typeof aulaObj === "string") {
        try {
          aulaObj = JSON.parse(aulaObj);
        } catch {
          throw new Error(
            'Arg "aula" veio como string mas não é JSON válido. Mande o objeto da aula.',
          );
        }
      }
      return await convexMutation("mcpExtras:mcpUpsertAula", {
        sessionToken,
        slug,
        aula: aulaObj,
      });
    }

    case "delete":
      // Sem undo do lado do servidor: quem quiser guardar o conteúdo puxa
      // action=get antes. Aula publicada é recusada até vir force.
      return await convexMutation("mcpExtras:mcpDeleteAula", {
        sessionToken,
        slug: need(args.slug, "slug"),
        force: args.force,
      });
  }
}
