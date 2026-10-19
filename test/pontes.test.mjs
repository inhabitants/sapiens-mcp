// A porta local das Pontes (sapiens_pontes): gerar com a chave da PESSOA.
// O que estes testes travam é o que o dono pediu no dia da decisão
// (27/09/2026): a chave nunca sai da máquina a não ser pro provedor, nunca volta
// num resultado, num erro ou no arquivo de jobs, e o pedido repetido não cobra
// duas vezes. Rede de mentira (fetch trocado), disco num diretório temporário,
// sem backend: ingerir=false em todo gerar.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pontes-test-"));
process.env.SAPIENS_MCP_HOME = HOME;
// Chaves falsas no formato de verdade (a da fal é id:segredo), setadas ANTES
// do import pra nenhum .env.local da máquina tomar o lugar delas.
const FAL = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b:1234567890abcdef1234567890abcdef";
const FAL_ID = FAL.split(":")[0];
const KIE = "kie_test_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const WS = "ws_test_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const REP = "r8_test_0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d";
const OR = "sk-or-v1-test-5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b";
const WS_DO_CAMPO = "ws_campo_ffeeddccbbaa99887766554433221100";
process.env.FAL_KEY = FAL;
process.env.KIE_API_KEY = KIE;
process.env.WAVESPEED_API_KEY = WS;
process.env.REPLICATE_API_TOKEN = REP;
process.env.OPENROUTER_API_KEY = OR;
for (const campo of [
  "SAPIENS_FAL_KEY",
  "SAPIENS_KIE_API_KEY",
  "SAPIENS_WAVESPEED_API_KEY",
  "SAPIENS_REPLICATE_API_TOKEN",
  "SAPIENS_OPENROUTER_API_KEY",
]) {
  delete process.env[campo];
}

const { pontes, semChave } = await import("../dist/tools/pontes.js");
const { helen } = await import("../dist/tools/helen.js");
const { runWithSessionToken } = await import("../dist/convexClient.js");

const chamadas = [];
let roteiro = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  chamadas.push({ url: u, init });
  const passo = roteiro.shift();
  if (!passo) throw new Error(`fetch fora do roteiro: ${u}`);
  return passo(u, init);
};
const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const zerar = (...passos) => {
  chamadas.length = 0;
  roteiro = passos;
};
const semSegredo = (texto, oQue) => {
  for (const s of [FAL, FAL_ID, KIE, WS, REP, OR, WS_DO_CAMPO]) {
    assert.ok(!texto.includes(s), `${oQue} vazou a chave`);
  }
};

test("semChave: troca a chave inteira e cada metade da chave da fal", () => {
  const out = semChave(`Key ${FAL} / conta ${FAL_ID} / kie ${KIE}`);
  semSegredo(out, "semChave");
  assert.match(out, /\[chave\]/);
});

test("no remoto a porta não existe: recusa antes de ler chave ou tocar a rede", async () => {
  zerar();
  await assert.rejects(
    () => runWithSessionToken("token-remoto-123456", () => pontes({ action: "balcoes" })),
    /só roda no MCP instalado/,
  );
  assert.equal(chamadas.length, 0);
});

test("balcoes: diz o que está configurado pelo NOME, nunca pelo valor", async () => {
  zerar();
  const r = await pontes({ action: "balcoes" });
  semSegredo(JSON.stringify(r), "balcoes");
  assert.deepEqual(
    r.balcoes.map((b) => [b.provedor, b.variavel, b.configurada]),
    [
      ["fal", "FAL_KEY", true],
      ["kie", "KIE_API_KEY", true],
      ["wavespeed", "WAVESPEED_API_KEY", true],
      ["replicate", "REPLICATE_API_TOKEN", true],
      ["openrouter", "OPENROUTER_API_KEY", true],
    ],
  );
  assert.equal(chamadas.length, 0);
});

test("campo vazio do plugin ou da extensão não conta como chave: o molde ${user_config...} é ignorado", async () => {
  zerar();
  const antes = process.env.KIE_API_KEY;
  try {
    // O jeito que um campo em branco pode chegar, sem chave nenhuma no terminal.
    process.env.SAPIENS_KIE_API_KEY = "${user_config.kie_api_key}";
    process.env.KIE_API_KEY = "";
    const r = await pontes({ action: "balcoes" });
    const kie = r.balcoes.find((b) => b.provedor === "kie");
    assert.equal(kie.configurada, false, "o molde não é chave");
    await assert.rejects(
      () =>
        pontes({
          action: "gerar",
          provedor: "kie",
          modelo: "kling/v2-1-standard",
          input: { prompt: "adult man walking" },
          ingerir: false,
        }),
      /KIE_API_KEY|chave da Kie/,
    );
    assert.equal(chamadas.length, 0, "com o molde no lugar da chave, nada vai pro provedor");
  } finally {
    process.env.KIE_API_KEY = antes;
    delete process.env.SAPIENS_KIE_API_KEY;
  }
});

test("chave dentro do pedido morre antes de sair da máquina", async () => {
  zerar();
  await assert.rejects(
    () =>
      pontes({
        action: "gerar",
        provedor: "fal",
        modelo: "fal-ai/flux/dev",
        input: { prompt: "retrato", api_key: "qualquer-coisa-123" },
        ingerir: false,
      }),
    /campo de chave \("api_key"\)/,
  );
  await assert.rejects(
    () =>
      pontes({
        action: "gerar",
        provedor: "fal",
        modelo: "fal-ai/flux/dev",
        input: { prompt: `retrato usando ${KIE}` },
        ingerir: false,
      }),
    (e) => {
      semSegredo(e.message, "erro de chave no prompt");
      assert.match(e.message, /chave de API dentro/);
      return true;
    },
  );
  assert.equal(chamadas.length, 0, "nada foi pro provedor");
});

test("piso de idade: prompt que cita menor não sai; negative_prompt não é cena", async () => {
  zerar();
  await assert.rejects(
    () =>
      pontes({
        action: "gerar",
        provedor: "fal",
        modelo: "fal-ai/flux/dev",
        input: { prompt: "a teen girl on a beach" },
        ingerir: false,
      }),
    /menor de idade/,
  );
  await assert.rejects(
    () =>
      pontes({
        action: "gerar",
        provedor: "kie",
        modelo: "kling/v2-1-standard",
        input: { prompt: "adult woman, 24.\n\nNEGATIVE: child, blurry" },
        ingerir: false,
      }),
    /negative_prompt/,
    "o NEGATIVE no corpo do prompt também cai, e o erro ensina onde ele vai",
  );
  assert.equal(chamadas.length, 0);
});

let jobDaFal;

test("fal: fila, status e resultado, com a chave só no header e só pra queue.fal.run", async () => {
  zerar(
    (u, init) => {
      assert.equal(u, "https://queue.fal.run/fal-ai/flux/dev");
      assert.equal(init.headers.Authorization, `Key ${FAL}`);
      assert.deepEqual(JSON.parse(init.body), {
        prompt: "adult woman, 24, portrait",
        negative_prompt: "child, teen",
      });
      return json(200, {
        request_id: "req-1",
        status_url: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
        response_url: "https://queue.fal.run/fal-ai/flux/requests/req-1",
      });
    },
    (u) => {
      assert.equal(u, "https://queue.fal.run/fal-ai/flux/requests/req-1/status");
      return json(200, { status: "COMPLETED" });
    },
    (u) => {
      assert.equal(u, "https://queue.fal.run/fal-ai/flux/requests/req-1");
      return json(200, {
        images: [{ url: "https://v3.fal.media/files/abc/out.png", content_type: "image/png" }],
        seed: 42,
      });
    },
  );
  const r = await pontes({
    action: "gerar",
    provedor: "fal",
    modelo: "fal-ai/flux/dev",
    input: { prompt: "adult woman, 24, portrait", negative_prompt: "child, teen" },
    ingerir: false,
    aguardarSegundos: 5,
  });
  assert.equal(r.estado, "pronto");
  assert.deepEqual(r.resultUrls, ["https://v3.fal.media/files/abc/out.png"]);
  assert.equal(r.motor, "fal-flux-dev");
  semSegredo(JSON.stringify(r), "resultado");
  semSegredo(fs.readFileSync(path.join(HOME, "pontes-jobs.json"), "utf8"), "arquivo de jobs");
  jobDaFal = r.jobId;
});

test("pedido idêntico em 30 min devolve o job que existe, sem cobrar de novo", async () => {
  zerar();
  const r = await pontes({
    action: "gerar",
    provedor: "fal",
    modelo: "fal-ai/flux/dev",
    // Mesma coisa em outra ordem de chave: a assinatura é do conteúdo.
    input: { negative_prompt: "child, teen", prompt: "adult woman, 24, portrait" },
    ingerir: false,
  });
  assert.equal(r.jobId, jobDaFal);
  assert.equal(r.repetido, true);
  assert.equal(chamadas.length, 0, "nenhum pedido novo pro provedor");
});

test("fal: URL de consulta de outro host é ignorada (a chave só volta pra queue.fal.run)", async () => {
  zerar(
    () =>
      json(200, {
        request_id: "req-x",
        status_url: "https://evil.example/status",
        response_url: "https://evil.example/response",
      }),
    (u, init) => {
      assert.equal(new URL(u).hostname, "queue.fal.run");
      assert.equal(u, "https://queue.fal.run/fal-ai/kling-video/requests/req-x/status");
      assert.equal(init.headers.Authorization, `Key ${FAL}`);
      return json(200, { status: "IN_QUEUE" });
    },
  );
  const r = await pontes({
    action: "gerar",
    provedor: "fal",
    modelo: "fal-ai/kling-video/v2/master/image-to-video",
    input: { prompt: "adult dancer spinning" },
    ingerir: false,
    aguardarSegundos: 0,
  });
  assert.equal(r.estado, "fila");
  assert.match(r.proximoPasso, /action=status/);
  assert.match(r.proximoPasso, /NÃO chame gerar de novo/);
});

test("status termina o job que voltou rodando, sem novo envio", async () => {
  zerar(
    () =>
      json(200, {
        request_id: "req-v",
        status_url: "https://queue.fal.run/fal-ai/wan/requests/req-v/status",
        response_url: "https://queue.fal.run/fal-ai/wan/requests/req-v",
      }),
    () => json(200, { status: "IN_PROGRESS" }),
  );
  const g = await pontes({
    action: "gerar",
    provedor: "fal",
    modelo: "fal-ai/wan/v2.2/text-to-video",
    input: { prompt: "adult runner at dawn" },
    ingerir: false,
    aguardarSegundos: 0,
  });
  assert.equal(g.estado, "rodando");

  zerar(
    () => json(200, { status: "COMPLETED" }),
    () => json(200, { video: { url: "https://v3.fal.media/files/v/out.mp4", content_type: "video/mp4" } }),
  );
  const s = await pontes({ action: "status", jobId: g.jobId, aguardarSegundos: 0 });
  assert.equal(s.estado, "pronto");
  assert.deepEqual(s.resultUrls, ["https://v3.fal.media/files/v/out.mp4"]);
  assert.ok(
    chamadas.every((c) => !c.init.method || c.init.method === "GET"),
    "status só consulta, não envia",
  );
});

test("erro do provedor que ecoa a chave chega limpo", async () => {
  zerar(() => json(401, { detail: `Invalid key ${FAL}` }));
  await assert.rejects(
    () =>
      pontes({
        action: "gerar",
        provedor: "fal",
        modelo: "fal-ai/flux/schnell",
        input: { prompt: "adult chef" },
        ingerir: false,
      }),
    (e) => {
      semSegredo(e.message, "erro do provedor");
      assert.match(e.message, /\[chave\]/);
      assert.match(e.message, /Nada entrou na fila/);
      return true;
    },
  );
});

test("WaveSpeed: POST no slug e consulta em predictions/<id>/result, com a chave só pra api.wavespeed.ai", async () => {
  zerar(
    (u, init) => {
      assert.equal(u, "https://api.wavespeed.ai/api/v3/wavespeed-ai/flux-2-klein-9b/text-to-image");
      assert.equal(init.headers.Authorization, `Bearer ${WS}`);
      assert.deepEqual(JSON.parse(init.body), { prompt: "adult woman, 30, portrait" });
      // URL de consulta de outro host: ignorada, a consulta vai pro endereço da casa dela.
      return json(200, {
        code: 200,
        data: { id: "ws-1", status: "created", outputs: [], urls: { get: "https://evil.example/ws-1" } },
      });
    },
    (u, init) => {
      assert.equal(u, "https://api.wavespeed.ai/api/v3/predictions/ws-1/result");
      assert.equal(init.headers.Authorization, `Bearer ${WS}`);
      return json(200, {
        code: 200,
        data: { id: "ws-1", status: "completed", outputs: ["https://d1q70pf5vjeyhc.cloudfront.net/predictions/ws-1/1.png"] },
      });
    },
  );
  const r = await pontes({
    action: "gerar",
    provedor: "wavespeed",
    modelo: "wavespeed-ai/flux-2-klein-9b/text-to-image",
    input: { prompt: "adult woman, 30, portrait" },
    ingerir: false,
    aguardarSegundos: 5,
  });
  assert.equal(r.estado, "pronto");
  assert.deepEqual(r.resultUrls, ["https://d1q70pf5vjeyhc.cloudfront.net/predictions/ws-1/1.png"]);
  assert.equal(r.motor, "wavespeed-flux-2-klein-9b-text-to-image");
  assert.equal(r.custo, "pago na WaveSpeed com a sua chave");
  assert.match(r.chave, /direto pra WaveSpeed/);
  semSegredo(JSON.stringify(r), "resultado da WaveSpeed");
});

test("WaveSpeed: falha marcada volta com o motivo e manda conferir o painel", async () => {
  zerar(
    () => json(200, { code: 200, data: { id: "ws-2", status: "created" } }),
    () => json(200, { code: 200, data: { id: "ws-2", status: "failed", error: "content flagged by the provider" } }),
  );
  const r = await pontes({
    action: "gerar",
    provedor: "wavespeed",
    modelo: "kwaivgi/kling-v3.0-pro/image-to-video",
    input: { prompt: "adult dancer in the rain", image: "https://cdn.example/ref.png" },
    ingerir: false,
    aguardarSegundos: 0,
  });
  assert.equal(r.estado, "falhou");
  assert.match(r.erro, /content flagged/);
  assert.match(r.proximoPasso, /^A WaveSpeed marcou falha\. Confira o painel da WaveSpeed/);
});

test("Replicate: modelo oficial vai pela rota do modelo, com a chave só pra api.replicate.com", async () => {
  zerar(
    (u, init) => {
      assert.equal(u, "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions");
      assert.equal(init.headers.Authorization, `Bearer ${REP}`);
      assert.deepEqual(JSON.parse(init.body), { input: { prompt: "adult sailor, 40, harbor" } });
      return json(201, { id: "rp-1", status: "starting", urls: { get: "https://api.replicate.com/v1/predictions/rp-1" } });
    },
    (u, init) => {
      assert.equal(u, "https://api.replicate.com/v1/predictions/rp-1");
      assert.equal(init.headers.Authorization, `Bearer ${REP}`);
      return json(200, { id: "rp-1", status: "succeeded", output: ["https://replicate.delivery/xezq/abc/out-0.webp"] });
    },
  );
  const r = await pontes({
    action: "gerar",
    provedor: "replicate",
    modelo: "black-forest-labs/flux-schnell",
    input: { prompt: "adult sailor, 40, harbor" },
    ingerir: false,
    aguardarSegundos: 5,
  });
  assert.equal(r.estado, "pronto");
  assert.deepEqual(r.resultUrls, ["https://replicate.delivery/xezq/abc/out-0.webp"]);
  assert.equal(r.motor, "replicate-black-forest-labs-flux-schnell");
  assert.equal(r.custo, "pago no Replicate com a sua chave");
  assert.match(r.chave, /direto pro Replicate/);
  semSegredo(JSON.stringify(r), "resultado do Replicate");
});

test("Replicate: modelo de comunidade vai pela versão, e a saída em texto solto também vale", async () => {
  const versao = "e5b0454205013708df48492a13a8ee4b3c41217336e3e2e01e5a4c00cc58a2b1";
  zerar(
    (u, init) => {
      assert.equal(u, "https://api.replicate.com/v1/predictions");
      assert.deepEqual(JSON.parse(init.body), { version: versao, input: { image: "https://cdn.example/a.png" } });
      return json(201, { id: "rp-2", status: "starting", urls: { get: "https://evil.example/rp-2" } });
    },
    (u) => {
      assert.equal(u, "https://api.replicate.com/v1/predictions/rp-2");
      return json(200, { id: "rp-2", status: "succeeded", output: "https://replicate.delivery/xezq/def/depth.png" });
    },
  );
  const r = await pontes({
    action: "gerar",
    provedor: "replicate",
    modelo: `cjwbw/depth-anything:${versao}`,
    input: { image: "https://cdn.example/a.png" },
    prompt: "depth map",
    ingerir: false,
    aguardarSegundos: 5,
  });
  assert.equal(r.estado, "pronto");
  assert.deepEqual(r.resultUrls, ["https://replicate.delivery/xezq/def/depth.png"]);
  assert.equal(r.motor, "replicate-cjwbw-depth-anything", "a versão identifica, mas não entra no nome do motor");
});

test("Replicate: modelo fora da forma dono/nome[:versão] é recusado sem tocar a rede", async () => {
  zerar();
  for (const modelo of ["flux-schnell", "black-forest-labs/flux-schnell:latest", "a/b/c"]) {
    await assert.rejects(
      () => pontes({ action: "gerar", provedor: "replicate", modelo, input: { prompt: "adult" }, ingerir: false }),
      /modelo inválido/,
    );
  }
  assert.equal(chamadas.length, 0);
});

test("campo do plugin ganha da variável do terminal; em branco, a do terminal vale", async () => {
  try {
    process.env.SAPIENS_WAVESPEED_API_KEY = WS_DO_CAMPO;
    zerar(
      (u, init) => {
        assert.equal(init.headers.Authorization, `Bearer ${WS_DO_CAMPO}`);
        return json(200, { code: 200, data: { id: "ws-3", status: "created" } });
      },
      () => json(200, { code: 200, data: { id: "ws-3", status: "processing" } }),
    );
    const r = await pontes({
      action: "gerar",
      provedor: "wavespeed",
      modelo: "wavespeed-ai/flux-2-klein-9b/text-to-image",
      input: { prompt: "adult potter at the wheel" },
      ingerir: false,
      aguardarSegundos: 0,
    });
    assert.equal(r.estado, "rodando");
    semSegredo(JSON.stringify(r), "resultado com a chave do campo");
    assert.equal(
      semChave(`campo ${WS_DO_CAMPO} terminal ${WS}`),
      "campo [chave] terminal [chave]",
      "as duas fontes saem do texto, até a que perdeu a precedência",
    );

    process.env.SAPIENS_WAVESPEED_API_KEY = "";
    zerar(
      (u, init) => {
        assert.equal(init.headers.Authorization, `Bearer ${WS}`);
        return json(200, { code: 200, data: { id: "ws-4", status: "created" } });
      },
      () => json(200, { code: 200, data: { id: "ws-4", status: "processing" } }),
    );
    await pontes({
      action: "gerar",
      provedor: "wavespeed",
      modelo: "wavespeed-ai/flux-2-klein-9b/text-to-image",
      input: { prompt: "adult potter at the kiln" },
      ingerir: false,
      aguardarSegundos: 0,
    });
  } finally {
    delete process.env.SAPIENS_WAVESPEED_API_KEY;
  }
});

test("Kie: o veredito é o code do corpo, e resultJson é texto com JSON dentro", async () => {
  zerar(() => json(200, { code: 422, msg: "model not found" }));
  await assert.rejects(
    () =>
      pontes({
        action: "gerar",
        provedor: "kie",
        modelo: "nao/existe",
        input: { prompt: "adult man" },
        ingerir: false,
      }),
    /A Kie recusou o pedido \(código 422\)/,
  );

  zerar(
    (u, init) => {
      assert.equal(u, "https://api.kie.ai/api/v1/jobs/createTask");
      assert.equal(init.headers.Authorization, `Bearer ${KIE}`);
      assert.deepEqual(JSON.parse(init.body), {
        model: "kling/v2-1-standard",
        input: { prompt: "adult man walking" },
      });
      return json(200, { code: 200, data: { taskId: "task-9" } });
    },
    (u) => {
      assert.equal(u, "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task-9");
      return json(200, {
        code: 200,
        data: {
          state: "success",
          resultJson: JSON.stringify({ resultUrls: ["https://tempfile.aiquickdraw.com/k/out.mp4"] }),
          creditsConsumed: 70,
        },
      });
    },
  );
  const k = await pontes({
    action: "gerar",
    provedor: "kie",
    modelo: "kling/v2-1-standard",
    input: { prompt: "adult man walking" },
    ingerir: false,
    aguardarSegundos: 5,
  });
  assert.equal(k.estado, "pronto");
  assert.equal(k.motor, "kie-kling-v2-1-standard");
  assert.deepEqual(k.resultUrls, ["https://tempfile.aiquickdraw.com/k/out.mp4"]);
  assert.match(k.custo, /70 créditos Kie/);
});

test("jobs: lista o que está nesta máquina, sem rede", async () => {
  zerar();
  const r = await pontes({ action: "jobs", limit: 10 });
  assert.ok(r.count >= 4);
  assert.ok(r.jobs.some((j) => j.jobId === jobDaFal));
  semSegredo(JSON.stringify(r), "jobs");
  assert.equal(chamadas.length, 0);
});

test("modelo com caminho estranho é recusado antes da rede", async () => {
  zerar();
  await assert.rejects(
    () =>
      pontes({
        action: "gerar",
        provedor: "fal",
        modelo: "../admin",
        input: { prompt: "adult" },
        ingerir: false,
      }),
    /modelo inválido/,
  );
  assert.equal(chamadas.length, 0);
});

test("sapiens_helen recusa chave sem chamar o servidor e sem cobrar", async () => {
  zerar();
  await assert.rejects(
    () =>
      helen({
        action: "speak",
        text: "oi",
        provider: "google",
        clientApiKey: "minha-chave-do-google-123",
      }),
    (e) => {
      assert.match(e.message, /nada foi cobrado/);
      assert.ok(!e.message.includes("minha-chave-do-google-123"));
      return true;
    },
  );
  assert.equal(chamadas.length, 0);
});

test("OpenRouter imagem: a peça vem em base64 na resposta e fica num arquivo desta máquina", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  zerar((u, init) => {
    assert.equal(u, "https://openrouter.ai/api/v1/images");
    assert.equal(init.headers.Authorization, `Bearer ${OR}`);
    const corpo = JSON.parse(init.body);
    assert.equal(corpo.model, "bytedance-seed/seedream-4.5", "o modelo vai no corpo e ganha do input");
    assert.equal(corpo.prompt, "adult woman, 30, studio portrait");
    return json(200, { data: [{ b64_json: png, media_type: "image/png" }], usage: { cost: 0.04 } });
  });
  const r = await pontes({
    action: "gerar",
    provedor: "openrouter",
    modelo: "bytedance-seed/seedream-4.5",
    input: { prompt: "adult woman, 30, studio portrait", model: "outro/modelo" },
    ingerir: false,
  });
  assert.equal(r.estado, "pronto");
  assert.equal(r.resultUrls.length, 1);
  const arq = r.resultUrls[0];
  assert.ok(arq.startsWith(HOME), "o arquivo mora na pasta local do MCP");
  assert.equal(fs.readFileSync(arq).toString("base64"), png);
  assert.equal(r.custo, "US$ 0.04 na OpenRouter");
  assert.equal(r.motor, "openrouter-bytedance-seed-seedream-4.5");
  assert.equal(chamadas.length, 1);
  semSegredo(JSON.stringify(r), "resultado da OpenRouter");
});

test("OpenRouter vídeo: fila, e o download leva a chave só pro host da OpenRouter", async () => {
  zerar(
    (u, init) => {
      assert.equal(u, "https://openrouter.ai/api/v1/videos");
      assert.equal(JSON.parse(init.body).model, "google/veo-3.1");
      return json(202, { id: "vid-1", polling_url: "https://openrouter.ai/api/v1/videos/vid-1", status: "pending" });
    },
    (u, init) => {
      assert.equal(u, "https://openrouter.ai/api/v1/videos/vid-1");
      assert.equal(init.headers.Authorization, `Bearer ${OR}`);
      return json(200, {
        id: "vid-1",
        status: "completed",
        unsigned_urls: ["https://outro-host.example/roubo.mp4", "https://openrouter.ai/api/v1/videos/vid-1/content?index=0"],
        usage: { cost: 0.25 },
      });
    },
    (u, init) => {
      assert.equal(u, "https://openrouter.ai/api/v1/videos/vid-1/content?index=0", "URL de outro host nunca recebe a chave");
      assert.equal(init.headers.Authorization, `Bearer ${OR}`);
      return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    },
  );
  const r = await pontes({
    action: "gerar",
    provedor: "openrouter",
    modelo: "google/veo-3.1",
    midia: "video",
    input: { prompt: "adult man walking at dusk", duration: 5 },
    ingerir: false,
    aguardarSegundos: 10,
  });
  assert.equal(r.estado, "pronto");
  assert.equal(r.resultUrls.length, 1);
  assert.ok(r.resultUrls[0].endsWith(".mp4"));
  assert.equal(r.custo, "US$ 0.25 na OpenRouter");
  semSegredo(JSON.stringify(r), "resultado do vídeo da OpenRouter");
});
