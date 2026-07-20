import { ConvexHttpClient } from "convex/browser";
import { ZodError } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a raiz do monorepo a partir do diretório do MCP build (dist).
 * dist/convexClient.js está em tools/mcp-sapiens/dist, então 3 níveis acima
 * dá no root do monorepo.
 */
function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

/**
 * Carrega .env.local de vários lugares conhecidos sem sobrescrever vars já
 * setadas (.mcp.json env tem prioridade). Ordem é importante: variáveis do
 * primeiro arquivo encontrado ganham, próximos arquivos só adicionam keys
 * que ainda não existem.
 */
function loadLocalEnv() {
  const candidates = [
    // 1. .env.local do MCP (legado, ainda primário)
    path.resolve(__dirname, "..", ".env.local"),
    // 2. .env.local global do monorepo
    path.resolve(repoRoot(), ".env.local"),
    // 3. .env do monorepo
    path.resolve(repoRoot(), ".env"),
    // 4. apps/sapiens .env.local (compartilha NEXT_PUBLIC_CONVEX_URL)
    path.resolve(repoRoot(), "apps", "sapiens", ".env.local"),
    path.resolve(repoRoot(), "apps", "sapiens", ".env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) {
          let val = m[2];
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          process.env[m[1]] = val;
        }
      }
    }
  }
}
// Override de identidade INJETADO pelo processo pai (ex: o house-hermes spawna o
// MCP com SAPIENS_SESSION_TOKEN = o token da daemon daquela conversa). Capturado
// AQUI, ANTES do loadLocalEnv, de propósito: só vale um token vindo do env REAL
// do spawn, não um que caísse de um .env.local (que reviveria o bug do token
// velho sombrando login). Ver getSessionToken.
const INJECTED_SESSION_TOKEN = process.env.SAPIENS_SESSION_TOKEN;

loadLocalEnv();

/**
 * Lê session token do plugin Claude Code (state local). Esse arquivo é criado
 * pela skill `/sapiens:login` e é fonte alternativa pro token. MCP env.local
 * continua tendo prioridade pra retrocompat com setups antigos.
 */
function readPluginSessionToken(): string | null {
  const candidates = [
    path.resolve(repoRoot(), ".claude-plugin", ".local", "session.json"),
    path.resolve(repoRoot(), ".claude-plugin", "session.local.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {
        sessionToken?: string;
        expiresAt?: number;
      };
      if (raw?.sessionToken && raw.sessionToken.length > 8) {
        if (raw.expiresAt && Date.now() > raw.expiresAt) {
          continue;
        }
        return raw.sessionToken;
      }
    } catch {
      // arquivo corrompido, ignora
    }
  }
  return null;
}

// URL do Convex de produção do Sapiens. É valor público (NEXT_PUBLIC_*), então
// vem embutido como default pra instalação via npm funcionar sem configurar nada.
// Override por env (CONVEX_URL) continua valendo pra dev/staging.
//
// CONVEX-URL-MIGRATION: artefato DISTRIBUÍDO (pacote npm `sapiens-mcp`, já
// publicado). No corte EU->US, trocar o literal aqui, bump de versão e
// `npm publish`. Quem instalou precisa atualizar. Ver docs/infra/migracao-convex-eu-us.md
const DEFAULT_CONVEX_URL = "https://oceanic-bass-791.convex.cloud";

let _client: ConvexHttpClient | null = null;

export function getConvex(): ConvexHttpClient {
  if (_client) return _client;
  const url =
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    DEFAULT_CONVEX_URL;
  _client = new ConvexHttpClient(url);
  return _client;
}

// ============================================
// Sessão salva pelo login do próprio MCP (sapiens_meta action=login).
// Caminho canônico pra instalação via npm: ~/.sapiens-mcp/session.json.
// ============================================
function sessionStorePath(): string {
  return path.resolve(os.homedir(), ".sapiens-mcp", "session.json");
}

export function saveSessionToken(token: string): { path: string; expiresAt: number } {
  const file = sessionStorePath();
  // mode 0700/0600: o arquivo guarda um bearer de 30 dias. Sem isto, em POSIX o
  // dir sai 0755 e o arquivo 0644 (world-readable) — num host compartilhado (a
  // VPS da Helen) outro usuário local leria o token e assumiria a conta. mode só
  // aplica na CRIAÇÃO, então o chmod explícito cobre o caso de reescrever um
  // arquivo já existente 0644. No Windows chmod é no-op benigno (try/catch).
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Espelha os 30 dias do server (só pra avisar quando perto de expirar; a
  // validade real é sempre checada no Convex).
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  fs.writeFileSync(
    file,
    JSON.stringify({ sessionToken: token, expiresAt }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows/ACL: chmod pode não aplicar; o alvo real é o POSIX da VPS.
  }
  return { path: file, expiresAt };
}

export function clearSessionToken(): boolean {
  try {
    const file = sessionStorePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
  } catch {
    // ignora
  }
  return false;
}

function readStoredSessionToken(): string | null {
  try {
    const file = sessionStorePath();
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      sessionToken?: string;
      expiresAt?: number;
    };
    if (raw?.sessionToken && raw.sessionToken.length > 8) {
      if (raw.expiresAt && Date.now() > raw.expiresAt) return null;
      return raw.sessionToken;
    }
  } catch {
    // arquivo corrompido, ignora
  }
  return null;
}

// Token POR REQUEST (transporte remoto): o handler HTTP embrulha cada chamada
// em runWithSessionToken(bearer, ...) e o getSessionToken resolve DESTE
// contexto antes de qualquer fonte global. É o que torna o processo remoto
// multi-tenant seguro: duas requests concorrentes nunca enxergam o token uma
// da outra (AsyncLocalStorage isola por cadeia async), e nenhuma request cai
// no login em disco do host. No stdio o contexto nunca é setado: zero mudança.
const requestTokenContext = new AsyncLocalStorage<string>();

export function runWithSessionToken<T>(token: string, fn: () => T): T {
  return requestTokenContext.run(token, fn);
}

/**
 * True quando a chamada corre dentro do transporte REMOTO (streamable HTTP):
 * cada request remota roda embrulhada em runWithSessionToken, então o
 * AsyncLocalStorage tem valor. No stdio (processo local, na máquina do dono do
 * token) o contexto NUNCA é setado. É o sinal confiável pra recusar operações
 * que tocam o disco do HOST (ex: ler um arquivo local pra usar como frame de
 * vídeo): no servidor multi-tenant da Vercel, um caminho arbitrário seria
 * leitura de arquivo do próprio servidor, nunca do PC do usuário.
 */
export function isRemoteContext(): boolean {
  return requestTokenContext.getStore() !== undefined;
}

export function getSessionToken(): string {
  // Prioridade -1: token da REQUEST (transporte remoto, ver acima). Vence tudo:
  // identidade no remoto é sempre do bearer, nunca do estado do host.
  const fromRequest = requestTokenContext.getStore();
  if (fromRequest && fromRequest.length > 8) {
    return fromRequest;
  }
  // Prioridade 0: token INJETADO pelo processo pai (SAPIENS_SESSION_TOKEN no env
  // do spawn). É o mecanismo do house-hermes pra rodar o MCP na conta de UMA
  // daemon específica por conversa, sem depender do login em disco da máquina.
  // Capturado antes do loadLocalEnv (ver topo do arquivo), então só um env real
  // conta, nunca um .env.local. Vence tudo de propósito: é escolha explícita.
  if (INJECTED_SESSION_TOKEN && INJECTED_SESSION_TOKEN.length > 8) {
    return INJECTED_SESSION_TOKEN;
  }
  // Ordem de prioridade (mudou em v1.9.1 — ver POR QUE abaixo):
  //   1. store local do login do MCP (~/.sapiens-mcp/session.json) — o que
  //      `sapiens_meta action=login` acabou de salvar. Fonte canônica.
  //   2. state do plugin Claude Code (monorepo, /sapiens:login).
  //   3. env var SAPIENS_DESKTOP_SESSION_TOKEN (.env.local / config do MCP) —
  //      fallback pra setups headless/CI que nunca rodaram login interativo.
  //
  // POR QUE login (disco) vem ANTES do env: até a v1.9.0 o env tinha prioridade
  // 1, então um token VELHO em .env.local sombreava um login fresco. O `/login`
  // dizia "conectado" (ele usa o token recém-redimido direto), mas todas as
  // outras chamadas pegavam o token velho do env e estouravam "sessionToken
  // inválido" — que, sem o fix do describeError, aparecia como "Server Error"
  // opaco. Resultado: login parecia funcionar e nada mais funcionava. Agora um
  // login fresco sempre vence. Pra forçar o env explicitamente (caso raro),
  // rode `sapiens_meta action=logout` (limpa o store em disco) e o fallback de
  // env volta a valer.
  const fromStore = readStoredSessionToken();
  if (fromStore) {
    return fromStore;
  }
  const fromPlugin = readPluginSessionToken();
  if (fromPlugin) {
    return fromPlugin;
  }
  const fromEnv = process.env.SAPIENS_DESKTOP_SESSION_TOKEN;
  if (fromEnv && fromEnv !== "PASTE_HERE_AFTER_RUNNING_auth.mjs") {
    return fromEnv;
  }
  throw new Error(
    "Conta Sapiens não conectada. 1) Abra https://sapiensinteticos.com/conectar-claude " +
      "logado e gere o código. 2) Rode a tool de login: sapiens_meta action=login code=XXXX-XXXX.",
  );
}

/**
 * Extrai a mensagem ÚTIL de um erro do Convex.
 *
 * O ConvexHttpClient embrulha qualquer throw do servidor num Error cujo
 * `.message` é o opaco "[Request ID: xxx] Server Error". Pra um ConvexError
 * (os throws "de aplicação" — token inválido/expirado, rate limit, saldo
 * insuficiente, item não encontrado, etc.) a mensagem real fica em `.data`.
 *
 * Sem isso, TODO erro de aplicação virava "Server Error" e era impossível
 * diagnosticar (um token expirado parecia uma queda de backend). Preferimos
 * `.data` quando existe; senão caímos no `.message`. Fonte única usada tanto
 * pelo handler global (index.ts) quanto pelos catches locais (ex: meta health).
 */
export function describeConvexError(e: any): string {
  // Erro de validação de argumento (schema.parse no dispatch): sem isto o
  // ZodError caía cru (e.message = dump JSON das issues). Vira uma linha
  // legível e acionável pro modelo refazer a chamada com o campo certo.
  if (e instanceof ZodError) {
    const parts = e.issues.map((i) => {
      const at = i.path.length ? i.path.join(".") : "(raiz)";
      return `${at}: ${i.message}`;
    });
    return `Argumentos inválidos: ${parts.join("; ")}`;
  }
  const data = e?.data;
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
    try {
      return JSON.stringify(data);
    } catch {
      /* cai no message abaixo */
    }
  }
  return e?.message ?? String(e);
}

// Teto de tempo por chamada ao Convex. O ConvexHttpClient não aceita
// AbortSignal em query/mutation/action, então o bound prático é um race contra
// um timer. Sem isto, um backend pendurado deixa a chamada MCP presa até o
// timeout do host, sem erro claro, ruim numa sessão que acabou de mandar
// debitar Sinapses e não sabe se caiu. NÃO há retry/backoff de propósito:
// chamadas não-idempotentes (cobrança) não podem re-disparar às cegas.
// Default 120s (era 30s): geração síncrona (imagem pesada, artigo, mega-gráfico,
// carrossel) leva de 30 a 90s e estourava o teto de 30s, voltando 'Timeout' pro
// cliente MESMO tendo gerado e COBRADO. 120s cobre esses casos; render de vídeo
// (minutos) ainda precisa do fluxo assíncrono. Override por env pra outro teto.
const CONVEX_TIMEOUT_MS = Number(process.env.SAPIENS_CONVEX_TIMEOUT_MS) || 120000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Timeout: o backend Sapiens não respondeu em ${Math.round(
            CONVEX_TIMEOUT_MS / 1000,
          )}s (${label}). Tente de novo em instantes.`,
        ),
      );
    }, CONVEX_TIMEOUT_MS);
  });
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    timeout,
  ]) as Promise<T>;
}

export async function convexQuery<T = any>(
  fnPath: string,
  args: Record<string, any>,
): Promise<T> {
  const client = getConvex();
  return (await withTimeout(client.query(fnPath as any, args), `query ${fnPath}`)) as T;
}

export async function convexMutation<T = any>(
  fnPath: string,
  args: Record<string, any>,
): Promise<T> {
  const client = getConvex();
  return (await withTimeout(client.mutation(fnPath as any, args), `mutation ${fnPath}`)) as T;
}

export async function convexAction<T = any>(
  fnPath: string,
  args: Record<string, any>,
): Promise<T> {
  const client = getConvex();
  return (await withTimeout(client.action(fnPath as any, args), `action ${fnPath}`)) as T;
}
