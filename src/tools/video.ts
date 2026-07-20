import { z } from "zod";
import {
  convexAction,
  convexQuery,
  convexMutation,
  getSessionToken,
  isRemoteContext,
} from "../convexClient.js";
import { httpUrl } from "../schema.js";

/**
 * Sapiens Video — gera vídeo (qualquer membro logado; vídeo é caro, cobra as
 * Sinapses da conta do sessionToken).
 *
 * Sub-actions:
 *   - create:   escolhe modelo + config e gera num call só (cria a row + renderiza).
 *               Habilita Seedance/Kling/WAN/Motion (WaveSpeed) e os Veo, sem o site.
 *   - generate: renderiza um imageId de vídeo já criado no site (legado).
 *   - demos:    lista os SEUS demo films (kind=demo do Estúdio de Vídeo) + estado
 *               de vitrine. Sem custo. Base pra curar o mini-cinema da vitrine.
 *   - showcase: põe/tira um demo film (por slug) da vitrine /conectar-claude, com
 *               chip (showcaseTag) e ordem (showcaseOrder). Só entra na vitrine
 *               pública se for a conta da casa. Sem custo.
 *   - shadows:  (ADMIN) extrai a SOMBRA (mapa de profundidade) de um vídeo por
 *               URL e guarda no Acervo (Corpo) como deepshadow reutilizável.
 *               200 Sinapses/segundo (durationSec; sem ela, flat 2000). Refund se falhar.
 *   - shadows-list: (ADMIN) lista o banco de motion (deepshadows + guias de corpo)
 *               com as duas views por ficha: url = sombra pura (driving pros
 *               geradores) e skeletonUrl = a soma (sombras + esqueleto, preview
 *               humano que separa personagem de objeto). Sem custo.
 *   - sonorize: dá som a um clipe SEU já gerado (MMAudio v2): imageId + prompt do
 *               som da cena -> VARIANTE nova com trilha sincronizada (o original
 *               fica intacto). Cobra por segundo do clipe; poll via action=status.
 *
 * Vídeos Programáticos (Estúdio de Vídeo, /experimentos/films) — ADMIN, sem custo.
 * A mesa de specs da casa (tabela videoSpecs, 5 kinds: demo | aula-tour | essay |
 * tipografia-musical | dataviz). A PRODUÇÃO do mp4 segue no agente local (skill
 * /film, repo films/); estas actions fecham o CICLO na plataforma sem browser:
 *   - film-list:    lista os specs (todos os kinds; filtros filmKind/filmStatus).
 *   - film-get:     um spec inteiro por slug (payload pronto pra produção).
 *   - film-upsert:  cria/atualiza spec por slug (idempotente; validação server).
 *   - film-status:  status/URL do render/duração por slug (fecho: pronto+URL).
 *   - film-publish: publica/despublica no Acervo (aba Fitas) + portfólio.
 *   - film-delete:  apaga um spec (limpar rascunho/duplicata).
 *
 * Modelos (action=create):
 *   - sapiens-video-seedance       Seedance 2.0 — cena com áudio nativo, 4-15s, 480/720/1080p (t2v/i2v)
 *   - sapiens-video-kling          Kling 3.0 Pro — dá vida a uma imagem, 3-15s, sound opcional (i2v/t2v)
 *   - sapiens-video-wan            WAN 2.5 — imagem que fala/canta (áudio+lip-sync nativo), 5/10s (i2v)
 *   - sapiens-video-kling-motion   Kling Motion — transfere o movimento de um vídeo pra uma imagem
 *                                   (PRECISA de pessoa com tronco visível na imagem E no vídeo;
 *                                   vídeo de referência MÁX 10s — o provider recusa acima disso —
 *                                   e cobra pela duração do clipe; corte antes de mandar)
 *   - sapiens-video-shot-mimic     Shot Mimic — recria o plano do vídeo de referência (câmera,
 *                                   cortes, blocking) como cena nova; personagem via role 'start'
 *                                   (vídeo de referência MÁX 15s — acima o provider corta em 15s)
 *   - sapiens-video-lite/fast/quality   Veo 3.1 (2000/5000/25000 sinapses)
 *   - sapiens-video-omni           Gemini Omni — texto -> vídeo 10s 720p com áudio nativo embutido.
 *                                   t2v + EDIÇÃO conversacional: `editOfImageId` aponta um vídeo Omni
 *                                   seu e o prompt edita a MESMA cena (troca item/personagem preservando
 *                                   o resto). Não aceita mídia do user (ignora references/durationSec/resolution).
 *
 * Custo: server-side por config (duração x resolução [x áudio]). i2v/motion usam
 * `references` em base64 (role 'start' = imagem inicial, 'end' = frame final,
 * 'driving' = vídeo de movimento do Motion).
 *
 * Retorna `{ success, url, imageId, cost }` ou `{ success: false, error }`.
 */

const VIDEO_MODELS = [
  "sapiens-video-seedance",
  "sapiens-video-kling",
  "sapiens-video-wan",
  "sapiens-video-kling-motion",
  "sapiens-video-shot-mimic",
  "sapiens-video-lite",
  "sapiens-video-fast",
  "sapiens-video-quality",
  "sapiens-video-omni",
] as const;

const FILM_KINDS = ["demo", "aula-tour", "essay", "tipografia-musical", "dataviz"] as const;
const FILM_STATUSES = ["rascunho", "na_fila", "renderizando", "pronto"] as const;

export const videoSchema = z.object({
  action: z.enum([
    "create",
    "generate",
    "status",
    "models",
    "demos",
    "showcase",
    "shadows",
    "shadows-list",
    "sonorize",
    "film-list",
    "film-get",
    "film-upsert",
    "film-status",
    "film-publish",
    "film-delete",
  ]),
  // --- Vídeos Programáticos (film-*): mesa de specs da casa, ADMIN, sem custo ---
  filmKind: z
    .enum(FILM_KINDS)
    .optional()
    .describe("film-list: filtra por kind (demo | aula-tour | essay | tipografia-musical | dataviz)."),
  filmStatus: z
    .enum(FILM_STATUSES)
    .optional()
    .describe(
      "film-status: novo status de produção (rascunho | na_fila | renderizando | pronto). " +
        "film-list: filtra por status. O fecho do render é film-status com filmStatus='pronto' + videoUrl + durationSec.",
    ),
  spec: z
    .record(z.any())
    .optional()
    .describe(
      "film-upsert: o spec inteiro como objeto JSON (validação fica no servidor, fonte única). " +
        "Shape: { kind, musicMode ('default'|'file'|'track'), musicRef?, aulaSlug? (só aula-tour), " +
        "e o payload do kind: demo | aulaTour | essay | tipoMusical | dataviz }. " +
        "Mesmo shape do 'Copiar spec' da tela /experimentos/films; descubra um exemplo real com film-get.",
    ),
  published: z
    .boolean()
    .optional()
    .describe("film-publish: true publica no Acervo (aba Fitas) + portfólio (exige pronto + videoUrl), false despublica."),
  durationSecMeasured: z
    .number()
    .optional()
    .describe("film-status: duração MEDIDA do render em segundos (ffprobe), vira a duração do card."),
  // --- action=shadows (deepshadows: extrai o mapa de profundidade de um vídeo) ---
  videoUrl: httpUrl()
    .optional()
    .describe(
      "action=shadows: URL pública (http/https) do vídeo-fonte. O servidor extrai a SOMBRA (depth) e guarda no Acervo (Corpo). ADMIN, 200 Sinapses/segundo (refund na falha). " +
        "film-status: a URL https do render no CDN (Bunny), o que acende o player do card.",
    ),
  title: z
    .string()
    .optional()
    .describe("action=shadows: nome do deepshadow (vira o slug no Acervo; re-extrair o mesmo título sobrescreve). Mín. 3 chars."),
  search: z
    .string()
    .optional()
    .describe("action=shadows-list: filtro de busca opcional (título/tags). Sem ele, lista o banco inteiro (até 300). Cada item traz url (sombra pura, driving) e skeletonUrl (soma com esqueleto, preview humano) quando existe."),
  // --- action=showcase (curadoria da vitrine /conectar-claude) ---
  slug: z
    .string()
    .optional()
    .describe(
      "action=showcase: slug do demo film a curar (descubra via action=demos). " +
        "film-get/film-status/film-publish/film-delete: slug do spec (descubra via film-list). " +
        "film-upsert: slug fixo do filme no repo films/ (idempotente: existe = atualiza, não existe = cria com esse slug); omita pra criar com slug gerado.",
    ),
  showcase: z
    .boolean()
    .optional()
    .describe("action=showcase: true põe na vitrine /conectar-claude, false tira."),
  showcaseTag: z
    .string()
    .optional()
    .describe("action=showcase: chip de capacidade do card (ex: 'Repertório', 'Galeria', 'Fórum'). Curto, até 24 chars."),
  showcaseOrder: z
    .number()
    .optional()
    .describe("action=showcase: ordem na trilha do mini-cinema (asc, 0..999; menor aparece primeiro)."),
  // --- action=create ---
  model: z
    .enum(VIDEO_MODELS)
    .optional()
    .describe(
      "action=create: modelo de vídeo. 'sapiens-video-seedance' (cinematográfico+áudio, t2v/i2v), " +
        "'sapiens-video-kling' (anima imagem, i2v/t2v), 'sapiens-video-wan' (imagem que fala, i2v), " +
        "'sapiens-video-kling-motion' (motion transfer, precisa pessoa na imagem E no vídeo de movimento; vídeo de referência MÁX 10s, cobra pela duração do clipe), " +
        "'sapiens-video-shot-mimic' (recria o plano do vídeo de referência com seu personagem: mesma câmera, mesmos cortes; 'driving' = previs/clipe do plano MÁX 15s, 'start' = personagem), " +
        "'sapiens-video-lite/fast/quality' (Veo 3.1), " +
        "'sapiens-video-omni' (Gemini Omni: texto -> vídeo 10s 720p com áudio nativo; t2v + EDIÇÃO conversacional via editOfImageId; não aceita imagem/vídeo do user, ignora duração/resolução).",
    ),
  durationSec: z
    .number()
    .optional()
    .describe(
      "action=create (modelos WaveSpeed): duração em segundos. Seedance/Shot Mimic 4-15, Kling 3-15, WAN 5/10. " +
        "Sem isso usa a config mais barata. O preço escala com a duração. " +
        "action=shadows: duração do vídeo-fonte, se souber (cobra 200/s; sem ela, flat ~2000).",
    ),
  resolution: z
    .enum(["480p", "720p", "1080p"])
    .optional()
    .describe("action=create: resolução (Seedance/WAN/Shot Mimic). Default 720p. Kling não usa (1080p nativo)."),
  audio: z
    .boolean()
    .optional()
    .describe("action=create: liga áudio. Seedance = on por default; Kling 'sound' = +50%. WAN é áudio nativo sempre."),
  editOfImageId: z
    .string()
    .optional()
    .describe(
      "action=create model=sapiens-video-omni: EDIÇÃO conversacional ('Nano Banana de vídeo'). " +
        "Passe o imageId de um vídeo Omni SEU já gerado e o prompt vira instrução de edição sobre a MESMA cena " +
        "(ex: 'troca o urso polar por um Papai Noel com um presente'), preservando câmera, ambiente e timing. " +
        "Cada edição debita como uma geração Omni nova e devolve um vídeo novo (que também pode ser editado). " +
        "Só funciona em vídeo gerado pelo Omni (não edita vídeo seu/upload).",
    ),
  // --- action=generate (legado) ---
  imageId: z
    .string()
    .optional()
    .describe(
      "action=generate ou action=status: generatedImages:_id do vídeo. O create devolve o imageId; " +
        "ou um vídeo já criado no site (o row define modelo + custo). Use sapiens_gallery action=list pra descobrir. " +
        "action=sonorize: o imageId do clipe SEU (status completed) que vai ganhar som.",
    ),
  // --- comum ---
  prompt: z
    .string()
    .optional()
    .describe("Prompt da cena. Pra i2v descreve o movimento. Default vago se omitido."),
  aspectRatio: z
    .string()
    .optional()
    .describe("'16:9' (horizontal), '9:16' (vertical), '1:1'. Vale pro t2v; i2v herda da imagem."),
  references: z
    .array(
      z.object({
        mimeType: z.string(),
        data: z.string(),
        role: z
          .string()
          .optional()
          .describe("'start' = imagem inicial (i2v), 'end' = frame final, 'driving' = vídeo de movimento (Motion)"),
      }),
    )
    .optional()
    .describe(
      "References em base64 (escape hatch / Motion / Shot Mimic). i2v: role 'start' (imagem). Motion: 'start' (pessoa) + 'driving' (vídeo de movimento, <=5MB, MÁX 10s — o Kling Motion recusa referência acima de 10s e cobra pela duração do clipe; corte o trecho antes). Shot Mimic: 'start' (personagem) + 'driving' (previs ou clipe do plano a imitar, <=5MB, MÁX 15s — acima o provider corta em 15s). Pra frame inicial/final a partir do seu acervo, prefira start/endImage* abaixo (sem precisar de base64).",
    ),
  // Frame inicial/final por REFERÊNCIA (resolvido server-side, igual à imagem):
  // id da própria galeria OU url allowlist (galeria/Acervo/personagens). Mais
  // simples que mandar base64. Descubra via sapiens_reference / sapiens_gallery.
  startImageId: z
    .string()
    .optional()
    .describe("Frame inicial (i2v): generatedImages:_id da SUA galeria. Vira reference role 'start'."),
  startImageUrl: httpUrl()
    .optional()
    .describe("Frame inicial (i2v): url pública (Bunny/Convex/Wikimedia) de galeria/Acervo/personagem. Vira reference role 'start'."),
  endImageId: z
    .string()
    .optional()
    .describe("Frame FINAL: generatedImages:_id da SUA galeria. Vira reference role 'end' (suporte varia por modelo)."),
  endImageUrl: httpUrl()
    .optional()
    .describe("Frame FINAL: url pública de galeria/Acervo/personagem. Vira reference role 'end' (suporte varia por modelo)."),
  // Frame inicial/final por ARQUIVO LOCAL (paridade com o upload do gerador do
  // site). Só no MCP instalado (stdio): o processo lê o arquivo do disco e sobe
  // como reference role 'start'/'end', sem o base64 passar pelo contexto do
  // modelo. No remoto é recusado (o path seria do servidor, não do usuário).
  startImagePath: z
    .string()
    .optional()
    .describe(
      "Frame INICIAL (i2v) a partir de um ARQUIVO LOCAL do seu PC — só no MCP instalado (stdio), não na conexão remota. " +
        "Passe o caminho absoluto (ex: 'C:\\\\Users\\\\voce\\\\HERO\\\\1.png'); o processo lê o arquivo e sobe como frame inicial, igual a subir a imagem no gerador do site. PNG/JPEG/WebP, até 8MB. " +
        "É 1 imagem inicial por vídeo (o modelo do site): pra vários vídeos, rode create uma vez por imagem. Mutuamente exclusivo com startImageId/startImageUrl.",
    ),
  endImagePath: z
    .string()
    .optional()
    .describe(
      "Frame FINAL a partir de um ARQUIVO LOCAL do seu PC — só no MCP instalado (stdio). Caminho absoluto; PNG/JPEG/WebP até 8MB. Vira reference role 'end' (suporte varia por modelo). 1 imagem por vídeo. Mutuamente exclusivo com endImageId/endImageUrl.",
    ),
});

export type VideoArgs = z.infer<typeof videoSchema>;

// Teto do arquivo local que vira frame de vídeo. Frame inicial/final não precisa
// ser pesado; 8MB cobre um PNG/JPEG grande com folga e evita estourar o payload
// da action (base64 infla ~33%).
const MAX_LOCAL_IMAGE_BYTES = 8 * 1024 * 1024;

// Detecta o mime por MAGIC BYTES (não confia na extensão). Frame de vídeo aceita
// só PNG/JPEG/WebP; qualquer outra coisa é recusada com erro claro.
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

// Lê um arquivo de imagem do disco e devolve uma reference base64 pro role dado.
// Guarda de segurança: só no stdio (o processo roda na máquina do dono do token).
// No remoto recusa ANTES de tocar o disco — ler um path arbitrário lá seria
// leitura de arquivo do servidor multi-tenant.
async function readLocalImageAsReference(
  filePath: string,
  role: "start" | "end",
): Promise<{ mimeType: string; data: string; role: string }> {
  if (isRemoteContext()) {
    throw new Error(
      `${role}ImagePath (arquivo local) só funciona no MCP instalado na sua máquina (stdio). ` +
        `Na conexão remota, suba a imagem no site e passe ${role}ImageId (id da galeria) ou ${role}ImageUrl (host Sapiens).`,
    );
  }
  const [{ default: fs }, { default: path }] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const abs = path.resolve(filePath);
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch {
    throw new Error(
      `Não achei/li o arquivo em ${role}ImagePath: "${filePath}". Use o caminho absoluto do arquivo (ex: C:\\Users\\voce\\HERO\\1.png).`,
    );
  }
  if (buf.length > MAX_LOCAL_IMAGE_BYTES) {
    const mb = (buf.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Imagem de ${role} muito grande (${mb}MB; teto ${Math.round(MAX_LOCAL_IMAGE_BYTES / (1024 * 1024))}MB). Exporte menor e tente de novo.`,
    );
  }
  const mimeType = detectImageMime(buf);
  if (!mimeType) {
    throw new Error(
      `O arquivo de ${role} não parece PNG/JPEG/WebP ("${filePath}"). O frame inicial/final aceita só imagem nesses formatos.`,
    );
  }
  return { mimeType, data: buf.toString("base64"), role };
}

// Monta as references de frame inicial/final a partir de arquivos locais,
// barrando o conflito com id/url (o site usa UMA via por frame: ou o arquivo,
// ou a imagem já hospedada). Devolve [] quando nenhum path foi passado.
export async function localFrameReferences(
  args: VideoArgs,
): Promise<Array<{ mimeType: string; data: string; role: string }>> {
  const refs: Array<{ mimeType: string; data: string; role: string }> = [];
  if (args.startImagePath) {
    if (args.startImageId || args.startImageUrl) {
      throw new Error(
        "Frame inicial: escolha UMA via — startImagePath (arquivo local) OU startImageId/startImageUrl (galeria/Acervo), não as duas.",
      );
    }
    refs.push(await readLocalImageAsReference(args.startImagePath, "start"));
  }
  if (args.endImagePath) {
    if (args.endImageId || args.endImageUrl) {
      throw new Error(
        "Frame final: escolha UMA via — endImagePath (arquivo local) OU endImageId/endImageUrl (galeria/Acervo), não as duas.",
      );
    }
    refs.push(await readLocalImageAsReference(args.endImagePath, "end"));
  }
  return refs;
}

export async function video(args: VideoArgs): Promise<any> {
  // models: catálogo VIVO dos modelos de vídeo (ativos + preço-piso/config +
  // override admin + disponibilidade). Público, sem custo e sem login — antes de
  // exigir sessão. Espelha sapiens_image action=models.
  if (args.action === "models") {
    const all: any[] = await convexQuery("videoModels:listWithOverrides", {});
    const models = (all ?? [])
      .filter((m) => m?.isActive)
      .map((m) => ({
        id: m.id,
        engine: m.engine,
        label: m.label,
        basePriceSinapses: m.basePriceSinapses,
        modes: m.modes,
        durationsSec: m.durationsSec,
        resolutions: m.resolutions,
        hasAudio: m.hasAudio,
        available: m.available,
        comingSoon: m.comingSoon,
        note: m.description,
      }));
    return {
      count: models.length,
      default: "sapiens-video-seedance",
      models,
      note: "basePriceSinapses é o PISO (config mais barata, já com override admin); o preço real escala por duração x resolução [x áudio]. available=false = 'em breve' (depende de env, ex: Omni).",
    };
  }

  const sessionToken = getSessionToken();

  if (args.action === "demos") {
    return await convexQuery("videoSpecs:mcpListMyDemoFilms", { sessionToken });
  }

  // --- Vídeos Programáticos (mesa de specs, ADMIN, sem custo) ---

  if (args.action === "film-list") {
    return await convexQuery("videoSpecs:mcpListMyVideoSpecs", {
      sessionToken,
      kind: args.filmKind,
      status: args.filmStatus,
    });
  }

  if (args.action === "film-get") {
    if (!args.slug) throw new Error("film-get exige slug (descubra via film-list).");
    return await convexQuery("videoSpecs:mcpGetVideoSpec", { sessionToken, slug: args.slug });
  }

  if (args.action === "film-upsert") {
    if (!args.spec || typeof args.spec !== "object") {
      throw new Error(
        "film-upsert exige spec (objeto JSON com kind + musicMode + payload do kind: demo | aulaTour | essay | tipoMusical | dataviz).",
      );
    }
    const { kind, musicMode, musicRef, aulaSlug, demo, aulaTour, essay, tipoMusical, dataviz } =
      args.spec as Record<string, any>;
    return await convexMutation("videoSpecs:mcpUpsertVideoSpec", {
      sessionToken,
      slug: args.slug,
      kind,
      musicMode: musicMode ?? "default",
      musicRef,
      aulaSlug,
      demo,
      aulaTour,
      essay,
      tipoMusical,
      dataviz,
    });
  }

  if (args.action === "film-status") {
    if (!args.slug) throw new Error("film-status exige slug (descubra via film-list).");
    if (args.filmStatus === undefined && args.videoUrl === undefined && args.durationSecMeasured === undefined) {
      throw new Error("film-status: passe filmStatus, videoUrl e/ou durationSecMeasured (o fecho do render é os três).");
    }
    return await convexMutation("videoSpecs:mcpSetVideoStatus", {
      sessionToken,
      slug: args.slug,
      status: args.filmStatus,
      videoUrl: args.videoUrl,
      durationSec: args.durationSecMeasured,
    });
  }

  if (args.action === "film-publish") {
    if (!args.slug) throw new Error("film-publish exige slug (descubra via film-list).");
    if (typeof args.published !== "boolean") {
      throw new Error("film-publish exige published (true publica no Acervo, false despublica).");
    }
    return await convexMutation("videoSpecs:mcpSetVideoPublished", {
      sessionToken,
      slug: args.slug,
      published: args.published,
    });
  }

  if (args.action === "film-delete") {
    if (!args.slug) throw new Error("film-delete exige slug (descubra via film-list).");
    return await convexMutation("videoSpecs:mcpDeleteVideoSpec", { sessionToken, slug: args.slug });
  }

  if (args.action === "showcase") {
    if (!args.slug) {
      throw new Error("action=showcase exige slug (descubra via action=demos).");
    }
    if (typeof args.showcase !== "boolean") {
      throw new Error("action=showcase exige showcase (true pra pôr, false pra tirar).");
    }
    return await convexMutation("videoSpecs:mcpSetVideoShowcase", {
      sessionToken,
      slug: args.slug,
      showcase: args.showcase,
      showcaseTag: args.showcaseTag,
      showcaseOrder: args.showcaseOrder,
    });
  }

  if (args.action === "status") {
    if (!args.imageId) {
      throw new Error("action=status exige imageId (o que create/generate devolveu).");
    }
    return await convexQuery("mcpExtras:mcpVideoStatus", {
      sessionToken,
      imageId: args.imageId,
    });
  }

  if (args.action === "sonorize") {
    if (!args.imageId) {
      throw new Error("action=sonorize exige imageId (o clipe SEU, já completed, que vai ganhar som).");
    }
    if (!args.prompt || args.prompt.trim().length < 4) {
      throw new Error(
        "action=sonorize exige prompt descrevendo o som da cena (ambiente, materiais, impactos, textura).",
      );
    }
    return await convexAction("mcpExtrasActions:mcpVideoSonorize", {
      sessionToken,
      sourceImageId: args.imageId,
      prompt: args.prompt,
    });
  }

  if (args.action === "create") {
    if (!args.model) {
      throw new Error(
        "action=create exige model (ex: sapiens-video-seedance, sapiens-video-kling, sapiens-video-wan, sapiens-video-kling-motion).",
      );
    }
    // Frame inicial/final por arquivo local (paridade com o upload do site):
    // lê do disco e injeta em references role start/end. O backend
    // (buildVideoReferences) já mescla references + start/end e valida o teto.
    const localRefs = await localFrameReferences(args);
    const references = localRefs.length
      ? [...(args.references ?? []), ...localRefs]
      : args.references;
    return await convexAction("mcpExtrasActions:mcpVideoCreateAndRender", {
      sessionToken,
      model: args.model,
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      durationSec: args.durationSec,
      resolution: args.resolution,
      audio: args.audio,
      references,
      startImageId: args.startImageId,
      startImageUrl: args.startImageUrl,
      endImageId: args.endImageId,
      endImageUrl: args.endImageUrl,
      editOfImageId: args.editOfImageId,
    });
  }

  if (args.action === "shadows") {
    if (!args.videoUrl) {
      throw new Error("action=shadows exige videoUrl (URL pública do vídeo-fonte).");
    }
    if (!args.title || args.title.trim().length < 3) {
      throw new Error("action=shadows exige title (mín. 3 chars; vira o slug do deepshadow).");
    }
    return await convexAction("mcpExtrasActions:mcpExtractShadows", {
      sessionToken,
      videoUrl: args.videoUrl,
      title: args.title,
      durationSec: args.durationSec,
    });
  }

  if (args.action === "shadows-list") {
    return await convexAction("mcpExtrasActions:mcpListShadows", {
      sessionToken,
      search: args.search,
    });
  }

  if (args.action === "generate") {
    if (!args.imageId) {
      throw new Error("action=generate exige imageId (vídeo já criado no site).");
    }
    const localRefs = await localFrameReferences(args);
    const references = localRefs.length
      ? [...(args.references ?? []), ...localRefs]
      : args.references;
    return await convexAction("mcpExtrasActions:mcpVideoGenerate", {
      sessionToken,
      imageId: args.imageId,
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      references,
      startImageId: args.startImageId,
      startImageUrl: args.startImageUrl,
      endImageId: args.endImageId,
      endImageUrl: args.endImageUrl,
    });
  }
}
