// Unit tests dos helpers PUROS (sem backend, sem stdio): describeConvexError
// (a tradução de erro que todo handler usa) e httpUrl (o guard de URL de
// referência). Importam do dist (o pretest builda), igual ao server.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { z, ZodError } from "zod";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeConvexError, runWithSessionToken } from "../dist/convexClient.js";
import { httpUrl } from "../dist/schema.js";
import { assertPublicHttpsUrl, fetchPublicHttps, isPrivateAddress } from "../dist/publicFetch.js";
import { detectImageMime, localFrameReferences } from "../dist/tools/video.js";
import { repertorioSchema } from "../dist/tools/repertorio.js";
import { profileSchema } from "../dist/tools/profile.js";
import { characterSchema } from "../dist/tools/character.js";
import { communitySchema } from "../dist/tools/community.js";
import { gallerySchema, lerPecaLocal, mimeDosBytes } from "../dist/tools/gallery.js";
import { distributionSchema } from "../dist/tools/distribution.js";

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

// ---------- publicFetch (sourceUrl que o servidor baixa) ----------
// O lookup do socket julga cada endereço resolvido com isPrivateAddress; o IP
// literal não passa por DNS, então o assertPublicHttpsUrl julga pelo texto.

test("isPrivateAddress: IPv4 fora da internet pública", () => {
  for (const ip of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "198.18.0.1", "224.0.0.1", "255.255.255.255",
  ]) assert.ok(isPrivateAddress(ip), `deveria recusar ${ip}`);
});

test("isPrivateAddress: IPv6 privado, loopback e IPv4 embutido", () => {
  for (const ip of [
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe", "[::1]",
  ]) assert.ok(isPrivateAddress(ip), `deveria recusar ${ip}`);
});

test("isPrivateAddress: público passa, lixo não", () => {
  for (const ip of [
    "8.8.8.8", "1.1.1.1", "100.63.255.255", "100.128.0.1", "172.32.0.1",
    "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808",
  ]) assert.ok(!isPrivateAddress(ip), `deveria aceitar ${ip}`);
  assert.ok(isPrivateAddress("não-é-ip"));
});

test("assertPublicHttpsUrl: recusa nome reservado, IP literal privado e http", () => {
  for (const u of [
    "https://localhost/x", "https://foo.localhost/x", "https://localhost./x",
    "https://printer.local/x", "https://metadata.google.internal/x",
    "https://127.0.0.1/x", "https://2130706433/x", "https://0x7f.1/x",
    "https://[::ffff:127.0.0.1]/x", "https://[fe80::1]/x",
    "https://100.64.0.1/x", "https://169.254.169.254/latest/meta-data",
    "http://example.com/x", "não é url",
  ]) assert.throws(() => assertPublicHttpsUrl(u), undefined, `deveria recusar ${u}`);
  assert.equal(assertPublicHttpsUrl("https://cdn.example.com/a.woff2").host, "cdn.example.com");
});

test("fetchPublicHttps: barra host privado antes de abrir conexão", async () => {
  await assert.rejects(
    fetchPublicHttps("https://127.0.0.1/x", { timeoutMs: 1000, maxBytes: 1024 }),
    /Host não permitido/,
  );
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

test("gallerySchema: aceita o upload de peça de fora pelas três entradas", () => {
  assert.doesNotThrow(() =>
    gallerySchema.parse({
      action: "upload",
      sourceUrl: "https://cdn.magnific.ai/render.png",
      uploadedSource: "magnific",
      note: "seedance frame 12",
    }),
  );
  assert.doesNotThrow(() => gallerySchema.parse({ action: "upload", filePath: "C:/tmp/a.png" }));
  assert.doesNotThrow(() => gallerySchema.parse({ action: "upload", base64: "iVBORw0KGgo=", mimeType: "image/png" }));
  // as actions antigas seguem inteiras
  assert.doesNotThrow(() => gallerySchema.parse({ action: "publish", imageId: "img1" }));
  assert.throws(() => gallerySchema.parse({ action: "import" }), ZodError);
});

// Caixa ftyp mínima de ISO BMFF: tamanho, "ftyp", marca principal, versão e as compatíveis.
function ftyp(principal, ...compat) {
  const corpo = Buffer.concat([Buffer.from("ftyp"), Buffer.from(principal), Buffer.alloc(4), ...compat.map((c) => Buffer.from(c))]);
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(corpo.length + 4);
  return Buffer.concat([tam, corpo]);
}

test("mimeDosBytes: o tipo sai do conteúdo, nunca do nome", () => {
  assert.equal(mimeDosBytes(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")), "image/png");
  assert.equal(mimeDosBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])), "image/jpeg");
  assert.equal(mimeDosBytes(Buffer.from("GIF89a\x01\x00", "latin1")), "image/gif");
  assert.equal(mimeDosBytes(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "image/webp");
  assert.equal(mimeDosBytes(ftyp("avif", "mif1", "miaf")), "image/avif");
  assert.equal(mimeDosBytes(ftyp("mif1", "avif")), "image/avif");
  assert.equal(mimeDosBytes(ftyp("isom", "iso2", "avc1", "mp41")), "video/mp4");
  assert.equal(mimeDosBytes(ftyp("qt  ", "qt  ")), "video/quicktime");
  // HEIC tem o mesmo ftyp do mp4 e não é peça que a galeria hospeda
  assert.equal(mimeDosBytes(ftyp("heic", "mif1", "heic")), undefined);
  // texto não é peça: o .env.local, uma chave, um JSON
  assert.equal(mimeDosBytes(Buffer.from("CONVEX_DEPLOY_KEY=prod:abc\n")), undefined);
  assert.equal(mimeDosBytes(Buffer.from("-----BEGIN OPENSSH PRIVATE KEY-----\n")), undefined);
  assert.equal(mimeDosBytes(Buffer.from("{\"ok\":true}")), undefined);
  assert.equal(mimeDosBytes(Buffer.alloc(0)), undefined);
});

test("lerPecaLocal: extensão fora da lista nem abre o arquivo, e texto com nome de imagem não sobe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "galeria-peca-"));
  try {
    // arquivos que nem existem: se o helper os abrisse, o erro seria ENOENT
    await assert.rejects(lerPecaLocal(join(dir, ".env.local"), false), /não é peça\. Nada foi lido/);
    await assert.rejects(lerPecaLocal(join(dir, "id_ed25519"), true), /não é peça/);
    // vídeo entra pela ponte (ingest), não pelo upload
    await assert.rejects(lerPecaLocal(join(dir, "take.mp4"), false), /não é peça/);

    const disfarce = join(dir, "segredo.png");
    await writeFile(disfarce, "CONVEX_DEPLOY_KEY=prod:abc\n");
    await assert.rejects(lerPecaLocal(disfarce, false), /"segredo\.png" não é imagem que a galeria aceita/);
    await assert.rejects(lerPecaLocal(disfarce, true), /não é imagem nem vídeo/);

    // nome errado, conteúdo certo: passa com o mime dos bytes
    const jpgComNomeDePng = join(dir, "frame.png");
    await writeFile(jpgComNomeDePng, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    assert.equal((await lerPecaLocal(jpgComNomeDePng, false)).mimeType, "image/jpeg");

    const take = join(dir, "take.mp4");
    await writeFile(take, ftyp("isom", "mp41"));
    assert.equal((await lerPecaLocal(take, true)).mimeType, "video/mp4");
    // vídeo com nome de imagem não passa no upload
    const videoComNomeDePng = join(dir, "take.png");
    await writeFile(videoComNomeDePng, ftyp("isom", "mp41"));
    await assert.rejects(lerPecaLocal(videoComNomeDePng, false), /não é imagem que a galeria aceita/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

// Os três campos que o backend sempre aceitou e a tool não passava. Sem `lang`,
// canal de rede internacional reescreve a copy sozinho dois segundos depois de
// enfileirar (e devolveu português pedindo inglês, em 06/09/2026, na copy da
// Aria). Sem `assetPageAssetId`, a peça só acha a obra quando a assetUrl bate
// letra a letra, então a versão web de um master nasce órfã de ficha.
test("distributionSchema: queue aceita título público, legendas e localizações do YouTube", () => {
  assert.doesNotThrow(() =>
    distributionSchema.parse({
      action: "queue",
      title: "corte excellence",
      channel: "youtube-2",
      lang: "en",
      publicTitle: "DHH on why excellence needs no justification",
      assetUrl: "https://sapiensinteticos.b-cdn.net/cortes/dhh/excellence-sursum-1a2b3c4d.mp4",
      assetKind: "video",
      captionTracks: [
        { lang: "en", url: "https://sapiensinteticos.b-cdn.net/cortes/dhh/excellence.en-1a2b3c4d.srt" },
        { lang: "pt-BR", url: "https://sapiensinteticos.b-cdn.net/cortes/dhh/excellence.pt-BR-1a2b3c4d.srt", name: "Português" },
      ],
      localizations: [{ lang: "pt-BR", title: "DHH: excelência não precisa de justificativa", description: "Trecho de..." }],
    }),
  );
  // título do YouTube tem teto de 100; mais de 4 faixas é recusa já no cliente
  assert.throws(() =>
    distributionSchema.parse({ action: "queue", title: "t", channel: "youtube", publicTitle: "x".repeat(101) }),
  );
  assert.throws(() =>
    distributionSchema.parse({
      action: "queue",
      title: "t",
      channel: "youtube",
      captionTracks: Array.from({ length: 5 }, (_, i) => ({ lang: `l${i}`, url: "https://a.b-cdn.net/x.srt" })),
    }),
  );
});

test("distributionSchema: queue aceita lang, assetPagePath e assetPageAssetId", () => {
  assert.doesNotThrow(() =>
    distributionSchema.parse({
      action: "queue",
      title: "take-02",
      channel: "bluesky-4",
      copy: "I spend my nights putting other people together.",
      lang: "en",
      assetUrl: "https://sapiensinteticos.b-cdn.net/x/take-02-web.mp4",
      assetKind: "video",
      assetPageAssetId: "jd719afa3my34v9xt20w2ke3ys8dw0y7",
    }),
  );
  assert.doesNotThrow(() =>
    distributionSchema.parse({
      action: "queue",
      title: "take-02",
      channel: "bluesky-4",
      assetPagePath: "/video/jd719afa3my34v9xt20w2ke3ys8dw0y7",
    }),
  );
  // os três seguem opcionais: peça em pt no canal de pt não precisa de nenhum
  assert.doesNotThrow(() =>
    distributionSchema.parse({ action: "queue", title: "t", channel: "instagram" }),
  );
  // língua fora do par que o backend valida é recusada aqui, não lá
  assert.throws(
    () => distributionSchema.parse({ action: "queue", title: "t", channel: "bluesky", lang: "es" }),
    ZodError,
  );
});

// A assinatura do vídeo (23/09/2026): a chave da ficha pela conversa, e o
// queue que já nasce assinado. signed é boolean de verdade, não string.
test("distributionSchema: sign e queue aceitam signed", () => {
  assert.doesNotThrow(() =>
    distributionSchema.parse({ action: "sign", itemId: "k57abc", signed: true }),
  );
  // sem signed, o handler liga (default true)
  assert.doesNotThrow(() => distributionSchema.parse({ action: "sign", itemId: "k57abc" }));
  assert.doesNotThrow(() =>
    distributionSchema.parse({ action: "queue", title: "t", channel: "bluesky-5", signed: true }),
  );
  assert.throws(
    () => distributionSchema.parse({ action: "sign", itemId: "k57abc", signed: "sim" }),
    ZodError,
  );
});

// O story do Instagram pela conversa (24/09/2026): o format da peça no queue.
// Só o story existe como valor; formato livre viraria campo que ninguém lê.
test("distributionSchema: queue aceita format instagram_story e nada além", () => {
  assert.doesNotThrow(() =>
    distributionSchema.parse({ action: "queue", title: "t", channel: "instagram-pro", format: "instagram_story" }),
  );
  assert.throws(
    () => distributionSchema.parse({ action: "queue", title: "t", channel: "instagram", format: "reels" }),
    ZodError,
  );
});

// A assinatura da linhagem (24/09/2026): o carimbo segue quem assina, e a Aria
// assina com a marca própria. Estilo fora dos três e marca acima do canto caem.
test("distributionSchema: lineage-save aceita assinatura", () => {
  assert.doesNotThrow(() =>
    distributionSchema.parse({
      action: "lineage-save",
      slug: "aria",
      assinatura: { estilo: "propria", marca: "Velourie", padrao: true },
    }),
  );
  assert.doesNotThrow(() => distributionSchema.parse({ action: "lineage-save", slug: "aria", assinatura: null }));
  assert.throws(
    () => distributionSchema.parse({ action: "lineage-save", slug: "aria", assinatura: { estilo: "logo" } }),
    ZodError,
  );
  assert.throws(
    () =>
      distributionSchema.parse({
        action: "lineage-save",
        slug: "aria",
        assinatura: { estilo: "propria", marca: "x".repeat(30) },
      }),
    ZodError,
  );
});

test("distributionSchema: tree lê e tree-mark leva as células da linhagem", () => {
  assert.doesNotThrow(() => distributionSchema.parse({ action: "tree" }));
  assert.doesNotThrow(() => distributionSchema.parse({ action: "tree", slug: "ad-infinitum" }));
  assert.doesNotThrow(() =>
    distributionSchema.parse({
      action: "tree-mark",
      slug: "sursum",
      celulas: [
        { rede: "email", handle: "canal@exemplo.com" },
        { rede: "instagram", canal: "instagram-6" },
        { rede: "fanvue", dispensada: true },
      ],
    }),
  );
  // Célula sem rede não é célula.
  assert.throws(
    () => distributionSchema.parse({ action: "tree-mark", slug: "sursum", celulas: [{ handle: "x" }] }),
    ZodError,
  );
});

// ---------- clientIdentity (o motor do outro lado do MCP) ----------

import { getClientName, runWithClientHint, sanitizeClientName } from "../dist/clientIdentity.js";

test("sanitizeClientName: uma linha limpa, teto de 120, nada que não seja string", () => {
  assert.equal(sanitizeClientName("  claude-code \n"), "claude-code");
  assert.equal(sanitizeClientName("a\u0000b\u001fc"), "a b c");
  assert.equal(sanitizeClientName("x".repeat(300)).length, 120);
  assert.equal(sanitizeClientName(""), undefined);
  assert.equal(sanitizeClientName(42), undefined);
  assert.equal(sanitizeClientName(undefined), undefined);
});

test("runWithClientHint: a pista existe só dentro da chamada", () => {
  assert.equal(getClientName(), undefined);
  const dentro = runWithClientHint("cursor", () => getClientName());
  assert.equal(dentro, "cursor");
  assert.equal(getClientName(), undefined);
  assert.equal(runWithClientHint("", () => getClientName()), undefined);
  assert.equal(runWithClientHint("ua:Claude-User/1.0", () => getClientName()), "ua:Claude-User/1.0");
});
