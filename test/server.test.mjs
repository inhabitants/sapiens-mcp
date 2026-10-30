// Teste de CONTRATO + SMOKE do binário stdio (node:test, zero devDep extra).
//
// Sobe o dist/index.js de verdade, faz o handshake JSON-RPC do MCP e lê
// tools/list. Trava o conjunto de tools (rename/drop quebra aqui, antes de
// chegar nos clients em skew de versão) e confere as annotations novas. Não
// chama tool que cobra: initialize + tools/list não tocam o backend nem exigem
// login. Rode com `npm test` (o pretest builda antes).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(PKG_ROOT, "dist", "index.js");
const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));

// Contrato: o conjunto EXATO de 41 tools do stdio. Adicionar/remover/renomear
// quebra este teste de propósito, forçando uma atualização consciente. O
// remoto lista uma a menos (sapiens_pontes só existe na máquina da pessoa).
const EXPECTED_TOOLS = [
  "sapiens_skill",
  "sapiens_resume",
  "sapiens_pipeline",
  "sapiens_carrossel",
  "sapiens_image",
  "sapiens_meta",
  "sapiens_repertorio",
  "sapiens_gallery",
  "sapiens_pontes",
  "sapiens_community",
  "sapiens_article",
  "sapiens_write",
  "sapiens_quote_pop",
  "sapiens_search",
  "sapiens_studios",
  "sapiens_persona",
  "sapiens_helen",
  "sapiens_musicator",
  "sapiens_agente",
  "sapiens_video",
  "sapiens_stock_audio",
  "sapiens_stock_video",
  "sapiens_brand",
  "sapiens_collection",
  "sapiens_character",
  "sapiens_profile",
  "sapiens_sintetico",
  "sapiens_forum",
  "sapiens_instagram",
  "sapiens_aula",
  "sapiens_support",
  "sapiens_atlas",
  "sapiens_reference",
  "sapiens_trilhas",
  "sapiens_semana",
  "sapiens_share",
  "sapiens_decupagem",
  "sapiens_publicidade",
  "sapiens_distribution",
  "sapiens_voice_jp",
  "sapiens_publicar",
].sort();

const READ_ONLY = [
  "sapiens_search",
  // sapiens_stock_audio saiu: action=generate cobra Sinapses (efeito sonoro).
  "sapiens_stock_video",
  "sapiens_atlas",
  "sapiens_reference",
  "sapiens_skill",
];

// sapiens_skill e sapiens_resume não falam com o backend (conteúdo estático /
// render puro no pacote), então são as únicas com openWorldHint=false.
const CLOSED_WORLD = ["sapiens_skill", "sapiens_resume"];

function startServer(extraEnv = {}) {
  // SAPIENS_TIER_OVERRIDE trava o tier e DESLIGA o probe de rede do boot:
  // teste hermético (a máquina de dev tem sessão real salva em disco, que sem
  // isto vazaria pro teste e dispararia chamada ao Convex). Default admin =
  // lista cheia, o contrato completo.
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SAPIENS_TIER_OVERRIDE: "admin", ...extraEnv },
  });
  const pending = new Map();
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  function send(msg) {
    child.stdin.write(JSON.stringify(msg) + "\n");
  }
  function request(id, method, params) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout esperando resposta de ${method}`));
      }, 15000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }
  function notify(method, params) {
    send({ jsonrpc: "2.0", method, params });
  }
  return { child, request, notify };
}

test("handshake declara serverInfo + instructions", async () => {
  const srv = startServer();
  try {
    const init = await srv.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "0" },
    });
    assert.ok(init.result, "initialize deve retornar result");
    assert.equal(init.result.serverInfo?.name, "mcp-sapiens");
    assert.equal(
      init.result.serverInfo?.version,
      pkg.version,
      "versão do handshake tem que bater com o package.json (fonte única)",
    );
    assert.ok(
      typeof init.result.instructions === "string" &&
        init.result.instructions.length > 100,
      "server instructions presentes no handshake",
    );
    assert.ok(init.result.capabilities?.tools, "declara capability tools");
    assert.equal(
      init.result.capabilities?.tools?.listChanged,
      true,
      "tools.listChanged declarado (tools/list por tier notifica mudança)",
    );
    assert.ok(init.result.capabilities?.prompts, "declara capability prompts");
  } finally {
    srv.child.kill();
  }
});

test("tools/list: contrato de nomes + annotations", async () => {
  const srv = startServer();
  try {
    await srv.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "0" },
    });
    srv.notify("notifications/initialized", {});

    const list = await srv.request(2, "tools/list", {});
    const tools = list.result?.tools;
    assert.ok(Array.isArray(tools), "tools/list retorna array");

    const names = tools.map((t) => t.name).sort();
    assert.equal(new Set(names).size, names.length, "sem nome de tool duplicado");
    assert.deepEqual(
      names,
      EXPECTED_TOOLS,
      "conjunto de tools mudou: atualize EXPECTED_TOOLS de propósito (rename/drop quebra clients em skew)",
    );

    for (const t of tools) {
      assert.match(t.name, /^sapiens_[a-z_]+$/, `nome válido: ${t.name}`);
      assert.ok(
        typeof t.description === "string" && t.description.length > 0,
        `${t.name} tem description`,
      );
      assert.equal(t.inputSchema?.type, "object", `${t.name} inputSchema é object`);
      assert.ok(t.annotations, `${t.name} tem annotations`);
      assert.ok(
        typeof t.annotations.title === "string" && t.annotations.title.length > 0,
        `${t.name} tem annotations.title`,
      );
      assert.equal(
        t.annotations.openWorldHint,
        !CLOSED_WORLD.includes(t.name),
        `${t.name} openWorldHint`,
      );
      assert.equal(
        typeof t.annotations.readOnlyHint,
        "boolean",
        `${t.name} readOnlyHint é boolean`,
      );
    }

    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const ro of READ_ONLY) {
      assert.equal(
        byName[ro].annotations.readOnlyHint,
        true,
        `${ro} deveria ser read-only`,
      );
    }
    assert.equal(
      byName["sapiens_image"].annotations.readOnlyHint,
      false,
      "sapiens_image cobra Sinapses, não pode ser read-only",
    );
  } finally {
    srv.child.kill();
  }
});

// Contrato de ACTIONS: as sub-actions críticas não podem sumir/renomear sem
// quebra consciente. O teste de nomes acima trava o conjunto de TOOLS; este
// trava as ACTIONS que importam (billing / fluxo que não pode errar). Extrai
// inputSchema.properties.action.enum de cada tool.
const MUST_HAVE_ACTIONS = {
  sapiens_meta: ["start", "login", "version", "subscription"],
  sapiens_image: ["generate", "models"],
  sapiens_video: ["create", "status", "models", "sonorize"],
  sapiens_musicator: ["create", "lyrics", "render", "get", "list_public"],
  sapiens_stock_audio: ["list", "generate", "generation-status"],
  sapiens_sintetico: ["send", "send_context", "status"],
  sapiens_pipeline: [
    "run_mega_grafico_full",
    "generate_carousel",
    "create_production",
    "finalize_production",
  ],
  sapiens_forum: ["feed", "post", "vote"],
  sapiens_repertorio: ["resolve", "add_item"],
  // A porta da chave própria: status é o que impede o agente de gerar (e
  // cobrar na conta da pessoa) de novo.
  sapiens_pontes: ["balcoes", "gerar", "status", "jobs"],
};

test("contrato de actions: sub-actions críticas presentes", async () => {
  const srv = startServer();
  try {
    await srv.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "0" },
    });
    srv.notify("notifications/initialized", {});
    const list = await srv.request(2, "tools/list", {});
    const byName = Object.fromEntries(
      list.result.tools.map((t) => [t.name, t]),
    );

    // Toda tool com propriedade `action` tem enum não-vazio (as que usam outro
    // campo primário, ex: sapiens_search=query, não têm `action` e são puladas).
    for (const t of list.result.tools) {
      const actionProp = t.inputSchema?.properties?.action;
      if (actionProp) {
        assert.ok(
          Array.isArray(actionProp.enum) && actionProp.enum.length > 0,
          `${t.name}.action tem enum não-vazio`,
        );
      }
    }

    // Sub-actions críticas não somem sem quebra consciente deste teste.
    for (const [tool, required] of Object.entries(MUST_HAVE_ACTIONS)) {
      const enumVals =
        byName[tool]?.inputSchema?.properties?.action?.enum ?? [];
      for (const a of required) {
        assert.ok(
          enumVals.includes(a),
          `${tool} perdeu a action crítica '${a}' (quebra clients/fluxo)`,
        );
      }
    }
  } finally {
    srv.child.kill();
  }
});

// tools/list por tier: user comum não recebe as tools admin-only (as
// descriptions/schemas mais pesadas), mas o CallTool continua despachando
// (esconder não é bloquear; o gate real é o Convex).
const ADMIN_ONLY = [
  "sapiens_pipeline",
  "sapiens_article",
  "sapiens_quote_pop",
  "sapiens_instagram",
  "sapiens_aula",
  "sapiens_share",
  "sapiens_decupagem",
  "sapiens_publicidade",
  "sapiens_distribution",
  // Motor de voz japonesa por fila numa GPU da casa: enquanto for japones-so,
  // membro nenhum precisa. Sai daqui junto com o gate do backend.
  "sapiens_voice_jp",
];

test("tools/list por tier: user não vê as admin-only", async () => {
  const srv = startServer({ SAPIENS_TIER_OVERRIDE: "user" });
  try {
    await srv.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "0" },
    });
    srv.notify("notifications/initialized", {});
    const list = await srv.request(2, "tools/list", {});
    const names = list.result.tools.map((t) => t.name);
    for (const hidden of ADMIN_ONLY) {
      assert.ok(!names.includes(hidden), `tier user não deveria listar ${hidden}`);
    }
    assert.equal(
      names.length,
      EXPECTED_TOOLS.length - ADMIN_ONLY.length,
      "tier user lista exatamente o catálogo menos as admin-only",
    );
    // Escondida ≠ bloqueada: chamar uma admin-only ainda DESPACHA (aqui falha
    // por falta de arg, prova que o handler atendeu; o gate real é server-side).
    const call = await srv.request(3, "tools/call", {
      name: "sapiens_article",
      arguments: {},
    });
    assert.ok(call.result?.isError, "tool escondida continua despachável");
  } finally {
    srv.child.kill();
  }
});

test("prompts: list + get com args", async () => {
  const srv = startServer();
  try {
    await srv.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "0" },
    });
    srv.notify("notifications/initialized", {});

    const list = await srv.request(2, "prompts/list", {});
    const prompts = list.result?.prompts;
    assert.ok(Array.isArray(prompts) && prompts.length >= 5, "catálogo de prompts");
    const names = prompts.map((p) => p.name);
    for (const expected of ["comecar", "capturar-repertorio", "quiz-persona", "criar-musica"]) {
      assert.ok(names.includes(expected), `prompt ${expected} presente`);
    }
    for (const p of prompts) {
      assert.ok(p.description?.length > 0, `${p.name} tem description`);
    }

    const got = await srv.request(3, "prompts/get", {
      name: "capturar-repertorio",
      arguments: { obra: "acabei de ver Duna 2, nota 9" },
    });
    const msg = got.result?.messages?.[0];
    assert.equal(msg?.role, "user");
    assert.match(msg?.content?.text ?? "", /Duna 2/, "arg interpolado na mensagem");
    assert.match(msg?.content?.text ?? "", /add_item/, "instrui o fluxo certo");

    // Arg obrigatório faltando → erro claro, não mensagem vazia.
    const missing = await srv.request(4, "prompts/get", {
      name: "capturar-repertorio",
      arguments: {},
    });
    assert.ok(missing.error, "arg obrigatório faltando vira erro JSON-RPC");
  } finally {
    srv.child.kill();
  }
});

// --- skills da casa servidas pelo connector (resources + tool) ---
//
// As duas portas pro MESMO conteúdo: quem lê resources pega por
// skill://sapiens/<slug>/SKILL.md, quem não lê pega por sapiens_skill. É a
// única tool que dá pra exercitar aqui sem tocar o backend (conteúdo estático
// do pacote: sem login, sem custo, sem rede).

const EXPECTED_SKILLS = [
  "primeiros-passos",
  "voz-da-casa",
  "musica",
  "video",
  "imagem",
  "personagem",
  "studio",
  "forum-comunidade",
  "companhia",
  "trilhas",
  "minha-soul",
  "minha-voz",
  "curriculo",
  "pontes",
  "repertorio",
  "carrossel",
  "publicar",
  "sapiens-api",
].sort();

test("skills: resources/list + resources/read servem o SKILL.md", async () => {
  const srv = startServer();
  try {
    await srv.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "0" },
    });
    srv.notify("notifications/initialized", {});

    const list = await srv.request(2, "resources/list", {});
    const resources = list.result?.resources;
    assert.ok(Array.isArray(resources), "resources/list retorna array");
    assert.deepEqual(
      resources.map((r) => r.name).sort(),
      EXPECTED_SKILLS,
      "conjunto de skills mudou: atualize EXPECTED_SKILLS de propósito",
    );

    for (const r of resources) {
      assert.equal(r.uri, `skill://sapiens/${r.name}/SKILL.md`, `uri de ${r.name}`);
      assert.equal(r.mimeType, "text/markdown", `${r.name} é markdown`);
      assert.ok(r.description?.length > 0, `${r.name} diz quando usar`);
    }

    const read = await srv.request(3, "resources/read", {
      uri: "skill://sapiens/musica/SKILL.md",
    });
    const text = read.result?.contents?.[0]?.text ?? "";
    assert.match(text, /^---\nname: musica\n/, "frontmatter do formato aberto");
    assert.match(text, /trackId/, "o fluxo de verdade está no corpo");

    // URI que não existe erra em vez de devolver conteúdo vazio.
    const bad = await srv.request(4, "resources/read", {
      uri: "skill://sapiens/nao-existe/SKILL.md",
    });
    assert.ok(bad.error, "resource desconhecido vira erro JSON-RPC");
  } finally {
    srv.child.kill();
  }
});

test("skills: tool sapiens_skill lista e entrega o mesmo conteúdo", async () => {
  const srv = startServer();
  try {
    await srv.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "0" },
    });
    srv.notify("notifications/initialized", {});

    const listed = await srv.request(2, "tools/call", {
      name: "sapiens_skill",
      arguments: { action: "list" },
    });
    assert.ok(!listed.result?.isError, "list não erra sem login");
    const index = listed.result?.structuredContent;
    assert.equal(index.count, EXPECTED_SKILLS.length);
    assert.deepEqual(index.skills.map((s) => s.name).sort(), EXPECTED_SKILLS);

    const got = await srv.request(3, "tools/call", {
      name: "sapiens_skill",
      arguments: { action: "get", name: "video" },
    });
    const content = got.result?.structuredContent?.content ?? "";
    assert.match(content, /seedance-2-mini/, "traz o miolo que saiu das instructions");

    // Slug errado devolve o menu em vez de estourar: sem loop de 3 falhas.
    const miss = await srv.request(4, "tools/call", {
      name: "sapiens_skill",
      arguments: { action: "get", name: "musiqinha" },
    });
    assert.ok(!miss.result?.isError, "slug errado não vira isError");
    assert.ok(
      Array.isArray(miss.result?.structuredContent?.available),
      "slug errado devolve os slugs válidos",
    );
  } finally {
    srv.child.kill();
  }
});
