import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  describeConvexError,
  getSessionToken,
  isRemoteContext,
} from "../convexClient.js";
import { findMinorMarkers } from "../pisoDeIdade.js";
import { CANAL, ondeFicaAChave } from "../canal.js";
import { gallery } from "./gallery.js";

/**
 * A PORTA LOCAL DAS PONTES (27/09/2026): gerar no provedor com a chave da
 * PESSOA e trazer a peça pro acervo como nativa, custo 0 em Sinapses.
 *
 * Existe porque Sinapse e chave própria andam lado a lado (decisão do dono):
 * Sinapse é pra quem não quer configurar nada; a chave própria é pra quem já tem
 * crédito num provedor, e aí a casa não cobra nada em cima. Até esta tool, quem
 * chamava o provedor era o harness da pessoa, então chave própria era coisa de
 * quem tem terminal. O Claude Desktop não tem.
 *
 * A regra da chave (doc docs/infra/pontes-traga-seu-motor.md): ela mora no
 * ambiente DESTA máquina (o campo do plugin ou da extensão, ou o "env" do config
 * do cliente MCP) e sai daqui só pro provedor. Não entra em arg, não volta em resultado, não vai pro Convex, não
 * fica no arquivo de jobs. No transporte remoto a tool nem aparece no
 * tools/list, e a chamada é recusada antes de ler qualquer coisa: lá o processo
 * é o servidor do site, e chave de membro não sobe.
 *
 * As quatro travas, uma por risco:
 *   1. Bug nosso gastar o dinheiro dela: o job é gravado em disco ANTES de
 *      esperar o render, e o pedido idêntico em 30 min devolve o job que existe.
 *   2. A chave vazar num erro: toda saída passa pelo `semChave`.
 *   3. Provedor mudar a API: porta genérica, o `input` é o corpo da doc dele.
 *   4. A casa passar a ser quem gera: o prompt passa pelo piso de idade antes
 *      de sair, e a peça entra pelo ingest com o carimbo da classe do provedor.
 */

/**
 * Os balcões que esta tool dirige. Cada um é um par enviar/ler (ADAPTADORES,
 * lá embaixo) e uma chave que só volta pro host do próprio provedor: é isso que
 * impede um texto de fora de fazer o Claude mandar a chave pra outro endereço,
 * e é por isso que balcão novo entra por código, nunca por campo livre.
 * 28/09/2026: WaveSpeed e Replicate entraram ("tem que ter liberdade de colocar
 * várias como wavespeed", o dono).
 * 03/10/2026: OpenRouter entrou. É o único que devolve a peça atrás da chave
 * (imagem em base64 no corpo, vídeo num endereço que pede Authorization), então
 * o adaptador baixa pra esta máquina e o ingest sobe pelo arquivo.
 */
const PROVEDORES = ["fal", "kie", "wavespeed", "replicate", "openrouter"] as const;
type Provedor = (typeof PROVEDORES)[number];

const BALCOES: Record<Provedor, { nome: string; envVar: string; artigo: "a" | "o" }> = {
  fal: { nome: "fal.ai", envVar: "FAL_KEY", artigo: "a" },
  kie: { nome: "Kie", envVar: "KIE_API_KEY", artigo: "a" },
  wavespeed: { nome: "WaveSpeed", envVar: "WAVESPEED_API_KEY", artigo: "a" },
  replicate: { nome: "Replicate", envVar: "REPLICATE_API_TOKEN", artigo: "o" },
  openrouter: { nome: "OpenRouter", envVar: "OPENROUTER_API_KEY", artigo: "a" },
};

/** "na fal.ai", "do Replicate": a preposição já com o artigo do balcão. */
function balcaoCom(p: Provedor, prep: "em" | "de" | "para" | ""): string {
  const { nome, artigo } = BALCOES[p];
  const forma = { em: { a: "na", o: "no" }, de: { a: "da", o: "do" }, para: { a: "pra", o: "pro" }, "": { a: "A", o: "O" } };
  return `${forma[prep][artigo]} ${nome}`;
}

/**
 * Toda variável de chave de provedor que a casa conhece, dirigida por esta tool
 * ou não: é a lista que o `semChave` limpa. Chave de balcão que a tool não usa
 * também não pode vazar num erro que ecoe o ambiente.
 */
const NOMES_DE_CHAVE = [
  "FAL_KEY",
  "KIE_API_KEY",
  "WAVESPEED_API_KEY",
  "SOGNI_API_KEY",
  "KREA_API_KEY",
  "REPLICATE_API_TOKEN",
  "OPENROUTER_API_KEY",
];

/**
 * No plugin do Claude Code e na extensão do Claude Desktop, o campo de chave
 * chega com nome próprio, e não como FAL_KEY: o env do app sobrescreve o do
 * processo, e campo deixado em branco não pode apagar a FAL_KEY que a pessoa já
 * exporta no terminal. Preenchido, o campo ganha. Os nomes saem de
 * CAMPOS_DE_CHAVE em scripts/servidor.mjs, e o smoke de lá confere que cada
 * campo acende o balcão certo.
 */
const CAMPO_DO_APP: Readonly<Record<string, string>> = {
  FAL_KEY: "SAPIENS_FAL_KEY",
  KIE_API_KEY: "SAPIENS_KIE_API_KEY",
  WAVESPEED_API_KEY: "SAPIENS_WAVESPEED_API_KEY",
  REPLICATE_API_TOKEN: "SAPIENS_REPLICATE_API_TOKEN",
  OPENROUTER_API_KEY: "SAPIENS_OPENROUTER_API_KEY",
};

const JANELA_REPETIDO_MS = 30 * 60 * 1000;
const MAX_JOBS_GUARDADOS = 200;
const MAX_PECAS_POR_JOB = 4;
const ESPERA_PADRAO_GERAR_S = 45;
const ESPERA_PADRAO_STATUS_S = 20;
const ESPERA_MAX_S = 75;
// O cliente MCP desiste em ~120s. Trazer um vídeo pro acervo (baixar + subir)
// leva segundos a dezenas de segundos, então o ingest só começa na mesma
// chamada se ainda sobra folga; senão o job volta "pronto" e o status traz.
const INGEST_SO_ATE_MS = 60_000;

export const pontesSchema = z.object({
  action: z.enum(["balcoes", "gerar", "status", "jobs"]),
  provedor: z
    .enum(PROVEDORES)
    .optional()
    .describe(
      "action=gerar: o balcão. 'fal' (FAL_KEY), 'kie' (KIE_API_KEY), 'wavespeed' (WAVESPEED_API_KEY) ou 'replicate' (REPLICATE_API_TOKEN) ou 'openrouter' (OPENROUTER_API_KEY). A chave mora nesta máquina: no campo do plugin ou da extensão, ou no env do config do cliente MCP. action=balcoes diz quais estão configuradas.",
    ),
  modelo: z
    .string()
    .max(200)
    .optional()
    .describe(
      "action=gerar: o slug do modelo NO PROVEDOR, igual à página dele. fal: o id do endpoint (ex: 'fal-ai/flux/dev'), que vai no caminho de queue.fal.run. Kie: o campo 'model' do Market (ex: 'kling/v2-1-standard'), que vai no corpo do createTask. WaveSpeed: o slug da página do modelo (ex: 'wavespeed-ai/flux-2-klein-9b/text-to-image'), que vai no caminho de api.wavespeed.ai/api/v3. Replicate: 'dono/nome' pra modelo oficial (ex: 'black-forest-labs/flux-schnell') ou 'dono/nome:<versão de 64 caracteres>' pra modelo de comunidade. OpenRouter: o slug 'dono/nome' da página do modelo (ex: 'bytedance-seed/seedream-4.5' pra imagem, 'google/veo-3.1' pra vídeo), que vai no corpo; diga midia='video' quando for vídeo. Não invente: confira na página do modelo.",
    ),
  midia: z
    .enum(["imagem", "video"])
    .optional()
    .describe(
      "action=gerar, só provedor='openrouter': 'imagem' (padrão, POST /api/v1/images) ou 'video' (POST /api/v1/videos, fila). Os outros balcões sabem pelo slug e ignoram este campo.",
    ),
  input: z
    .union([z.record(z.any()), z.string()])
    .optional()
    .describe(
      "action=gerar: o corpo que a doc do provedor descreve pra esse modelo, com o prompt DENTRO (ex: {\"prompt\": \"...\", \"image_urls\": [\"...\"]}). A ficha do personagem entra aqui: passportPrompt no começo do prompt e mainImageUrl/imageUrls no campo de referência que o modelo aceita. A chave NUNCA vai aqui.",
    ),
  prompt: z
    .string()
    .max(20000)
    .optional()
    .describe(
      "action=gerar: o prompt verbatim pra ficha da peça, quando ele não mora em input.prompt. Omitido, a ficha usa input.prompt.",
    ),
  jobId: z
    .string()
    .optional()
    .describe("action=status: o id do job local (pj_...), devolvido pelo gerar e listado em action=jobs."),
  ingerir: z
    .boolean()
    .optional()
    .describe(
      "action=gerar/status: true (padrão) traz a peça pro acervo quando o render termina. false só gera e devolve as URLs do provedor (que expiram).",
    ),
  aguardarSegundos: z
    .number()
    .int()
    .min(0)
    .max(ESPERA_MAX_S)
    .optional()
    .describe(
      `action=gerar/status: quanto esperar pelo render nesta chamada (padrão ${ESPERA_PADRAO_GERAR_S} no gerar, ${ESPERA_PADRAO_STATUS_S} no status, teto ${ESPERA_MAX_S}). Imagem costuma sair dentro; vídeo quase nunca: volta 'rodando' e o status termina.`,
    ),
  forcar: z
    .boolean()
    .optional()
    .describe(
      "action=gerar: true gera de novo MESMO com um pedido idêntico nos últimos 30 minutos. Sem isto, o pedido repetido devolve o job que já existe, pra não cobrar duas vezes.",
    ),
  externalEngine: z
    .string()
    .max(100)
    .optional()
    .describe(
      "action=gerar: o nome do motor na ficha, formato provedor-motor ('fal-krea-2'). Omitido, sai do slug do modelo. O prefixo do provedor é sempre o de verdade: é ele que decide o carimbo +18 da classe.",
    ),
  externalCost: z
    .string()
    .max(200)
    .optional()
    .describe(
      "action=gerar: o custo pra ficha, quando você sabe ('US$ 0,35 na fal'). Omitido, a Kie informa os créditos consumidos e os outros balcões ficam como 'pago na <balcão> com a sua chave'.",
    ),
  characterId: z
    .string()
    .optional()
    .describe("action=gerar: o personagem de quem é a peça (influencers:_id). A peça nasce ligada à ficha dele."),
  characterIds: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe("action=gerar: quem está em cena, em ordem (o protagonista primeiro), quando é mais de uma criatura."),
  referenceImageIds: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe("action=gerar: generatedImages:_id das peças da casa que serviram de referência."),
  aspectRatio: z.string().max(20).optional().describe("action=gerar: proporção pra ficha ('9:16'). Omitido, lê input.aspect_ratio."),
  size: z.string().max(20).optional().describe("action=gerar: resolução pra ficha ('720p'). Omitido, lê input.resolution."),
  unfiltered: z
    .boolean()
    .optional()
    .describe("action=gerar: true quando o modelo rodou sem filtro num balcão que modera (Kie): a peça nasce com o carimbo +18 declarado."),
  skills: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe("action=gerar: os slugs das skills da casa que dirigiram a peça."),
  limit: z.number().int().positive().max(50).optional().describe("action=jobs: quantos (padrão 10)."),
});

export type PontesArgs = z.infer<typeof pontesSchema>;

type Estado = "fila" | "rodando" | "pronto" | "falhou" | "ingerido";

type Peca = {
  url: string;
  imageId?: string;
  acervoUrl?: string;
  adulta?: boolean;
  erro?: string;
};

type Job = {
  id: string;
  provedor: Provedor;
  modelo: string;
  hash: string;
  criadoEm: number;
  atualizadoEm: number;
  estado: Estado;
  requestId: string;
  statusUrl?: string;
  responseUrl?: string;
  midia?: "imagem" | "video";
  /** Caminhos nesta máquina quando o balcão entrega a peça atrás da chave (OpenRouter). */
  arquivos?: string[];
  resultUrls?: string[];
  custo?: string;
  erro?: string;
  ingerir: boolean;
  pecas?: Peca[];
  ficha: {
    externalEngine: string;
    prompt?: string;
    externalCost?: string;
    characterId?: string;
    characterIds?: string[] | string;
    referenceImageIds?: string[] | string;
    aspectRatio?: string;
    size?: string;
    unfiltered?: boolean;
    skills?: string[] | string;
  };
};

// ---------------------------------------------------------------------------
// A chave: lida do ambiente, nunca devolvida.
// ---------------------------------------------------------------------------

/**
 * O valor de uma variável de chave, ou undefined quando não há chave de verdade.
 * Na extensão do Claude Desktop (.mcpb) e no plugin do Claude Code a chave chega
 * como "${user_config.fal_key}": campo opcional deixado em branco pode chegar vazio
 * OU como o próprio texto do molde, e o molde não é chave (mandar ele pro
 * provedor seria um 401 com cara de chave errada).
 */
export function valorDeChave(nome: string): string | undefined {
  const campo = CAMPO_DO_APP[nome];
  return (campo && lerChave(campo)) || lerChave(nome);
}

function lerChave(nome: string): string | undefined {
  const valor = process.env[nome]?.trim();
  if (!valor || valor.length < 8) return undefined;
  if (/^\$\{[^}]*\}$/.test(valor)) return undefined;
  return valor;
}

function segredosConfigurados(): string[] {
  const out = new Set<string>();
  // As duas fontes de cada chave saem do texto, até a que perdeu a precedência.
  for (const nome of [...NOMES_DE_CHAVE, ...Object.values(CAMPO_DO_APP)]) {
    const valor = lerChave(nome);
    if (!valor) continue;
    out.add(valor);
    // A chave da fal é "id:segredo": um erro que ecoa só o id ainda identifica
    // a conta dela, então cada metade também sai.
    for (const parte of valor.split(":")) if (parte.length >= 8) out.add(parte);
  }
  // Maior primeiro: trocar o pedaço antes do inteiro deixaria sobra do inteiro.
  return [...out].sort((a, b) => b.length - a.length);
}

/** Troca qualquer valor de chave configurada por "[chave]". Toda saída passa aqui. */
export function semChave(texto: string): string {
  let out = texto;
  for (const segredo of segredosConfigurados()) out = out.split(segredo).join("[chave]");
  return out;
}

function limpo<T>(valor: T): T {
  return JSON.parse(semChave(JSON.stringify(valor))) as T;
}

function chaveDo(provedor: Provedor): string {
  const { envVar } = BALCOES[provedor];
  const valor = valorDeChave(envVar);
  if (!valor) {
    throw new Error(
      `Falta a chave ${balcaoCom(provedor, "de")} (${envVar}) nesta máquina. ${ondeFicaAChave()} A chave fica no seu computador; nunca mande ela no chat.`,
    );
  }
  return valor;
}

const CAMPO_DE_CHAVE =
  /^(api[_-]?key|apikey|x[_-]api[_-]key|secret|client[_-]?secret|access[_-]?token|authorization|fal[_-]?key|kie[_-]?api[_-]?key)$/i;

function campoDeChave(v: unknown, fundo = 0): string | null {
  if (fundo > 6 || !v || typeof v !== "object") return null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (CAMPO_DE_CHAVE.test(k)) return k;
    const achou = campoDeChave(x, fundo + 1);
    if (achou) return achou;
  }
  return null;
}

/**
 * A chave não viaja no pedido. Se ela aparece no input ou no prompt, o pedido
 * morre aqui, sem sair da máquina, e a mensagem não repete o valor.
 */
function confereSemChaveNoPedido(input: Record<string, unknown>, prompt?: string): void {
  const corpo = `${JSON.stringify(input)}\n${prompt ?? ""}`;
  const vazou = segredosConfigurados().some((s) => corpo.includes(s));
  const campo = campoDeChave(input);
  if (vazou || campo) {
    throw new Error(
      `${campo ? `O input tem um campo de chave ("${campo}")` : "Tem uma chave de API dentro do input ou do prompt"}. A chave não vai no pedido: ela mora nesta máquina (campo do plugin, da extensão ou env do cliente MCP) e esta tool lê de lá. Tire do input e, se a chave foi colada no chat, gere uma nova no provedor.`,
    );
  }
}

// ---------------------------------------------------------------------------
// O pedido: input, prompt, piso de idade, assinatura pro repetido.
// ---------------------------------------------------------------------------

function lerInput(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    throw new Error(
      "action=gerar exige input: o corpo que a doc do provedor descreve pra esse modelo, com o prompt dentro (ex: {\"prompt\": \"...\"}).",
    );
  }
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error("input veio como texto e não é JSON válido. Mande o objeto (ex: {\"prompt\": \"...\"}).");
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("input precisa ser um objeto JSON (ex: {\"prompt\": \"...\"}).");
  }
  return obj as Record<string, unknown>;
}

/** Os textos que o motor lê como cena: prompt e parentes, fora o negativo. */
function textosDeCena(v: unknown, chave = "", out: string[] = [], fundo = 0): string[] {
  if (fundo > 6) return out;
  if (typeof v === "string") {
    if (/prompt|text|caption|description|scene/i.test(chave) && !/negative/i.test(chave)) out.push(v);
    return out;
  }
  if (Array.isArray(v)) {
    for (const x of v) textosDeCena(x, chave, out, fundo + 1);
    return out;
  }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) textosDeCena(x, k, out, fundo + 1);
  }
  return out;
}

function conferePisoDeIdade(textos: string[]): void {
  const marcas = textos.flatMap((t) => findMinorMarkers(t));
  if (!marcas.length) return;
  const citados = [...new Set(marcas.map((m) => `"${m.match}"`))].slice(0, 3).join(", ");
  throw new Error(
    `O prompt cita menor de idade (${citados}). A porta da casa não gera isso em motor nenhum: 18 é o piso, 21+ é o padrão. Reescreva com a idade em absoluto ("adult woman, 24") e sem criança, adolescente, teen ou child no texto, mesmo falando de terceiros ou do passado. Se a palavra estava num "NEGATIVE:" dentro do prompt (o passportPrompt da ficha termina com um), mova pro campo negative_prompt do modelo ou tire: no corpo do prompt a maioria dos motores lê o negativo como cena.`,
  );
}

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

function hashDoPedido(provedor: Provedor, modelo: string, input: Record<string, unknown>): string {
  return createHash("sha256").update(`${provedor}\n${modelo}\n${canonico(input)}`).digest("hex");
}

// Slug que vai no caminho da URL (fal, WaveSpeed, Replicate) ou no corpo (Kie):
// letras, números, ponto, hífen, sublinhado e barra entre partes. Sem "..", sem
// esquema, sem barra na frente: o host é fixo e o caminho não passeia.
const MODELO_VALIDO = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;
// Replicate: "dono/nome" (modelo oficial) ou "dono/nome:<versão>" (comunidade).
const MODELO_REPLICATE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(:[a-f0-9]{64})?$/i;
// OpenRouter: "dono/nome", com variante opcional (":free", ":nitro").
const MODELO_OPENROUTER = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(:[a-z0-9-]+)?$/i;

function confereModelo(provedor: Provedor, modelo: string): void {
  const forma =
    provedor === "replicate" ? MODELO_REPLICATE : provedor === "openrouter" ? MODELO_OPENROUTER : MODELO_VALIDO;
  if (!forma.test(modelo) || modelo.includes("..")) {
    throw new Error(
      `modelo inválido: "${modelo.slice(0, 80)}". Use o slug como está na página do modelo no provedor (ex: 'fal-ai/flux/dev', 'kling/v2-1-standard', 'wavespeed-ai/flux-2-klein-9b/text-to-image', 'black-forest-labs/flux-schnell', 'google/veo-3.1').`,
    );
  }
}

/** O nome do motor na ficha: sempre com o prefixo do provedor de verdade. */
function motorDaFicha(provedor: Provedor, modelo: string, pedido?: string): string {
  const limpa = (s: string) =>
    s
      .toLowerCase()
      .replace(/^(fal-ai|wavespeed-ai)\//, "")
      .replace(/[\s/]+/g, "-")
      .replace(/[^a-z0-9._-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  // A versão do Replicate (64 caracteres) identifica, mas não é nome de motor.
  const base = pedido?.trim() ? limpa(pedido) : limpa(modelo.split(":")[0]);
  if (base.startsWith(`${provedor}-`)) return base;
  return `${provedor}-${base || "modelo"}`;
}

// ---------------------------------------------------------------------------
// Os jobs, gravados nesta máquina (nunca no servidor).
// ---------------------------------------------------------------------------

function pastaLocal(): string {
  return process.env.SAPIENS_MCP_HOME || path.resolve(os.homedir(), ".sapiens-mcp");
}

function arquivoDeJobs(): string {
  return path.join(pastaLocal(), "pontes-jobs.json");
}

function lerJobs(): Job[] {
  try {
    const raw = JSON.parse(fs.readFileSync(arquivoDeJobs(), "utf8"));
    return Array.isArray(raw?.jobs) ? (raw.jobs as Job[]) : [];
  } catch {
    return [];
  }
}

function gravarJobs(jobs: Job[]): void {
  const file = arquivoDeJobs();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const corpo = semChave(JSON.stringify({ versao: 1, jobs: jobs.slice(-MAX_JOBS_GUARDADOS) }, null, 2));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, corpo, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows/ACL: chmod pode não aplicar.
  }
}

// Fila de escrita do processo: duas chamadas em paralelo não se atropelam no
// arquivo (ler-mudar-gravar sem trava perde o job de uma delas).
let filaDeEscrita: Promise<unknown> = Promise.resolve();

function comTrava<T>(fn: () => T): Promise<T> {
  const vez = filaDeEscrita.then(fn, fn);
  filaDeEscrita = vez.catch(() => undefined);
  return vez;
}

function salvarJob(job: Job): Promise<void> {
  return comTrava(() => {
    const jobs = lerJobs().filter((j) => j.id !== job.id);
    jobs.push({ ...job, atualizadoEm: Date.now() });
    gravarJobs(jobs);
  });
}

function novoId(): string {
  return `pj_${randomBytes(6).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Os balcões. O que é comum (enviar, ler uma vez) tem a mesma forma em todos;
// o que diverge (onde mora o veredito, onde mora a URL) fica em cada um.
// ---------------------------------------------------------------------------

type Leitura =
  | { estado: "fila" | "rodando" }
  | { estado: "pronto"; urls: string[]; custo?: string }
  | { estado: "falhou"; erro: string };

const EXT_ACEITA = /\.(png|jpe?g|webp|mp4|mov)(\?|#|$)/i;

function detalheDoErro(json: any): string {
  const d = json?.detail ?? json?.error?.message ?? json?.error ?? json?.message ?? json?.msg;
  if (typeof d === "string") return d.slice(0, 400);
  if (Array.isArray(d)) return d.map((x) => x?.msg ?? JSON.stringify(x)).join("; ").slice(0, 400);
  if (d) return JSON.stringify(d).slice(0, 400);
  return "";
}

/** As URLs de mídia que o provedor devolveu, na ordem, sem repetir. */
function urlsDeMidia(v: unknown, out: string[] = [], fundo = 0): string[] {
  if (fundo > 6 || out.length >= MAX_PECAS_POR_JOB * 2) return out;
  if (Array.isArray(v)) {
    for (const x of v) urlsDeMidia(x, out, fundo + 1);
    return out;
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.url === "string" && o.url.startsWith("https://")) {
      const tipo = typeof o.content_type === "string" ? o.content_type : "";
      if ((/^(image|video)\//.test(tipo) || EXT_ACEITA.test(o.url)) && !out.includes(o.url)) out.push(o.url);
    }
    for (const [k, x] of Object.entries(o)) if (k !== "url") urlsDeMidia(x, out, fundo + 1);
  }
  return out;
}

// --- fal: fila em queue.fal.run ---

const FAL_FILA = "https://queue.fal.run";

/**
 * A URL de consulta que o provedor devolveu, só se for https no host dele: a
 * chave vai junto nessa consulta, então URL de outro host nunca é seguida.
 */
function urlNoHost(u: unknown, host: string): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname === host ? url.toString() : null;
  } catch {
    return null;
  }
}

const urlDaFilaFal = (u: unknown) => urlNoHost(u, "queue.fal.run");

/** As URLs https de uma saída que é string solta ou lista de strings. */
function urlsSoltas(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : [v];
  return lista.filter((u): u is string => typeof u === "string" && u.startsWith("https://"));
}

async function falEnviar(chave: string, modelo: string, input: Record<string, unknown>) {
  const res = await fetch(`${FAL_FILA}/${modelo}`, {
    method: "POST",
    headers: { Authorization: `Key ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || typeof json?.request_id !== "string") {
    throw new Error(
      `A fal recusou o pedido (HTTP ${res.status}): ${detalheDoErro(json) || "resposta sem detalhe"}. ` +
        (res.ok
          ? "Confira no painel da fal se o pedido entrou antes de repetir."
          : "Nada entrou na fila."),
    );
  }
  // A fila da fal responde com as URLs de status e resultado; quando faltam,
  // o caminho é <dono>/<app>/requests/<id> (o resto do slug não entra).
  const app = modelo.split("/").slice(0, 2).join("/");
  const base = `${FAL_FILA}/${app}/requests/${json.request_id}`;
  return {
    requestId: json.request_id as string,
    statusUrl: urlDaFilaFal(json.status_url) ?? `${base}/status`,
    responseUrl: urlDaFilaFal(json.response_url) ?? base,
  };
}

async function falLer(chave: string, job: Job): Promise<Leitura> {
  const aindaNao: Leitura = { estado: job.estado === "rodando" ? "rodando" : "fila" };
  const statusUrl = urlDaFilaFal(job.statusUrl);
  const responseUrl = urlDaFilaFal(job.responseUrl);
  if (!statusUrl || !responseUrl) return { estado: "falhou", erro: "job sem endereço de consulta da fal" };
  let res: Response;
  try {
    res = await fetch(statusUrl, {
      headers: { Authorization: `Key ${chave}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return aindaNao; // consulta que falha não é geração que falhou
  }
  if (!res.ok) return aindaNao;
  const st: any = await res.json().catch(() => null);
  if (st?.status === "IN_QUEUE") return { estado: "fila" };
  if (st?.status !== "COMPLETED") return { estado: "rodando" };
  if (st?.error) {
    return { estado: "falhou", erro: `${st.error_type ? `${st.error_type}: ` : ""}${String(st.error).slice(0, 400)}` };
  }
  let out: Response;
  try {
    out = await fetch(responseUrl, {
      headers: { Authorization: `Key ${chave}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { estado: "rodando" };
  }
  const json: any = await out.json().catch(() => null);
  if (out.status >= 500) return { estado: "rodando" };
  if (!out.ok) {
    return { estado: "falhou", erro: `HTTP ${out.status}: ${detalheDoErro(json) || "sem detalhe"}` };
  }
  const urls = urlsDeMidia(json);
  if (!urls.length) return { estado: "falhou", erro: "a fal terminou mas não devolveu arquivo de imagem ou vídeo" };
  return { estado: "pronto", urls, custo: "pago na fal com a sua chave" };
}

// --- Kie: createTask + recordInfo, o mesmo par pro Market inteiro ---

const KIE_JOBS = "https://api.kie.ai/api/v1/jobs";
/** 1 crédito Kie = US$ 0,005 (a unidade da tabela deles). */
const KIE_CREDITO_USD = 0.005;

async function kieEnviar(chave: string, modelo: string, input: Record<string, unknown>) {
  const res = await fetch(`${KIE_JOBS}/createTask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelo, input }),
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json().catch(() => null);
  // A armadilha da Kie: HTTP 200 não é sucesso, o veredito é o `code` do corpo
  // (422 modelo inexistente, 500 campo faltando, 401 chave).
  if (json?.code !== 200 || typeof json?.data?.taskId !== "string") {
    throw new Error(
      `A Kie recusou o pedido (código ${json?.code ?? res.status}): ${json?.msg || "resposta sem detalhe"}. Nada entrou na fila.`,
    );
  }
  return { requestId: json.data.taskId as string };
}

async function kieLer(chave: string, job: Job): Promise<Leitura> {
  const aindaNao: Leitura = { estado: job.estado === "rodando" ? "rodando" : "fila" };
  let res: Response;
  try {
    res = await fetch(`${KIE_JOBS}/recordInfo?taskId=${encodeURIComponent(job.requestId)}`, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return aindaNao;
  }
  if (!res.ok) return aindaNao;
  const json: any = await res.json().catch(() => null);
  const d = json?.data;
  if (!d) return aindaNao;
  if (d.state === "success") {
    // `resultJson` é STRING com JSON dentro.
    let urls: string[] = [];
    try {
      const parsed = typeof d.resultJson === "string" ? JSON.parse(d.resultJson) : d.resultJson;
      if (Array.isArray(parsed?.resultUrls)) {
        urls = parsed.resultUrls.filter((u: unknown) => typeof u === "string" && u.startsWith("https://"));
      }
    } catch {
      // cai no "sem arquivo" abaixo
    }
    if (!urls.length) return { estado: "falhou", erro: "a Kie terminou mas não devolveu arquivo" };
    const creditos = typeof d.creditsConsumed === "number" ? d.creditsConsumed : undefined;
    return {
      estado: "pronto",
      urls,
      custo:
        creditos != null
          ? `${creditos} créditos Kie (~US$ ${(creditos * KIE_CREDITO_USD).toFixed(2)})`
          : "pago na Kie com a sua chave",
    };
  }
  if (d.state === "fail") {
    return { estado: "falhou", erro: String(d.failMsg || d.failCode || "a Kie marcou falha sem motivo").slice(0, 400) };
  }
  return { estado: d.state === "generating" ? "rodando" : "fila" };
}

// --- WaveSpeed: POST no slug + predictions/<id>/result (o par do sapiens_video) ---

const WAVESPEED_API = "https://api.wavespeed.ai/api/v3";

async function wavespeedEnviar(chave: string, modelo: string, input: Record<string, unknown>) {
  const res = await fetch(`${WAVESPEED_API}/${modelo}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json().catch(() => null);
  const id = json?.data?.id;
  if (!res.ok || typeof id !== "string") {
    throw new Error(
      `A WaveSpeed recusou o pedido (HTTP ${res.status}): ${detalheDoErro(json) || "resposta sem detalhe"}. ` +
        (res.ok ? "Confira no painel da WaveSpeed se o pedido entrou antes de repetir." : "Nada entrou na fila."),
    );
  }
  return {
    requestId: id,
    statusUrl:
      urlNoHost(json.data.urls?.get, "api.wavespeed.ai") ??
      `${WAVESPEED_API}/predictions/${encodeURIComponent(id)}/result`,
  };
}

async function wavespeedLer(chave: string, job: Job): Promise<Leitura> {
  const aindaNao: Leitura = { estado: job.estado === "rodando" ? "rodando" : "fila" };
  const statusUrl = urlNoHost(job.statusUrl, "api.wavespeed.ai");
  if (!statusUrl) return { estado: "falhou", erro: "job sem endereço de consulta da WaveSpeed" };
  let res: Response;
  try {
    res = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return aindaNao;
  }
  if (!res.ok) return aindaNao;
  const json: any = await res.json().catch(() => null);
  const d = json?.data ?? json;
  if (d?.status === "failed") {
    return { estado: "falhou", erro: detalheDoErro(d) || "a WaveSpeed marcou falha sem motivo" };
  }
  if (d?.status !== "completed") return { estado: d?.status === "processing" ? "rodando" : "fila" };
  const urls = urlsSoltas(d.outputs);
  if (!urls.length) return { estado: "falhou", erro: "a WaveSpeed terminou mas não devolveu arquivo" };
  return { estado: "pronto", urls, custo: "pago na WaveSpeed com a sua chave" };
}

// --- Replicate: predictions; modelo oficial pelo nome, comunidade pela versão ---

const REPLICATE_API = "https://api.replicate.com/v1";

async function replicateEnviar(chave: string, modelo: string, input: Record<string, unknown>) {
  // Modelo de comunidade só roda por /predictions com a versão completa: o
  // atalho /models/<dono>/<nome>/predictions serve só modelo oficial (404).
  const [nome, versao] = modelo.split(":");
  const res = await fetch(versao ? `${REPLICATE_API}/predictions` : `${REPLICATE_API}/models/${nome}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(versao ? { version: versao, input } : { input }),
    signal: AbortSignal.timeout(30_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || typeof json?.id !== "string") {
    throw new Error(
      `O Replicate recusou o pedido (HTTP ${res.status}): ${detalheDoErro(json) || "resposta sem detalhe"}. ` +
        (res.ok ? "Confira no painel do Replicate se o pedido entrou antes de repetir." : "Nada entrou na fila."),
    );
  }
  return {
    requestId: json.id as string,
    statusUrl:
      urlNoHost(json.urls?.get, "api.replicate.com") ?? `${REPLICATE_API}/predictions/${encodeURIComponent(json.id)}`,
  };
}

async function replicateLer(chave: string, job: Job): Promise<Leitura> {
  const aindaNao: Leitura = { estado: job.estado === "rodando" ? "rodando" : "fila" };
  const statusUrl = urlNoHost(job.statusUrl, "api.replicate.com");
  if (!statusUrl) return { estado: "falhou", erro: "job sem endereço de consulta do Replicate" };
  let res: Response;
  try {
    res = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return aindaNao;
  }
  if (!res.ok) return aindaNao;
  const p: any = await res.json().catch(() => null);
  if (p?.status === "failed" || p?.status === "canceled") {
    return { estado: "falhou", erro: String(p.error || `o Replicate marcou ${p.status}`).slice(0, 400) };
  }
  if (p?.status !== "succeeded") return { estado: p?.status === "processing" ? "rodando" : "fila" };
  // A saída do Replicate expira em 1 hora: o ingest do mesmo turno importa aqui.
  const urls = urlsSoltas(p.output);
  if (!urls.length) return { estado: "falhou", erro: "o Replicate terminou mas não devolveu arquivo" };
  return { estado: "pronto", urls, custo: "pago no Replicate com a sua chave" };
}

// --- OpenRouter: imagem síncrona em base64, vídeo em fila atrás da chave ---

const OPENROUTER_API = "https://openrouter.ai/api/v1";
const OPENROUTER_TETO_BYTES = 200 * 1024 * 1024;
const EXT_DO_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

function pastaDePecas(): string {
  const dir = path.join(pastaLocal(), "pontes-pecas");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function custoOpenRouter(usage: any): string {
  const c = usage?.cost;
  return typeof c === "number" ? `US$ ${c.toFixed(2)} na OpenRouter` : "pago na OpenRouter com a sua chave";
}

async function openrouterEnviar(
  chave: string,
  modelo: string,
  input: Record<string, unknown>,
  midia: "imagem" | "video" = "imagem",
): Promise<Enviado> {
  const video = midia === "video";
  const res = await fetch(`${OPENROUTER_API}/${video ? "videos" : "images"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, model: modelo }),
    // Imagem volta pronta nesta mesma resposta: o teto cobre o render inteiro.
    signal: AbortSignal.timeout(video ? 30_000 : 90_000),
  });
  const json: any = await res.json().catch(() => null);
  const recusa = (detalhe: string) =>
    new Error(
      `A OpenRouter recusou o pedido (HTTP ${res.status}): ${detalhe}. ` +
        (res.ok ? "Confira em openrouter.ai/activity se o pedido entrou antes de repetir." : "Nada foi gerado."),
    );
  if (video) {
    if (!res.ok || typeof json?.id !== "string") throw recusa(detalheDoErro(json) || "resposta sem detalhe");
    return {
      requestId: json.id,
      midia,
      statusUrl:
        urlNoHost(json.polling_url, "openrouter.ai") ?? `${OPENROUTER_API}/videos/${encodeURIComponent(json.id)}`,
    };
  }
  const itens: any[] = Array.isArray(json?.data) ? json.data : [];
  if (!res.ok || !itens.length) throw recusa(detalheDoErro(json) || "resposta sem imagem");
  const id = `or_${randomBytes(6).toString("hex")}`;
  const arquivos: string[] = [];
  for (const [i, item] of itens.slice(0, MAX_PECAS_POR_JOB).entries()) {
    const ext = EXT_DO_TIPO[String(item?.media_type)];
    if (typeof item?.b64_json !== "string" || !ext) continue;
    const arq = path.join(pastaDePecas(), `${id}-${i}.${ext}`);
    fs.writeFileSync(arq, Buffer.from(item.b64_json, "base64"), { mode: 0o600 });
    arquivos.push(arq);
  }
  if (!arquivos.length) throw recusa("a resposta não trouxe imagem em png, jpg ou webp");
  return { requestId: id, midia, arquivos, custo: custoOpenRouter(json.usage) };
}

async function openrouterLer(chave: string, job: Job): Promise<Leitura> {
  // Imagem: a peça já está no disco desde o enviar.
  if (job.arquivos?.length) {
    return { estado: "pronto", urls: job.arquivos, custo: job.custo ?? "pago na OpenRouter com a sua chave" };
  }
  const aindaNao: Leitura = { estado: job.estado === "rodando" ? "rodando" : "fila" };
  const statusUrl = urlNoHost(job.statusUrl, "openrouter.ai");
  if (!statusUrl) return { estado: "falhou", erro: "job sem endereço de consulta da OpenRouter" };
  let res: Response;
  try {
    res = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return aindaNao;
  }
  if (!res.ok) return aindaNao;
  const v: any = await res.json().catch(() => null);
  if (v?.status === "failed") {
    return { estado: "falhou", erro: detalheDoErro(v) || "a OpenRouter marcou falha sem motivo" };
  }
  if (v?.status !== "completed") return { estado: v?.status === "in_progress" ? "rodando" : "fila" };
  // O endereço do vídeo não é pré-assinado: baixa daqui, com a chave, só do host dela.
  const fontes = (Array.isArray(v.unsigned_urls) ? v.unsigned_urls : [])
    .map((u: unknown) => urlNoHost(u, "openrouter.ai"))
    .filter((u: string | null): u is string => Boolean(u))
    .slice(0, MAX_PECAS_POR_JOB);
  if (!fontes.length) return { estado: "falhou", erro: "a OpenRouter terminou mas não devolveu arquivo" };
  const arquivos: string[] = [];
  for (const [i, u] of fontes.entries()) {
    let out: Response;
    try {
      out = await fetch(u, { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(60_000) });
    } catch {
      return { estado: "rodando" }; // download que cai não é geração que falhou
    }
    if (!out.ok) {
      return out.status >= 500 ? { estado: "rodando" } : { estado: "falhou", erro: `download HTTP ${out.status}` };
    }
    const tipo = (out.headers.get("content-type") ?? "video/mp4").split(";")[0].trim();
    const buf = Buffer.from(await out.arrayBuffer());
    if (buf.length > OPENROUTER_TETO_BYTES) return { estado: "falhou", erro: "o vídeo passou de 200 MB" };
    const arq = path.join(pastaDePecas(), `${job.id}-${i}.${EXT_DO_TIPO[tipo] ?? "mp4"}`);
    fs.writeFileSync(arq, buf, { mode: 0o600 });
    arquivos.push(arq);
  }
  return { estado: "pronto", urls: arquivos, custo: custoOpenRouter(v.usage) };
}

type Enviado = {
  requestId: string;
  statusUrl?: string;
  responseUrl?: string;
  midia?: "imagem" | "video";
  arquivos?: string[];
  custo?: string;
};

const ADAPTADORES: Record<
  Provedor,
  {
    enviar: (
      chave: string,
      modelo: string,
      input: Record<string, unknown>,
      midia?: "imagem" | "video",
    ) => Promise<Enviado>;
    ler: (chave: string, job: Job) => Promise<Leitura>;
    intervaloMs: number;
  }
> = {
  fal: { enviar: falEnviar, ler: falLer, intervaloMs: 2500 },
  kie: { enviar: kieEnviar, ler: kieLer, intervaloMs: 3000 },
  wavespeed: { enviar: wavespeedEnviar, ler: wavespeedLer, intervaloMs: 2500 },
  replicate: { enviar: replicateEnviar, ler: replicateLer, intervaloMs: 2500 },
  openrouter: { enviar: openrouterEnviar, ler: openrouterLer, intervaloMs: 4000 },
};

// ---------------------------------------------------------------------------
// O laço: consultar, e quando pronto, trazer pro acervo.
// ---------------------------------------------------------------------------

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function aplicar(job: Job, leitura: Leitura): Job {
  if (leitura.estado === "pronto") {
    return {
      ...job,
      estado: "pronto",
      resultUrls: leitura.urls.slice(0, MAX_PECAS_POR_JOB),
      custo: job.ficha.externalCost ?? leitura.custo,
      erro: undefined,
    };
  }
  if (leitura.estado === "falhou") return { ...job, estado: "falhou", erro: leitura.erro };
  return { ...job, estado: leitura.estado };
}

async function ingerirPecas(job: Job): Promise<Job> {
  const pecas: Peca[] = [...(job.pecas ?? [])];
  for (const url of job.resultUrls ?? []) {
    const ja = pecas.find((p) => p.url === url);
    if (ja?.imageId) continue;
    try {
      // Peça que o balcão entregou atrás da chave já está no disco: sobe pelo arquivo.
      const local = !url.startsWith("https://");
      const r: any = await gallery({
        action: "ingest",
        ...(local ? { filePath: url } : { sourceUrl: url }),
        externalEngine: job.ficha.externalEngine,
        prompt: job.ficha.prompt,
        externalCost: job.custo,
        characterId: job.ficha.characterId,
        characterIds: job.ficha.characterIds,
        referenceImageIds: job.ficha.referenceImageIds,
        aspectRatio: job.ficha.aspectRatio,
        size: job.ficha.size,
        unfiltered: job.ficha.unfiltered,
        skills: job.ficha.skills,
      } as any);
      const peca: Peca = {
        url,
        imageId: r?.imageId ? String(r.imageId) : undefined,
        acervoUrl: r?.acervoUrl,
        adulta: r?.adulta ? true : undefined,
      };
      if (ja) Object.assign(ja, peca, { erro: undefined });
      else pecas.push(peca);
    } catch (e) {
      // O ingest é idempotente pela URL: o próximo status tenta de novo sem duplicar.
      const erro = describeConvexError(e);
      if (ja) ja.erro = erro;
      else pecas.push({ url, erro });
    }
  }
  const todas = (job.resultUrls ?? []).every((u) => pecas.some((p) => p.url === u && p.imageId));
  return { ...job, pecas, estado: todas ? "ingerido" : "pronto" };
}

async function avancar(job: Job, segundos: number): Promise<Job> {
  const inicio = Date.now();
  const prazo = inicio + Math.max(0, Math.min(segundos, ESPERA_MAX_S)) * 1000;
  const { ler, intervaloMs: intervalo } = ADAPTADORES[job.provedor];
  let atual = job;
  for (;;) {
    if (atual.estado === "fila" || atual.estado === "rodando") {
      const leitura = await ler(chaveDo(atual.provedor), atual);
      atual = aplicar(atual, leitura);
      await salvarJob(atual);
    }
    if (atual.estado === "pronto" && atual.ingerir && Date.now() - inicio < INGEST_SO_ATE_MS) {
      atual = await ingerirPecas(atual);
      await salvarJob(atual);
      return atual;
    }
    if (atual.estado !== "fila" && atual.estado !== "rodando") return atual;
    if (Date.now() + intervalo > prazo) return atual;
    await dormir(intervalo);
  }
}

// ---------------------------------------------------------------------------
// O que volta pro agente.
// ---------------------------------------------------------------------------

function proximoPasso(job: Job): string {
  const p = job.provedor;
  switch (job.estado) {
    case "fila":
    case "rodando":
      return `Ainda renderizando ${balcaoCom(p, "em")}. Chame sapiens_pontes action=status jobId=${job.id} (aguardarSegundos até ${ESPERA_MAX_S}). NÃO chame gerar de novo: isso cria outro job e cobra outra vez na conta da pessoa.`;
    case "pronto":
      if (!job.ingerir) {
        return "Pronto no provedor, fora do acervo (ingerir=false). A URL do render expira: pra trazer, chame action=status com ingerir=true.";
      }
      return job.pecas?.some((p) => p.erro)
        ? `Gerou, mas a volta pro acervo falhou (ver pecas[].erro). Chame action=status jobId=${job.id} de novo: o ingest é idempotente, não duplica.`
        : `Gerou. Chame action=status jobId=${job.id} pra trazer pro acervo (a URL do render expira).`;
    case "ingerido":
      return "No acervo, privada e com custo 0 em Sinapses. Mostre com sapiens_gallery action=list (kind=video pra vídeo). Publicar é ato da pessoa (sapiens_gallery action=publish).";
    case "falhou":
      return `${balcaoCom(p, "")} marcou falha. Confira o painel ${balcaoCom(p, "de")} antes de tentar de novo (a regra de cobrança de job que falha é deles).`;
  }
}

function resumo(job: Job, extra: Record<string, unknown> = {}) {
  return {
    jobId: job.id,
    provedor: job.provedor,
    modelo: job.modelo,
    estado: job.estado,
    motor: job.ficha.externalEngine,
    pecas: job.pecas?.length ? job.pecas : undefined,
    resultUrls: job.estado === "pronto" ? job.resultUrls : undefined,
    custo: job.custo,
    erro: job.erro,
    chave: `A chave ficou nesta máquina: o pedido saiu daqui direto ${balcaoCom(job.provedor, "para")}. A casa não viu a chave.`,
    proximoPasso: proximoPasso(job),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// As actions.
// ---------------------------------------------------------------------------

async function gerar(args: PontesArgs) {
  const provedor = args.provedor;
  if (!provedor) throw new Error(`action=gerar exige provedor: ${PROVEDORES.map((p) => `'${p}'`).join(", ")}.`);
  const modelo = args.modelo?.trim();
  if (!modelo) {
    throw new Error("action=gerar exige modelo: o slug do modelo no provedor, igual à página dele.");
  }
  confereModelo(provedor, modelo);
  const chave = chaveDo(provedor);
  const input = lerInput(args.input);
  confereSemChaveNoPedido(input, args.prompt);
  conferePisoDeIdade([...(args.prompt ? [args.prompt] : []), ...textosDeCena(input)]);

  const ingerir = args.ingerir ?? true;
  if (ingerir) {
    try {
      getSessionToken();
    } catch {
      throw new Error(
        "Pra peça voltar pro acervo, a conta Sapiens precisa estar conectada neste MCP (sapiens_meta action=login). Sem conta, mande ingerir=false: a peça fica só no provedor.",
      );
    }
  }

  const midia = provedor === "openrouter" ? (args.midia ?? "imagem") : undefined;
  const hash = hashDoPedido(provedor, midia ? `${midia}:${modelo}` : modelo, input);
  if (!args.forcar) {
    const igual = lerJobs()
      .reverse()
      .find((j) => j.hash === hash && j.estado !== "falhou" && Date.now() - j.criadoEm < JANELA_REPETIDO_MS);
    if (igual) {
      if (args.ingerir === true) igual.ingerir = true;
      const atual = await avancar(igual, Math.min(args.aguardarSegundos ?? 0, ESPERA_MAX_S));
      return resumo(atual, {
        repetido: true,
        aviso:
          "Esse mesmo pedido já tinha ido pro provedor há menos de 30 minutos: devolvi o job que existe em vez de criar outro, pra não cobrar duas vezes. Pra gerar de novo de propósito, mande forcar=true.",
      });
    }
  }

  const promptDaFicha =
    args.prompt?.trim() ||
    (typeof input.prompt === "string" && input.prompt.trim() ? input.prompt : JSON.stringify(input).slice(0, 4000));
  const enviado = await ADAPTADORES[provedor].enviar(chave, modelo, input, midia);
  const agora = Date.now();
  const job: Job = {
    id: novoId(),
    provedor,
    modelo,
    hash,
    criadoEm: agora,
    atualizadoEm: agora,
    estado: "fila",
    ...enviado,
    ingerir,
    ficha: {
      externalEngine: motorDaFicha(provedor, modelo, args.externalEngine),
      prompt: promptDaFicha,
      externalCost: args.externalCost,
      characterId: args.characterId,
      characterIds: args.characterIds,
      referenceImageIds: args.referenceImageIds,
      aspectRatio:
        args.aspectRatio ?? (typeof input.aspect_ratio === "string" ? input.aspect_ratio : undefined),
      size: args.size ?? (typeof input.resolution === "string" ? input.resolution : undefined),
      unfiltered: args.unfiltered,
      skills: args.skills,
    },
  };
  // Gravado ANTES de esperar: se o cliente desistir no meio, o job continua
  // aqui e o status termina, em vez de alguém gerar (e pagar) de novo.
  await salvarJob(job);
  const atual = await avancar(job, args.aguardarSegundos ?? ESPERA_PADRAO_GERAR_S);
  return resumo(atual);
}

async function status(args: PontesArgs) {
  if (!args.jobId) throw new Error("action=status exige jobId (o pj_... que o gerar devolveu; action=jobs lista).");
  const job = lerJobs().find((j) => j.id === args.jobId);
  if (!job) {
    throw new Error(
      `Job ${args.jobId} não está nesta máquina. Os jobs moram em ${arquivoDeJobs()} do computador que gerou; liste com action=jobs.`,
    );
  }
  if (args.ingerir === true) job.ingerir = true;
  const atual = await avancar(job, args.aguardarSegundos ?? ESPERA_PADRAO_STATUS_S);
  return resumo(atual);
}

function balcoes() {
  return {
    regra:
      "A chave mora nesta máquina e sai daqui só pro provedor. A casa não recebe, não guarda e não vê. Gerar com a sua chave custa zero em Sinapses: você paga o preço do provedor, sem margem da casa.",
    balcoes: PROVEDORES.map((k) => ({
      provedor: k,
      nome: BALCOES[k].nome,
      variavel: BALCOES[k].envVar,
      configurada: Boolean(valorDeChave(BALCOES[k].envVar)),
    })),
    canal: CANAL,
    comoConfigurar: ondeFicaAChave(),
    ondeAcharOModelo:
      "fal: o id do endpoint na página do modelo em fal.ai/models (ex: 'fal-ai/flux/dev'). Kie: o 'model' da página do modelo no Market da Kie. WaveSpeed: o slug da página do modelo em wavespeed.ai/models (ex: 'wavespeed-ai/flux-2-klein-9b/text-to-image'). Replicate: 'dono/nome' do modelo oficial (ex: 'black-forest-labs/flux-schnell'), ou 'dono/nome:<versão>' pra modelo de comunidade. OpenRouter: o slug 'dono/nome' em openrouter.ai/models (imagem: 'bytedance-seed/seedream-4.5'; vídeo: 'google/veo-3.1' com midia='video'). O input é o corpo que a mesma página descreve.",
    outrosBalcoes:
      "Sogni, Krea, Magnific e a própria placa seguem pelo seu harness + sapiens_gallery action=ingest (catálogo em sapiens_meta action=pontes). Balcão novo na porta local entra por código, não por campo livre: cada chave só vai pro endereço do próprio provedor.",
  };
}

function jobs(args: PontesArgs) {
  const lista = lerJobs().slice(-(args.limit ?? 10)).reverse();
  return {
    arquivo: arquivoDeJobs(),
    count: lista.length,
    jobs: lista.map((j) => ({
      jobId: j.id,
      provedor: j.provedor,
      modelo: j.modelo,
      estado: j.estado,
      criadoEm: new Date(j.criadoEm).toISOString(),
      pecas: j.pecas?.filter((p) => p.imageId).map((p) => p.imageId),
      custo: j.custo,
    })),
  };
}

async function pontesInterno(args: PontesArgs): Promise<unknown> {
  if (isRemoteContext()) {
    throw new Error(
      "sapiens_pontes só roda no MCP instalado (sapiens-mcp no seu computador): a chave mora na sua máquina e o conector remoto não recebe chave nenhuma. Aqui, gere em Sinapse (sapiens_image, sapiens_video) ou instale o MCP local: https://www.sapiensinteticos.com/conectar-claude",
    );
  }
  switch (args.action) {
    case "balcoes":
      return balcoes();
    case "gerar":
      return gerar(args);
    case "status":
      return status(args);
    case "jobs":
      return jobs(args);
  }
}

export async function pontes(args: PontesArgs): Promise<unknown> {
  try {
    return limpo(await pontesInterno(args));
  } catch (e) {
    throw new Error(semChave(describeConvexError(e)));
  }
}
