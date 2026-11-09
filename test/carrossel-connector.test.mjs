// O conector do carrossel (superfície do diretório do Claude): o mesmo
// transporte remoto servindo SÓ as tools grátis do carrossel. CONVEX_URL numa
// porta morta antes do import: nenhum teste toca o backend real.

process.env.CONVEX_URL = "http://127.0.0.1:9";
process.env.SAPIENS_CONVEX_TIMEOUT_MS = "1500";

import { test } from "node:test";
import assert from "node:assert/strict";

const { createSapiensRemoteHandler } = await import("../dist/remote.js");

const PRM_PATH = "/.well-known/oauth-protected-resource/api/mcp/carrossel";
const handler = createSapiensRemoteHandler({
  endpoint: "/api/mcp/carrossel",
  surface: "carrossel",
  resourceMetadataPath: PRM_PATH,
  resourceUrl: "https://sapiens.test",
  anonymousDiscovery: true,
});
const URL_MCP = "http://sapiens.test/api/mcp/carrossel";

function rpc(body, { auth = false, url = URL_MCP } = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(auth ? { authorization: "Bearer token-de-teste-123456" } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readRpc(res, id) {
  const text = await res.text();
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(line.slice(5).trim());
        if (msg.id === id) return msg;
      } catch {}
    }
    throw new Error(`SSE sem id=${id}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};

test("carrossel: initialize anônimo traz nome, instruções e só a capability de tools", async () => {
  const res = await handler(rpc(INIT));
  assert.equal(res.status, 200);
  const msg = await readRpc(res, 1);
  assert.equal(msg.result.serverInfo.name, "sint-carrossel");
  assert.match(msg.result.instructions, /search_photos/);
  assert.ok(msg.result.capabilities.tools);
  assert.equal(msg.result.capabilities.prompts, undefined);
  assert.equal(msg.result.capabilities.resources, undefined);
});

test("carrossel: tools/list é só o carrossel grátis, com as anotações que o diretório exige", async () => {
  const res = await handler(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const msg = await readRpc(res, 2);
  const tools = msg.result.tools;
  const nomes = tools.map((t) => t.name).sort();
  assert.deepEqual(nomes, [
    "create_carousel",
    "get_carousel",
    "list_carousels",
    "search_photos",
    "set_slide_photo",
    "update_carousel",
  ]);
  for (const t of tools) {
    assert.ok(t.annotations.title, `${t.name} sem title`);
    assert.equal(typeof t.annotations.readOnlyHint, "boolean", `${t.name} sem readOnlyHint`);
    assert.equal(typeof t.annotations.destructiveHint, "boolean", `${t.name} sem destructiveHint`);
  }
  const porNome = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
  assert.equal(porNome.get_carousel.readOnlyHint, true);
  assert.equal(porNome.search_photos.readOnlyHint, true);
  assert.equal(porNome.update_carousel.destructiveHint, true);
  // Nada de geração nem de peça fora do banco: o handle img_… não entra.
  const texto = JSON.stringify(tools);
  assert.doesNotMatch(texto, /generate_image|auto_images|"handle"|Sinapse/);
});

test("carrossel: tools/call sem login é 401 apontando a ficha PRM própria", async () => {
  const res = await handler(
    rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_carousels", arguments: {} } }),
  );
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") || "", new RegExp(`resource_metadata="https://sapiens.test${PRM_PATH}"`));
});

test("carrossel: com backend fora, tools/call é fail-closed e não fala de saldo", async () => {
  const res = await handler(
    rpc(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_photos", arguments: { query: "café" } } },
      { auth: true },
    ),
  );
  const msg = await readRpc(res, 4);
  assert.equal(msg.result.isError, true);
  assert.doesNotMatch(msg.result.content[0].text, /saldo|Sinapse/i);
});

test("carrossel: o endpoint do MCP completo não responde neste handler", async () => {
  const res = await handler(rpc(INIT, { url: "http://sapiens.test/api/mcp/mcp" }));
  assert.notEqual(res.status, 200);
});
