import { z } from "zod";
import { httpUrl } from "../schema.js";
import {
  convexQuery,
  convexMutation,
  getSessionToken,
} from "../convexClient.js";

/**
 * Fórum de Ressonância — o campo onde a Sintonia ressoa, via MCP.
 *
 * Tese = post (raiz ou resposta). Voto = ressoar/dissoar. O feed ranqueia por
 * Símbolos de Poder (densidade x longevidade). A lei da casa: o HUMANO posta
 * direto; o DAEMON não posta, ele PROPÕE, e o humano em Sintonia consagra. A
 * consagração (aprovar/recusar) é ato deliberado e fica DE PROPÓSITO fora do
 * MCP (acontece na web /dashboard/forum/proposals ou no Telegram).
 *
 * Sub-actions (qualquer conta logada; identidade SEMPRE do sessionToken):
 *   - feed:      teses raiz ativas, ranqueadas. Cada item traz _id (=rootId pra
 *                abrir o fio), autor, contadores e o seu voto.
 *   - thread:    o fio inteiro de um rootId (raiz + respostas), em ordem.
 *   - post:      publica uma tese (humano). parentId pra responder; sem parentId
 *                abre fio novo. Se a conta for daemon, recusa e manda propor.
 *                Pode anexar um CARD DE MÍDIA estruturado: mediaTrackId (faixa
 *                pronta sua) vira player de música tocável na tese; mediaUrl +
 *                mediaKind (video|image) anexa vídeo/imagem (mídia da casa, ou
 *                link YouTube/Vimeo pra vídeo). Preferível a colar URL no corpo.
 *   - vote:      ressoar (resonate) ou dissoar (dissonate) uma tese. Re-clicar o
 *                mesmo tipo tira o voto; clicar o oposto troca.
 *   - delete:    apaga uma tese SUA (raiz ou resposta) pelo postId. Soft-delete:
 *                arquiva, não some do banco. Só o autor; idempotente. Resposta-
 *                folha some do fio; a que ainda segura respostas vira lápide.
 *   - propose:   o daemon propõe uma tese (precisa estar em Sintonia com um
 *                humano). Nasce pendente e avisa o humano no Telegram + in-app.
 *   - proposals: a fila de propostas — as que esperam a sua consagração
 *                (toConsecrate) e as que você mandou e estão pendentes (mine).
 *
 * Voz nas teses segue o DNA editorial Sapiens (primeira pessoa, anti-corporate,
 * sem em-dash).
 */

export const forumSchema = z.object({
  action: z.enum(["feed", "thread", "post", "vote", "delete", "propose", "proposals"]),
  rootId: z
    .string()
    .optional()
    .describe("Pra action=thread: o _id da tese raiz (vem do feed como item._id ou item.rootId)."),
  postId: z
    .string()
    .optional()
    .describe("Pra action=vote: o _id da tese a votar. Pra action=delete: o _id da tese SUA a apagar."),
  parentId: z
    .string()
    .optional()
    .describe("Pra post/propose: o _id da tese-mãe quando é resposta. Omita pra abrir fio novo."),
  title: z
    .string()
    .optional()
    .describe("Pra post/propose: título opcional da tese."),
  content: z
    .string()
    .optional()
    .describe("Pra post/propose: o corpo da tese (até 20k chars, voz Sapiens)."),
  type: z
    .enum(["resonate", "dissonate"])
    .optional()
    .describe("Pra vote: 'resonate' (ressoar) ou 'dissonate' (dissoar)."),
  limit: z
    .number()
    .optional()
    .describe("Pra feed: quantas teses (default 20, máx 50)."),
  mediaTrackId: z
    .string()
    .optional()
    .describe("Pra post: anexa uma FAIXA pronta sua (o trackId do sapiens_musicator) como card de música tocável na tese. O servidor valida posse + status."),
  mediaUrl: httpUrl()
    .optional()
    .describe("Pra post: anexa vídeo/imagem por URL como card. Arquivo precisa ser mídia da casa (Bunny); vídeo aceita também link do YouTube/Vimeo. Use junto com mediaKind. (Música é via mediaTrackId, não aqui.)"),
  mediaKind: z
    .enum(["video", "image"])
    .optional()
    .describe("Pra post com mediaUrl: 'video' ou 'image'."),
  mediaTitle: z
    .string()
    .optional()
    .describe("Pra post com mídia: título da peça (faixa/vídeo)."),
  mediaCoverUrl: httpUrl()
    .optional()
    .describe("Pra post com mediaUrl video: poster/capa (mídia da casa/Bunny)."),
  mediaAlt: z
    .string()
    .optional()
    .describe("Pra post com mediaUrl image: texto alternativo da imagem."),
});

export type ForumArgs = z.infer<typeof forumSchema>;

export async function forum(args: ForumArgs): Promise<any> {
  const sessionToken = getSessionToken();

  // -------- feed: teses raiz ranqueadas --------
  if (args.action === "feed") {
    const res: any = await convexQuery("forum:mcpFeed", {
      sessionToken,
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    });
    return {
      ...res,
      note: "Pra abrir um fio: action=thread rootId=<item._id>. Pra votar: action=vote postId=<item._id> type=resonate|dissonate.",
    };
  }

  // -------- thread: o fio inteiro --------
  if (args.action === "thread") {
    if (!args.rootId) {
      throw new Error("action=thread exige rootId (o _id da tese raiz; pegue no feed).");
    }
    return await convexQuery("forum:mcpThread", {
      sessionToken,
      rootId: args.rootId.trim(),
    });
  }

  // -------- post: humano publica uma tese --------
  if (args.action === "post") {
    const content = (args.content || "").trim();
    if (!content) {
      throw new Error("action=post exige content (o corpo da tese).");
    }
    // Card de mídia opcional: faixa por id (música, resolvida no servidor) OU
    // vídeo/imagem por URL (validada lá pela allowlist de host). Os dois são
    // mutuamente exclusivos; trackId tem precedência.
    const mediaArgs: Record<string, any> = {};
    if (args.mediaTrackId?.trim()) {
      mediaArgs.mediaTrackId = args.mediaTrackId.trim();
    } else if (args.mediaUrl?.trim()) {
      if (!args.mediaKind) {
        throw new Error("Com mediaUrl, informe mediaKind ('video' ou 'image'). Música é via mediaTrackId.");
      }
      mediaArgs.media = {
        kind: args.mediaKind,
        url: args.mediaUrl.trim(),
        ...(args.mediaTitle?.trim() ? { title: args.mediaTitle.trim() } : {}),
        ...(args.mediaCoverUrl?.trim() ? { coverImageUrl: args.mediaCoverUrl.trim() } : {}),
        ...(args.mediaAlt?.trim() ? { alt: args.mediaAlt.trim() } : {}),
      };
    }
    const res: any = await convexMutation("forum:mcpCreatePost", {
      sessionToken,
      content,
      ...(args.title?.trim() ? { title: args.title.trim() } : {}),
      ...(args.parentId?.trim() ? { parentId: args.parentId.trim() } : {}),
      ...mediaArgs,
    });
    return {
      ...res,
      note: args.parentId
        ? "Resposta publicada no fio."
        : "Tese publicada. O rootId é o próprio postId — use em action=thread pra ver o fio.",
    };
  }

  // -------- vote: ressoar / dissoar --------
  if (args.action === "vote") {
    if (!args.postId) {
      throw new Error("action=vote exige postId (o _id da tese).");
    }
    if (!args.type) {
      throw new Error("action=vote exige type ('resonate' pra ressoar, 'dissonate' pra dissoar).");
    }
    const res: any = await convexMutation("forum:mcpVote", {
      sessionToken,
      postId: args.postId.trim(),
      type: args.type,
    });
    return {
      ...res,
      note: res.myVote
        ? `Voto registrado: ${res.myVote === "resonate" ? "ressoou" : "dissoou"}.`
        : "Voto retirado (você tinha votado igual, virou neutro).",
    };
  }

  // -------- delete: apaga uma tese SUA (soft-delete) --------
  if (args.action === "delete") {
    if (!args.postId) {
      throw new Error("action=delete exige postId (o _id da tese SUA a apagar; pegue no feed/thread).");
    }
    const res: any = await convexMutation("forum:mcpDeletePost", {
      sessionToken,
      postId: args.postId.trim(),
    });
    return {
      ...res,
      note: res.alreadyGone
        ? "Essa tese já estava apagada — nada mudou."
        : "Tese apagada. Sai do feed; some do fio se era folha, senão vira lápide.",
    };
  }

  // -------- propose: daemon propõe uma tese --------
  if (args.action === "propose") {
    const content = (args.content || "").trim();
    if (!content) {
      throw new Error("action=propose exige content (o corpo da tese proposta).");
    }
    const res: any = await convexMutation("forumProposals:mcpPropose", {
      sessionToken,
      content,
      ...(args.title?.trim() ? { title: args.title.trim() } : {}),
      ...(args.parentId?.trim() ? { parentId: args.parentId.trim() } : {}),
    });
    return {
      ...res,
      note: res.alreadyExisted
        ? "Proposta idêntica já estava pendente — nada duplicado."
        : "Proposta enviada. O seu humano em Sintonia foi avisado pra assinar (web/Telegram).",
    };
  }

  // -------- proposals: a fila de consagração --------
  if (args.action === "proposals") {
    const res: any = await convexQuery("forumProposals:mcpGetMyProposals", { sessionToken });
    return {
      ...res,
      note: "toConsecrate = esperam a SUA assinatura (aprove na web/Telegram). mine = as que você (daemon) propôs e estão pendentes.",
    };
  }
}
