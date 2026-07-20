import { createMcpHandler, withMcpAuth } from "mcp-handler";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  buildToolList,
  callTool,
  SAPIENS_INSTRUCTIONS,
} from "./registry.js";
import { getPrompt, listPrompts } from "./prompts.js";
import {
  convexMutation,
  convexQuery,
  getSessionToken,
  runWithSessionToken,
} from "./convexClient.js";
import { MCP_VERSION } from "./version.js";

/**
 * Transporte REMOTO do sapiens-mcp: streamable HTTP via `mcp-handler`, pensado
 * pra rota /api/mcp do Next na Vercel (mas é um fetch handler puro, Request ->
 * Response, então roda e TESTA fora do Next).
 *
 * PROTEÇÃO (o endpoint fica exposto na internet; regra do dono: obrigatório
 * login VÁLIDO e Sinapses na conta pra usar):
 *   1. Rate limit in-memory por IP (todas as requests) + penalidade dedicada
 *      pra rajada de 401 (brute-force de bearer) + teto por token autenticado.
 *      Por instância serverless, sem Redis: é a primeira camada, não a única
 *      (custo/limite fino continua server-side no Convex por função).
 *   2. Sessão validada DE VERDADE contra o Convex (mcpGetMySubscription) com
 *      cache por token: inválida = erro claro, sem catálogo e sem dispatch
 *      (fail-closed). Transiente (backend fora) = erro pedindo retry.
 *   3. Saldo: conta sem Sinapses não executa tool nenhuma exceto sapiens_meta
 *      (diagnóstico: whoami/credits/subscription pra pessoa entender o porquê).
 *      Admin (dono) passa sempre.
 *
 * Identidade: SEMPRE o bearer do header Authorization (o sessionToken de 30
 * dias do Sapiens). Cada request roda embrulhada em runWithSessionToken
 * (AsyncLocalStorage), então o getSessionToken de TODO handler resolve o token
 * daquela request (multi-tenant seguro, nunca cai no login em disco do host).
 * login/logout são bloqueados aqui: sessão remota não tem estado local.
 *
 * TELEMETRIA: toda tools/call de sessão válida loga fire-and-forget no Convex
 * (mcpUsage:logCall, identidade do próprio token) + uma linha JSON no stdout
 * (logs da Vercel). Falha de log nunca derruba a chamada.
 */

// ---------- rate limit (janela fixa, in-memory, por instância) ----------

const LIMITER_MAX_KEYS = 5000;

class WindowLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** true = dentro do limite (e consome 1); false = estourou. */
  hit(key: string): boolean {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || now >= cur.reset) {
      if (this.hits.size >= LIMITER_MAX_KEYS) {
        const oldest = this.hits.keys().next().value;
        if (oldest !== undefined) this.hits.delete(oldest);
      }
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    cur.n += 1;
    return cur.n <= this.max;
  }

  /** Consulta sem consumir (pra pré-checar a penalidade de 401). */
  blocked(key: string): boolean {
    const cur = this.hits.get(key);
    return !!cur && Date.now() < cur.reset && cur.n >= this.max;
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "local";
}

function tooMany(msg: string): Response {
  return new Response(
    JSON.stringify({ error: "rate_limited", message: msg }),
    {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    },
  );
}

// ---------- sessão remota (validação real + cache por token) ----------

type RemoteSession =
  | { status: "valid"; tier: "admin" | "user"; balance: number }
  | { status: "invalid"; reason: string }
  | { status: "unknown" };

const SESSION_CACHE_MAX = 2000;
const TTL_VALID_MS = 5 * 60 * 1000; // saldo/tier podem mudar; 5 min de frescor
const TTL_INVALID_MS = 60 * 1000; // não martela o Convex com token podre
const TTL_UNKNOWN_MS = 15 * 1000; // transiente: tenta de novo logo

const sessionCache = new Map<string, { s: RemoteSession; exp: number }>();

function cacheSession(token: string, s: RemoteSession, ttl: number): RemoteSession {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
  sessionCache.set(token, { s, exp: Date.now() + ttl });
  return s;
}

async function resolveRemoteSession(token: string): Promise<RemoteSession> {
  const hit = sessionCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.s;
  try {
    const sub: any = await convexQuery("mcpExtras:mcpGetMySubscription", {
      sessionToken: token,
    });
    if (sub?.user) {
      return cacheSession(
        token,
        {
          status: "valid",
          tier: sub.user.isAdmin ? "admin" : "user",
          balance: typeof sub.balance?.total === "number" ? sub.balance.total : 0,
        },
        TTL_VALID_MS,
      );
    }
    return cacheSession(token, { status: "unknown" }, TTL_UNKNOWN_MS);
  } catch (e: any) {
    // ConvexError de aplicação (token inválido/expirado) vem com .data; erro
    // de rede/timeout vem sem. Só o primeiro é veredito; o resto é transiente.
    if (e?.data) {
      return cacheSession(
        token,
        { status: "invalid", reason: String(e.data) },
        TTL_INVALID_MS,
      );
    }
    return cacheSession(token, { status: "unknown" }, TTL_UNKNOWN_MS);
  }
}

function isErrorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

const MSG_INVALID = (reason: string) =>
  `Erro: sessão remota recusada (${reason}). O header Authorization precisa de um sessionToken ` +
  "VÁLIDO do Sapiens. Gere um novo acesso em sapiensinteticos.com/conectar-claude e atualize a " +
  "config da conexão.";

const MSG_UNKNOWN =
  "Erro: não consegui validar a sessão agora (backend indisponível?). Tente de novo em instantes.";

const MSG_NO_BALANCE =
  "Erro: sua conta está sem Sinapses, e o acesso remoto exige saldo ativo. Recarregue em " +
  "sapiensinteticos.com (Sinapses) e tente de novo; sapiens_meta (whoami/credits/subscription) " +
  "segue liberada pra você conferir a conta.";

function remoteSessionError(action: string) {
  return isErrorResult(
    `Erro: action=${action} não existe na conexão remota. A sessão aqui vem do header ` +
      "Authorization (Bearer <sessionToken>) configurado no seu cliente MCP, não de um " +
      "login local. Pra trocar de conta, troque o token na config da conexão " +
      "(gere acesso em sapiensinteticos.com/conectar-claude).",
  );
}

// ---------- telemetria (fire-and-forget, nunca derruba a chamada) ----------

function logUsage(fields: {
  tool: string;
  action: string | null;
  ok: boolean;
  ms: number;
  tier: string;
  token: string;
}): void {
  // Linha estruturada pros logs da Vercel (sem token, nunca).
  console.log(
    JSON.stringify({
      src: "sapiens-mcp-remote",
      v: MCP_VERSION,
      tool: fields.tool,
      action: fields.action,
      ok: fields.ok,
      ms: fields.ms,
      tier: fields.tier,
    }),
  );
  // Registro por usuário no Convex (identidade do próprio token; requireMcpUser
  // no servidor). Se a função ainda não existir no deploy, falha em silêncio.
  convexMutation("mcpUsage:logCall", {
    sessionToken: fields.token,
    tool: fields.tool,
    action: fields.action ?? undefined,
    ok: fields.ok,
    ms: Math.round(fields.ms),
    transport: "remote",
  }).catch(() => {});
}

// ---------- o servidor MCP (registry compartilhado com o stdio) ----------

function initServer(mcp: McpServer): void {
  // Registra os handlers direto no Server de baixo nível: paridade exata com o
  // stdio (mesmo registry, mesmo dispatch), sem redeclarar tool a tool.
  const s = mcp.server;

  s.setRequestHandler(ListToolsRequestSchema, async () => {
    const session = await resolveRemoteSession(getSessionToken());
    if (session.status === "invalid") {
      throw new Error(MSG_INVALID(session.reason));
    }
    // Transiente: serve o catálogo cheio (o gate de verdade é no tools/call).
    const tier = session.status === "valid" ? session.tier : null;
    return { tools: buildToolList(tier) };
  });

  s.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listPrompts(),
  }));

  s.setRequestHandler(GetPromptRequestSchema, async (req) =>
    getPrompt(
      req.params.name,
      (req.params.arguments ?? {}) as Record<string, string>,
    ),
  );

  s.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const token = getSessionToken();

    // login/logout mexem no store em disco do HOST: sem sentido (e errado) num
    // servidor multi-tenant. A identidade remota é o bearer, ponto.
    if (
      name === "sapiens_meta" &&
      (args.action === "login" || args.action === "logout")
    ) {
      return remoteSessionError(String(args.action));
    }

    // O gate do dono: login válido + Sinapses na conta pra executar qualquer
    // coisa. sapiens_meta fica de fora do gate de saldo (é como a pessoa
    // DESCOBRE que está sem saldo); admin passa sempre.
    const session = await resolveRemoteSession(token);
    if (session.status === "invalid") {
      return isErrorResult(MSG_INVALID(session.reason));
    }
    if (session.status === "unknown") {
      return isErrorResult(MSG_UNKNOWN);
    }
    if (
      session.tier !== "admin" &&
      session.balance <= 0 &&
      name !== "sapiens_meta"
    ) {
      return isErrorResult(MSG_NO_BALANCE);
    }

    const t0 = Date.now();
    const result = await callTool(name, args);
    logUsage({
      tool: name,
      action: typeof args.action === "string" ? args.action : null,
      ok: !result.isError,
      ms: Date.now() - t0,
      tier: session.tier,
      token,
    });
    return result;
  });
}

export type SapiensRemoteOptions = {
  /** basePath da rota (ex: "/api/mcp" pra app/api/mcp/[transport]/route.js). */
  basePath: string;
  /** Teto em segundos do streaming de uma request (default 300, teto Vercel Pro). */
  maxDuration?: number;
  verboseLogs?: boolean;
  /** Tetos do rate limit por minuto (in-memory, por instância). */
  limits?: {
    /** Toda request, por IP. Default 120/min. */
    perIpPerMin?: number;
    /** Respostas 401 (bearer ruim), por IP: freia brute-force. Default 20/min. */
    authFailPerMin?: number;
    /** Requests autenticadas, por token. Default 240/min. */
    perTokenPerMin?: number;
  };
};

/**
 * Cria o fetch handler (Request -> Response) do MCP remoto. Exporte como
 * GET/POST/DELETE numa rota Next, ou sirva com qualquer runtime que fale
 * fetch. SSE fica desligado (transporte legado, exigiria Redis); é streamable
 * HTTP puro em <basePath>/mcp.
 */
export function createSapiensRemoteHandler(
  opts: SapiensRemoteOptions,
): (req: Request) => Promise<Response> {
  const limits = {
    perIpPerMin: opts.limits?.perIpPerMin ?? 120,
    authFailPerMin: opts.limits?.authFailPerMin ?? 20,
    perTokenPerMin: opts.limits?.perTokenPerMin ?? 240,
  };
  const ipLimiter = new WindowLimiter(limits.perIpPerMin, 60_000);
  const authFailLimiter = new WindowLimiter(limits.authFailPerMin, 60_000);
  const tokenLimiter = new WindowLimiter(limits.perTokenPerMin, 60_000);

  const base = createMcpHandler(
    initServer,
    {
      serverInfo: { name: "mcp-sapiens", version: MCP_VERSION },
      capabilities: { tools: {}, prompts: {} },
      instructions: SAPIENS_INSTRUCTIONS,
    },
    {
      basePath: opts.basePath,
      maxDuration: opts.maxDuration ?? 300,
      disableSse: true,
      verboseLogs: opts.verboseLogs ?? false,
    },
  );

  // O withMcpAuth valida o bearer e pendura em req.auth ANTES de chamar o
  // inner; o inner aplica o teto por token e embrulha TODO o processamento da
  // request no contexto do token (é daí que o getSessionToken de cada handler
  // resolve).
  const inner = (req: Request): Promise<Response> | Response => {
    const token = (req as any).auth?.token as string | undefined;
    if (!token) return base(req);
    if (!tokenLimiter.hit(token)) {
      return tooMany(
        "Muitas requisições dessa sessão num minuto. Espere um pouco e tente de novo.",
      );
    }
    return runWithSessionToken(token, () => base(req));
  };

  const authed = withMcpAuth(
    inner,
    (_req, bearerToken) => {
      // Shape-check só (sem rede): a validação de VERDADE acontece por request
      // contra o Convex (resolveRemoteSession) e por função (requireMcpUser).
      if (!bearerToken || bearerToken.length < 9) return undefined;
      return {
        token: bearerToken,
        clientId: "sapiens-remote",
        scopes: [],
      };
    },
    { required: true },
  );

  return async (req: Request): Promise<Response> => {
    const ip = clientIp(req);
    if (!ipLimiter.hit(ip)) {
      return tooMany("Muitas requisições desse IP num minuto.");
    }
    if (authFailLimiter.blocked(ip)) {
      return tooMany(
        "Muitas tentativas de autenticação inválidas desse IP. Espere um minuto.",
      );
    }
    const res = await authed(req);
    if (res.status === 401) {
      authFailLimiter.hit(ip);
    }
    return res;
  };
}
