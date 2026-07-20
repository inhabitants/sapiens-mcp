import { z } from "zod";
import { convexQuery, convexMutation, getSessionToken } from "../convexClient.js";

/**
 * sapiens_profile — o "tudo junto" do perfil do user (/u/<username>), leitura
 * user-tier. Agrega o que mora no perfil mas estava espalhado/fora do MCP:
 * identidade + nível/XP, badges (conquistas) e golden tools (favoritos do aitag).
 *
 * Monta a partir de queries que JÁ existem em prod (sem deploy novo), igual ao
 * roster da comunidade: getDesktopUser resolve o user pelo token, e badges /
 * favoritos são queries públicas por userId.
 *
 * As partes "grandes" do perfil têm tool própria e não são duplicadas aqui:
 *   - imagens geradas/publicadas → sapiens_gallery
 *   - repertório (filmes/séries/jogos/livros/música) → sapiens_repertorio
 *   - personagens → sapiens_character
 *   - persona/arquétipo MBTI → sapiens_persona action=my_profile
 *   - saldo detalhado por bucket → sapiens_meta action=subscription
 *
 * Sub-actions:
 *   - get:          card completo (identidade + nível + saldo + badges + golden tools).
 *   - badges:       só as conquistas (lista cheia).
 *   - golden_tools: só os favoritos do aitag (lista cheia).
 *   - notifications: suas notificações recentes (sino) + contagem de não-lidas.
 *   - mark_read:    marca uma (notificationId) ou TODAS as suas não-lidas como lidas.
 *   - follow/unfollow: segue/deixa de seguir outro usuário (followingId).
 *   - update_bio:   edita a SUA bio.
 *   - update_username: troca o SEU @username.
 *   - favorite_tool: favorita/desfavorita uma ferramenta de IA (estrela do aitag).
 *   - favorite_lists: lista as SUAS listas de favoritos (Golden Tools).
 *   - create_favorite_list / delete_favorite_list: cria/apaga lista de favoritos.
 *   - add_to_favorite_list / remove_from_favorite_list: gere tools numa lista.
 */

export const profileSchema = z.object({
  action: z.enum([
    "get",
    "badges",
    "golden_tools",
    "notifications",
    "mark_read",
    "follow",
    "unfollow",
    "update_bio",
    "update_username",
    "favorite_tool",
    "favorite_lists",
    "create_favorite_list",
    "add_to_favorite_list",
    "remove_from_favorite_list",
    "delete_favorite_list",
  ]),
  limit: z
    .number()
    .optional()
    .describe("Pra notifications: quantas trazer (default 15, máx 50)."),
  notificationId: z
    .string()
    .optional()
    .describe(
      "Pra mark_read: o id de UMA notificação (vem de action=notifications). Omita pra marcar TODAS as não-lidas.",
    ),
  followingId: z
    .string()
    .optional()
    .describe(
      "Pra follow/unfollow: users:_id de QUEM seguir/deixar de seguir. Você (o seguidor) é sempre o dono da sessão. Descubra o id via sapiens_community participants/search_users ou sapiens_search.",
    ),
  bio: z
    .string()
    .optional()
    .describe("Pra update_bio: o novo texto da sua bio (perfil /u/<username>)."),
  newUsername: z
    .string()
    .optional()
    .describe(
      "Pra update_username: o novo @ (3-20 chars, alfanumérico + underscore). Já em uso ou inválido volta {success:false,error}.",
    ),
  toolId: z
    .string()
    .optional()
    .describe(
      "Pra favorite_tool / add_to_favorite_list / remove_from_favorite_list: o toolId da ferramenta de IA (aitagTools). Descubra via sapiens_repertorio action=search_tools.",
    ),
  listId: z
    .string()
    .optional()
    .describe(
      "Pra add_to_favorite_list / remove_from_favorite_list / delete_favorite_list: id da SUA lista de favoritos (via action=favorite_lists).",
    ),
  listName: z
    .string()
    .optional()
    .describe("Pra create_favorite_list: nome da lista (até 60 chars)."),
  emoji: z
    .string()
    .optional()
    .describe("Pra create_favorite_list: emoji da lista (opcional, ex '⭐')."),
  description: z
    .string()
    .optional()
    .describe("Pra create_favorite_list: descrição curta (opcional)."),
  isPublic: z
    .boolean()
    .optional()
    .describe("Pra create_favorite_list: lista pública (default true) ou privada."),
});

export type ProfileArgs = z.infer<typeof profileSchema>;

const APP = "https://sapiensinteticos.com";

async function resolveUser(sessionToken: string): Promise<any> {
  const user: any = await convexQuery("desktopAuth:getDesktopUser", { sessionToken });
  if (!user || !user._id) {
    throw new Error(
      "Sessão Sapiens inválida ou expirada. Rode sapiens_meta action=login pra reconectar.",
    );
  }
  return user;
}

function mapBadges(rows: any[]): any[] {
  return (rows || []).map((b) => ({
    name: b?.badge?.name ?? null,
    description: b?.badge?.description ?? null,
    xpReward: b?.badge?.xpReward ?? null,
    earnedAt: b?.earnedAt ?? b?.awardedAt ?? b?._creationTime ?? null,
  }));
}

function mapTools(rows: any[]): any[] {
  return (rows || []).filter(Boolean).map((t) => ({
    name: t?.name ?? null,
    slug: t?.slug ?? null,
    category: t?.category ?? t?.categorySlug ?? null,
    url: t?.websiteUrl ?? t?.url ?? null,
  }));
}

export async function profile(args: ProfileArgs): Promise<any> {
  const sessionToken = getSessionToken();

  // notifications/mark_read autenticam pelo próprio sessionToken (requireMcpUser
  // no Convex), não precisam do resolveUser — atalham antes.
  if (args.action === "notifications") {
    const res: any = await convexQuery("notifications:mcpListMine", {
      sessionToken,
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    });
    return {
      ...res,
      note:
        "Pra marcar lida: action=mark_read (com notificationId pra uma só, ou sem pra todas).",
    };
  }

  if (args.action === "mark_read") {
    const res: any = await convexMutation("notifications:mcpMarkRead", {
      sessionToken,
      ...(args.notificationId?.trim()
        ? { notificationId: args.notificationId.trim() }
        : {}),
    });
    return {
      ...res,
      note: args.notificationId
        ? "Notificação marcada como lida."
        : `Marquei ${res.updated} notificação(ões) como lida(s).`,
    };
  }

  // Escritas do perfil (autenticam pelo sessionToken; identidade sempre do
  // token, o cliente só escolhe alvo/valor). Despacham antes do resolveUser.
  if (args.action === "follow" || args.action === "unfollow") {
    if (!args.followingId?.trim()) {
      throw new Error(
        `action=${args.action} exige followingId (users:_id de quem seguir). Descubra via sapiens_community participants/search_users.`,
      );
    }
    const fn = args.action === "follow" ? "users:mcpFollowUser" : "users:mcpUnfollowUser";
    const res: any = await convexMutation(fn, {
      sessionToken,
      followingId: args.followingId.trim(),
    });
    return { ...res, action: args.action };
  }

  if (args.action === "update_bio") {
    if (typeof args.bio !== "string") {
      throw new Error("action=update_bio exige bio (o novo texto do perfil).");
    }
    const res: any = await convexMutation("users:mcpUpdateBio", {
      sessionToken,
      bio: args.bio,
    });
    return { ...res, note: "Bio atualizada." };
  }

  if (args.action === "update_username") {
    if (!args.newUsername?.trim()) {
      throw new Error("action=update_username exige newUsername (3-20 chars).");
    }
    const res: any = await convexMutation("users:mcpUpdateUsername", {
      sessionToken,
      newUsername: args.newUsername.trim(),
    });
    // doUpdateUsername devolve {success:false,error} quando inválido/tomado.
    return res;
  }

  // Favoritos de ferramentas de IA (Golden Tools do aitag). Autenticam pelo
  // sessionToken (requireMcpUser no Convex). O toolId vem de
  // sapiens_repertorio action=search_tools.
  if (args.action === "favorite_lists") {
    return await convexQuery("aitag/favorites:mcpListFavoriteLists", { sessionToken });
  }

  if (args.action === "favorite_tool") {
    if (!args.toolId?.trim()) {
      throw new Error("action=favorite_tool exige toolId (via sapiens_repertorio action=search_tools).");
    }
    return await convexMutation("aitag/favorites:mcpToggleFavorite", {
      sessionToken,
      toolId: args.toolId.trim(),
    });
  }

  if (args.action === "create_favorite_list") {
    if (!args.listName?.trim()) {
      throw new Error("action=create_favorite_list exige listName.");
    }
    return await convexMutation("aitag/favorites:mcpCreateFavoriteList", {
      sessionToken,
      name: args.listName.trim(),
      emoji: args.emoji,
      description: args.description,
      isPublic: args.isPublic,
    });
  }

  if (args.action === "add_to_favorite_list" || args.action === "remove_from_favorite_list") {
    if (!args.toolId?.trim() || !args.listId?.trim()) {
      throw new Error(`action=${args.action} exige toolId e listId (listId via action=favorite_lists).`);
    }
    const fn =
      args.action === "add_to_favorite_list"
        ? "aitag/favorites:mcpAddToFavoriteList"
        : "aitag/favorites:mcpRemoveFromFavoriteList";
    return await convexMutation(fn, {
      sessionToken,
      toolId: args.toolId.trim(),
      listId: args.listId.trim(),
    });
  }

  if (args.action === "delete_favorite_list") {
    if (!args.listId?.trim()) {
      throw new Error("action=delete_favorite_list exige listId (via action=favorite_lists).");
    }
    return await convexMutation("aitag/favorites:mcpDeleteFavoriteList", {
      sessionToken,
      listId: args.listId.trim(),
    });
  }

  const user = await resolveUser(sessionToken);
  const userId = user._id;

  if (args.action === "badges") {
    const rows: any[] = await convexQuery("gamification:getUserBadges", { userId });
    const badges = mapBadges(rows);
    return { count: badges.length, badges };
  }

  if (args.action === "golden_tools") {
    const rows: any[] = await convexQuery("aitag/favorites:listFavoritesByUserId", {
      userId,
    });
    const tools = mapTools(rows);
    return {
      count: tools.length,
      tools,
      note: "Favoritos do aitag (golden tools). Marque/desmarque pelo aitag.app.",
    };
  }

  // get: card completo
  const [badgeRows, toolRows] = await Promise.all([
    convexQuery("gamification:getUserBadges", { userId }),
    convexQuery("aitag/favorites:listFavoritesByUserId", { userId }),
  ]);
  const badges = mapBadges(badgeRows as any[]);
  const tools = mapTools(toolRows as any[]);

  return {
    identity: {
      username: user.username ?? null,
      name: user.name ?? null,
      avatarUrl: user.avatarUrl ?? user.image ?? null,
      level: user.level ?? null,
      xp: user.xp ?? null,
      isPremium: user.isPremium === true,
      profileUrl: user.username ? `${APP}/u/${user.username}` : null,
    },
    credits: typeof user.totalCredits === "number" ? user.totalCredits : null,
    badges: {
      count: badges.length,
      items: badges.slice(0, 30),
    },
    goldenTools: {
      count: tools.length,
      items: tools.slice(0, 30),
    },
    note:
      "Card do perfil: identidade + nível + saldo + badges + golden tools (favoritos do aitag). " +
      "O resto do perfil tem tool própria: imagens=sapiens_gallery, repertório=sapiens_repertorio, " +
      "personagens=sapiens_character, persona/MBTI=sapiens_persona action=my_profile.",
  };
}
