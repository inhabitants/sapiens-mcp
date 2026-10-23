import { z } from "zod";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createHash } from "node:crypto";
import {
  convexAction,
  convexMutation,
  convexQuery,
  describeConvexError,
  getSessionToken,
  isRemoteContext,
} from "../convexClient.js";
import { assertPublicHttpsUrl, fetchPublicHttps } from "../publicFetch.js";

/**
 * Galeria do usuário: browse, publicação e UPLOAD de peça de fora.
 * Wrapper sobre `desktopMcp.galleryList` / `galleryGet` / `gallerySetPublic` e
 * `galleryImport.mcpUploadImage`.
 *
 * Usado pra:
 *   - Listar imagens recentes do user (pra reusar como referenceImage)
 *   - Pegar bytes de uma imagem pra mostrar inline no Claude
 *   - Descobrir imageId pra passar como sourceImageId em sapiens_image edit/variation
 *   - Publicar/despublicar a própria imagem (galeria pública + feed Pinterest)
 *   - Subir peça gerada FORA da casa (action=upload), que entra privada e serve
 *     de referência pras gerações daqui
 *   - Ingerir peça gerada em motor EXTERNO com a receita da pessoa
 *     (action=ingest, qualquer conta desde set/2026: a PONTE), que entra como
 *     peça nativa: timeline, publicação, comunidade
 *
 * O upload resolve URL/arquivo pra base64 AQUI, no cliente, e manda os bytes
 * prontos pro Convex. O servidor não busca URL nenhuma (sem SSRF novo lá).
 *
 * O INGEST tem duas portas no servidor com o mesmo contrato de peça: a do dono
 * (o servidor baixa de allowlist fechada de hosts, convex/externalIngest.ts) e
 * a ponte (os bytes são resolvidos AQUI, na máquina da pessoa, sobem pro
 * storage do Convex e o servidor só move pro Bunny, convex/externalIngestNode.ts).
 * A diferença entre upload e ingest não é de onde vieram os bytes, é de quem
 * foi a DIREÇÃO: peça achada pronta é upload; peça que a pessoa dirigiu (a
 * ficha do personagem dela, o prompt dela) e um motor terceiro só renderizou é
 * ingest. A chave do provedor nunca passa por aqui nem pelo servidor.
 */
export const gallerySchema = z.object({
  action: z.enum([
    "list",
    "get",
    "publish",
    "upload",
    "ingest",
    "refs",
    "processo",
    "cast",
    "parts",
    "link_parts",
    "reprovar",
    "reprovadas",
    "carimbo",
    "apagar",
  ]),
  processo: z
    .array(
      z.object({
        sourceImageId: z
          .string()
          .describe("generatedImages:_id da peça de PROCESSO (a sua, já no acervo)."),
        label: z
          .string()
          .max(80)
          .optional()
          .describe(
            'Uma linha do que aquela peça mostra: "Mapa de rota", "Antes e depois", "Os 8 tempos do take". É o que aparece embaixo da miniatura na página pública.',
          ),
      }),
    )
    .max(12)
    .optional()
    .describe(
      "action=processo: as peças de processo, NA ORDEM em que o processo aconteceu (o still, o mapa, a prancha). Teto de 12.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Default 20. Max 100. Pra action=list (e action=reprovadas, teto 60). Sem offset: com filtro de model ou skill a busca varre só as últimas 200 peças. Pra achar o imageId de peça que não é de hoje, use sapiens_reference action=browse bucket=history term=<palavra> (paginado, devolve o imageId) ou sapiens_reference action=resolve handle=img_xxx."),
  model: z
    .string()
    .optional()
    .describe(
      "Filtro de model (action=list). Ex: 'nano-banana-max' pra ver só Pro.",
    ),
  skill: z
    .string()
    .optional()
    .describe(
      "Filtro por SKILL que dirigiu a peça (action=list): devolve só o que saiu daquela skill, pelo slug exato que a geração gravou (ex: 'camarim', 'escala-gigantismo'). É o que responde 'me mostra tudo que saiu do camarim'. Com filtro, a busca varre as últimas 200 peças antes de cortar no limit, então acha coisa antiga. Peça sem marcação nenhuma volta com skills null e nunca casa com filtro.",
    ),
  kind: z
    .enum(["image", "video", "all"])
    .optional()
    .describe(
      "action=list: que mídia listar. 'image' (default) é o de sempre; 'video' traz só os takes, cada um com `posterUrl` (a capa) e `acervoUrl` (a ficha); 'all' mistura. Use kind=video depois de uma leva de ingest ou de geração de vídeo: é o que permite MOSTRAR a peça (capa + player) em vez de devolver link solto. posterUrl null = capa ainda em produção, volte em alguns segundos.",
    ),
  imageId: z
    .string()
    .optional()
    .describe(
      "generatedImages:_id (obrigatório pra action=get/publish/refs/cast/processo, e em link_parts é o vídeo INTEIRO). Em action=parts é OPCIONAL: com ele vem a ficha de parentesco daquela peça, sem ele vem o que ainda não foi montado na conta inteira.",
    ),
  includeBase64: z
    .boolean()
    .optional()
    .describe(
      "Default false. Quando true, action=get devolve os bytes em base64 (pesado, evite em listagens).",
    ),

  // --- action=upload e action=ingest: de onde vêm os bytes ---
  sourceUrl: z
    .string()
    .optional()
    .describe(
      "action=upload/ingest: URL https direta da peça pronta no motor de fora (o link do render da Kie, da fal, da Magnific). No ingest ela também é o RASTRO e a chave de idempotência: repetir a mesma sourceUrl corrige a ficha em vez de duplicar. Quem baixa é o cliente MCP (na sua máquina, no stdio; no remoto, o servidor do site): URL de render expira (Kie em 24h, Magnific no mesmo dia), então ingira no mesmo turno do render. Alternativa a filePath/base64.",
    ),
  filePath: z
    .string()
    .optional()
    .describe(
      "action=upload/ingest: caminho ABSOLUTO de um arquivo local: no upload só imagem (png, jpg, webp, gif, avif), no ingest também mp4 e mov. O conteúdo é conferido pelos bytes antes de subir, e arquivo que não é peça é recusado sem ser enviado. SÓ no MCP instalado (stdio): é a porta de quem gerou na própria máquina ou baixou o render antes; no remoto use sourceUrl. No ingest, o sha256 do arquivo vira a chave de idempotência.",
    ),
  base64: z
    .string()
    .optional()
    .describe(
      "action=upload/ingest: os bytes já em base64, se você mesmo os tem em mãos (imagem; vídeo vai por filePath ou sourceUrl).",
    ),
  mimeType: z
    .string()
    .optional()
    .describe(
      "action=upload/ingest: tipo do arquivo (image/png, video/mp4...). Detectado sozinho a partir da URL/extensão/resposta HTTP quando omitido. Em filePath e base64 vale o tipo que os bytes mostram, não este.",
    ),
  note: z
    .string()
    .optional()
    .describe(
      "action=upload: o que é a peça (prompt original, contexto). Vira a descrição na galeria e a busca acha por ela.",
    ),
  // --- action=ingest (peça gerada em motor externo COM receita da casa) ---
  externalEngine: z
    .string()
    .optional()
    .describe(
      "action=ingest: qual motor renderizou, sempre no formato provedor-motor ('kie-kling-3.0', 'fal-krea-2', 'magnific-minimax-h3', 'sogni-minimax-h3', 'bancada-ltx-2.5'). É ESTE campo que a ficha da peça mostra em 'Motor', então a marca sozinha ('kie', 'magnific') é recusada pelo servidor: provedor é a loja, não o motor. O provedor decide o carimbo +18 na entrada: peso aberto (sogni-, replicate-, hf-, fal-, wavespeed-, civitai-, bancada-, comfy-, local-) ou provedor que a casa não conhece entra com o carimbo por classe (publica e fica no perfil, só não vai pra vitrine anônima); serviço com moderação (kie-, magnific-, freepik-, faceless-, krea-, midjourney-, runway-, higgsfield-, modelark-) entra sem.",
    ),
  externalCost: z
    .string()
    .optional()
    .describe(
      "action=ingest: quanto custou lá fora, em texto livre ('4200 créditos Freepik'). A peça entra com 0 Sinapses, então é isto que preserva o custo real no histórico.",
    ),
  prompt: z
    .string()
    .optional()
    .describe(
      "action=ingest: o PROMPT DE GERAÇÃO, copiado inteiro do motor externo, exatamente como foi enviado. É o que a ficha mostra e a busca acha, e é o que permite regerar a peça depois. NÃO escreva aqui nota, resumo, título ou comentário sobre a peça: isso deixa a ficha sem sentido pra quem abrir. Re-ingerir a mesma sourceUrl com um prompt novo CORRIGE o que já está gravado, sem duplicar.",
    ),
  aspectRatio: z
    .string()
    .optional()
    .describe("action=ingest: proporção da peça ('16:9', '9:16'). Default 16:9."),
  size: z
    .string()
    .optional()
    .describe("action=ingest: resolução ('720p', '1080p'). Default 720p."),
  // Aceita lista OU string com os ids separados por vírgula. O segundo formato
  // existe porque alguns clientes MCP serializam array como texto ao repassar a
  // chamada, e aí o servidor recusava com "Expected array, received string" sem
  // que houvesse nada de errado com o pedido. Normalizado logo abaixo.
  referenceImageIds: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe(
      "action=ingest/refs: generatedImages:_id das peças DA CASA que serviram de referência (folha de storyboard, ficha de personagem, frame inicial). Ficam acopladas à peça e aparecem na ficha dela: é o que prova que a receita saiu daqui. Se alguma delas foi feita com um personagem, a peça HERDA esse personagem sozinha (no ingest, e no refs quando a peça ainda não tem um). Só peça sua entra, no máximo 8. Aceita lista ou os ids separados por vírgula.",
    ),
  characterId: z
    .string()
    .optional()
    .describe(
      "action=ingest: o personagem de quem é a peça (influencers:_id, ache com sapiens_character action=list_mine). A peça nasce ligada à ficha, igual ao que sai dos motores da casa: conta no personagem e resolve a miniatura dele. PODE OMITIR quando as referenceImageIds já são peças da casa feitas com aquele personagem (folha de storyboard, ficha): o servidor deduz o personagem da primeira ref que tem um. O que você diz aqui manda sobre o que ele deduz. Re-ingerir a mesma sourceUrl com characterId AMARRA uma peça que já entrou sem personagem, sem trocar o id. Aceita personagem seu ou público. Em action=reprovadas, FILTRA as vetadas daquele personagem.",
    ),
  characterIds: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe(
      "QUEM ESTÁ EM CENA, quando é mais de uma criatura (action=ingest e action=cast). Em ordem de cena: o PRIMEIRO é o protagonista (é ele que a ficha e o cartão do vídeo mostram) e o resto vira elenco, então a peça conta na ficha de TODOS eles em vez de sumir da segunda. Teto de 6. Use quando a fita foi dirigida com duas folhas de personagem: sem isto, ela aparece só na ficha de um. Aceita lista ou os ids separados por vírgula, personagem seu ou público. Pra peça de uma criatura só continue usando characterId.",
    ),
  partIds: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe(
      "action=link_parts: os PEDAÇOS que viraram o vídeo inteiro, NA ORDEM em que aparecem nele (take A, depois take B). generatedImages:_id de vídeo seu, teto de 16, aceita lista ou os ids separados por vírgula. A lista TROCA o que estava gravado antes, então mande sempre todas as partes, não só a que faltou.",
    ),
  unfiltered: z
    .boolean()
    .optional()
    .describe(
      "action=ingest: true quando o motor rodou SEM filtro de conteúdo (modo livre, spicy, uncensored) num serviço que normalmente modera. A peça nasce com o carimbo +18 da casa DECLARADO por você (você pode tirar depois na ficha): publica, fica no seu perfil e no link direto, e sai da vitrine anônima e dos feeds. Não precisa dizer pra provedor de peso aberto (Sogni, Replicate, Hugging Face, fal, WaveSpeed, Civitai, a própria placa): esses já entram com o carimbo por CLASSE, que só a curadoria tira, igual ao motor sem freio da casa. Serviço com moderação (Kie, Magnific, Freepik, faceless, Krea, Midjourney, Runway, Higgsfield) entra sem carimbo, a menos que você diga isto ou o nome do motor tenha '-spicy', '-nsfw', '-uncensored'.",
    ),
  replace: z
    .boolean()
    .optional()
    .describe(
      "action=refs: false (default) SOMA às referências que já existem; true troca a lista inteira. Pra limpar tudo, mande a lista vazia com replace=true.",
    ),
  // Mesma tolerância a lista serializada como texto do referenceImageIds.
  skills: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe(
      "action=ingest: COMO A PEÇA FOI FEITA, os slugs das skills da casa que dirigiram o take (ex: ['clipe'], ['rasante','storyboard']). Aparece como 'Feito com /clipe' na ficha e na página pública da peça. No Claude Code com o plugin Sapiens o hook carimba sozinho; em outro cliente, passe sempre que o take saiu de uma skill da casa. Re-ingerir SOMA às que já estavam, nunca apaga. Metadado puro: não muda custo nem alcance.",
    ),
  uploadedSource: z
    .string()
    .optional()
    .describe(
      "action=upload: de onde veio ('magnific', 'suno', 'camera'). Fica registrado na peça e no aviso do Discord.",
    ),

  // --- action=reprovar: o veto do dono ---
  motivo: z
    .string()
    .max(500)
    .optional()
    .describe(
      "action=reprovar: O PORQUÊ do veto, numa frase concreta que a próxima geração consegue usar ('trocou o rosto da Helen: gerada só com influencerId, sem as refs do passaporte'; 'mão esquerda com seis dedos'). É a lição que fica na peça: sem ele, reprovar só esconde e não ensina. Até 500 caracteres. Reprovar de novo sem motivo mantém o que já estava escrito.",
    ),
  desfazer: z
    .boolean()
    .optional()
    .describe(
      "action=reprovar: true TIRA o veto (a peça volta a poder sair e a entrar nas levas), e o motivo vai junto. Ausente/false reprova.",
    ),

  // --- action=carimbo: o carimbo +18 da peça ---
  adulta: z
    .boolean()
    .optional()
    .describe(
      "action=carimbo: true LIGA o carimbo +18 na peça, false TIRA. Obrigatório nessa action. A regra é a do botão da ficha: a curadoria (admin) liga e tira qualquer carimbo, inclusive o que a ponte põe por CLASSE de motor sem autor; o dono liga na própria peça e só tira o carimbo que ele mesmo pôs. Peça carimbada não entra em praça de teto sfw do Distribution (Instagram, TikTok, YouTube, LinkedIn): tirar o carimbo de peça vestida é o que destrava a fila. Não tire carimbo de peça com nudez.",
    ),

  // --- action=apagar: a saída sem volta ---
  confirmar: z
    .boolean()
    .optional()
    .describe(
      "action=apagar: tem que vir true. Apagar não tem volta (a peça e o arquivo saem), então a tool recusa sem ele: só mande depois que o dono pediu pra apagar AQUELA peça. Peça que errou e deve ficar como lição vai por action=reprovar.",
    ),
});

export type GalleryArgs = z.infer<typeof gallerySchema>;

// Teto igual ao do servidor (convex/galleryImport.ts): falha aqui é mais barata
// que falhar depois de trafegar o base64 inteiro.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
// Tetos da PONTE (action=ingest pela porta do membro), espelho de
// convex/shared/ingestRules.ts. O servidor devolve os dele na uploadUrl e é o
// que manda; estes só recusam antes de trafegar o arquivo.
const MAX_INGEST_VIDEO_BYTES = 60 * 1024 * 1024;
const MAX_INGEST_IMAGE_BYTES = 12 * 1024 * 1024;
// Render de vídeo demora mais pra baixar que uma imagem.
const INGEST_FETCH_TIMEOUT_MS = 120_000;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  // Vídeo entra pela ponte (action=ingest); o upload continua só imagem.
  mp4: "video/mp4",
  mov: "video/quicktime",
};

function mimeFromPath(p: string): string | undefined {
  const ext = p.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();
  return ext ? EXT_MIME[ext] : undefined;
}

// Marcas ISO BMFF de HEIC/HEIF: imagem que a galeria não hospeda, e que sem
// esta lista passaria por vídeo (o ftyp é o mesmo do mp4).
const MARCAS_HEIF = new Set(["heic", "heix", "heim", "heis", "mif1", "msf1"]);

/**
 * O tipo da peça pelos primeiros bytes, ou undefined quando não é imagem nem
 * vídeo que a casa aceita. A extensão sozinha não prova nada: sem isto, um
 * filePath qualquer (o .env.local, uma chave) subia pro CDN como image/png, e
 * bastava uma frase plantada num README lido por skill (auditoria de prompt
 * injection, 15/10/2026).
 */
export function mimeDosBytes(b: Uint8Array): string | undefined {
  const txt = (ini: number, fim: number) =>
    b.length >= fim ? Buffer.from(b.subarray(ini, fim)).toString("latin1") : "";
  if (txt(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (txt(0, 6) === "GIF87a" || txt(0, 6) === "GIF89a") return "image/gif";
  if (txt(0, 4) === "RIFF" && txt(8, 12) === "WEBP") return "image/webp";
  if (txt(4, 8) === "ftyp") {
    // A caixa ftyp traz a marca principal e as compatíveis (o byte 12 é versão).
    const caixa = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
    const marcas = [txt(8, 12)];
    for (let i = 16; i + 4 <= caixa; i += 4) marcas.push(txt(i, i + 4));
    if (marcas.includes("avif") || marcas.includes("avis")) return "image/avif";
    if (marcas.some((m) => MARCAS_HEIF.has(m))) return undefined;
    return marcas[0] === "qt  " ? "video/quicktime" : "video/mp4";
  }
  // QuickTime antigo abre direto num átomo, sem ftyp.
  if (["moov", "mdat", "wide", "free", "skip"].includes(txt(4, 8))) return "video/quicktime";
  return undefined;
}

/** Confere que os bytes são peça (imagem; vídeo só onde aceitaVideo) e devolve o mime deles. */
function exigePeca(bytes: Uint8Array, nome: string, aceitaVideo: boolean): string {
  const mime = mimeDosBytes(bytes);
  if (!mime || (!aceitaVideo && !mime.startsWith("image/"))) {
    throw new Error(
      `${nome} não é ${aceitaVideo ? "imagem nem vídeo" : "imagem"} que a galeria aceita (o conteúdo não bate com png, jpg, webp, gif, avif${aceitaVideo ? ", mp4 ou mov" : ""}). Nada foi enviado.`,
    );
  }
  return mime;
}

const EXT_IMAGEM = ["png", "jpg", "jpeg", "webp", "gif", "avif"];
const EXT_VIDEO = ["mp4", "mov"];

/**
 * Lê o filePath de upload/ingest só quando ele É a peça: a extensão é
 * conferida ANTES de abrir o arquivo (o que não é peça nem chega a ser lido) e
 * os bytes depois. O mime que segue pro servidor é o dos bytes, não o que o
 * nome ou o argumento dizem.
 */
export async function lerPecaLocal(
  filePath: string,
  aceitaVideo: boolean,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const aceitas = aceitaVideo ? [...EXT_IMAGEM, ...EXT_VIDEO] : EXT_IMAGEM;
  const nome = basename(filePath);
  const ext = extname(filePath).slice(1).toLowerCase();
  if (!aceitas.includes(ext)) {
    throw new Error(
      `filePath aceita só ${aceitas.join(", ")}: "${nome}" não é peça. Nada foi lido nem enviado.`,
    );
  }
  const bytes = await readFile(filePath);
  return { bytes, mimeType: exigePeca(bytes, `"${nome}"`, aceitaVideo) };
}

/** Resolve sourceUrl | filePath | base64 nos bytes prontos pro Convex. */
async function resolveUploadBytes(
  args: GalleryArgs,
): Promise<{ base64: string; mimeType: string }> {
  if (args.base64?.trim()) {
    // Mesma régua do filePath: o agente que lê um arquivo e o codifica à mão
    // não pode subir texto como imagem por esta porta.
    const bytes = Buffer.from(args.base64.trim().replace(/^data:[^;]+;base64,/, ""), "base64");
    return { base64: args.base64.trim(), mimeType: exigePeca(bytes, "O base64", false) };
  }

  if (args.filePath) {
    if (isRemoteContext()) {
      throw new Error(
        "filePath só funciona no MCP instalado (stdio). No remoto, mande sourceUrl.",
      );
    }
    const { bytes: buf, mimeType } = await lerPecaLocal(args.filePath, false);
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(
        `Arquivo grande demais: ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB (teto 12 MB).`,
      );
    }
    return { base64: buf.toString("base64"), mimeType };
  }

  if (args.sourceUrl) {
    const u = assertPublicHttpsUrl(args.sourceUrl);
    const res = await fetchPublicHttps(u, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_UPLOAD_BYTES,
    });
    if (!res.ok) {
      throw new Error(`Baixar a imagem falhou: HTTP ${res.status} ${res.statusText}`);
    }
    const mimeType =
      args.mimeType || mimeFromPath(u.pathname) || res.contentType || "image/png";
    return { base64: res.bytes.toString("base64"), mimeType };
  }

  throw new Error(
    "action=upload exige a peça: sourceUrl (https), filePath (local, stdio) ou base64.",
  );
}

const AVISO_INGEST =
  "Peça NATIVA: entra na timeline PRIVADA (isPublic false), igual a qualquer geração da casa. Ela NÃO publica sozinha e NÃO vai pra comunidade: publicar é ato separado do dono, por action=publish. Custo em Sinapses é 0 e ela NÃO leva assinatura C2PA, porque o motor rodou fora. Use ingest só quando a receita (ficha do personagem, prompt, folha) foi sua; peça achada pronta é action=upload. Mostre a peça com action=list kind=video (capa + player) em vez de devolver link solto.";

/**
 * Os bytes da PONTE, resolvidos aqui (na máquina da pessoa no stdio; no
 * servidor do site no remoto, com o mesmo guard de host público do upload).
 * Devolve também a chave de idempotência: a própria URL quando veio de URL, ou
 * `sha256:<hash>` do conteúdo pra arquivo local e base64, pra o retry corrigir
 * a ficha em vez de duplicar a peça.
 */
async function resolveIngestBytes(
  args: GalleryArgs,
): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  sourceKey: string;
  /** sha256 hex dos bytes: a PROVA DE POSSE que o servidor confere contra o storage. */
  sha256: string;
}> {
  const tetoDe = (mime: string) =>
    mime.startsWith("video/") ? MAX_INGEST_VIDEO_BYTES : MAX_INGEST_IMAGE_BYTES;
  const confereTeto = (bytes: Uint8Array, mime: string, oQue: string) => {
    const teto = tetoDe(mime);
    if (bytes.byteLength > teto) {
      throw new Error(
        `${oQue} grande demais: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB (teto ${Math.round(teto / 1024 / 1024)} MB). ` +
          (mime.startsWith("video/")
            ? "Reencode em peso de web antes de trazer: ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset slow -movflags +faststart out.mp4 (um take de 15s em 1080p fica abaixo de 15 MB)."
            : "Exporte em webp ou jpg com qualidade 85."),
      );
    }
  };
  const hexDe = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  if (args.base64?.trim()) {
    const bytes = Buffer.from(
      args.base64.trim().replace(/^data:[^;]+;base64,/, ""),
      "base64",
    );
    const mimeType = exigePeca(bytes, "O base64", true);
    confereTeto(bytes, mimeType, "Peça");
    const hex = hexDe(bytes);
    return { bytes, mimeType, sourceKey: `sha256:${hex}`, sha256: hex };
  }
  if (args.filePath) {
    if (isRemoteContext()) {
      throw new Error(
        "filePath só funciona no MCP instalado (stdio). No remoto, mande sourceUrl.",
      );
    }
    const { bytes, mimeType } = await lerPecaLocal(args.filePath, true);
    confereTeto(bytes, mimeType, "Arquivo");
    const hex = hexDe(bytes);
    return { bytes, mimeType, sourceKey: `sha256:${hex}`, sha256: hex };
  }
  if (args.sourceUrl) {
    const u = assertPublicHttpsUrl(args.sourceUrl);
    const res = await fetchPublicHttps(u, {
      timeoutMs: INGEST_FETCH_TIMEOUT_MS,
      maxBytes: MAX_INGEST_VIDEO_BYTES,
    });
    if (!res.ok) {
      throw new Error(
        `Baixar o render falhou: HTTP ${res.status} ${res.statusText}. URL de render expira (Kie em 24h, Magnific no mesmo dia): se passou do prazo, baixe de novo no provedor ou mande o arquivo por filePath.`,
      );
    }
    const mimeType =
      args.mimeType || mimeFromPath(u.pathname) || res.contentType || "image/png";
    const bytes = res.bytes;
    confereTeto(bytes, mimeType, "Render");
    return { bytes, mimeType, sourceKey: args.sourceUrl, sha256: hexDe(bytes) };
  }
  throw new Error(
    "action=ingest exige a peça: sourceUrl (https), filePath (local, stdio) ou base64.",
  );
}

/**
 * A ponte, de ponta a ponta: bytes -> URL assinada do storage -> action Node
 * que move pro Bunny e grava a ficha. Três chamadas, e a chave de provedor não
 * aparece em nenhuma delas, porque o motor já rodou antes, no harness da pessoa.
 */
async function ingestPelaPonte(
  sessionToken: string,
  args: GalleryArgs,
  ficha: Record<string, unknown>,
): Promise<any> {
  const { bytes, mimeType, sourceKey, sha256 } = await resolveIngestBytes(args);
  const porta = await convexMutation<{
    uploadUrl: string;
    maxVideoBytes: number;
    maxImageBytes: number;
  }>("externalIngest:mcpIngestUploadUrl", { sessionToken });
  const teto = mimeType.startsWith("video/")
    ? porta.maxVideoBytes
    : porta.maxImageBytes;
  if (bytes.byteLength > teto) {
    throw new Error(
      `Peça grande demais pro servidor: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB (teto ${Math.round(teto / 1024 / 1024)} MB). Reencode em peso de web e tente de novo.`,
    );
  }
  const subida = await fetch(porta.uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: bytes,
  });
  if (!subida.ok) {
    throw new Error(
      `Subir a peça pro storage falhou: HTTP ${subida.status}. Tente de novo; se repetir, peça outra uploadUrl (ela vale 1h).`,
    );
  }
  const { storageId } = (await subida.json()) as { storageId: string };
  return await semSkillsSeRecusar(ficha, (f) =>
    convexAction("externalIngestNode:mcpIngestFromStorage", {
      sessionToken,
      storageId,
      mimeType,
      sourceUrl: sourceKey,
      // Prova de posse: o servidor confere contra o sha256 do storage antes de
      // mover ou apagar qualquer byte.
      contentSha256: sha256,
      unfiltered: args.unfiltered,
      ...f,
    }),
  );
}

/**
 * Servidor de antes do carimbo de skill (deploy atrasado em relação ao pacote)
 * recusa o arg que não conhece, e recusa ANTES do handler, sem tocar em nada.
 * A peça vale mais que o carimbo: tenta de novo sem ele.
 */
async function semSkillsSeRecusar<T>(
  ficha: Record<string, unknown>,
  chamar: (f: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  try {
    return await chamar(ficha);
  } catch (e) {
    if (!ficha.skills || !/extra field `?skills`?/i.test(describeConvexError(e))) throw e;
    const { skills: _semCarimbo, ...resto } = ficha;
    return await chamar(resto);
  }
}

/**
 * Normaliza `referenceImageIds` pro formato que o Convex espera (lista).
 *
 * O schema aceita lista ou string com vírgulas porque cliente MCP que serializa
 * array como texto existe de verdade, e o erro que ele produzia ("Expected
 * array, received string") não dizia nada sobre como consertar. Aqui a diferença
 * morre, e o backend continua recebendo sempre uma lista.
 */
function normalizeRefIds(raw: string[] | string | undefined): string[] {
  if (!raw) return [];
  const lista = Array.isArray(raw) ? raw : raw.split(",");
  return lista
    .map((id) => id.trim().replace(/^["'[]+|["'\]]+$/g, ""))
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * O mesmo tratamento pro elenco, com o teto de lá: seis em cena. Mesma tolerância
 * a cliente que serializa lista como texto (ver normalizeRefIds), porque o erro
 * é o mesmo e a cura também.
 */
function normalizeCastIds(raw: string[] | string | undefined): string[] {
  if (!raw) return [];
  const lista = Array.isArray(raw) ? raw : raw.split(",");
  return lista
    .map((id) => id.trim().replace(/^["'[]+|["'\]]+$/g, ""))
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * E o mesmo pras PARTES de um vídeo, com o teto de lá: dezesseis pedaços. O
 * clipe da casa tem dois takes, mas a fita longa tem mais, e o teto é do
 * servidor (MAX_PARTES em convex/videoParts.ts), não daqui.
 */
function normalizePartIds(raw: string[] | string | undefined): string[] {
  if (!raw) return [];
  const lista = Array.isArray(raw) ? raw : raw.split(",");
  return lista
    .map((id) => id.trim().replace(/^["'[]+|["'\]]+$/g, ""))
    .filter(Boolean)
    .slice(0, 16);
}

/**
 * E pras skills: lista ou texto com vírgula vira lista, vazio vira undefined
 * (campo que o servidor nem recebe). Quem limpa o slug é o servidor
 * (convex/shared/skillSlugs.ts), aqui só o formato.
 */
function normalizeSkills(raw: string[] | string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const lista = (Array.isArray(raw) ? raw : raw.split(","))
    .map((s) => s.trim().replace(/^["'[]+|["'\]]+$/g, ""))
    .filter(Boolean);
  return lista.length ? lista.slice(0, 8) : undefined;
}

export async function gallery(args: GalleryArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "list") {
    const result = await convexAction("desktopMcp:galleryList", {
      sessionToken,
      limit: args.limit ?? 20,
      model: args.model,
      skill: args.skill,
      kind: args.kind,
    });
    return {
      count: result?.items?.length ?? 0,
      items: result?.items ?? [],
    };
  }

  if (args.action === "get") {
    if (!args.imageId) {
      throw new Error("action=get exige imageId.");
    }
    return await convexAction("desktopMcp:galleryGet", {
      sessionToken,
      imageId: args.imageId,
      includeBase64: args.includeBase64 ?? false,
    });
  }

  // publish: liga isPublic na própria peça, imagem ou vídeo (o vídeo desde
  // 20/10/2026, pelo servidor: este pacote só repassa, então versão antiga
  // publica vídeo também). Imagem entra na galeria pública + feed Pinterest (e
  // /imagem/<id> se não for degen); vídeo ganha a /video/<id>. Publicado não
  // despublica (decisão do dono, 22/08/2026): a action unpublish saiu daqui, e
  // pacote antigo que ainda mandar isPublic=false toma a recusa do servidor.
  if (args.action === "publish") {
    if (!args.imageId) {
      throw new Error(
        `action=${args.action} exige imageId. Use action=list pra descobrir.`,
      );
    }
    return await convexAction("desktopMcp:gallerySetPublic", {
      sessionToken,
      imageId: args.imageId,
      isPublic: true,
    });
  }

  // upload: peça gerada FORA entra na galeria do dono. Nasce privada e assim
  // fica: o servidor recusa publicar e compartilhar um upload. Serve de
  // referência pras gerações da casa, e o derivado publica normal.
  if (args.action === "upload") {
    const { base64, mimeType } = await resolveUploadBytes(args);
    const result = await convexAction("galleryImport:mcpUploadImage", {
      sessionToken,
      base64,
      mimeType,
      note: args.note,
      uploadedSource: args.uploadedSource,
    });
    return {
      ...result,
      aviso:
        "Peça enviada de fora: fica privada, é sua e a responsabilidade é sua. Não publica nem vai pra comunidade. Use como referência (sourceImageIds em sapiens_image) e publique o que gerar a partir dela.",
    };
  }

  // ingest: a peça que a pessoa DIRIGIU (ficha do personagem, prompt dela) e um
  // motor de fora renderizou entra como NATIVA. Duas portas no servidor, o mesmo
  // contrato de peça:
  //
  //   1. A do dono (`externalIngest:mcpIngestExternal`): o SERVIDOR baixa a URL,
  //      só de host liberado, e fita grande que já mora no CDN da casa entra sem
  //      trafegar byte. Continua como sempre foi.
  //   2. A ponte (`externalIngestNode:mcpIngestFromStorage`): qualquer conta.
  //      Os bytes são resolvidos AQUI, na máquina da pessoa (URL do render,
  //      arquivo local ou base64), sobem pro storage do Convex pela URL assinada
  //      e o servidor só move pro Bunny. Sem fetch de URL do membro no servidor,
  //      sem chave de provedor em lugar nenhum: quem gerou lá fora foi o harness
  //      da pessoa, com o crédito dela.
  //
  // Com só a URL em mãos, tenta a porta do dono primeiro (é a que aceita a fita
  // grande do CDN); se o servidor recusar por cargo ou por host, cai pra ponte
  // sem a pessoa precisar saber que existem duas.
  if (args.action === "ingest") {
    if (!args.externalEngine) {
      throw new Error(
        "action=ingest exige externalEngine: qual motor renderizou, no formato provedor-motor ('kie-kling-3.0', 'fal-krea-2', 'magnific-minimax-h3', 'sogni-minimax-h3'). É o que a ficha mostra em 'Motor' e o que explica depois por que a peça não tem custo em Sinapses. Marca sozinha ('kie', 'magnific') não vale.",
      );
    }
    const temBytesLocais = Boolean(args.filePath || args.base64?.trim());
    if (!args.sourceUrl && !temBytesLocais) {
      throw new Error(
        "action=ingest exige a peça: sourceUrl (o link https do render no motor de fora), filePath (arquivo local, só no MCP instalado) ou base64.",
      );
    }
    const ficha = {
      externalEngine: args.externalEngine,
      prompt: args.prompt ?? args.note,
      externalCost: args.externalCost,
      aspectRatio: args.aspectRatio,
      size: args.size,
      referenceImageIds: normalizeRefIds(args.referenceImageIds),
      characterId: args.characterId,
      characterIds: normalizeCastIds(args.characterIds).length
        ? normalizeCastIds(args.characterIds)
        : undefined,
      skills: normalizeSkills(args.skills),
    };
    if (args.sourceUrl && !temBytesLocais) {
      try {
        const result = await semSkillsSeRecusar(ficha, (f) =>
          convexAction("externalIngest:mcpIngestExternal", {
            sessionToken,
            sourceUrl: args.sourceUrl,
            ...f,
          }),
        );
        return { ...result, aviso: AVISO_INGEST };
      } catch (e) {
        // Só as duas recusas que a ponte resolve caem pra ela. O resto (motor
        // sem nome, personagem errado, tipo recusado) é erro de verdade e sobe.
        const msg = describeConvexError(e);
        if (!/restrita ao dono|Host não liberado/i.test(msg)) throw e;
      }
    }
    const result = await ingestPelaPonte(sessionToken, args, ficha);
    return {
      ...result,
      aviso:
        AVISO_INGEST +
        (result.adulta
          ? result.adultaPor === "declaracao"
            ? " Esta nasceu com o carimbo +18 que você declarou (unfiltered): publica e fica no seu perfil e no link, só não vai pra vitrine anônima. Você tira o carimbo na ficha se mudar de ideia."
            : " Esta nasceu com o carimbo +18 por CLASSE (provedor de peso aberto ou motor sem freio): publica e fica no seu perfil e no link, só não vai pra vitrine anônima. Esse carimbo só a curadoria tira, igual ao motor sem freio da casa."
          : ""),
    };
  }

  // cast: quem está EM CENA numa peça que já existe.
  //
  // Porta separada do ingest pelo mesmo motivo do refs: o elenco quase sempre se
  // descobre depois. A fita sai do motor, o autor assiste e só então diz quem
  // apareceu. Pedir isso no disparo é pedir na hora em que ninguém sabe ainda.
  if (args.action === "cast") {
    if (!args.imageId) {
      throw new Error(
        "action=cast exige imageId: a peça que recebe o elenco. Use action=list pra achar.",
      );
    }
    const influencerIds = normalizeCastIds(args.characterIds);
    if (!influencerIds.length) {
      throw new Error(
        "action=cast exige characterIds: quem está em cena, em ordem, o protagonista primeiro. Ache os ids com sapiens_character action=list_mine.",
      );
    }
    const result = await convexMutation("imageCast:mcpSetImageCast", {
      sessionToken,
      imageId: args.imageId,
      influencerIds,
    });
    return {
      ...result,
      aviso:
        "A peça agora conta na ficha de cada um em cena. O primeiro da lista é o protagonista: é o nome que a ficha e o cartão do vídeo mostram.",
    };
  }

  // refs: acopla peças da casa a uma peça que JÁ existe (upload ou ingest).
  // A ingestão aceita refs no nascimento, mas quem sobe raramente tem os ids em
  // mãos na hora; e o upload não tinha lugar nenhum pra dizer de onde veio a
  // direção. Escreve proveniência e nada mais: upload continua sem publicar.
  if (args.action === "refs") {
    if (!args.imageId) {
      throw new Error(
        "action=refs exige imageId: a peça que RECEBE as referências. Use action=list pra achar.",
      );
    }
    const referenceImageIds = normalizeRefIds(args.referenceImageIds);
    if (!referenceImageIds.length && !args.replace) {
      throw new Error(
        "action=refs exige referenceImageIds: os ids das peças da casa que serviram de referência. Pra LIMPAR as referências, mande replace=true com a lista vazia.",
      );
    }
    return await convexMutation("externalIngest:mcpAttachReferences", {
      sessionToken,
      imageId: args.imageId,
      referenceImageIds,
      replace: args.replace,
    });
  }

  // processo: o COMO junto do QUE. O mapa de rota desenhado sobre o still, a
  // prancha de frames com o tempo de cada marco, o antes e depois de duas
  // rodadas: material que conta como a peça foi dirigida e que, solto no
  // acervo, não diz nada a ninguém. Aqui ele vira a seção "Como foi feito" na
  // página pública da peça, na ordem em que você mandar, com a sua legenda.
  //
  // Irmã do refs, e a diferença importa: refs é o INSUMO que entrou na geração,
  // processo é o REGISTRO de como ela foi dirigida. Uma lista não mexe na
  // outra.
  //
  // Peça de processo privada não aparece pra quem está de fora, nem em
  // miniatura: pra ela aparecer, publique ela também (action=publish).
  if (args.action === "processo") {
    if (!args.imageId) {
      throw new Error(
        "action=processo exige imageId: a peça FINAL que recebe o processo. Use action=list pra achar.",
      );
    }
    const itens = (args.processo ?? []).map((p) => ({
      sourceImageId: p.sourceImageId,
      ...(p.label ? { label: p.label } : {}),
    }));
    if (!itens.length && !args.replace) {
      throw new Error(
        "action=processo exige processo: a lista de peças que mostram como a peça foi feita. Pra LIMPAR, mande replace=true com a lista vazia.",
      );
    }
    return await convexMutation("processo:mcpAnexar", {
      sessionToken,
      imageId: args.imageId,
      itens,
      replace: args.replace,
    });
  }

  // parts: o parentesco entre o clipe INTEIRO e os takes que viraram ele.
  //
  // Duas perguntas na mesma action, porque quem faz uma quase sempre precisa
  // da outra. COM imageId responde a ficha daquela peça: quais são as partes
  // dela, ou de qual inteiro ela é parte. SEM imageId responde a pergunta que
  // faz a tabela existir, o que ainda NÃO foi montado: varre os takes soltos,
  // agrupa os que têm cara de par (mesmo personagem, mesmo período, prompt de
  // "Part one/Part two" ou arquivo em -a/-b) e devolve o `porque` de cada
  // agrupamento.
  //
  // O agrupamento é heurística e não monta nada sozinho: ele adianta o
  // trabalho de descobrir, quem decide é quem lê, e a ligação se fecha com
  // action=link_parts depois que o inteiro existe. characterId aqui FILTRA por
  // personagem.
  if (args.action === "parts") {
    if (args.imageId) {
      return await convexQuery("videoParts:mcpPartsOf", {
        sessionToken,
        imageId: args.imageId,
      });
    }
    return await convexQuery("videoParts:mcpPendingWholes", {
      sessionToken,
      ...(args.characterId ? { influencerId: args.characterId } : {}),
    });
  }

  // link_parts: liga na mão o inteiro aos pedaços.
  //
  // Existe porque a montagem quase nunca acontece aqui dentro: o clipe é
  // juntado no ffmpeg da máquina de quem dirige e volta por action=ingest como
  // uma peça nova, sem nenhum laço com os takes que a formaram. O juntador da
  // casa (o "compilado") e o ingest com refs de vídeo já gravam o laço
  // sozinhos; esta porta é pro resto, e pra corrigir ligação errada.
  // reprovar: o VETO do dono. A peça errou (rosto trocado, mão quebrada) e
  // não sai mais por porta nenhuma (fila do Distribution, publicar, Telegram,
  // teia) nem volta numa leva do garimpo. Fica no acervo, com o porquê, pra
  // ensinar: é o que action=reprovadas devolve antes da próxima geração.
  if (args.action === "reprovar") {
    if (!args.imageId) {
      throw new Error(
        "action=reprovar exige imageId: a peça vetada (imagem ou vídeo, o id da galeria).",
      );
    }
    if (!args.desfazer && !args.motivo?.trim()) {
      throw new Error(
        "action=reprovar exige motivo: o porquê do veto numa frase concreta. É ele que ensina a próxima geração a não repetir o erro.",
      );
    }
    return await convexAction("desktopMcp:galleryReprovar", {
      sessionToken,
      imageId: args.imageId,
      reprovada: !args.desfazer,
      motivo: args.desfazer ? undefined : args.motivo?.trim(),
    });
  }

  // carimbo: liga ou tira o +18 da peça, com a regra do botão da ficha
  // (convex/shared/adultStamp.ts). Existe porque a ponte carimba por CLASSE de
  // motor, sem autor, e vídeo vestido ficava preso fora do Instagram e do
  // YouTube até alguém abrir a ficha.
  if (args.action === "carimbo") {
    if (!args.imageId) {
      throw new Error(
        "action=carimbo exige imageId: a peça (imagem ou vídeo, o id da galeria).",
      );
    }
    if (typeof args.adulta !== "boolean") {
      throw new Error(
        "action=carimbo exige adulta: true liga o carimbo +18, false tira.",
      );
    }
    return await convexAction("desktopMcp:galleryCarimbo", {
      sessionToken,
      imageId: args.imageId,
      adulta: args.adulta,
    });
  }

  // apagar: a mesma saída do botão de excluir da ficha. A peça e o arquivo
  // saem e não voltam; quem quer guardar a lição do erro usa reprovar. O
  // confirmar=true é a trava daqui pro agente não apagar por engano.
  if (args.action === "apagar") {
    if (!args.imageId) {
      throw new Error(
        "action=apagar exige imageId: a peça que sai (imagem ou vídeo, o id da galeria).",
      );
    }
    if (args.confirmar !== true) {
      throw new Error(
        "action=apagar exige confirmar=true: apagar não tem volta. Se a peça só errou e deve ficar como lição, use action=reprovar com o motivo.",
      );
    }
    return await convexAction("desktopMcp:galleryApagar", {
      sessionToken,
      imageId: args.imageId,
    });
  }

  // reprovadas: as peças vetadas da conta, com o prompt que gerou e o porquê,
  // a mais recente primeiro. Leia ANTES de gerar de novo o mesmo personagem.
  if (args.action === "reprovadas") {
    return await convexAction("desktopMcp:galleryReprovadas", {
      sessionToken,
      characterId: args.characterId,
      limit: args.limit,
    });
  }

  if (args.action === "link_parts") {
    if (!args.imageId) {
      throw new Error(
        "action=link_parts exige imageId: o vídeo INTEIRO, o clipe montado. Use action=parts SEM imageId pra ver os pares de take que ainda não viraram um inteiro.",
      );
    }
    const partIds = normalizePartIds(args.partIds);
    if (!partIds.length) {
      throw new Error(
        "action=link_parts exige partIds: os takes que viraram esse inteiro, na ordem em que aparecem nele.",
      );
    }
    return await convexMutation("videoParts:mcpLinkParts", {
      sessionToken,
      wholeId: args.imageId,
      partIds,
    });
  }
}
