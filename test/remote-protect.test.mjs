// Testes da PROTEÇÃO do transporte remoto: gate de sessão válida + saldo,
// rate limit por IP/token/401 e telemetria. Sobe um Convex FAKE (node:http
// imitando POST /api/query|/api/mutation do ConvexHttpClient) pra exercitar os
// caminhos válido/inválido/sem-saldo sem tocar o backend real.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

// Cenários por sessionToken (o fake acha o token no corpo da request).
const ACCOUNTS = {
  "tok-admin-123456": { user: { _id: "u-admin", isAdmin: true }, balance: { total: 9999 } },
  "tok-user-rico-12": { user: { _id: "u-rico", isAdmin: false }, balance: { total: 500 } },
  "tok-user-zero-12": { user: { _id: "u-zero", isAdmin: false }, balance: { total: 0 } },
};

const telemetry = [];

const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (obj) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const token = (body.match(/"sessionToken":\s*"([^"]+)"/) || [])[1];
    const path = (body.match(/"path":\s*"([^"]+)"/) || [])[1] || "";
    if (path === "mcpUsage:logCall") {
      telemetry.push({ token, body });
      return send({ status: "success", value: null });
    }
    if (path === "mcpExtras:mcpGetMySubscription") {
      const acct = ACCOUNTS[token];
      if (!acct) {
        return send({
          status: "error",
          errorMessage: "MCP: sessionToken inválido.",
          errorData: "MCP: sessionToken inválido.",
        });
      }
      return send({ status: "success", value: acct });
    }
    // Qualquer outra função: erro distinto, prova que o dispatch ACONTECEU.
    return send({
      status: "error",
      errorMessage: "fake: função não implementada",
      errorData: `fake: ${path} não implementada`,
    });
  });
});

let handler;
let handlerLimited;

before(async () => {
  await new Promise((ok) => fake.listen(0, "127.0.0.1", ok));
  process.env.CONVEX_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.SAPIENS_CONVEX_TIMEOUT_MS = "3000";
  const { createSapiensRemoteHandler } = await import("../dist/remote.js");
  handler = createSapiensRemoteHandler({ basePath: "/api/mcp" });
  handlerLimited = createSapiensRemoteHandler({
    basePath: "/api/mcp",
    limits: { perIpPerMin: 3, authFailPerMin: 2, perTokenPerMin: 100 },
  });
});

after(() => fake.close());

const URL_MCP = "http://sapiens.test/api/mcp/mcp";

function rpc(body, { token, ip } = {}) {
  return new Request(URL_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readRpcResponse(res, id) {
  const ctype = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ctype.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(line.slice(5).trim());
        if (msg.id === id) return msg;
      } catch {}
    }
    throw new Error(`sem mensagem id=${id}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

const call = (id, name, args, opts) =>
  rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, opts);
const list = (id, opts) => rpc({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, opts);

test("gate: tools/list por tier vale no remoto (admin 29, user 23)", async () => {
  const admin = await readRpcResponse(await handler(list(1, { token: "tok-admin-123456" })), 1);
  assert.equal(admin.result.tools.length, 29);
  const user = await readRpcResponse(await handler(list(2, { token: "tok-user-rico-12" })), 2);
  assert.equal(user.result.tools.length, 23, "user não vê admin-only");
});

test("gate: token inválido não leva catálogo nem dispatch", async () => {
  const lst = await readRpcResponse(await handler(list(3, { token: "tok-podre-12345" })), 3);
  assert.ok(lst.error, "tools/list com token inválido vira erro");
  assert.match(String(lst.error.message), /sessão remota recusada/);
  const c = await readRpcResponse(
    await handler(call(4, "sapiens_gallery", { action: "list" }, { token: "tok-podre-12345" })),
    4,
  );
  assert.equal(c.result?.isError, true);
  assert.match(c.result.content[0].text, /sessão remota recusada/);
});

test("gate: sem Sinapses bloqueia tool, mas sapiens_meta fica pra diagnóstico", async () => {
  const blocked = await readRpcResponse(
    await handler(call(5, "sapiens_gallery", { action: "list" }, { token: "tok-user-zero-12" })),
    5,
  );
  assert.equal(blocked.result?.isError, true);
  assert.match(blocked.result.content[0].text, /sem Sinapses/);

  const meta = await readRpcResponse(
    await handler(call(6, "sapiens_meta", { action: "app_url" }, { token: "tok-user-zero-12" })),
    6,
  );
  assert.ok(!meta.result?.isError, "meta liberada mesmo com saldo 0");
  assert.match(meta.result.content[0].text, /conectar-claude/);
});

test("gate: com saldo o dispatch acontece (erro vem do backend, não do gate)", async () => {
  const c = await readRpcResponse(
    await handler(call(7, "sapiens_gallery", { action: "list" }, { token: "tok-user-rico-12" })),
    7,
  );
  assert.equal(c.result?.isError, true, "fake não implementa gallery");
  assert.match(c.result.content[0].text, /não implementada/, "passou do gate e chegou no backend");
  assert.ok(!/sem Sinapses/.test(c.result.content[0].text));
});

test("telemetria: tools/call de sessão válida loga no Convex", async () => {
  const beforeCount = telemetry.length;
  await handler(call(8, "sapiens_meta", { action: "app_url" }, { token: "tok-admin-123456" }));
  await new Promise((r) => setTimeout(r, 300)); // fire-and-forget assenta
  assert.ok(telemetry.length > beforeCount, "logCall chegou no fake");
  const last = telemetry[telemetry.length - 1];
  assert.equal(last.token, "tok-admin-123456");
  assert.match(last.body, /"sapiens_meta"/);
});

test("rate limit: teto por IP devolve 429", async () => {
  const ip = "10.9.9.9"; // header controla a chave; handlerLimited: 3/min
  let last;
  for (let i = 0; i < 4; i++) {
    last = await handlerLimited(list(10 + i, { token: "tok-admin-123456", ip }));
  }
  assert.equal(last.status, 429, "4ª request do mesmo IP estoura o teto de 3/min");
  assert.equal((await last.json()).error, "rate_limited");
});

test("rate limit: rajada de 401 vira 429 (freio de brute-force)", async () => {
  const ip = "10.8.8.8"; // authFailPerMin: 2
  const r1 = await handlerLimited(list(20, { ip }));
  assert.equal(r1.status, 401);
  const r2 = await handlerLimited(list(21, { ip }));
  assert.equal(r2.status, 401);
  const r3 = await handlerLimited(list(22, { ip }));
  assert.equal(r3.status, 429, "depois de 2 falhas de auth, o IP espera a janela");
});
