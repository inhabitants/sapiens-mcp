import { z } from "zod";
import { convexQuery, convexMutation, getSessionToken } from "../convexClient.js";

/**
 * sapiens_portfolio: a vitrine do portfolio do Borderless
 * (/experimentos/borderless-portfolio, o /bord) pelo agente do dono.
 *
 * Os cases moram no Convex (tabela portfolioCases), não no código: até aqui só
 * o admin no navegador (/dashboard/admin/portfolio) editava, e o agente tinha
 * que pedir login no Chrome pra trocar um título. Prêmios, bio e SEO seguem no
 * código da página.
 *
 * Sub-actions:
 *   - list: todos os cases (ativos e escondidos), na ordem do site.
 *   - save: edita ou cria. Edição acha o case pelo id ou pelo slug e só muda o
 *           campo que vier; string vazia apaga campo opcional. Criação só com
 *           create=true: slug que não bate com nenhum case é erro, não case
 *           novo (um slug digitado errado iria direto pro ar).
 *
 * ADMIN-ONLY (o Convex recusa user comum). Vai pro ar na hora: a página lê o
 * banco, não espera deploy. Sem custo em Sinapses.
 */

const PAGE_URL = "https://www.sapiensinteticos.com/experimentos/borderless-portfolio";

const text = (hint: string) => z.string().optional().describe(hint);

export const portfolioSchema = z.object({
  action: z.enum(["list", "save"]),
  id: text("save: id do case (vem do list). Sem id, o alvo é achado pelo slug."),
  slug: text("save: slug do case (minúscula, número, hífen). Com id, renomeia o slug; sem id, é por ele que o case é achado (slug que não existe é erro, a não ser com create=true)."),
  create: z.boolean().optional().describe("save: true CRIA um case novo com o slug dado (erro se o slug já existe). Sem create, save só edita."),
  titleEn: text("Título em inglês."),
  titlePt: text("Título em português."),
  descriptionEn: text("Descrição em inglês (2 frases, voz da casa, sem em-dash)."),
  descriptionPt: text("Descrição em português."),
  mediaUrl: text("URL https da imagem ou do vídeo (CDN da casa)."),
  mediaType: z.enum(["image", "video"]).optional().describe("image ou video (MP4 em autoplay mudo)."),
  link1Url: text("Link principal: o card inteiro abre nele. https:// ou caminho começando com / (http:// e //host não passam)."),
  link1LabelEn: text("Rótulo EN do link 1."),
  link1LabelPt: text("Rótulo PT do link 1."),
  link1Color: text("Cor do botão: default, purple, blue, green, amber, rose, cyan."),
  link2Url: text("Link 2."),
  link2LabelEn: text("Rótulo EN do link 2."),
  link2LabelPt: text("Rótulo PT do link 2."),
  link2Color: text("Cor do botão 2."),
  link3Url: text("Link 3."),
  link3LabelEn: text("Rótulo EN do link 3."),
  link3LabelPt: text("Rótulo PT do link 3."),
  link3Color: text("Cor do botão 3."),
  awardLabelEn: text("Selo sobre a mídia, EN (ex: Logitech Competition). Vazio apaga."),
  awardLabelPt: text("Selo, PT."),
  awardUrl: text("Link do selo."),
  badgeStyle: text("Cor do selo: gold, blue, green, purple, red, cyan."),
  orderIndex: z.number().optional().describe("Posição: o site ordena crescente (os cases andam de 10 em 10)."),
  isActive: z.boolean().optional().describe("false esconde o case sem apagar."),
});

export type PortfolioArgs = z.infer<typeof portfolioSchema>;

function compact(c: any) {
  const links = [1, 2, 3]
    .filter((i) => c[`link${i}Url`])
    .map((i) => ({
      url: c[`link${i}Url`],
      labelEn: c[`link${i}LabelEn`] ?? null,
      labelPt: c[`link${i}LabelPt`] ?? null,
      color: c[`link${i}Color`] ?? null,
    }));
  return {
    id: c._id,
    slug: c.slug,
    orderIndex: c.orderIndex,
    isActive: c.isActive,
    titleEn: c.titleEn,
    titlePt: c.titlePt,
    descriptionEn: c.descriptionEn,
    descriptionPt: c.descriptionPt,
    mediaType: c.mediaType,
    mediaUrl: c.mediaUrl,
    links,
    award: c.awardLabelEn || c.awardLabelPt
      ? { labelEn: c.awardLabelEn ?? null, labelPt: c.awardLabelPt ?? null, url: c.awardUrl ?? null, style: c.badgeStyle ?? null }
      : null,
  };
}

export async function portfolio(args: PortfolioArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "list") {
    const rows = await convexQuery<any[]>("portfolio:mcpListPortfolioCases", { sessionToken });
    const cases = (rows ?? []).map(compact);
    return {
      url: PAGE_URL,
      total: cases.length,
      ativos: cases.filter((c) => c.isActive).length,
      cases,
    };
  }

  const { action: _action, ...fields } = args;
  const payload = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const res = await convexMutation<{ id: string; slug: string; created: boolean; changed: string[] }>(
    "portfolio:mcpSavePortfolioCase",
    { sessionToken, ...payload },
  );
  return {
    ...res,
    url: PAGE_URL,
    note: res.created
      ? "Case novo no ar, no fim da fila. orderIndex muda a posição."
      : "No ar na hora: a página lê o banco, sem deploy.",
  };
}
