// Unit tests dos helpers PUROS (sem backend, sem stdio): describeConvexError
// (a tradução de erro que todo handler usa) e httpUrl (o guard de URL de
// referência). Importam do dist (o pretest builda), igual ao server.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { z, ZodError } from "zod";

import { describeConvexError, runWithSessionToken } from "../dist/convexClient.js";
import { httpUrl } from "../dist/schema.js";
import { detectImageMime, localFrameReferences } from "../dist/tools/video.js";
import { repertorioSchema } from "../dist/tools/repertorio.js";
import { profileSchema } from "../dist/tools/profile.js";
import { characterSchema } from "../dist/tools/character.js";
import { communitySchema } from "../dist/tools/community.js";

// ---------- describeConvexError ----------

test("describeConvexError: ZodError vira uma linha acionável", () => {
  let zerr;
  try {
    z.object({ action: z.enum(["a", "b"]), n: z.number() }).parse({
      action: "x",
    });
  } catch (e) {
    zerr = e;
  }
  assert.ok(zerr instanceof ZodError);
  const msg = describeConvexError(zerr);
  assert.match(msg, /^Argumentos inválidos: /);
  assert.match(msg, /action: /);
  assert.match(msg, /n: /);
  // Uma linha só, sem dump JSON das issues.
  assert.ok(!msg.includes("\n"), "mensagem em linha única");
});

test("describeConvexError: ConvexError com data string usa a data", () => {
  const e = new Error("[Request ID: abc123] Server Error");
  e.data = "sessionToken inválido ou expirado";
  assert.equal(describeConvexError(e), "sessionToken inválido ou expirado");
});

test("describeConvexError: data objeto com message usa a message", () => {
  const e = new Error("[Request ID: abc] Server Error");
  e.data = { message: "Saldo insuficiente: precisa de 400 Sinapses", code: "LOW_BALANCE" };
  assert.equal(
    describeConvexError(e),
    "Saldo insuficiente: precisa de 400 Sinapses",
  );
});

test("describeConvexError: data objeto sem message vira JSON legível", () => {
  const e = new Error("[Request ID: abc] Server Error");
  e.data = { code: "RATE_LIMIT", retryAfterMs: 20000 };
  assert.equal(
    describeConvexError(e),
    JSON.stringify({ code: "RATE_LIMIT", retryAfterMs: 20000 }),
  );
});

test("describeConvexError: Error comum cai no .message", () => {
  assert.equal(describeConvexError(new Error("boom")), "boom");
});

test("describeConvexError: data string vazia não engole o .message", () => {
  const e = new Error("mensagem real");
  e.data = "   ";
  assert.equal(describeConvexError(e), "mensagem real");
});

// ---------- httpUrl ----------

const url = httpUrl();
const ok = (u) => assert.ok(url.safeParse(u).success, `deveria aceitar ${u}`);
const bad = (u) => assert.ok(!url.safeParse(u).success, `deveria recusar ${u}`);

test("httpUrl: aceita http(s) público", () => {
  ok("https://sapiens-assets.b-cdn.net/img/foto.webp");
  ok("http://example.com/a.png");
  // 172.32.x está FORA da faixa privada 172.16-31: público, passa.
  ok("http://172.32.0.1/x.png");
});

test("httpUrl: recusa localhost e loopback", () => {
  bad("http://localhost:3000/x.png");
  bad("http://foo.localhost/x.png");
  bad("http://127.0.0.1/x.png");
  bad("http://[::1]/x.png");
  bad("http://0.0.0.0/x.png");
});

test("httpUrl: recusa faixas privadas e link-local", () => {
  bad("http://10.1.2.3/x.png");
  bad("http://192.168.1.10/x.png");
  bad("http://172.16.0.1/x.png");
  bad("http://172.31.255.255/x.png");
  bad("http://169.254.169.254/latest/meta-data"); // metadata endpoint clássico
  bad("http://[fc00::1]/x.png"); // IPv6 ULA
});

test("httpUrl: recusa protocolo não-http e lixo", () => {
  bad("ftp://example.com/a.png");
  bad("file:///etc/passwd");
  bad("javascript:alert(1)");
  bad("não é url");
  bad("");
});

// ---------- frame local (sapiens_video startImagePath/endImagePath) ----------
// Cobre os guards que barram ANTES de qualquer rede/disco: detecção de mime por
// magic bytes, recusa no transporte remoto (leitura de arquivo do host) e o
// conflito path vs id/url. São os pontos que a paridade com o site não pode furar.

test("detectImageMime: reconhece PNG/JPEG/WebP por magic bytes", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const webp = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP", "ascii"),
  ]);
  assert.equal(detectImageMime(png), "image/png");
  assert.equal(detectImageMime(jpeg), "image/jpeg");
  assert.equal(detectImageMime(webp), "image/webp");
});

test("detectImageMime: recusa o que não é PNG/JPEG/WebP", () => {
  assert.equal(detectImageMime(Buffer.from([0x00, 0x01, 0x02, 0x03])), null);
  assert.equal(detectImageMime(Buffer.from("GIF89a", "ascii")), null);
  assert.equal(detectImageMime(Buffer.from("%PDF-1.7", "ascii")), null);
  assert.equal(detectImageMime(Buffer.alloc(0)), null);
});

test("localFrameReferences: sem path devolve vazio (não toca disco)", async () => {
  assert.deepEqual(await localFrameReferences({ action: "create" }), []);
});

test("localFrameReferences: recusa arquivo local no transporte REMOTO", async () => {
  await runWithSessionToken("token-remoto-de-teste", async () => {
    await assert.rejects(
      () => localFrameReferences({ action: "create", startImagePath: "/qualquer/1.png" }),
      /só funciona no MCP instalado/i,
    );
  });
});

test("localFrameReferences: path + id juntos é conflito (barra antes do disco)", async () => {
  await assert.rejects(
    () =>
      localFrameReferences({
        action: "create",
        startImagePath: "/x/1.png",
        startImageId: "abc123",
      }),
    /escolha UMA via/i,
  );
  await assert.rejects(
    () =>
      localFrameReferences({
        action: "create",
        endImagePath: "/x/2.png",
        endImageUrl: "https://cdn.sapiensinteticos.com/x.png",
      }),
    /escolha UMA via/i,
  );
});

test("localFrameReferences: arquivo inexistente dá erro claro no stdio", async () => {
  await assert.rejects(
    () =>
      localFrameReferences({
        action: "create",
        startImagePath: "/caminho/que/nao/existe/zzz-9f3a.png",
      }),
    /Não achei\/li o arquivo/i,
  );
});

// ---------- paridade "operar a conta" (schemas) ----------
// action=lists foi removida (query repertorio:listLists não existe mais): o
// schema tem que RECUSAR, não deixar chamar a função morta.

test("repertorioSchema: recusa a action 'lists' removida", () => {
  assert.throws(() => repertorioSchema.parse({ action: "lists", userId: "x" }), ZodError);
  // as demais reads continuam válidas
  assert.doesNotThrow(() => repertorioSchema.parse({ action: "list", userId: "x" }));
});

test("profileSchema: aceita as escritas novas (follow/bio/@)", () => {
  assert.doesNotThrow(() => profileSchema.parse({ action: "follow", followingId: "u1" }));
  assert.doesNotThrow(() => profileSchema.parse({ action: "unfollow", followingId: "u1" }));
  assert.doesNotThrow(() => profileSchema.parse({ action: "update_bio", bio: "oi" }));
  assert.doesNotThrow(() => profileSchema.parse({ action: "update_username", newUsername: "luca_x" }));
  // action fora do enum é recusada
  assert.throws(() => profileSchema.parse({ action: "nuke_account" }), ZodError);
});

test("characterSchema: aceita a gestão de imagem nova", () => {
  assert.doesNotThrow(() => characterSchema.parse({ action: "remove_image", characterId: "c1", imageUrl: "https://cdn.x/a.png" }));
  assert.doesNotThrow(() => characterSchema.parse({ action: "set_main_image", characterId: "c1", imageUrl: "https://cdn.x/a.png" }));
  assert.doesNotThrow(() => characterSchema.parse({ action: "reorder_images", characterId: "c1", orderedUrls: ["https://cdn.x/a.png", "https://cdn.x/b.png"] }));
  assert.doesNotThrow(() => characterSchema.parse({ action: "delete", characterId: "c1" }));
});

// ---------- Leva B: aitag favoritos (profile) + chat anexo/Tese (community) ----------

test("profileSchema: aceita os favoritos de ferramentas (aitag)", () => {
  assert.doesNotThrow(() => profileSchema.parse({ action: "favorite_tool", toolId: "t1" }));
  assert.doesNotThrow(() => profileSchema.parse({ action: "favorite_lists" }));
  assert.doesNotThrow(() => profileSchema.parse({ action: "create_favorite_list", listName: "Design" }));
  assert.doesNotThrow(() => profileSchema.parse({ action: "add_to_favorite_list", toolId: "t1", listId: "l1" }));
  assert.doesNotThrow(() => profileSchema.parse({ action: "remove_from_favorite_list", toolId: "t1", listId: "l1" }));
  assert.doesNotThrow(() => profileSchema.parse({ action: "delete_favorite_list", listId: "l1" }));
});

test("communitySchema: aceita anexo do acervo + asTese, valida kind", () => {
  assert.doesNotThrow(() =>
    communitySchema.parse({ action: "send", content: "ouçam essa", mediaAssetKind: "track", mediaAssetId: "trk1" }),
  );
  assert.doesNotThrow(() => communitySchema.parse({ action: "send", content: "minha tese", asTese: true }));
  // kind fora do union é recusado
  assert.throws(
    () => communitySchema.parse({ action: "send", content: "x", mediaAssetKind: "pdf", mediaAssetId: "y" }),
    ZodError,
  );
});
