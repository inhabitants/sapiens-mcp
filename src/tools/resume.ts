import { z } from "zod";
import {
  generateResumeHTML,
  RESUME_SCHEMA_DESCRIPTION,
  RESUME_THEMES,
  type ResumeTheme,
} from "../resume/template.js";
import { isRemoteContext } from "../convexClient.js";

/**
 * sapiens_resume: o Currículo PRO da casa via MCP.
 *
 * Junto com sapiens_skill, é tool de MUNDO FECHADO: não fala com o backend,
 * não exige login, não cobra Sinapse. O agente conduz a entrevista (ou lê o
 * LinkedIn colado), monta o JSON no contrato e chama render; o HTML volta
 * pronto pra salvar e imprimir em PDF. É o MESMO template do Lab
 * /experimentos/resume-builder (fonte única em ../resume/template.ts).
 *
 * FOTO: nunca toca banco nenhum. No stdio, photoPath lê o arquivo AQUI na
 * máquina da pessoa e embute como data URI direto no HTML. No remoto, path
 * local é recusado (seria ler arquivo do servidor); a pessoa passa uma URL
 * https ou anexa a foto depois, no Lab web.
 */

const THEME_IDS = Object.keys(RESUME_THEMES) as [ResumeTheme, ...ResumeTheme[]];

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export const resumeSchema = z.object({
  action: z
    .enum(["schema", "render"])
    .default("schema")
    .describe(
      "'schema' devolve o contrato de dados + os modelos disponíveis (leia antes do primeiro render). 'render' recebe os dados e devolve o HTML pronto.",
    ),
  data: z
    .union([z.record(z.unknown()), z.string()])
    .optional()
    .describe(
      "Os dados do currículo no shape do contrato (objeto, ou string JSON). Obrigatório no render. Mínimo: name + title.",
    ),
  theme: z
    .enum(THEME_IDS)
    .optional()
    .describe(
      "Modelo visual: 'pro' (default, duas colunas com sidebar jade), 'executivo' (sidebar grafite + serifa), 'moderno' (coluna única roxa), 'minimal' (coluna única preto e branco).",
    ),
  accentColor: z
    .string()
    .optional()
    .describe("Hex 6 dígitos pra trocar a cor de destaque do modelo (ex '#0E7C66')."),
  photoPath: z
    .string()
    .optional()
    .describe(
      "Caminho absoluto de uma foto local (PNG/JPEG/WebP até 4MB) pra embutir como foto de perfil. SÓ no MCP instalado (stdio): a foto vira data URI dentro do HTML e não sai da máquina. No remoto use data.photo com URL https.",
    ),
  outPath: z
    .string()
    .optional()
    .describe(
      "Caminho absoluto de um .html pra salvar o resultado direto no disco (SÓ stdio). Com outPath a resposta volta enxuta ({savedTo, bytes}) em vez do HTML inteiro.",
    ),
});

export type ResumeArgs = z.infer<typeof resumeSchema>;

function detectImageMime(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length > 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

async function readLocalPhotoAsDataUri(filePath: string): Promise<string> {
  if (isRemoteContext()) {
    throw new Error(
      "photoPath (arquivo local) só funciona no MCP instalado na sua máquina (stdio). " +
        "Na conexão remota, passe data.photo com uma URL https, ou anexe a foto no Lab web (/experimentos/resume-builder), onde ela fica só no navegador.",
    );
  }
  const [{ default: fs }, { default: path }] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const abs = path.resolve(filePath);
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    throw new Error(
      `Não achei/li a foto em photoPath: "${filePath}". Use o caminho absoluto (ex: C:\\Users\\voce\\foto.jpg).`,
    );
  }
  if (buf.length > MAX_PHOTO_BYTES) {
    const mb = (buf.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Foto muito grande (${mb}MB; teto 4MB). Exporte menor (um recorte quadrado de ~800px resolve) e tente de novo.`,
    );
  }
  const mime = detectImageMime(buf);
  if (!mime) {
    throw new Error(
      `O arquivo em photoPath não parece PNG/JPEG/WebP ("${filePath}").`,
    );
  }
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function saveHtmlLocally(outPath: string, html: string): Promise<string> {
  if (isRemoteContext()) {
    throw new Error(
      "outPath (salvar em disco) só funciona no MCP instalado na sua máquina (stdio). Na conexão remota, pegue o campo html da resposta e salve você.",
    );
  }
  if (!/\.html?$/i.test(outPath)) {
    throw new Error(`outPath precisa terminar em .html (recebi "${outPath}").`);
  }
  const [{ default: fs }, { default: path }] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const abs = path.resolve(outPath);
  await fs.writeFile(abs, html, "utf8");
  return abs;
}

export async function resume(args: ResumeArgs): Promise<any> {
  const action = args.action ?? "schema";

  if (action === "schema") {
    return {
      themes: Object.entries(RESUME_THEMES).map(([id, t]) => ({
        id,
        label: t.label,
        layout: t.layout,
        description: t.description,
      })),
      contract: RESUME_SCHEMA_DESCRIPTION,
      cost: 0,
      notes: [
        "Entreviste a pessoa (ou leia o texto do LinkedIn que ela colar), monte o JSON e chame action=render. Não invente fato: melhore a redação, preserve a verdade.",
        "lang define o idioma dos títulos de seção ('pt' ou 'en'); case com o idioma do conteúdo.",
        "Foto é opcional e NUNCA vai pra banco: no stdio use photoPath (vira data URI local); no remoto, data.photo com URL https.",
        "O HTML sai pronto pra imprimir em PDF (abrir no navegador -> Ctrl+P -> Salvar como PDF, A4).",
        "No stdio, passe outPath pra salvar direto no disco sem trafegar o HTML inteiro na conversa.",
      ],
    };
  }

  // action === "render"
  let data: any = args.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error("data veio como string mas não é JSON válido. Mande o objeto do contrato (veja action=schema).");
    }
  }
  if (!data || typeof data !== "object") {
    throw new Error("render exige 'data' com os dados do currículo. Rode action=schema pra ver o contrato.");
  }
  if (!data.name || !data.title) {
    throw new Error("data precisa de pelo menos 'name' e 'title'. Complete e chame de novo.");
  }

  if (args.photoPath) {
    data = { ...data, photo: await readLocalPhotoAsDataUri(args.photoPath) };
  }

  const theme = args.theme ?? "pro";
  const html = generateResumeHTML(data, {
    theme,
    accentColor: args.accentColor,
  });

  const base = {
    theme,
    bytes: Buffer.byteLength(html, "utf8"),
    tip: "Abra o .html no navegador e imprima em PDF (Ctrl+P, A4, margens padrão). A foto, se houver, já está embutida no arquivo.",
  };

  if (args.outPath) {
    const savedTo = await saveHtmlLocally(args.outPath, html);
    return { ...base, savedTo };
  }

  return { ...base, html };
}
