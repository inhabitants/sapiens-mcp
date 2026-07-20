// Testes do transporte REMOTO (streamable HTTP via mcp-handler): o handler é
// um fetch handler puro (Request -> Response), então dá pra exercitar em
// processo, sem Next e sem rede. CONVEX_URL aponta pra uma porta morta ANTES
// do import: qualquer lookup (tier) falha na hora -> tier desconhecido ->
// lista cheia, e nenhum teste toca o backend real.

process.env.CONVEX_URL = "http://127.0.0.1:9";
process.env.SAPIENS_CONVEX_TIMEOUT_MS = "1500";

import { test } from "node:test";
import assert from "node:assert/strict";

const { createSapiensRemoteHandler } = await import("../dist/remote.js");

const handler = createSapiensRemoteHandler({ basePath: "/api/mcp" });
const URL_MCP = "http://sapiens.test/api/mcp/mcp";
const BEARER = "token-de-teste-123456";

function rpc(body, { auth = true } = {}) {
  return new Request(URL_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(auth ? { authorization: `Bearer ${BEARER}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Streamable HTTP responde JSON puro ou SSE; normaliza pros dois casos. */
async function readRpcResponse(res, id) {
  const ctype = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ctype.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(line.slice(5).trim());
        if (msg.id === id) return msg;
      } catch {
        // linha de keepalive/parcial, segue
      }
    }
    throw new Error(`resposta SSE sem mensagem id=${id}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "remote-test", version: "0" },
  },
};

test("remoto: sem bearer é 401 com WWW-Authenticate", async () => {
  const res = await handler(rpc(INIT, { auth: false }));
  assert.equal(res.status, 401);
  assert.ok(res.headers.get("www-authenticate"), "aponta o esquema de auth");
});

test("remoto: initialize com bearer devolve serverInfo + instructions", async () => {
  const res = await handler(rpc(INIT));
  assert.equal(res.status, 200);
  const msg = await readRpcResponse(res, 1);
  assert.equal(msg.result?.serverInfo?.name, "mcp-sapiens");
  assert.ok(
    typeof msg.result?.instructions === "string" &&
      msg.result.instructions.length > 100,
    "instructions viajam no handshake remoto",
  );
  assert.ok(msg.result?.capabilities?.tools, "capability tools");
  assert.ok(msg.result?.capabilities?.prompts, "capability prompts");
});

test("remoto: tools/list com token não-verificável = lista cheia (fail-open)", async () => {
  const res = await handler(
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  );
  assert.equal(res.status, 200);
  const msg = await readRpcResponse(res, 2);
  const tools = msg.result?.tools;
  assert.ok(Array.isArray(tools), "tools/list responde");
  assert.equal(tools.length, 29, "tier desconhecido lista o catálogo cheio");
  const meta = tools.find((t) => t.name === "sapiens_meta");
  assert.ok(meta?.description?.length > 0, "descriptions presentes");
});

test("remoto: com backend fora, tools/call é FAIL-CLOSED (erro claro, sem dispatch)", async () => {
  // CONVEX_URL aponta pra porta morta: a sessão não valida (transiente) e o
  // gate segura a chamada em vez de despachar no escuro. O caminho feliz do
  // dispatch (sessão válida) é coberto em remote-protect.test.mjs com o
  // Convex fake.
  const res = await handler(
    rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "sapiens_meta", arguments: { action: "app_url" } },
    }),
  );
  const msg = await readRpcResponse(res, 3);
  assert.equal(msg.result?.isError, true);
  assert.match(
    msg.result?.content?.[0]?.text ?? "",
    /não consegui validar a sessão/,
    "erro pede retry em vez de fingir sucesso",
  );
});

test("remoto: login/logout são bloqueados (sessão vem do bearer)", async () => {
  for (const action of ["login", "logout"]) {
    const res = await handler(
      rpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "sapiens_meta", arguments: { action } },
      }),
    );
    const msg = await readRpcResponse(res, 4);
    assert.equal(msg.result?.isError, true, `${action} bloqueado no remoto`);
    assert.match(
      msg.result?.content?.[0]?.text ?? "",
      /Authorization/,
      "erro explica de onde vem a sessão remota",
    );
  }
});

test("remoto: prompts/list responde no transporte HTTP", async () => {
  const res = await handler(
    rpc({ jsonrpc: "2.0", id: 5, method: "prompts/list", params: {} }),
  );
  const msg = await readRpcResponse(res, 5);
  assert.ok(
    Array.isArray(msg.result?.prompts) && msg.result.prompts.length >= 5,
    "prompts disponíveis no remoto",
  );
});
