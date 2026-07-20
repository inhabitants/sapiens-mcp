import { z } from "zod";
import { convexAction, convexQuery, getSessionToken } from "../convexClient.js";

/**
 * Comunidade Sapiens — chat compartilhado entre assinantes/alumni.
 * Wrapper sobre `desktopMcp.communityList` / `communitySend` / `communityReact`
 * (escrita) + `communityChat.listParticipants` / `searchUsers` (quem está na sala).
 *
 * Claude posta como intercessor do user. Toda mensagem ganha sufixo " · via Claude"
 * pra transparência (regra do servidor, não pode ser removida).
 *
 * @mentions: escreva "@username" no content do send — o servidor resolve o
 * username, NOTIFICA a pessoa citada (sino + Telegram) e ela vê que foi marcada.
 * Use 'participants' (ou 'search_users') pra descobrir o @username certo antes.
 *
 * Gate de acesso: o paywall do servidor valida assinatura/alumni. Se o user
 * não tem acesso, list/participants devolvem vazio e send/react retornam erro.
 */
export const communitySchema = z.object({
  action: z.enum(["list", "send", "react", "participants", "search_users"]),
  roomSlug: z
    .string()
    .optional()
    .describe("Default 'geral'. Pra criar sala nova precisa do admin no site."),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Pra action=list. Default 30, max 100."),
  content: z
    .string()
    .optional()
    .describe(
      "Texto da mensagem (action=send). Max ~487 chars (suffix '· via Claude' adicionado pelo servidor). Use voz Sapiens. Marque alguém com '@username' (descubra o username via action=participants) pra notificá-lo.",
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Pra action=search_users: prefixo/parte do nome ou @username pra achar quem está na sala (autocomplete de menção). Devolve até ~8 candidatos com o username pra você marcar no send.",
    ),
  replyTo: z
    .string()
    .optional()
    .describe("communityChatMessages:_id da mensagem que está respondendo (action=send opcional)."),
  mediaAssetKind: z
    .enum(["track", "video", "film", "comic"])
    .optional()
    .describe(
      "Pra action=send: anexa uma peça do SEU acervo como card (track=faixa do Musicator, video=vídeo gerado, film=Vídeo Programático, comic=tirinha). Requer mediaAssetId. O servidor confere que a peça é sua e está pronta.",
    ),
  mediaAssetId: z
    .string()
    .optional()
    .describe(
      "Pra action=send com mediaAssetKind: o id da peça no acervo. Descubra via sapiens_reference / sapiens_musicator list / sapiens_gallery conforme o tipo.",
    ),
  asTese: z
    .boolean()
    .optional()
    .describe(
      "Pra action=send: posta a fala como TESE (card de marca no chat, pingável pro Fórum). Sem custo.",
    ),
  messageId: z
    .string()
    .optional()
    .describe("communityChatMessages:_id (obrigatório pra action=react)."),
  emoji: z
    .string()
    .optional()
    .describe(
      "Emoji da reação (action=react). Allowlist do server: 👍 🔥 ❤️ 🚀 🤯",
    ),
});

export type CommunityArgs = z.infer<typeof communitySchema>;

export async function community(args: CommunityArgs): Promise<any> {
  const sessionToken = getSessionToken();

  if (args.action === "list") {
    return await convexAction("desktopMcp:communityList", {
      sessionToken,
      roomSlug: args.roomSlug,
      limit: args.limit,
    });
  }

  if (args.action === "send") {
    if (!args.content || !args.content.trim()) {
      throw new Error("action=send exige content (texto não-vazio, mesmo com anexo).");
    }
    if (args.mediaAssetKind && !args.mediaAssetId?.trim()) {
      throw new Error("mediaAssetKind exige mediaAssetId (o id da peça no seu acervo).");
    }
    return await convexAction("desktopMcp:communitySend", {
      sessionToken,
      content: args.content,
      roomSlug: args.roomSlug,
      replyTo: args.replyTo,
      ...(args.mediaAssetKind && args.mediaAssetId?.trim()
        ? { assetRef: { kind: args.mediaAssetKind, id: args.mediaAssetId.trim() } }
        : {}),
      ...(args.asTese ? { asTese: true } : {}),
    });
  }

  if (args.action === "react") {
    if (!args.messageId) throw new Error("action=react exige messageId.");
    if (!args.emoji) throw new Error("action=react exige emoji.");
    return await convexAction("desktopMcp:communityReact", {
      sessionToken,
      messageId: args.messageId,
      emoji: args.emoji,
    });
  }

  // -------- participants: quem está na sala (pra saber quem marcar com @) --------
  // Query pública existente (gated por paywall via sessionToken). Não precisa de
  // wrapper desktopMcp nem de deploy novo — é só leitura da lista.
  if (args.action === "participants") {
    const rows: any[] = await convexQuery("communityChat:listParticipants", {
      sessionToken,
    });
    const people = (rows || []).map((p) => ({
      username: p.username,
      name: p.name ?? null,
      isBot: p.isBot === true,
      mention: p.username ? `@${p.username}` : null,
      lastActiveAt: p.lastActiveAt ?? null,
      messageCount: p.messageCount ?? 0,
    }));
    return {
      count: people.length,
      participants: people,
      note:
        "Pra falar direto com alguém, inclua o `mention` (ex: '@joao') no content " +
        "do action=send — o servidor notifica a pessoa citada. isBot=true são personas " +
        "(ex: Helen), que respondem sozinhas quando marcadas.",
    };
  }

  // -------- search_users: autocomplete de menção por nome/username --------
  if (args.action === "search_users") {
    if (!args.query || !args.query.trim()) {
      throw new Error("action=search_users exige query (parte do nome ou @username).");
    }
    const rows: any[] = await convexQuery("communityChat:searchUsers", {
      sessionToken,
      query: args.query.trim().replace(/^@/, ""),
    });
    const matches = (rows || []).map((p) => ({
      username: p.username,
      name: p.name ?? null,
      mention: p.username ? `@${p.username}` : null,
    }));
    return {
      count: matches.length,
      matches,
      note: "Use o `mention` no content do action=send pra notificar a pessoa.",
    };
  }
}
