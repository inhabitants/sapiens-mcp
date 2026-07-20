#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { MCP_VERSION } from "./version.js";
import {
  buildToolList,
  callTool,
  SAPIENS_INSTRUCTIONS,
  TOOLS,
} from "./registry.js";
import {
  getCachedTier,
  onTierVisibilityChange,
  probeTierInBackground,
} from "./tier.js";
import { getPrompt, listPrompts } from "./prompts.js";
import { convexMutation, getSessionToken } from "./convexClient.js";

// Telemetria stdio (fire-and-forget, NUNCA derruba a chamada). O stdio sempre
// foi caixa-preta (cada cliente roda a própria cópia via npx), então o
// transporte que mais roda — Helen/Cursor/Gemini CLI — era invisível na
// mcpUsage, que só via o remoto. Loga o MESMO shape que o remote.ts, com
// transport:"stdio". Identidade do login local (getSessionToken), nunca args
// (só tool/action/ok/ms). Opt-out por SAPIENS_MCP_NO_TELEMETRY=1.
function logStdioUsage(fields: {
  tool: string;
  action: string | null;
  ok: boolean;
  ms: number;
}): void {
  try {
    if (process.env.SAPIENS_MCP_NO_TELEMETRY === "1") return;
    const token = getSessionToken();
    if (!token) return; // sem login não há identidade pra vincular
    convexMutation("mcpUsage:logCall", {
      sessionToken: token,
      tool: fields.tool,
      action: fields.action ?? undefined,
      ok: fields.ok,
      ms: Math.round(fields.ms),
      transport: "stdio",
    }).catch(() => {});
  } catch {
    // telemetria nunca vira erro pro cliente
  }
}

// Transporte STDIO (o pacote npm/npx que os clients locais rodam). O catálogo,
// as instructions e o dispatch vivem no registry.ts, compartilhados com o
// transporte remoto (remote.ts). Aqui fica só o que é do stdio: o tier vem do
// login local em disco (cache de processo + probe no boot) e muda por
// notifications/tools/list_changed.
const server = new Server(
  { name: "mcp-sapiens", version: MCP_VERSION },
  {
    capabilities: { tools: { listChanged: true }, prompts: {} },
    instructions: SAPIENS_INSTRUCTIONS,
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: buildToolList(getCachedTier()),
}));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: listPrompts(),
}));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  return getPrompt(
    req.params.name,
    (req.params.arguments ?? {}) as Record<string, string>,
  );
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const t0 = Date.now();
  const result = await callTool(name, args);
  logStdioUsage({
    tool: name,
    action: typeof args.action === "string" ? args.action : null,
    ok: !result.isError,
    ms: Date.now() - t0,
  });
  return result;
});

// Tier mudou de um jeito que altera a lista visível (login/logout/probe):
// avisa o client pra re-listar. Best-effort: client que não suporta ignora.
onTierVisibilityChange(() => {
  server.sendToolListChanged().catch(() => {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
// Descobre o tier em background (não bloqueia handshake nem tools/list).
probeTierInBackground();
console.error(
  `mcp-sapiens v${MCP_VERSION} rodando via stdio (${Object.keys(TOOLS).length} tools)`,
);
